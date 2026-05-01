import {
  subscribeToPlaylists,
  addPlaylist,
  updatePlaylist,
  deletePlaylist,
  getOrCreateDailyPlan,
  subscribeToDailyPlan,
  updateDailyPlan,
  markAsReviewed,
} from "./playlists.service.js";

import {
  generateDailyPlan,
  updateStatuses,
  getTodayKey,
  loadRandomReviewSet
} from "./playlists.engine.js";

let currentPlaylists = [];
let currentPlan = [];
let lastPlanSnapshot = null;
let undoTimeout = null;
let editingPlaylistId = null;
let currentReviewSet = [];

/* ===============================
   INIT
================================ */
export async function init() {
  const todayKey = getTodayKey();

  // 1. Subscribe to Playlists
  subscribeToPlaylists(async (playlists) => {
    currentPlaylists = playlists;
    updateStatuses(currentPlaylists);

    renderPlaylistManager(currentPlaylists);
    renderCleaning(currentPlaylists);
    renderDailyPlan(currentPlan);

    await getOrCreateDailyPlan(todayKey, () => generateDailyPlan(currentPlaylists));
  });

  // 2. Subscribe to Daily Plan
  await subscribeToDailyPlan(todayKey, (blocks) => {
    currentPlan = blocks;
    renderDailyPlan(blocks);
    renderMaintenanceTab(blocks);
  });
  
  setupEventListeners();
  initPlaylistTabs();
}

/* ===============================
   REVIEW RENDER & ACTIONS
================================ */

async function handleRefreshReview() {
    const container = document.getElementById("randomReviewContainer");
    if (container) container.innerHTML = "<div class='loader'></div>";
    
    currentReviewSet = await loadRandomReviewSet();
    renderRandomReview(currentReviewSet);
}

function renderRandomReview(reviewSet) {
    const container = document.getElementById("randomReviewContainer");
    if (!container) return;

    if (reviewSet.length === 0) {
        container.innerHTML = "<p class='text-muted'>No playlists available for review.</p>";
        return;
    }

    container.innerHTML = reviewSet.map(p => `
        <div class="card review-card" data-id="${p.id}">
            <div style="margin-bottom: 10px;">
                <strong style="display:block; font-size: 1.1em;">${p.name}</strong>
                <small class="text-muted">ID: ${p.id.substring(0,8)}...</small>
            </div>
            <div class="review-actions" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <button class="btn-primary btn-sm" data-id="${p.id}" data-action="review-ok">✅ OK</button>
                <button class="btn-secondary btn-sm" data-id="${p.id}" data-action="edit">✏️ Edit</button>
                <button class="btn-secondary btn-sm" data-id="${p.id}" data-action="review-merge">🔗 Merge</button>
                <button class="btn-secondary btn-sm" data-id="${p.id}" data-action="delete" style="color:var(--color-danger)">🗑️</button>
            </div>
        </div>
    `).join("");
}

/* --- UI Logic --- */

const isUsedToday = (lastUsed) => {
    if (!lastUsed) return false;
    const today = new Date().toISOString().split('T')[0];
    const date = (typeof lastUsed.toDate === 'function') ? lastUsed.toDate() : new Date(lastUsed);
    return date.toISOString().split('T')[0] === today;
};

function initPlaylistTabs() {
  const tabsContainer = document.querySelector(".tabs");
  const panels = document.querySelectorAll(".tab-panel");

  tabsContainer?.addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;

    const target = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === tab));
    panels.forEach(p => p.classList.toggle("active", p.id === `tab-${target}`));
  });
}

/* ===============================
    RENDER FUNCTIONS
================================ */

// playlists.js
function renderDailyPlan(plan) {
  const container = document.getElementById("dailyPlan");
  if (!container || !plan) return;

  // FILTER: Exclude the maintenance/review block from this specific view
  const scheduleBlocks = plan.filter(block => block.type !== "review_block");

  container.innerHTML = scheduleBlocks.map((block, index) => {
    const playlistId = block.playlistId || block.playlist;
    const playlist = currentPlaylists.find(p => p.id === playlistId);
    const used = playlist ? isUsedToday(playlist.lastUsed) : false;

    return `
      <div class="card" style="${used ? 'border-left: 4px solid var(--color-success); opacity: 0.8;' : ''}">
        <h4>${block.label} <small style="color:var(--text-muted)">(${block.context})</small></h4>
        <p><strong>${playlist ? playlist.name : "Silence"}</strong></p>
        <div style="display:flex; gap:8px">
          ${playlist ? `<button class="btn-primary ${used ? 'btn-success' : ''}" data-id="${playlist.id}" data-action="use" ${used ? 'disabled' : ''}>${used ? 'Done! ✅' : 'Mark as Used'}</button>` : ""}
          <button class="btn-secondary" data-index="${index}" data-action="swap">Swap</button>
        </div>
      </div>
    `;
  }).join("");
}

// playlists.js
function renderMaintenanceTab(plan) {
  const container = document.getElementById("randomReviewContainer");
  if (!container || !plan) return;

  // FIND: Grab the specific review block from the saved daily plan
  const reviewBlock = plan.find(block => block.type === "review_block");

  if (!reviewBlock || !reviewBlock.items || reviewBlock.items.length === 0) {
    container.innerHTML = `<p class="text-muted">No review set generated for today. Hit regenerate to create one.</p>`;
    return;
  }

  container.innerHTML = reviewBlock.items.map(p => `
    <div class="card review-card" style="border-top: 3px solid var(--accent);">
      <div style="margin-bottom: 12px;">
        <strong style="font-size: 1.1rem; display: block; margin-bottom: 4px;">${p.name}</strong>
        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
          <span class="badge">⭐ P${p.priority}</span>
          ${(p.contexts || []).map(c => `<span class="tag">${c}</span>`).join("")}
        </div>
      </div>
      <div class="review-actions" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <button class="btn-success btn-sm" data-id="${p.id}" data-action="review-ok">✅ OK</button>
        <button class="btn-secondary btn-sm" data-id="${p.id}" data-action="edit">✏️ Edit</button>
        <button class="btn-secondary btn-sm" data-id="${p.id}" data-action="review-merge">🔗 Merge</button>
        <button class="btn-secondary btn-sm" data-id="${p.id}" data-action="delete" style="color:var(--color-danger)">🗑️</button>
      </div>
    </div>
  `).join("");
}

function renderPlaylistManager(playlists) {
  const container = document.getElementById("playlistManager");
  if (!container) return;

  container.innerHTML = playlists.map(p => {
    if (editingPlaylistId === p.id) {
      return `
        <div class="card" style="border-left: 4px solid var(--accent)">
          
          <input type="text" value="${p.name}" data-id="${p.id}" class="edit-name"/>

          <div style="margin: 12px 0;">
            Priority:
            <input type="number" min="1" max="5" value="${p.priority}" 
              data-id="${p.id}" class="edit-priority" style="width:60px; margin-left:10px;" />
          </div>

          <div class="context-chips">
            ${renderContextCheckboxes(p.contexts)}
          </div>

          <div style="margin-top:15px;">
            <button data-id="${p.id}" data-action="save-edit" class="btn-primary">Save</button>
            <button data-action="cancel-edit" class="btn-secondary">Cancel</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="card" style="border-left: 4px solid var(--accent)">
        <strong>${p.name}</strong>

        <div style="font-size: 13px; margin: 8px 0;color: var(--text-muted);">
          Priority: ${p.priority} | Status: ${p.status}
        </div>

        <div style="display:flex; gap:5px">
          <button data-id="${p.id}" data-action="edit" class="btn-secondary">Edit</button>
          <button data-id="${p.id}" data-action="archive" class="btn-secondary">Archive</button>
          <button data-id="${p.id}" data-action="delete" class="btn-secondary" style="color:var(--color-danger)">Delete</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderContextCheckboxes(selected = []) {
  return ["Gym", "Work", "Driving", "Relax", "Free"].map(ctx => `
    <label style="margin-right:12px; font-size: 14px;">
      <input type="checkbox" value="${ctx}" 
        ${selected.includes(ctx) ? "checked" : ""} />
      ${ctx}
    </label>
  `).join("");
}

/* ===============================
    EVENT HANDLERS
================================ */
function setupEventListeners() {
  document.getElementById("dailyPlan")?.addEventListener("click", handlePlanActions);
  document.getElementById("playlistManager")?.addEventListener("click", handleManagerActions);
  document.getElementById("regenBtn")?.addEventListener("click", handleRegenerate);
  document.getElementById("randomReviewContainer")?.addEventListener("click", handleReviewActions);
  document.getElementById("refreshRandomBtn")?.addEventListener("click", handleRefreshReview);

  // Form for Adding New Playlist
  document.getElementById("addPlaylistBtn")?.addEventListener("click", async () => {
    const container = document.getElementById("addPlaylistForm");
    const name = document.getElementById("newName").value.trim();
    const priority = Number(document.getElementById("newPriority").value);
    const contexts = Array.from(container.querySelectorAll("input[type=checkbox]:checked")).map(c => c.value);

    if (!name || contexts.length === 0) return alert("Missing info");

    await addPlaylist({ name, priority, contexts, status: "active", lastUsed: null });
    
    // Reset form
    document.getElementById("newName").value = "";
    container.querySelectorAll("input[type=checkbox]").forEach(c => c.checked = false);
  });
}

async function handlePlanActions(e) {
  const btn = e.target.closest("button");
  if (!btn) return;

  const { action, id } = btn.dataset;
  if (action === "use") { await markAsUsed(id, btn); }

  if (action === "swap") { alert("Swap logic triggered (Implement in engine.js)"); }
}

async function handleManagerActions(e) {
  const btn = e.target.closest("button");
  if (!btn) return;
  const { action, id } = btn.dataset;

  if (action === "edit") {
    editingPlaylistId = id;
    renderPlaylistManager(currentPlaylists);
  } else if (action === "cancel-edit") {
    editingPlaylistId = null;
    renderPlaylistManager(currentPlaylists);
  } else if (action === "save-edit") {
    const card = btn.closest(".card");
    const updateData = {
      name: card.querySelector(".edit-name").value.trim(),
      priority: Number(card.querySelector(".edit-priority").value),
      contexts: Array.from(card.querySelectorAll("input[type=checkbox]:checked")).map(c => c.value)
    };
    editingPlaylistId = null;
    await updatePlaylist(id, updateData);
  } else if (action === "delete" && confirm("Delete this playlist?")) {
    await deletePlaylist(id);
  } else if (action === "archive") {
    await updatePlaylist(id, { status: "archived" });
  }
}

async function handleReviewActions(e) {
    const btn = e.target.closest("button");
    if (!btn) return;

    const { action, id } = btn.dataset;

    if (action === "review-ok") {
        await markAsReviewed(id);
        // Remove from local view immediately for better UX
        currentReviewSet = currentReviewSet.filter(p => p.id !== id);
        renderRandomReview(currentReviewSet);
        
        // If all 3 are done, auto-refresh
        if (currentReviewSet.length === 0) handleRefreshReview();
        
    } else if (action === "review-merge") {
        const targetName = prompt("Enter the name of the playlist to merge THIS one INTO:");
        if (targetName) alert(`Logic: Search for "${targetName}", move items, then delete ${id}`);
    } 
}

/* --- Core Logic Actions --- */

export async function markAsUsed(id, btnElement) {
  const originalText = btnElement.innerHTML;
  btnElement.disabled = true;
  btnElement.innerHTML = "Updating..."

  try {
    await updatePlaylist(id, { lastUsed: new Date(), status: "active" });

  } catch (error) {
    btnElement.disabled = false;
    btnElement.innerHTML = originalText;
    alert("Falied to update.")
  }
}

async function handleRegenerate() {
  const todayKey = getTodayKey();
    
  lastPlanSnapshot = [...currentPlan]; // For undo
  const newPlan = await generateDailyPlan(currentPlaylists);
  
  await updateDailyPlan(todayKey, newPlan);
  showUndoToast(todayKey);  
}

function showUndoToast(todayKey) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  if (undoTimeout) clearTimeout(undoTimeout);
  container.innerHTML = "";

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <span>Plan regenerated</span>
    <button class="btn-secondary" id="undoBtn" style="padding: 4px 8px;">Undo</button>
    <div class="toast-progress"></div>
  `;

  container.appendChild(toast);

  toast.querySelector("#undo-btn").onclick = async () => {
    if (lastPlanSnapshot) {
      await updateDailyPlan(todayKey, lastPlanSnapshot);
      toast.remove();
    }
  };

  undoTimeout = setTimeout(() => {
    toast.remove();
    lastPlanSnapshot = null;
  }, 5000);
}

function renderCleaning(playlists) {
  const container = document.getElementById("cleaningList");
  if (!container) return;

  const fortyFiveDaysAgo = Date.now() - (45 * 24 * 60 * 60 * 1000);
  const neglected = playlists.filter(p => p.lastUsed && new Date(p.lastUsed).getTime() < fortyFiveDaysAgo);

  container.innerHTML = neglected.length ? neglected.map(p => `
    <div class="card" style="display:flex; justify-content:space-between; align-items:center;">
      <span>${p.name}</span>
      <button class="btn-secondary" data-id="${p.id}" data-action="archive">Archive</button>
    </div>
  `).join("") : `<p class="text-muted">All playlists are fresh!</p>`;
}