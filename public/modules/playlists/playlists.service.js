// /modules/playlists/playlists.service.js
import { collection, doc, addDoc, updateDoc, deleteDoc, getDoc, setDoc, onSnapshot, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../../js/firebase.js";
import { getCurrentUser } from "../../js/auth.js"; // ✅ use auth.js
import { generateDailyPlan, calculateScore, ContextType, BLOCK_KEYS, isValidContext } from "./playlists.engine.js";

/* ===============================
   REFS
================================ */
async function userRef() {
  const user = await getCurrentUser();
  if (!user) throw new Error("No user logged in");
  return doc(db, "users", user.uid);
}

async function playlistsRef() {
  const uRef = await userRef();
  return collection(uRef, "playlists");
}

async function dailyPlanRef(dateKey) {
  const uRef = await userRef();
  return doc(uRef, "dailyPlans", dateKey);
}

async function plannedOverrideRef(dateKey) {
  const uRef = await userRef();
  return doc(uRef, "plannedOverrides", dateKey);
}

async function getDailyPlanSnapshot(dateKey) {
  const ref = await dailyPlanRef(dateKey);
  const snap = await getDoc(ref);
  return { ref, snap };
}

/* ===============================
   PLAYLISTS
================================ */
export async function subscribeToPlaylists(callback) {
  const colRef = await playlistsRef();
  return onSnapshot(colRef, snapshot => {
    const playlists = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    callback(playlists);
  });
}

export async function addPlaylist(data) {
  const colRef = await playlistsRef();
  await addDoc(colRef, {
    ...data,
    lastUsed: Timestamp.fromDate(new Date(0)),
    status: "active",
    createdAt: Timestamp.now()
  });
}

export async function updatePlaylist(id, data) {
  const uRef = await userRef();
  await updateDoc(doc(uRef, "playlists", id), data);
}

export async function deletePlaylist(id) {
  const uRef = await userRef();
  await deleteDoc(doc(uRef, "playlists", id));
}

/* ===============================
   DAILY PLAN
================================ */
export async function getOrCreateDailyPlan(dateKey, generatorFn) {
  const ref = await dailyPlanRef(dateKey);
  const snap = await getDoc(ref);

  if (snap.exists()) return snap.data().blocks;

  const planOrPayload = await generatorFn();
  const payload = Array.isArray(planOrPayload)
    ? { blocks: planOrPayload, source: "default" }
    : planOrPayload;

  await setDoc(ref, {
    date: dateKey,
    blocks: payload.blocks,
    source: payload.source || "default",
    createdAt: Timestamp.now()
  });

  return payload.blocks;
}

export async function subscribeToDailyPlan(dateKey, callback) {
  const ref = await dailyPlanRef(dateKey);
  return onSnapshot(ref, snap => {
    if (!snap.exists()) return;
    callback(snap.data().blocks);
  });
}

export async function updateDailyPlan(dateKey, blocksOrPayload) {
  const ref = await dailyPlanRef(dateKey);

  if (Array.isArray(blocksOrPayload)) {
    await updateDoc(ref, { blocks: blocksOrPayload });
    return;
  }

  const updateData = { blocks: blocksOrPayload.blocks };
  if (blocksOrPayload.source) updateData.source = blocksOrPayload.source;
  await updateDoc(ref, updateData);
}

export async function regenerateDailyPlan(dateKey, generatorFn) {
  const newPlan = await generatorFn();
  await updateDailyPlan(dateKey, newPlan);
}

export async function getPlannedOverride(dateKey) {
  const ref = await plannedOverrideRef(dateKey);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data().blocks || {} : {};
}

export async function setPlannedOverride(dateKey, blocks) {
  if (!blocks || typeof blocks !== "object") {
    throw new Error("Planned override blocks must be an object.");
  }

  const invalidKeys = Object.keys(blocks).filter(key => !BLOCK_KEYS.includes(key));
  if (invalidKeys.length) {
    throw new Error(`Invalid block keys: ${invalidKeys.join(", ")}`);
  }

  const invalidContexts = Object.values(blocks).filter(value => !isValidContext(value));
  if (invalidContexts.length) {
    throw new Error(`Invalid context values: ${invalidContexts.join(", ")}`);
  }

  const ref = await plannedOverrideRef(dateKey);
  await setDoc(ref, {
    date: dateKey,
    blocks,
    updatedAt: Timestamp.now()
  }, { merge: true });
}

export async function resetPlannedOverride(dateKey) {
  const ref = await plannedOverrideRef(dateKey);
  await deleteDoc(ref);
}

export async function generateDailyPlanPayload(dateKey, playlists) {
  const plannedOverride = await getPlannedOverride(dateKey);
  return generateDailyPlan(playlists, dateKey, plannedOverride);
}

export async function createDailyPlan(dateKey, playlists) {
  const payload = await generateDailyPlanPayload(dateKey, playlists);
  const ref = await dailyPlanRef(dateKey);

  await setDoc(ref, {
    date: dateKey,
    blocks: payload.blocks,
    source: payload.source,
    createdAt: Timestamp.now()
  });

  return payload;
}

async function getPlaylistById(id) {
  const uRef = await userRef();
  const snap = await getDoc(doc(uRef, "playlists", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function normalizeBlockKeyOrLabel(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function findBlockIndex(blocks, blockKey) {
  const normalizedKey = normalizeBlockKeyOrLabel(blockKey);
  return blocks.findIndex(b => {
    return [b.key, b.label]
      .filter(Boolean)
      .some(value => normalizeBlockKeyOrLabel(value) === normalizedKey);
  });
}

function chooseBestPlaylistForContext(playlists, context, excludedIds = []) {
  const normalizedContext = String(context || "").toLowerCase();

  let candidates = playlists
    .filter(p =>
      p.contexts?.some(c => String(c).toLowerCase() === normalizedContext) &&
      p.status !== "archived" &&
      !excludedIds.includes(p.id)
    )
    .map(p => ({ ...p, score: calculateScore(p) }))
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    candidates = playlists
      .filter(p =>
        p.contexts?.some(c => String(c).toLowerCase() === normalizedContext) &&
        p.status === "active" &&
        !excludedIds.includes(p.id)
      )
      .map(p => ({ ...p, score: calculateScore(p) }))
      .sort((a, b) => b.score - a.score);
  }

  if (!candidates.length) return null;

  const topCandidates = candidates.slice(0, 3);
  return topCandidates[Math.floor(Math.random() * topCandidates.length)];
}

export async function overrideBlockContext(dateKey, blockKey, newContext) {
  if (!isValidContext(newContext)) {
    throw new Error("Invalid context selected.");
  }

  const { ref, snap } = await getDailyPlanSnapshot(dateKey);
  if (!snap.exists()) {
    throw new Error("Daily plan not found.");
  }

  const plan = snap.data();
  const blocks = Array.isArray(plan.blocks) ? [...plan.blocks] : [];
  const index = findBlockIndex(blocks, blockKey);

  if (index === -1) {
    throw new Error("Block not found.");
  }

  const block = { ...blocks[index] };
  if (block.used) {
    throw new Error("Cannot modify a block after it has been marked as used.");
  }

  block.context = newContext;

  const currentPlaylistId = block.playlist;
  if (currentPlaylistId) {
    const currentPlaylist = await getPlaylistById(currentPlaylistId);
    const hasSameContext = currentPlaylist?.contexts?.some(c => String(c).toLowerCase() === String(newContext).toLowerCase());

    if (!hasSameContext) {
      const allPlaylists = await getAllPlaylists();
      const excludedIds = blocks
        .filter((item, idx) => idx !== index && item.playlist)
        .map(item => item.playlist);
      const replacement = chooseBestPlaylistForContext(allPlaylists, newContext, excludedIds);
      block.playlist = replacement ? replacement.id : null;
    }
  } else {
    const allPlaylists = await getAllPlaylists();
    const excludedIds = blocks.filter(item => item.playlist).map(item => item.playlist);
    const replacement = chooseBestPlaylistForContext(allPlaylists, newContext, excludedIds);
    block.playlist = replacement ? replacement.id : null;
  }

  blocks[index] = block;
  await updateDoc(ref, { blocks });
  return blocks;
}

export async function markBlockUsed(dateKey, blockKey) {
  const { ref, snap } = await getDailyPlanSnapshot(dateKey);
  if (!snap.exists()) {
    throw new Error("Daily plan not found.");
  }

  const plan = snap.data();
  const blocks = Array.isArray(plan.blocks) ? [...plan.blocks] : [];
  const index = findBlockIndex(blocks, blockKey);

  if (index === -1) {
    throw new Error("Block not found.");
  }

  const block = { ...blocks[index] };
  if (block.used) {
    return blocks;
  }

  block.used = true;
  blocks[index] = block;

  await updateDoc(ref, { blocks });
  return blocks;
}

/* ===============================
   RANDOM REVIEW & MAINTENANCE
================================ */

// Fetch all for local randomization (Efficient for < 500 docs)
export async function getAllPlaylists() {
  const colRef = await playlistsRef();
  const { getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const snapshot = await getDocs(colRef);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function getRandomPlaylists(count = 3) {
  const playlists = await getAllPlaylists();
  if (!playlists.length) return [];

  // Fisher-Yates Shuffle
  for (let i = playlists.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playlists[i], playlists[j]] = [playlists[j], playlists[i]];
  }
  return playlists.slice(0, count);
}

export async function markAsReviewed(id) {
  const uRef = await userRef();
  await updateDoc(doc(uRef, "playlists", id), {
    lastReviewed: Timestamp.now(),
    status: "active" // Ensures it stays in rotation
  });
}
