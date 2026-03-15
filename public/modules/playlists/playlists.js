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
  calculateScore,
  updateStatuses,
  getTodayKey
} from "./playlists.engine.js";

let currentPlaylists = [];
let currentPlan = [];
let lastPlanSnapshot = null;
let undoTimeout = null;

/* ===============================
   INIT
================================ */
export async function init() {
  console.log("Playlists module initialized");

  const todayKey = getTodayKey();

  // 1. Subscribe to Playlists
  subscribeToPlaylists(async (playlists) => {
    currentPlaylists = playlists;
    updateStatuses(currentPlaylists);

    renderPlaylistManager(currentPlaylists);
    renderCleaning(currentPlaylists);

    // Ensure daily plan exists for today
    await getOrCreateDailyPlan(todayKey, () => generateDailyPlan(currentPlaylists));
  });

  // 2. Subscribe to Daily Plan
  await subscribeToDailyPlan(todayKey, (blocks) => {
    currentPlan = blocks;
    renderDailyPlan(blocks);
  });
  
  setupEventListeners();
  setupAddPlaylistForm();
  initPlaylistTabs();
}

/* --- UI Logic --- */

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

function setupAddPlaylistForm() {
  const container = document.getElementById("addPlaylistForm");
  if (!container) return;

  container.innerHTML = `
    <div class="card">
      <input type="text" id="newName" placeholder="Playlist name" />
      
      <div style="margin: 10px 0;">
        <label>Priority (1–5)</label>
        <input type="number" id="newPriority" min="1" max="5" value="3" style="width: 60px; margin-left: 10px;"/>
      </div>

      <div class="context-chips" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 15px;">
        <label><input type="checkbox" value="Gym" /> Gym</label>
        <label><input type="checkbox" value="Work" /> Work</label>
        <label><input type="checkbox" value="Driving" /> Driving</label>
        <label><input type="checkbox" value="Relax" /> Relax</label>
        <label><input type="checkbox" value="Free" /> Free</label>
      </div>
      
      <button id="addPlaylistBtn" class="primary">Add Playlist</button>
    </div>
  `;

  document.getElementById("addPlaylistBtn")?.addEventListener("click", async () => {
    const name = document.getElementById("newName").value.trim();
    const priority = Number(document.getElementById("newPriority").value);
    const contexts = Array.from(
      container.querySelectorAll("input[type=checkbox]:checked")
    ).map(c => c.value);

    if (!name || contexts.length === 0) {
      alert("Please provide a name and at least one context.");
      return;
    }

    await addPlaylist({ name, priority, contexts, status: "active", lastUsed: new Date().toISOString() });
    
    // Clear form
    document.getElementById("newName").value = "";
    container.querySelectorAll("input[type=checkbox]").forEach(c => c.checked = false);
    alert("Playlist added!");
  });
}

function renderDailyPlan(plan) {
  const container = document.getElementById("dailyPlan");
  if (!container) return;

  container.innerHTML = plan.map((block, index) => {
    const playlist = currentPlaylists.find(p => p.id === block.playlist);
    return `
      <div class="card plan-refresh">
        <h4>${block.label} <small style="color:var(--text-muted)">(${block.context})</small></h4>
        <p><strong>${playlist ? playlist.name : "Silence"}</strong></p>
        <div style="display:flex; gap:8px">
          ${playlist ? `<button class="primary" data-id="${playlist.id}" data-action="use">Mark as Used</button>` : ""}
          <button class="secondary" data-index="${index}" data-action="swap">Swap</button>
        </div>
      </div>
    `;
  }).join("");
}

/* ===============================
   RENDER PLAYLIST MANAGER
================================ */
function renderPlaylistManager(playlists) {
  const container = document.getElementById("playlistManager");
  if (!container) return;

  container.innerHTML = playlists.map(p => `
    <div class="card"; style="border-left: 4px solid var(--accent)">
      <strong>${p.name}</strong>
      <div style="font-size: 13px; margin: 8px 0;">
        Priority: <input type="number" min="1" max="5" value="${p.priority}" data-id="${p.id}" class="priority-input" style="width:50px; display:inline"/>
        | Status: ${p.status}
      </div>
      <div style="display:flex; gap:5px">
        <button data-id="${p.id}" data-action="archive" class="secondary" style="padding:4px 8px">Archive</button>
        <button data-id="${p.id}" data-action="delete" class="secondary" style="padding:4px 8px; color:var(--color-danger)">Delete</button>
      </div>    
    </div>
  `).join("");
}

/* --- Event Delegation (The "Clean" Way) --- */

function setupEventListeners() {
  // Plan Actions (Use/Swap)
  document.getElementById("dailyPlan")?.addEventListener("click", handlePlanActions);

  // Manager Actions (Delete/Archive)
  document.getElementById("playlistManager")?.addEventListener("click", handleManagerActions);
  document.getElementById("playlistManager")?.addEventListener("change", handlePriorityChange);

  // Regenerate
  document.getElementById("regenBtn")?.addEventListener("click", handleRegenerate);
}

async function handlePlanActions(e) {
  const btn = e.target.closest("button");
  if (!btn) return;

  const { action, id, index } = btn.dataset;
  if (action === "use") markAsUsed(id);
  if (action === "swap") swapPlaylist(Number(index));
}

async function handleManagerActions(e) {
  const btn = e.target.closest("button");
  if (!btn) return;

  const { action, id } = btn.dataset;
  if (action === "delete" && confirm("Delete this playlist?")) await deletePlaylist(id);
  if (action === "archive") await updatePlaylist(id, { status: "archived" });
}

async function handlePriorityChange(e) {
  if (e.target.classList.contains("priority-input")) {
    await updatePlaylist(e.target.dataset.id, { priority: Number(e.target.value) });
  }
}

/* --- Core Actions --- */

async function handleRegenerate() {
  const todayKey = getTodayKey();
  
  toggleLoading(true);
  
  lastPlanSnapshot = [...currentPlan]; // For undo
  const newPlan = generateDailyPlan(currentPlaylists);
  
  await updateDailyPlan(todayKey, newPlan);
  showUndoToast(todayKey);
  
  toggleLoading(false);
}

function toggleLoading(isLoading) {
  const btn = document.getElementById("regenBtn");
  const icon = document.getElementById("regenIcon");
  if (btn) btn.disabled = isLoading;
  if (icon) icon.classList.toggle("rotate", isLoading);
}

function showUndoToast(todayKey) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  // Clear existing toasts/timeouts
  if (undoTimeout) clearTimeout(undoTimeout);
  container.innerHTML = "";

  const toast = document.createElement("div");
  toast.className = "toast undo-toast";
  toast.innerHTML = `
    <div class="toast-content">
      <span>Plan updated</span>
      <button class="undo-btn">Undo</button>
    </div>
    <div class="toast-progress"></div>
  `;

  container.appendChild(toast);

  toast.querySelector(".undo-btn").onclick = async () => {
    if (lastPlanSnapshot) {
      await updateDailyPlan(todayKey, lastPlanSnapshot);
      toast.remove();
    }
  };

  undoTimeout = setTimeout(() => {
    toast.remove();
    lastPlanSnapshot = null;
  }, 8000);
}

function renderCleaning(playlists) {
  const container = document.getElementById("cleaningList");
  if (!container) return;

  const today = new Date();
  const neglected = playlists.filter(p => {
    if (!p.lastUsed) return true;
    const lastUsed = new Date(p.lastUsed);
    const daysSince = (today - lastUsed) / (1000 * 60 * 60 * 24);
    return daysSince > 45;
  });

  if (neglected.length === 0) {
    container.innerHTML = `<p class="text-muted">No playlists need cleaning 🎉</p>`;
    return;
  }

  container.innerHTML = neglected.map(p => `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 8px; background: rgba(255,255,255,0.03); border-radius: var(--radius);">
      <span>${p.name}</span>
      <button class="secondary" data-id="${p.id}" data-action="archive" style="padding: 4px 8px; font-size: 12px;">Archive</button>
    </div>
  `).join("");
}