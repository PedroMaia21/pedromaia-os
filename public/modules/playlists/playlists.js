import {
  subscribeToPlaylists,
  addPlaylist,
  updatePlaylist,
  deletePlaylist,
  getOrCreateDailyPlan,
  subscribeToDailyPlan,
  updateDailyPlan,
  createDailyPlan,
  generateDailyPlanPayload,
  overrideBlockContext,
  markBlockUsed,
  markAsReviewed,
  getPlannedOverride,
  setPlannedOverride,
  resetPlannedOverride,
} from "./playlists.service.js";

import {
  updateStatuses,
  getTodayKey,
  loadRandomReviewSet,
  ContextType,
  getDefaultTemplate,
  getDefaultContextsForDate,
  getBlockLabel,
  getAllBlockKeys,
  DEFAULT_BLOCKS
} from "./playlists.engine.js";

let currentPlaylists = [];
let currentPlan = [];
let lastPlanSnapshot = null;
let undoTimeout = null;
let editingPlaylistId = null;
let currentReviewSet = [];
let pendingSwapData = null;

/* ===============================
   CONTEXT SELECTION MODAL
================================ */
function showContextSelectionModal(blockLabel, currentContext, onConfirm) {
  const modal = document.getElementById("contextSelectionModal");
  const title = document.getElementById("contextSelectionTitle");
  const label = document.getElementById("contextSelectionLabel");
  const dropdown = document.getElementById("contextSelectionDropdown");
  const confirmBtn = document.getElementById("contextSelectionConfirm");
  const cancelBtn = document.getElementById("contextSelectionCancel");

  if (!modal) {
    console.warn("Context selection modal not found in DOM");
    return;
  }

  title.textContent = `Select Context for ${blockLabel}`;
  label.textContent = `Current: ${currentContext}`;

  dropdown.innerHTML = Object.values(ContextType).map(ctx => `
    <option value="${ctx}" ${ctx === currentContext ? "selected" : ""}>${ctx}</option>
  `).join("");

  modal.style.display = "flex";

  const handleConfirm = () => {
    const selectedContext = dropdown.value;
    if (selectedContext) {
      onConfirm(selectedContext);
    }
    closeContextModal();
  };

  const closeContextModal = () => {
    modal.style.display = "none";
    confirmBtn.removeEventListener("click", handleConfirm);
    cancelBtn.removeEventListener("click", closeContextModal);
    modal.removeEventListener("click", handleBackdropClick);
  };

  const handleBackdropClick = (e) => {
    if (e.target === modal) closeContextModal();
  };

  confirmBtn.addEventListener("click", handleConfirm);
  cancelBtn.addEventListener("click", closeContextModal);
  modal.addEventListener("click", handleBackdropClick);
}

/* ===============================
   INIT
================================ */
export async function init() {
  const todayKey = getTodayKey();

  // Initialize Plan Day date input with today's date
  const dateInput = document.getElementById("planDayDateInput");
  if (dateInput) {
    dateInput.value = todayKey;
  }

  // 1. Subscribe to Playlists
  subscribeToPlaylists(async (playlists) => {
    currentPlaylists = playlists;
    updateStatuses(currentPlaylists);

    renderPlaylistManager(currentPlaylists);
    renderCleaning(currentPlaylists);
    renderDailyPlan(currentPlan);

    await getOrCreateDailyPlan(todayKey, () => createDailyPlan(todayKey, currentPlaylists));
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
    const used = block.used === true || (playlist ? isUsedToday(playlist.lastUsed) : false);
    const blockKey = block.key || String(block.label || "").toLowerCase().replace(/\s+/g, "");

    return `
      <div class="card" style="${used ? 'border-left: 4px solid var(--color-success); opacity: 0.8;' : ''}">
        <h4>${block.label} <small style="color:var(--text-muted)">(${block.context})</small></h4>
        <p><strong>${playlist ? playlist.name : "Silence"}</strong></p>
        <div style="display:flex; gap:8px">
          ${playlist ? `<button class="btn-primary ${used ? 'btn-success' : ''}" data-id="${playlist.id}" data-block-key="${blockKey}" data-action="use" ${used ? 'disabled' : ''}>${used ? 'Done! ✅' : 'Mark as Used'}</button>` : ""}
          <button class="btn-secondary" data-index="${index}" data-block-key="${blockKey}" data-action="swap" ${used ? 'disabled' : ''}>Swap</button>
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

  // Plan Day handlers
  document.getElementById("planDayDateInput")?.addEventListener("change", handlePlanDayDateChange);
  document.getElementById("savePlannedOverrideBtn")?.addEventListener("click", handleSavePlannedOverride);
  document.getElementById("resetPlannedOverrideBtn")?.addEventListener("click", handleResetPlannedOverride);

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

/* ===============================
   PLAN DAY HANDLERS
================================ */
async function handlePlanDayDateChange() {
  const dateInput = document.getElementById("planDayDateInput");
  const selectedDate = dateInput.value;
  if (!selectedDate) return;

  await renderPlanDayBlocks(selectedDate);
}

async function renderPlanDayBlocks(dateKey) {
  const container = document.getElementById("planDayBlocksContainer");
  if (!container) return;

  try {
    const defaultContexts = getDefaultContextsForDate(dateKey);
    const plannedOverride = await getPlannedOverride(dateKey);

    container.innerHTML = getAllBlockKeys().map(blockKey => {
      const block = DEFAULT_BLOCKS.find(b => b.key === blockKey);
      const selectedContext = plannedOverride[blockKey] || defaultContexts[blockKey];

      return `
        <div class="card" style="padding: 12px;">
          <div style="margin-bottom: 8px;">
            <strong style="display: block; margin-bottom: 4px;">${block.label}</strong>
            <small class="text-muted">Default: ${defaultContexts[blockKey]}</small>
          </div>
          <select data-block-key="${blockKey}" data-block-label="${block.label}" style="width: 100%; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px;">
            ${Object.values(ContextType).map(ctx => `
              <option value="${ctx}" ${ctx === selectedContext ? "selected" : ""}>${ctx}</option>
            `).join("")}
          </select>
        </div>
      `;
    }).join("");
  } catch (error) {
    container.innerHTML = `<p class="text-muted">Error loading blocks: ${error.message}</p>`;
  }
}

async function handleSavePlannedOverride() {
  const dateInput = document.getElementById("planDayDateInput");
  const selectedDate = dateInput.value;
  const messageDiv = document.getElementById("planDayMessage");

  if (!selectedDate) {
    showMessage(messageDiv, "Please select a date", "error");
    return;
  }

  const blockSelects = document.querySelectorAll("#planDayBlocksContainer select");
  const overrides = {};

  blockSelects.forEach(select => {
    const blockKey = select.dataset.blockKey;
    const selectedContext = select.value;
    overrides[blockKey] = selectedContext;
  });

  try {
    await setPlannedOverride(selectedDate, overrides);
    showMessage(messageDiv, "✅ Overrides saved successfully", "success");
  } catch (error) {
    showMessage(messageDiv, `❌ Error: ${error.message}`, "error");
  }
}

async function handleResetPlannedOverride() {
  const dateInput = document.getElementById("planDayDateInput");
  const selectedDate = dateInput.value;
  const messageDiv = document.getElementById("planDayMessage");

  if (!selectedDate) {
    showMessage(messageDiv, "Please select a date", "error");
    return;
  }

  try {
    await resetPlannedOverride(selectedDate);
    await renderPlanDayBlocks(selectedDate);
    showMessage(messageDiv, "↺ Reset to default template", "success");
  } catch (error) {
    showMessage(messageDiv, `❌ Error: ${error.message}`, "error");
  }
}

function showMessage(messageDiv, text, type) {
  if (!messageDiv) return;

  messageDiv.textContent = text;
  messageDiv.style.display = "block";
  messageDiv.style.backgroundColor = type === "error" ? "#fee" : "#efe";
  messageDiv.style.color = type === "error" ? "#c33" : "#3c3";
  messageDiv.style.borderLeft = `4px solid ${type === "error" ? "#c33" : "#3c3"}`;

  setTimeout(() => {
    messageDiv.style.display = "none";
  }, 3000);
}


async function handlePlanActions(e) {
  const btn = e.target.closest("button");
  if (!btn) return;

  const { action, id, blockKey } = btn.dataset;

  if (action === "use") {
    await markAsUsed(id, btn, blockKey);
  }

  if (action === "swap") {
    const block = currentPlan.find(b => b.key === blockKey || b.label === blockKey || String(b.label || "").toLowerCase().replace(/\s+/g, "") === blockKey);
    if (!block) return;

    if (block.used) {
      return alert("Cannot swap a block after it has been marked as used.");
    }

    showContextSelectionModal(block.label, block.context, async (selectedContext) => {
      try {
        await overrideBlockContext(getTodayKey(), blockKey, selectedContext);
      } catch (error) {
        alert(`Error: ${error.message}`);
      }
    });
  }
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

export async function markAsUsed(id, btnElement, blockKey) {
  const originalText = btnElement.innerHTML;
  btnElement.disabled = true;
  btnElement.innerHTML = "Updating..."

  try {
    await updatePlaylist(id, { lastUsed: new Date(), status: "active" });

    if (blockKey) {
      await markBlockUsed(getTodayKey(), blockKey);
    }

  } catch (error) {
    btnElement.disabled = false;
    btnElement.innerHTML = originalText;
    alert("Failed to update.")
  }
}

async function handleRegenerate() {
  const todayKey = getTodayKey();

  lastPlanSnapshot = [...currentPlan]; // For undo
  const newPlanPayload = await generateDailyPlanPayload(todayKey, currentPlaylists);

  await updateDailyPlan(todayKey, newPlanPayload);
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

  toast.querySelector("#undoBtn").onclick = async () => {
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