import { getRandomPlaylists } from "./playlists.service.js";

/* ===============================
   CONTEXT ENUMS
================================ */
export const ContextType = Object.freeze({
  RELAX: "Relax",
  WORK: "Work",
  DRIVING: "Driving",
  GYM: "Gym",
  FREE: "Free"
});

export const BLOCK_KEYS = Object.freeze([
  "earlyMorning",
  "morning",
  "afternoon",
  "evening",
  "night",
  "lateNight"
]);

const DEFAULT_TEMPLATES = {
  weekday: {
    earlyMorning: ContextType.GYM,
    morning: ContextType.WORK,
    afternoon: ContextType.WORK,
    evening: ContextType.DRIVING,
    night: ContextType.RELAX,
    lateNight: ContextType.FREE
  },
  weekend: {
    earlyMorning: ContextType.FREE,
    morning: ContextType.GYM,
    afternoon: ContextType.FREE,
    evening: ContextType.FREE,
    night: ContextType.RELAX,
    lateNight: ContextType.FREE
  }
};

export const DEFAULT_BLOCKS = [
  { key: "earlyMorning", label: "Early Morning" },
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
  { key: "night", label: "Night" },
  { key: "lateNight", label: "Late Night" }
];

export function getDefaultTemplate(dateKey) {
  const date = typeof dateKey === "string" ? new Date(`${dateKey}T00:00:00`) : new Date();
  const day = date.getDay();
  return [0, 6].includes(day) ? "weekend" : "weekday";
}

export function getDefaultContextsForDate(dateKey) {
  const templateType = getDefaultTemplate(dateKey);
  return DEFAULT_TEMPLATES[templateType];
}

export function getBlockLabel(blockKey) {
  const block = DEFAULT_BLOCKS.find(b => b.key === blockKey);
  return block ? block.label : blockKey;
}

export function getAllBlockKeys() {
  return DEFAULT_BLOCKS.map(b => b.key);
}

export function getAllBlockLabels() {
  return DEFAULT_BLOCKS.map(b => b.label);
}

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
  return new Date().toISOString().split('T')[0];
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

export function calculateIdleScore(p) {
  const today = new Date();
  const lastUsed = p.lastUsed?.toDate?.() ?? new Date(0);
  const daysSince = (today - lastUsed) / (1000 * 60 * 60 * 24);
  const recentPenalty = daysSince < 2 ? 2 : 0;
  return Math.max(daysSince - recentPenalty, 0) + 1;
}

export function calculateManualPriorityModifier(priority) {
  const normalized = Number.isFinite(priority) ? Math.min(Math.max(priority, 1), 5) : 3;
  return 1 + ((normalized - 3) * 0.06);
}

export function calculateScore(p, preferenceModifiers = {}) {
  const idleScore = calculateIdleScore(p);
  const priorityModifier = preferenceModifiers.priorityModifier ?? calculateManualPriorityModifier(p.priority);
  const artistModifier = preferenceModifiers.artistModifier ?? 1.0;
  const genreModifier = preferenceModifiers.genreModifier ?? 1.0;
  const subgenreModifier = preferenceModifiers.subgenreModifier ?? 1.0;
  return idleScore * priorityModifier * artistModifier * genreModifier * subgenreModifier;
}

export function getScoreBreakdown(p, preferenceModifiers = {}) {
  const idleScore = calculateIdleScore(p);
  const priorityModifier = preferenceModifiers.priorityModifier ?? calculateManualPriorityModifier(p.priority);
  const artistModifier = preferenceModifiers.artistModifier ?? 1.0;
  const genreModifier = preferenceModifiers.genreModifier ?? 1.0;
  const subgenreModifier = preferenceModifiers.subgenreModifier ?? 1.0;
  const finalScore = idleScore * priorityModifier * artistModifier * genreModifier * subgenreModifier;

  return {
    baseIdleScore: idleScore,
    manualPriorityModifier: priorityModifier,
    artistModifier,
    genreModifier,
    subgenreModifier,
    finalScore
  };
}

export function isValidContext(value) {
  return Object.values(ContextType).includes(value);
}

function getTemplateType(date) {
  const day = date.getDay();
  return [0, 6].includes(day) ? "weekend" : "weekday";
}

function choosePlaylistForContext(playlists, context, excludedIds = []) {
  const normalizedContext = String(context || "").toLowerCase();

  let candidates = playlists
    .filter(p =>
      p.contexts?.some(c => String(c).toLowerCase() === normalizedContext) &&
      p.status !== "archived" &&
      !excludedIds.includes(p.id)
    )
    .map(p => ({
      ...p,
      score: calculateScore(p, p.preferenceModifiers || {})
    }))
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    candidates = playlists
      .filter(p =>
        p.contexts?.some(c => String(c).toLowerCase() === normalizedContext) &&
        p.status === "active" &&
        !excludedIds.includes(p.id)
      )
      .map(p => ({
        ...p,
        score: calculateScore(p, p.preferenceModifiers || {})
      }))
      .sort((a, b) => b.score - a.score);
  }

  if (!candidates.length) return null;

  const topCandidates = candidates.slice(0, 3);
  return topCandidates[Math.floor(Math.random() * topCandidates.length)];
}

/* ===============================
   GENERATOR
================================ */
export async function generateDailyPlan(playlists, dateKey = getTodayKey(), plannedOverride = {}) {
  const usedToday = new Set();
  const date = typeof dateKey === "string" ? new Date(`${dateKey}T00:00:00`) : new Date();
  const template = DEFAULT_TEMPLATES[getTemplateType(date)];
  const overrideKeys = Object.keys(plannedOverride || {});
  const mergedContext = { ...template, ...(plannedOverride || {}) };

  const source = overrideKeys.length === 0
    ? "default"
    : overrideKeys.length === BLOCK_KEYS.length
      ? "planned"
      : "mixed";

  const blocks = DEFAULT_BLOCKS.map(({ key, label }) => {
    const context = mergedContext[key];
    const selected = choosePlaylistForContext(playlists, context, Array.from(usedToday));

    if (selected) {
      usedToday.add(selected.id);
    }

    return {
      key,
      label,
      context,
      used: false,
      playlist: selected ? selected.id : null
    };
  });

  const reviewPlaylists = await getRandomPlaylists(3);
  const reviewItems = reviewPlaylists.map(p => ({
    id: p.id,
    name: p.name,
    priority: p.priority,
    contexts: p.contexts || [],
    status: p.status
  }));

  blocks.push({
    label: "Daily Review",
    type: "review_block",
    items: reviewItems
  });

  return {
    blocks,
    source
  };
}
