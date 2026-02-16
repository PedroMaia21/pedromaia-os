export function init() {
  console.log("Playlists module initialized");

  const playlists = getOrCreatePlaylists();
  updateStatuses(playlists);
  savePlaylists(playlists);

  const todayKey = getTodayKey();
  let dailyPlan = JSON.parse(localStorage.getItem(todayKey));

  if (!dailyPlan) {
    dailyPlan = generateDailyPlan(playlists);
    localStorage.setItem(todayKey, JSON.stringify(dailyPlan));
  }

  renderDailyPlan(dailyPlan, playlists);
  renderCleaning(playlists);
  renderPlaylistManager(playlists);
  setupAddPlaylist();

}
/* ===============================
   MANAGER EVENTS
================================ */
function attachManagerEvents() {
  const playlists = JSON.parse(localStorage.getItem("pm-playlists"));

  document.querySelectorAll(".priorityInput").forEach(input => {
    input.addEventListener("change", () => {
      const playlist = playlists.find(p => p.id === input.dataset.id);
      playlist.priority = Number(input.value);
      savePlaylists(playlists);
    });
  });

  document.querySelectorAll(".deleteBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const updated = playlists.filter(p => p.id !== btn.dataset.id);
      savePlaylists(updated);
      location.reload();
    });
  });

  document.querySelectorAll(".archiveBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const playlist = playlists.find(p => p.id === btn.dataset.id);
      playlist.status = "archived";
      savePlaylists(playlists);
      location.reload();
    });
  });
}

function setupAddPlaylist() {
  document.getElementById("addPlaylistBtn")
    .addEventListener("click", () => {

      const name = document.getElementById("newName").value.trim();
      const priority = Number(document.getElementById("newPriority").value);

      const contextCheckboxes =
        document.querySelectorAll("#addPlaylistForm input[type=checkbox]:checked");

      const contexts = Array.from(contextCheckboxes).map(c => c.value);

      if (!name || contexts.length === 0) {
        alert("Please provide name and at least one context.");
        return;
      }

      const playlists = JSON.parse(localStorage.getItem("pm-playlists"));

      playlists.push({
        id: crypto.randomUUID(),
        name,
        contexts,
        priority,
        lastUsed: new Date(0).toISOString(),
        status: "active"
      });

      savePlaylists(playlists);

      location.reload();
    });
}

/* ===============================
   PLAYLIST STORAGE
================================ */

function getOrCreatePlaylists() {
  const stored = localStorage.getItem("pm-playlists");

  if (stored) {
    return JSON.parse(stored);
  }

  const seedData = [
    {
      id: "gym-power",
      name: "Gym Power",
      contexts: ["Gym", "Driving"],
      priority: 5,
      lastUsed: "2026-02-10T00:00:00.000Z",
      status: "active"
    },
    {
      id: "deep-focus",
      name: "Deep Focus",
      contexts: ["Work"],
      priority: 5,
      lastUsed: "2026-02-12T00:00:00.000Z",
      status: "active"
    },
    {
      id: "night-chill",
      name: "Night Chill",
      contexts: ["Relax", "Free"],
      priority: 4,
      lastUsed: "2026-01-01T00:00:00.000Z",
      status: "active"
    }
  ];

  localStorage.setItem("pm-playlists", JSON.stringify(seedData));
  return seedData;
}

function savePlaylists(playlists) {
  localStorage.setItem("pm-playlists", JSON.stringify(playlists));
}

/* ===============================
   DAILY PLAN ENGINE
================================ */

function getTodayKey() {
  const today = new Date().toISOString().split("T")[0];
  return "dailyPlan-" + today;
}

function generateDailyPlan(playlists) {
  const usedToday = new Set();
  const isWeekend = [0, 6].includes(new Date().getDay());

  const timeBlocks = [
    { label: "Early Morning", context: "Gym" },
    { label: "Morning", context: isWeekend ? "Free" : "Work" },
    { label: "Afternoon", context: isWeekend ? "Free" : "Work" },
    { label: "Evening", context: "Driving" },
    { label: "Night", context: "Relax" },
    { label: "Late Night", context: "Free" }
  ];

  return timeBlocks.map(block => {
    const candidates = playlists
      .filter(p =>
        p.contexts.includes(block.context) &&
        p.status === "active" &&
        !usedToday.has(p.id)
      )
      .map(p => ({ ...p, score: calculateScore(p) }))
      .sort((a, b) => b.score - a.score);

    if (!candidates.length) {
      return { ...block, playlist: null };
    }

    const selected = candidates[0];
    usedToday.add(selected.id);

    return { ...block, playlist: selected.id };
  });
}

function calculateScore(p) {
  const today = new Date();
  const lastUsed = new Date(p.lastUsed);

  const daysSince =
    (today - lastUsed) / (1000 * 60 * 60 * 24);

  const recentPenalty = daysSince < 2 ? 10 : 0;

  return (p.priority * 2) + daysSince - recentPenalty;
}

/* ===============================
   RENDERING
================================ */

function renderDailyPlan(plan, playlists) {
  const container = document.getElementById("dailyPlan");

  container.innerHTML = plan.map(block => {
    const playlist = playlists.find(p => p.id === block.playlist);

    return `
      <div>
        <strong>${block.label}</strong> (${block.context})<br/>
        ${playlist ? playlist.name : "No playlist available"}
        ${playlist ? `<button data-id="${playlist.id}">Mark as Used</button>` : ""}
        <hr/>
      </div>
    `;
  }).join("");

  container.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      markAsUsed(btn.dataset.id);
    });
  });
}

function renderCleaning(playlists) {
  const container = document.getElementById("cleaningList");
  const today = new Date();

  const neglected = playlists.filter(p => {
    const lastUsed = new Date(p.lastUsed);
    const daysSince =
      (today - lastUsed) / (1000 * 60 * 60 * 24);
    return daysSince > 45;
  });

  container.innerHTML = neglected.length
    ? neglected.map(p => `<p>${p.name}</p>`).join("")
    : "<p>No playlists need cleaning 🎉</p>";
}

/* ===============================
   ACTIONS
================================ */

function markAsUsed(id) {
  const playlists = JSON.parse(localStorage.getItem("pm-playlists"));
  const playlist = playlists.find(p => p.id === id);
  if (!playlist) return;

  playlist.lastUsed = new Date().toISOString();

  savePlaylists(playlists);

  alert(`${playlist.name} marked as used today.`);
}

/* ===============================
   STATUS UPDATE
================================ */

function updateStatuses(playlists) {
  const today = new Date();

  playlists.forEach(p => {
    const lastUsed = new Date(p.lastUsed);
    const daysSince =
      (today - lastUsed) / (1000 * 60 * 60 * 24);

    if (daysSince > 45) {
      p.status = "clean";
    } else {
      p.status = "active";
    }
  });
}
