import {
  subscribeToPlaylists,
  addPlaylist,
  updatePlaylist,
  deletePlaylist,
  getOrCreateDailyPlan,
  subscribeToDailyPlan,
  updateDailyPlan,
  regenerateDailyPlan
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

  // Subscribe to playlists (real-time updates)
  await subscribeToPlaylists(async playlists => {
    currentPlaylists = playlists;
    updateStatuses(currentPlaylists);

    renderPlaylistManager(currentPlaylists);
    renderCleaning(currentPlaylists);

    const todayKey = getTodayKey();

    // Ensure daily plan exists
    await getOrCreateDailyPlan(todayKey, () => generateDailyPlan(currentPlaylists));

    // Subscribe to daily plan changes
    await subscribeToDailyPlan(todayKey, blocks => {
      window.currentDailyPlanBlocks = blocks;
      renderDailyPlan(blocks);
    });
  });

  setupAddPlaylist();
}

/* ===============================
   ADD PLAYLIST UI
================================ */
function setupAddPlaylist() {
  const container = document.getElementById("addPlaylistForm");
  if (!container) return;

  container.innerHTML = `
    <div class="card">
      <input type="text" id="newName" placeholder="Playlist name" />
      <label>Priority (1–5)</label><br/>
      <input type="number" id="newPriority" min="1" max="5" value="3" />
      <br/><br/>
      <label>Contexts:</label><br/>
      <label><input type="checkbox" value="Gym" /> Gym</label>
      <label><input type="checkbox" value="Work" /> Work</label>
      <label><input type="checkbox" value="Driving" /> Driving</label>
      <label><input type="checkbox" value="Relax" /> Relax</label>
      <label><input type="checkbox" value="Free" /> Free</label>
      <br/><br/>
      <button id="addPlaylistBtn" class="primary">Add Playlist</button>
    </div>
  `;

  const btn = document.getElementById("addPlaylistBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const name = document.getElementById("newName").value.trim();
    const priority = Number(document.getElementById("newPriority").value);
    const contexts = Array.from(
      container.querySelectorAll("input[type=checkbox]:checked")
    ).map(c => c.value);

    if (!name || contexts.length === 0) {
      alert("Please provide name and at least one context.");
      return;
    }

    await addPlaylist({ name, priority, contexts });
    alert("Playlist added.");
  });
}

/* ===============================
   RENDER PLAYLIST MANAGER
================================ */
function renderPlaylistManager(playlists) {
  const container = document.getElementById("playlistManager");
  if (!container) return;

  container.innerHTML = playlists.map(p => `
    <div style="border:1px solid #ccc; padding:8px; margin-bottom:8px;">
      <strong>${p.name}</strong><br/>
      Priority: <input type="number" min="1" max="5" value="${p.priority}" data-id="${p.id}" class="priorityInput"/><br/>
      Contexts: ${p.contexts.join(", ")}<br/>
      Status: ${p.status}<br/><br/>
      <button data-id="${p.id}" class="useBtn">Mark as Used</button>
      <button data-id="${p.id}" class="swapBtn">Swap</button>
      <button data-id="${p.id}" class="deleteBtn">Delete</button>
      <button data-id="${p.id}" class="archiveBtn">Archive</button>
    </div>
  `).join("");

  attachManagerEvents();
}

function attachManagerEvents() {
  document.querySelectorAll(".priorityInput").forEach(input => {
    input.addEventListener("change", async () => {
      const playlist = currentPlaylists.find(p => p.id === input.dataset.id);
      if (!playlist) return;
      await updatePlaylist(input.dataset.id, { priority: Number(input.value) });
    });
  });

  document.querySelectorAll(".useBtn").forEach(btn => {
    btn.addEventListener("click", () => markAsUsed(btn.dataset.id));
  });

  document.querySelectorAll(".swapBtn").forEach((btn, index) => {
    btn.addEventListener("click", () => swapPlaylist(index));
  });

  document.querySelectorAll(".deleteBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (confirm("Are you sure you want to delete this playlist?")) {
        await deletePlaylist(btn.dataset.id);
      }
    });
  });

  document.querySelectorAll(".archiveBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await updatePlaylist(btn.dataset.id, { status: "archived" });
    });
  });
}

/* ===============================
   RENDER DAILY PLAN
================================ */
function renderDailyPlan(plan) {
  const container = document.getElementById("dailyPlan");
  if (!container) return;

  container.innerHTML = plan.map((block, index) => {
    const playlist = currentPlaylists.find(p => p.id === block.playlist);
    return `
      <div class="card">
        <h4>${block.label} (${block.context})</h4>
        <p>${playlist ? playlist.name : "No playlist available"}</p>
        ${playlist ? `
          <button class="primary" data-id="${playlist.id}" data-action="use">Mark as Used</button>
          <button class="secondary" data-index="${index}" data-action="swap">Swap</button>
        ` : ""}
      </div>
    `;
  }).join("");

  container.querySelectorAll("button").forEach(btn => {
    const action = btn.dataset.action;
    if (!action) return;

    btn.addEventListener("click", () => {
      if (action === "use") markAsUsed(btn.dataset.id);
      if (action === "swap") swapPlaylist(Number(btn.dataset.index));
    });
  });
}

document.getElementById("regenBtn")
  .addEventListener("click", async () => {
    if (!confirm("Generate a new daily plan?")) return;
    
    const todayKey = getTodayKey();

    setPlanButtonsDisabled(true);
    rotateRegenIcon(true);

    // 1️⃣ Store previous plan
    const previousPlan = [...window.currentDailyPlanBlocks];
    lastPlanSnapshot = previousPlan;

    // 2️⃣ Generate new plan
    updateStatuses(currentPlaylists);
    const newPlan = generateDailyPlan(currentPlaylists);

    // 3️⃣ Optimistic render (instant UI update)
    renderDailyPlan(newPlan);
    window.currentDailyPlanBlocks = newPlan;

    // 4️⃣ Show undo toast
    showUndoToast(todayKey);

    // 5️⃣ Write to Firestore (background)
    await updateDailyPlan(todayKey, newPlan);

    rotateRegenIcon(false);
    setPlanButtonsDisabled(false);
  });
/* ===============================
   CLEANING
================================ */
function renderCleaning(playlists) {
  const container = document.getElementById("cleaningList");
  if (!container) return;

  const today = new Date();
  const neglected = playlists.filter(p => {
    const lastUsed = new Date(p.lastUsed);
    const daysSince = (today - lastUsed) / (1000 * 60 * 60 * 24);
    return daysSince > 45;
  });

  container.innerHTML = neglected.length
    ? neglected.map(p => `<p>${p.name}</p>`).join("")
    : "<p>No playlists need cleaning 🎉</p>";
}

/* ===============================
   ACTIONS
================================ */
export async function markAsUsed(id) {
  const playlist = currentPlaylists.find(p => p.id === id);
  if (!playlist) return;

  await updatePlaylist(id, { lastUsed: new Date() });
  alert(`${playlist.name} marked as used today.`);
}

export async function swapPlaylist(blockIndex) {
  if (!currentPlan || !currentPlan.length) return;

  const block = currentPlan[blockIndex];
  if (!block) return;

  const usedIds = new Set(currentPlan.map(b => b.playlist));

  const alternatives = currentPlaylists
    .filter(p => p.contexts.includes(block.context) && p.status === "active" && !usedIds.has(p.id))
    .map(p => ({ ...p, score: calculateScore(p) }))
    .sort((a, b) => b.score - a.score);

  if (!alternatives.length) {
    alert("No alternative available.");
    return;
  }

  const updatedPlan = [...currentPlan];
  updatedPlan[blockIndex] = { ...block, playlist: alternatives[0].id };
  await updateDailyPlan(getTodayKey(), updatedPlan);
}
/* ===============================
   UTILITY HELPERS
================================ */
function setPlanButtonsDisabled(disabled) {
  const regenBtn = document.getElementById("regenBtn");

  if (!regenBtn) return;

  regenBtn.disabled = disabled;
  regenBtn.classList.toggle("disabled", disabled);
}

function showUndoToast(todayKey) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast undo-toast";

  toast.innerHTML = `
    <div class="toast-content">
      <span>New plan generated.</span>
      <button class="undo-btn">Undo</button>
    </div>
    <div class="toast-progress"></div>
  `;

  container.appendChild(toast);

  const undoBtn = toast.querySelector(".undo-btn");
  const progressBar = toast.querySelector(".toast-progress");

  // Start shrinking animation
  progressBar.style.animation = "shrinkBar 10s linear forwards";

  undoBtn.addEventListener("click", async () => {
    if (!lastPlanSnapshot) return;

    clearTimeout(undoTimeout);

    renderDailyPlan(lastPlanSnapshot);
    window.currentDailyPlanBlocks = lastPlanSnapshot;

    await updateDailyPlan(todayKey, lastPlanSnapshot);

    toast.remove();
  });

  undoTimeout = setTimeout(() => {
    toast.remove();
    lastPlanSnapshot = null;
  }, 10000);
}

function rotateRegenIcon(shouldRotate) {
  const icon = document.getElementById("regenIcon");
  if (!icon) return;

  icon.classList.toggle("rotate", shouldRotate);
}