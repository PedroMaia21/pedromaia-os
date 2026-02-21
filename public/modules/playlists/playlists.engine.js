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

export function generateDailyPlan(playlists) {
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