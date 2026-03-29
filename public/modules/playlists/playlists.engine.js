import { getRandomPlaylists } from "./playlists.service.js";

/* ===============================
   RANDOM REVIEW LOGIC
================================ */
export async function loadRandomReviewSet() {
    const playlists = await getRandomPlaylists(3);

    return playlists.map(p => ({
        id: p.id,
        name: p.name,
        reviewStatus: "pending"
    }));
}

/* ===============================
   UTILS
================================ */
export function getTodayKey() {
  return new Date().toISOString().split("T")[0];
}

export function updateStatuses(playlists) {
  const today = new Date();

  playlists.forEach(p => {
    const lastUsed = p.lastUsed?.toDate?.() ?? new Date(0);

    const daysSince =
      (today - lastUsed) / (1000 * 60 * 60 * 24);

    if (daysSince > 45) {
      p.status = "clean";
    } else if (p.status !== "archived") {
      p.status = "active";
    }
  });
}

export function calculateScore(p) {
  const today = new Date();
  const lastUsed = p.lastUsed?.toDate?.() ?? new Date(0);

  const daysSince =
    (today - lastUsed) / (1000 * 60 * 60 * 24);

  const recentPenalty = daysSince < 2 ? 10 : 0;

  return (p.priority * 2) + daysSince - recentPenalty;
}

/* ===============================
   GENERATOR
================================ */
export async function generateDailyPlan(playlists) {  
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
  
  // 1. Generate the standard context-based blocks
  const blocks = timeBlocks.map(block => {
    let candidates = playlists
      .filter(p =>
        p.contexts?.some(c =>
          c.toLowerCase() === block.context.toLowerCase()
        ) &&
        p.status !== "archived" &&
        !usedToday.has(p.id)
      )
      .map(p => ({ ...p, score: calculateScore(p) }))
      .sort((a, b) => b.score - a.score);

    // Allow reuse if no unused candidates
    if (!candidates.length) {
      candidates = playlists
        .filter(p =>
          p.contexts?.some(c =>
            c.toLowerCase() === block.context.toLowerCase()
          ) &&
          p.status === "active"
        )
        .map(p => ({ ...p, score: calculateScore(p) }))
        .sort((a, b) => b.score - a.score);
    }

    if (!candidates.length) {
      return { ...block, playlist: null };
    }

    const topCandidates = candidates.slice(0, 3);

    const selected =
      topCandidates[Math.floor(Math.random() * topCandidates.length)];
    
      usedToday.add(selected.id);

    return { ...block, playlist: selected.id };
  });
  
  const reviewPlaylists = await getRandomPlaylists(3);
  const reviewItems = reviewPlaylists.map(p => ({
    id: p.id,
    name: p.name,
    priority: p.priority,
    contexts: p.contexts || [],
    status: p.status
  }));

  // Append the review block with full data so it's saved in the DB
  blocks.push({
    label: "Daily Review",
    type: "review_block",
    items: reviewItems
  });

  return blocks;
}