// /modules/playlists/playlists.service.js
import { collection, doc, addDoc, updateDoc, deleteDoc, getDoc, setDoc, onSnapshot, Timestamp, query, where, getDocs, runTransaction, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../../js/firebase.js";
import { getCurrentUser } from "../../js/auth.js"; // ✅ use auth.js
import { generateDailyPlan, calculateScore, calculateIdleScore, calculateManualPriorityModifier, ContextType, BLOCK_KEYS, isValidContext } from "./playlists.engine.js";
import { calculateNewElo, getEntityPreferenceModifier } from "./playlists.preferences.engine.js";

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

async function playlistClassifierRef(playlistId) {
  const uRef = await userRef();
  return doc(uRef, "playlist_classifiers", playlistId);
}

async function dailyPlanRef(dateKey) {
  const uRef = await userRef();
  return doc(uRef, "dailyPlans", dateKey);
}

async function plannedOverrideRef(dateKey) {
  const uRef = await userRef();
  return doc(uRef, "plannedOverrides", dateKey);
}

async function preferenceEntitiesCollection() {
  const uRef = await userRef();
  return collection(uRef, "preference_entities");
}

async function preferenceBattlesCollection() {
  const uRef = await userRef();
  return collection(uRef, "preference_battles");
}

async function preferenceEntityRef(entityId) {
  const uRef = await userRef();
  return doc(uRef, "preference_entities", entityId);
}

async function preferenceBattleRef(battleId) {
  const uRef = await userRef();
  return doc(uRef, "preference_battles", battleId);
}

function normalizePreferenceEntityName(value) {
  return String(value || "").trim();
}

function normalizePreferenceEntityType(value) {
  return String(value || "").trim().toUpperCase();
}

function validatePreferenceEntityType(entityType) {
  const normalized = normalizePreferenceEntityType(entityType);
  const allowed = ["ARTIST", "GENRE", "SUBGENRE"];
  if (!allowed.includes(normalized)) {
    throw new Error(`Invalid preference entity type: ${entityType}`);
  }
  return normalized;
}

async function getDailyPlanSnapshot(dateKey) {
  const ref = await dailyPlanRef(dateKey);
  const snap = await getDoc(ref);
  return { ref, snap };
}

/* ===============================
   CLASSIFIERS
================================ */
export async function getPlaylistClassifier(playlistId) {
  if (!playlistId) throw new Error("playlistId is required");
  const ref = await playlistClassifierRef(playlistId);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function setPlaylistClassifier(playlistId, classifier) {
  if (!playlistId) throw new Error("playlistId is required");
  const ref = await playlistClassifierRef(playlistId);
  const payload = {
    main_artist: classifier?.main_artist || null,
    main_genre: classifier?.main_genre || null,
    main_subgenre: classifier?.main_subgenre || null,
    rating: classifier?.rating ?? null,
    source_app: classifier?.source_app || null,
    updated_at: Timestamp.now()
  };
  await setDoc(ref, payload, { merge: true });
}

export async function deletePlaylistClassifier(playlistId) {
  if (!playlistId) throw new Error("playlistId is required");
  const ref = await playlistClassifierRef(playlistId);
  await deleteDoc(ref);
}

/* ===============================
   PREFERENCE ENTITIES
================================ */
function normalizePreferenceEntityKey(value) {
  return String(value || "").trim().toLowerCase();
}

export async function findPreferenceEntity(entityType, entityName) {
  const normalizedType = validatePreferenceEntityType(entityType);
  const normalizedNameKey = normalizePreferenceEntityKey(entityName);
  if (!normalizedNameKey) return null;

  const entities = await preferenceEntitiesCollection();
  const q = query(entities, where("entity_type", "==", normalizedType));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;

  const match = snapshot.docs.find(docSnap =>
    normalizePreferenceEntityKey(docSnap.data().entity_name) === normalizedNameKey
  );

  return match ? { id: match.id, ...match.data() } : null;
}

export async function getPreferenceEntityById(entityId) {
  if (!entityId) throw new Error("entityId is required");
  const ref = await preferenceEntityRef(entityId);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getOrCreatePreferenceEntity(entityType, entityName) {
  const normalizedType = validatePreferenceEntityType(entityType);
  const normalizedName = normalizePreferenceEntityName(entityName);
  if (!normalizedName) {
    throw new Error("entityName is required");
  }

  const existing = await findPreferenceEntity(normalizedType, normalizedName);
  if (existing) return existing;

  const entities = await preferenceEntitiesCollection();
  const payload = {
    entity_type: normalizedType,
    entity_name: normalizedName,
    elo_rating: 1000,
    battle_count: 0,
    active_playlist_count: 0,
    days_unused: 0,
    created_at: Timestamp.now(),
    updated_at: Timestamp.now()
  };
  const ref = await addDoc(entities, payload);
  return { id: ref.id, ...payload };
}

export async function updatePreferenceEntity(entityId, updates) {
  if (!entityId) throw new Error("entityId is required");
  if (!updates || typeof updates !== "object") {
    throw new Error("updates must be a plain object");
  }

  const ref = await preferenceEntityRef(entityId);
  const payload = {
    ...updates,
    updated_at: Timestamp.now()
  };
  await updateDoc(ref, payload);
}

export async function deletePreferenceEntity(entityId) {
  if (!entityId) throw new Error("entityId is required");
  const ref = await preferenceEntityRef(entityId);
  await deleteDoc(ref);
}

function normalizeClassifierValue(value) {
  const normalized = String(value || "").trim();
  return normalized === "" ? null : normalized;
}

function normalizeClassifier(classifier = {}) {
  const rawRating = classifier.rating;
  const parsedRating = Number(rawRating);
  const rating = rawRating === "" || rawRating == null || !Number.isFinite(parsedRating) ? null : parsedRating;
  const mainArtist = normalizeClassifierValue(classifier.main_artist);
  const mainGenre = normalizeClassifierValue(classifier.main_genre);
  const mainSubgenre = normalizeClassifierValue(classifier.main_subgenre);
  const sourceApp = normalizeClassifierValue(classifier.source_app);
  const hasAnyMetadata = Boolean(mainArtist || mainGenre || mainSubgenre || rating != null || sourceApp);

  return {
    main_artist: mainArtist,
    main_genre: mainGenre,
    main_subgenre: mainSubgenre,
    rating,
    source_app: sourceApp || (hasAnyMetadata ? "Chosic" : null)
  };
}

function classifierHasMetadata(classifier) {
  return Boolean(
    classifier?.main_artist ||
    classifier?.main_genre ||
    classifier?.main_subgenre ||
    classifier?.rating != null ||
    classifier?.source_app
  );
}

export async function decrementPreferenceEntityPlaylistCount(entityId, delta = 1) {
  if (!entityId) throw new Error("entityId is required");
  const ref = await preferenceEntityRef(entityId);
  return runTransaction(db, async transaction => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) {
      throw new Error("Preference entity not found");
    }
    const current = snap.data().active_playlist_count || 0;
    const next = Math.max(current - delta, 0);
    transaction.update(ref, {
      active_playlist_count: next,
      updated_at: Timestamp.now()
    });
  });
}

async function changePreferenceEntityUsage(entityType, entityName, delta) {
  const normalizedName = normalizeClassifierValue(entityName);
  if (!normalizedName) return null;

  const entity = await getOrCreatePreferenceEntity(entityType, normalizedName);
  if (delta >= 0) {
    await incrementPreferenceEntityPlaylistCount(entity.id, delta);
  } else {
    await decrementPreferenceEntityPlaylistCount(entity.id, Math.abs(delta));
  }

  console.debug("Preference entity usage updated", {
    entityType,
    entityName: normalizedName,
    entityId: entity.id,
    delta
  });
  return entity;
}

async function syncPlaylistClassifierEntities(oldClassifier, newClassifier) {
  const oldNorm = normalizeClassifier(oldClassifier || {});
  const newNorm = normalizeClassifier(newClassifier || {});

  const fields = [
    ["ARTIST", "main_artist"],
    ["GENRE", "main_genre"],
    ["SUBGENRE", "main_subgenre"]
  ];

  for (const [type, key] of fields) {
    const oldValue = oldNorm[key];
    const newValue = newNorm[key];

    if (oldValue && oldValue !== newValue) {
      const oldEntity = await findPreferenceEntity(type, oldValue);
      if (oldEntity) {
        await decrementPreferenceEntityPlaylistCount(oldEntity.id, 1);
        console.debug("Decremented old preference entity", { type, oldValue, entityId: oldEntity.id });
      }
    }

    if (newValue && oldValue !== newValue) {
      await changePreferenceEntityUsage(type, newValue, 1);
    }
  }
}

export async function addPlaylistWithClassifier(data, classifier = {}) {
  const colRef = await playlistsRef();
  const playlistRef = await addDoc(colRef, {
    ...data,
    lastUsed: Timestamp.fromDate(new Date(0)),
    status: "active",
    createdAt: Timestamp.now()
  });

  const normalizedClassifier = normalizeClassifier(classifier);
  if (classifierHasMetadata(normalizedClassifier)) {
    try {
      await setPlaylistClassifier(playlistRef.id, normalizedClassifier);
      await syncPlaylistClassifierEntities(null, normalizedClassifier);
      console.debug("Saved classifier for new playlist", { playlistId: playlistRef.id, classifier: normalizedClassifier });
    } catch (error) {
      console.warn("Failed to save classifier for new playlist", error);
    }
  }

  return { id: playlistRef.id, ...data };
}

export async function updatePlaylistWithClassifier(id, data, classifier = {}) {
  const oldClassifier = await getPlaylistClassifier(id);
  const normalizedClassifier = normalizeClassifier(classifier);

  // 1. Persist playlist first
  await updatePlaylist(id, data);

  // 2. Persist classifier second
  try {
    if (classifierHasMetadata(normalizedClassifier)) {
      await setPlaylistClassifier(id, normalizedClassifier);
    } else {
      await deletePlaylistClassifier(id);
    }

    // 3. Only then sync entities
    await syncPlaylistClassifierEntities(oldClassifier, normalizedClassifier);
    console.debug("Updated playlist classifier", { playlistId: id, classifier: normalizedClassifier });
  } catch (error) {
    console.warn("Failed to sync classifier for updated playlist", error);
  }
}

export async function deletePlaylistWithClassifierCleanup(id) {
  const oldClassifier = await getPlaylistClassifier(id);
  await deletePlaylist(id);

  if (classifierHasMetadata(oldClassifier)) {
    try {
      await syncPlaylistClassifierEntities(oldClassifier, null);
      await deletePlaylistClassifier(id);
      console.debug("Cleaned up classifier after playlist delete", { playlistId: id });
    } catch (error) {
      console.warn("Failed to clean up classifier after playlist delete", error);
    }
  }
}

export async function listPreferenceEntities(entityType = null) {
  const entities = await preferenceEntitiesCollection();
  let q = entities;

  if (entityType) {
    const normalizedType = validatePreferenceEntityType(entityType);
    q = query(entities, where("entity_type", "==", normalizedType));
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function listInactivePreferenceEntities() {
  const entities = await preferenceEntitiesCollection();
  const q = query(entities, where("active_playlist_count", "==", 0));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function incrementPreferenceEntityPlaylistCount(entityId, delta = 1) {
  if (!entityId) throw new Error("entityId is required");
  const ref = await preferenceEntityRef(entityId);
  await updateDoc(ref, {
    active_playlist_count: increment(delta),
    updated_at: Timestamp.now()
  });
}

function getPreferenceEntityKey(entityType, entityName) {
  return `${entityType}|${normalizePreferenceEntityName(entityName)}`;
}

function buildPreferenceBattleKey(entityAId, entityBId) {
  return [entityAId, entityBId].sort().join("|");
}

function getDaysSince(dateValue) {
  const today = new Date();
  const lastUsed = dateValue?.toDate?.() ?? new Date(0);
  return (today - lastUsed) / (1000 * 60 * 60 * 24);
}

export async function getAllPlaylistClassifiers() {
  const uRef = await userRef();
  const col = collection(uRef, "playlist_classifiers");
  const snapshot = await getDocs(col);
  return snapshot.docs.reduce((acc, docSnap) => {
    acc[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
    return acc;
  }, {});
}

export async function getAllPreferenceEntities() {
  const snapshot = await getDocs(await preferenceEntitiesCollection());
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function getPreferenceBattlesForDate(dateKey) {
  const battles = await getDocs(query(
    await preferenceBattlesCollection(),
    where("scheduled_for", "==", dateKey)
  ));
  return battles.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function subscribeToPreferenceBattles(dateKey, callback) {
  const q = query(
    await preferenceBattlesCollection(),
    where("scheduled_for", "==", dateKey)
  );
  return onSnapshot(q, snapshot => {
    callback(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })));
  });
}

export async function listPreferenceBattlesByType(entityType) {
  const normalizedType = validatePreferenceEntityType(entityType);
  const snapshot = await getDocs(query(
    await preferenceBattlesCollection(),
    where("entity_type", "==", normalizedType)
  ));
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
}

function buildBattleCandidates(entities, pastBattles) {
  const maxBattleCount = Math.max(...entities.map(e => e.battle_count || 0), 1);

  const pairInfo = [];
  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      const a = entities[i];
      const b = entities[j];
      const pairKey = buildPreferenceBattleKey(a.id, b.id);
      const existingPair = pastBattles[pairKey];
      const eloDistance = Math.abs((a.elo_rating || 1000) - (b.elo_rating || 1000));
      const eloScore = 1 - Math.min(eloDistance / 400, 1);
      const battleCountScore = 1 - ((a.battle_count || 0) + (b.battle_count || 0)) / (maxBattleCount * 2);
      const freshnessScore = existingPair?.daysSinceLastBattle != null
        ? Math.min(existingPair.daysSinceLastBattle / 60, 1)
        : 1;
      const finalScore = (eloScore * 0.5) + (battleCountScore * 0.3) + (freshnessScore * 0.2);

      pairInfo.push({ a, b, pairKey, score: finalScore, existingPair });
    }
  }

  return pairInfo.sort((left, right) => right.score - left.score);
}

function groupPastBattlesByPair(battles) {
  return battles.reduce((acc, battle) => {
    const key = buildPreferenceBattleKey(battle.entity_a_id, battle.entity_b_id);
    const lastBattleDate = battle.resolved_at ? battle.resolved_at.toDate?.() ?? new Date(battle.resolved_at) : battle.created_at?.toDate?.() ?? new Date(battle.created_at);
    const daysSinceLastBattle = (new Date() - lastBattleDate) / (1000 * 60 * 60 * 24);
    if (!acc[key] || acc[key].daysSinceLastBattle > daysSinceLastBattle) {
      acc[key] = { ...battle, daysSinceLastBattle };
    }
    return acc;
  }, {});
}

export async function refreshPreferenceEntityCounts() {
  const playlists = await getAllPlaylists();
  const classifiers = await getAllPlaylistClassifiers();
  const entities = await getAllPreferenceEntities();
  const entityByKey = new Map();

  entities.forEach(entity => {
    const key = getPreferenceEntityKey(entity.entity_type, entity.entity_name);
    entityByKey.set(key, entity);
  });

  const counts = new Map();
  playlists.forEach(playlist => {
    if (playlist.status === "archived") return;
    const classifier = classifiers[playlist.id];
    if (!classifier) return;

    [
      ["ARTIST", classifier.main_artist],
      ["GENRE", classifier.main_genre],
      ["SUBGENRE", classifier.main_subgenre]
    ].forEach(([type, name]) => {
      if (!name) return;
      const key = getPreferenceEntityKey(type, name);
      const stats = counts.get(key) || { entity_type: type, entity_name: name, active_playlist_count: 0, days_unused: null };
      stats.active_playlist_count += 1;
      const age = getDaysSince(playlist.lastUsed);
      stats.days_unused = stats.days_unused === null ? age : Math.min(stats.days_unused, age);
      counts.set(key, stats);
    });
  });

  for (const [key, stats] of counts.entries()) {
    let entity = entityByKey.get(key);
    if (!entity) {
      entity = await getOrCreatePreferenceEntity(stats.entity_type, stats.entity_name);
      entityByKey.set(key, entity);
    }

    const updates = {};
    if (entity.active_playlist_count !== stats.active_playlist_count) {
      updates.active_playlist_count = stats.active_playlist_count;
    }
    if (entity.days_unused !== stats.days_unused) {
      updates.days_unused = stats.days_unused;
    }
    if (Object.keys(updates).length) {
      updates.updated_at = Timestamp.now();
      await updateDoc(await preferenceEntityRef(entity.id), updates);
    }
  }

  for (const entity of entities) {
    const key = getPreferenceEntityKey(entity.entity_type, entity.entity_name);
    if (!counts.has(key) && (entity.active_playlist_count !== 0 || entity.days_unused !== 0)) {
      await updateDoc(await preferenceEntityRef(entity.id), {
        active_playlist_count: 0,
        days_unused: 0,
        updated_at: Timestamp.now()
      });
    }
  }
}

export async function ensureDailyPreferenceBattles(dateKey) {
  const existing = await getPreferenceBattlesForDate(dateKey);
  if (existing.length) return existing;
  await refreshPreferenceEntityCounts();
  return generateDailyPreferenceBattles(dateKey);
}

export async function generateDailyPreferenceBattles(dateKey) {
  const artistEntities = (await listPreferenceEntities("ARTIST")).filter(e => e.active_playlist_count > 0);
  const genreEntities = (await listPreferenceEntities("GENRE")).filter(e => e.active_playlist_count > 0);
  const subgenreEntities = (await listPreferenceEntities("SUBGENRE")).filter(e => e.active_playlist_count > 0);

  const existingArtistBattles = groupPastBattlesByPair(await listPreferenceBattlesByType("ARTIST"));
  const existingGenreBattles = groupPastBattlesByPair(await listPreferenceBattlesByType("GENRE"));
  const existingSubgenreBattles = groupPastBattlesByPair(await listPreferenceBattlesByType("SUBGENRE"));

  const battleSets = [
    { type: "ARTIST", entities: artistEntities, existing: existingArtistBattles, count: 3 },
    { type: "GENRE", entities: genreEntities, existing: existingGenreBattles, count: 1 },
    { type: "SUBGENRE", entities: subgenreEntities, existing: existingSubgenreBattles, count: 2 }
  ];

  const createdBattles = [];
  for (const set of battleSets) {
    if (set.entities.length < 2) continue;
    const candidates = buildBattleCandidates(set.entities, set.existing);
    const selectedPairs = [];
    const usedEntityIds = new Set();

    for (const candidate of candidates) {
      if (selectedPairs.length >= set.count) break;
      if (usedEntityIds.has(candidate.a.id) || usedEntityIds.has(candidate.b.id)) continue;
      if (candidate.existingPair?.daysSinceLastBattle != null && candidate.existingPair.daysSinceLastBattle < 30) {
        continue;
      }

      selectedPairs.push(candidate);
      usedEntityIds.add(candidate.a.id);
      usedEntityIds.add(candidate.b.id);
    }

    if (selectedPairs.length < set.count) {
      for (const candidate of candidates) {
        if (selectedPairs.length >= set.count) break;
        if (usedEntityIds.has(candidate.a.id) || usedEntityIds.has(candidate.b.id)) continue;
        selectedPairs.push(candidate);
        usedEntityIds.add(candidate.a.id);
        usedEntityIds.add(candidate.b.id);
      }
    }

    for (const candidate of selectedPairs) {
      const payload = {
        entity_type: set.type,
        entity_a_id: candidate.a.id,
        entity_b_id: candidate.b.id,
        entity_a_name: candidate.a.entity_name,
        entity_b_name: candidate.b.entity_name,
        scheduled_for: dateKey,
        winner_entity_id: null,
        resolved_at: null,
        created_at: Timestamp.now()
      };
      const ref = await addDoc(await preferenceBattlesCollection(), payload);
      createdBattles.push({ id: ref.id, ...payload });
    }
  }

  return createdBattles;
}

export async function resolvePreferenceBattle(battleId, winnerEntityId) {
  if (!battleId || !winnerEntityId) {
    throw new Error("battleId and winnerEntityId are required");
  }

  const battleRef = await preferenceBattleRef(battleId);
  return runTransaction(db, async transaction => {
    const battleSnap = await transaction.get(battleRef);
    if (!battleSnap.exists()) {
      throw new Error("Battle not found.");
    }

    const battle = battleSnap.data();
    if (battle.winner_entity_id) {
      throw new Error("Battle has already been resolved.");
    }

    const entityARef = await preferenceEntityRef(battle.entity_a_id);
    const entityBRef = await preferenceEntityRef(battle.entity_b_id);
    const entityASnap = await transaction.get(entityARef);
    const entityBSnap = await transaction.get(entityBRef);

    if (!entityASnap.exists() || !entityBSnap.exists()) {
      throw new Error("Preference entity not found.");
    }

    const entityA = entityASnap.data();
    const entityB = entityBSnap.data();
    const didAWin = winnerEntityId === battle.entity_a_id;

    const newEloA = calculateNewElo(entityA.elo_rating ?? 1000, entityB.elo_rating ?? 1000, didAWin);
    const newEloB = calculateNewElo(entityB.elo_rating ?? 1000, entityA.elo_rating ?? 1000, !didAWin);

    transaction.update(entityARef, {
      elo_rating: newEloA,
      battle_count: increment(1),
      updated_at: Timestamp.now()
    });

    transaction.update(entityBRef, {
      elo_rating: newEloB,
      battle_count: increment(1),
      updated_at: Timestamp.now()
    });

    transaction.update(battleRef, {
      winner_entity_id: winnerEntityId,
      resolved_at: Timestamp.now()
    });

    return { id: battleId, ...battle, winner_entity_id: winnerEntityId, resolved_at: Timestamp.now() };
  });
}

export async function enrichPlaylistsWithPreferenceData(playlists) {
  if (!Array.isArray(playlists)) return [];

  const classifiers = await getAllPlaylistClassifiers();
  const entities = await getAllPreferenceEntities();
  const entityMap = new Map();

  entities.forEach(entity => {
    entityMap.set(getPreferenceEntityKey(entity.entity_type, entity.entity_name), entity);
  });

  return playlists.map(playlist => {
    const classifier = classifiers[playlist.id] || null;
    const artistEntity = classifier?.main_artist ? entityMap.get(getPreferenceEntityKey("ARTIST", classifier.main_artist)) : null;
    const genreEntity = classifier?.main_genre ? entityMap.get(getPreferenceEntityKey("GENRE", classifier.main_genre)) : null;
    const subgenreEntity = classifier?.main_subgenre ? entityMap.get(getPreferenceEntityKey("SUBGENRE", classifier.main_subgenre)) : null;

    const preferenceModifiers = {
      artistModifier: getEntityPreferenceModifier(artistEntity),
      genreModifier: getEntityPreferenceModifier(genreEntity),
      subgenreModifier: getEntityPreferenceModifier(subgenreEntity)
    };

    const preferenceScoreBreakdown = {
      ...preferenceModifiers,
      manualPriorityModifier: calculateManualPriorityModifier(playlist.priority),
      baseIdleScore: calculateIdleScore(playlist),
      finalScore: calculateScore(playlist, preferenceModifiers)
    };

    return {
      ...playlist,
      classifier,
      preferenceModifiers,
      preferenceScoreBreakdown,
      preferenceEntities: {
        artistEntity,
        genreEntity,
        subgenreEntity
      }
    };
  });
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
  const decoratedPlaylists = await enrichPlaylistsWithPreferenceData(playlists);
  return generateDailyPlan(decoratedPlaylists, dateKey, plannedOverride);
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

  try {
    await ensureDailyPreferenceBattles(dateKey);
  } catch (error) {
    console.warn("Preference battle generation failed", error);
  }
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
