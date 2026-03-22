import {
  subscribeToPlaylists,
  addPlaylist,
  updatePlaylist,
  deletePlaylist,
  getOrCreateDailyPlan,
  subscribeToDailyPlan,
  updateDailyPlan,
} from "./playlists.service.js";

import {
  generateDailyPlan,
  updateStatuses,
  getTodayKey
} from "./playlists.engine.js";

let currentPlaylists = [];
let currentPlan = [];
let lastPlanSnapshot = null;
let undoTimeout = null;
let editingPlaylistId = null;

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
  });
  
  setupEventListeners();
  initPlaylistTabs();
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

function renderDailyPlan(plan) {
  const container = document.getElementById("dailyPlan");
  if (!container) return;

  //const todayKey = new Date().toISOString().split('T')[0];

  container.innerHTML = plan.map((block, index) => {
    const playlist = currentPlaylists.find(p => p.id === block.playlist);
    const used = playlist ? isUsedToday(playlist.lastUsed) : false;

    return `
      <div class="card" style="${used ? 'border-left 4px solid var(--color-success); opacity: 0.8;' : ''}">
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
  const newPlan = generateDailyPlan(currentPlaylists);
  
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