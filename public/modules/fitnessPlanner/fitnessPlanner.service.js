// /modules/fitnessPlanner/fitnessPlanner.service.js
//
// Firestore persistence boundary for the Fitness Planner (technical design v1.1).
// Owns paths, Timestamp ⇄ Date mapping, reads, writes, batches, query shapes,
// and subscriptions. Domain rules, validation, IDs, snapshots, lifecycle, and
// summaries come from the engine. No DOM, no auth lookups, no custom storage:
// offline durability is Firestore's persistent cache (public/js/firebase.js).
//
// Write semantics (§9.2): a method that issues a write returns (or resolves to)
// `{ ..., write }` as soon as the write is applied locally; `write` is the
// Firestore promise that settles on server acknowledgement (pending while
// offline). Callers must attach a rejection handler to `write`.
// applyWeeklyTemplate is the exception: it requires connectivity (§8.2) and
// resolves only after the server acknowledges the batch.
//
// Errors: reads and multi-step operations are async and reject; write methods
// that need no read are synchronous and throw ValidationError /
// FitnessServiceError before anything is sent to Firestore.

import {
  collection, doc, getDoc, getDocs, getDocFromServer, getDocsFromServer,
  setDoc, updateDoc, deleteDoc, writeBatch, query, where, orderBy, limit, startAfter,
  onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  SCHEMA_VERSION, DocumentKind, LifecycleKind, ItemSource, PlannedSessionOrigin,
  PlannedSessionStatus, WorkoutOrigin, WorkoutStatus, ValidationError,
  isValidDocumentId, isValidLocalDate, compareLocalDates, todayLocal,
  buildPlannedWorkoutSessionId, buildSetId, buildTemplatePlannedSessionId,
  buildSnapshotItems, checkDocument, transition, completeWorkoutSession, planTemplateApplication,
  validateProfile, validateWeeklyTemplate, validateExercise, validateRoutine,
  validatePlannedSession, validateWorkoutSession, validateSet, validateSnapshotItems
} from "./fitnessPlanner.engine.js";

/* ===============================
   ERRORS (§16)
   Engine ValidationError (code "VALIDATION") and Firestore errors propagate
   unchanged. FitnessServiceError covers persistence-level refusals.
================================ */
export const ServiceErrorCode = Object.freeze({
  NOT_FOUND: "NOT_FOUND",
  INVALID_DOCUMENT: "INVALID_DOCUMENT",
  INVALID_STATE: "INVALID_STATE"
});

export class FitnessServiceError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "FitnessServiceError";
    this.code = code;
    this.details = details;
  }
}

export const ErrorCategory = Object.freeze({
  VALIDATION: "VALIDATION",
  NOT_FOUND: "NOT_FOUND",
  INVALID_DOCUMENT: "INVALID_DOCUMENT",
  INVALID_STATE: "INVALID_STATE",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  UNAVAILABLE: "UNAVAILABLE",
  FAILED_PRECONDITION: "FAILED_PRECONDITION",
  RESOURCE_EXHAUSTED: "RESOURCE_EXHAUSTED",
  UNKNOWN: "UNKNOWN"
});

const FIRESTORE_ERROR_CATEGORIES = Object.freeze({
  "permission-denied": ErrorCategory.PERMISSION_DENIED,
  "unavailable": ErrorCategory.UNAVAILABLE,
  "failed-precondition": ErrorCategory.FAILED_PRECONDITION,
  "resource-exhausted": ErrorCategory.RESOURCE_EXHAUSTED
});

/** Maps any error thrown or rejected by the service to an ErrorCategory (no UI text). */
export function classifyError(error) {
  if (error instanceof ValidationError) return ErrorCategory.VALIDATION;
  if (error instanceof FitnessServiceError) return error.code;
  return FIRESTORE_ERROR_CATEGORIES[error?.code] || ErrorCategory.UNKNOWN;
}

/* ===============================
   PATHS (§6.1)
================================ */
const CONFIG = "fitnessConfig";
const PROFILE_ID = "profile";
const WEEKLY_TEMPLATE_ID = "weeklyTemplate";
const EXERCISES = "fitnessExercises";
const ROUTINES = "fitnessRoutines";
const PLANNED_SESSIONS = "fitnessPlannedSessions";
const WORKOUT_SESSIONS = "fitnessWorkoutSessions";
const SETS = "sets";

const MAX_BATCH_WRITES = 500;
const HISTORY_PAGE_SIZE = 20;

function requireId(value, field) {
  if (!isValidDocumentId(value)) throw new ValidationError(field, `${field} must be a valid document ID.`);
}

function requireLocalDateArg(value, field) {
  if (!isValidLocalDate(value)) throw new ValidationError(field, `${field} must be a valid YYYY-MM-DD date.`);
}

function requireNow(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new ValidationError("now", "now must be a valid Date.");
}

/* ===============================
   MAPPING (§5.1, §13.2)
================================ */
function mapValues(value, convert) {
  const converted = convert(value);
  if (converted !== value) return converted;
  if (Array.isArray(value)) return value.map(v => mapValues(v, convert));
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapValues(v, convert)]));
  }
  return value;
}

const timestampToDate = value => (value instanceof Timestamp ? value.toDate() : value);
const dateToTimestamp = value => (value instanceof Date ? Timestamp.fromDate(value) : value);

/** Snapshot → domain object (Timestamps as Dates, `id` added), or `{ id, invalid, reason }`. */
function fromSnapshot(kind, snapshot) {
  return checkDocument(kind, { id: snapshot.id, ...mapValues(snapshot.data(), timestampToDate) });
}

/**
 * Validated domain object → Firestore data for a full write. `id` is dropped
 * (it is the document ID). A `createdAt` read earlier is carried forward;
 * otherwise it is set now. `updatedAt` is always set. Audit fields only.
 */
function toWriteData(domain) {
  const { id, createdAt, updatedAt, ...fields } = domain;
  return {
    ...mapValues(fields, dateToTimestamp),
    createdAt: createdAt instanceof Date ? Timestamp.fromDate(createdAt) : serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

function splitDocs(kind, snapshots) {
  const docs = [];
  const invalid = [];
  for (const snapshot of snapshots) {
    const result = fromSnapshot(kind, snapshot);
    (result.invalid === true ? invalid : docs).push(result);
  }
  return { docs, invalid };
}

function requireValid(kind, result, label) {
  if (result === null) throw new FitnessServiceError(ServiceErrorCode.NOT_FOUND, `${label} not found.`);
  if (result.invalid === true) {
    throw new FitnessServiceError(ServiceErrorCode.INVALID_DOCUMENT, `${label} could not be read: ${result.reason}`, result);
  }
  return result;
}

/* ===============================
   SERVICE FACTORY (§4.3, §4.5)
================================ */
export function createFitnessService({ db, uid } = {}) {
  if (!db) throw new ValidationError("db", "db is required.");
  requireId(uid, "uid");

  // Every reference derives from the bound uid; callers never supply a user path.
  const userCollection = name => collection(db, "users", uid, name);
  const userDoc = (name, id) => {
    requireId(id, `${name} id`);
    return doc(db, "users", uid, name, id);
  };
  const profileRef = () => userDoc(CONFIG, PROFILE_ID);
  const weeklyTemplateRef = () => userDoc(CONFIG, WEEKLY_TEMPLATE_ID);
  const exerciseRef = id => userDoc(EXERCISES, id);
  const routineRef = id => userDoc(ROUTINES, id);
  const plannedRef = id => userDoc(PLANNED_SESSIONS, id);
  const workoutRef = id => userDoc(WORKOUT_SESSIONS, id);
  const setsCollection = workoutSessionId => collection(workoutRef(workoutSessionId), SETS);
  const setRef = (workoutSessionId, setId) => {
    requireId(setId, "setId");
    return doc(setsCollection(workoutSessionId), setId);
  };

  async function readDoc(kind, ref) {
    const snapshot = await getDoc(ref);
    return snapshot.exists() ? fromSnapshot(kind, snapshot) : null;
  }

  async function readCollection(kind, refOrQuery) {
    return splitDocs(kind, (await getDocs(refOrQuery)).docs);
  }

  /** Full write of a validated domain object; resolves once applied locally. */
  function writeFull(ref, domain) {
    return { id: ref.id, write: setDoc(ref, toWriteData(domain)) };
  }

  function commit(batch, result) {
    return { ...result, write: batch.commit() };
  }

  async function readExercisesById() {
    const { docs } = await readCollection(DocumentKind.EXERCISE, userCollection(EXERCISES));
    return Object.fromEntries(docs.map(exercise => [exercise.id, exercise]));
  }

  async function readRoutineSnapshot(routineId) {
    const routine = requireValid(DocumentKind.ROUTINE, await readDoc(DocumentKind.ROUTINE, routineRef(routineId)), "Routine");
    return { routine, items: buildSnapshotItems(routine, await readExercisesById()) };
  }

  async function readWorkout(workoutSessionId) {
    return requireValid(DocumentKind.WORKOUT_SESSION,
      await readDoc(DocumentKind.WORKOUT_SESSION, workoutRef(workoutSessionId)), "Workout session");
  }

  /**
   * Existence check that is "server, falling back to cache" (§9.3 step 4).
   * Offline, getDoc rejects with `unavailable` for a document the cache has
   * never seen; for this check that means "not known locally".
   */
  async function existsPreferServer(ref) {
    try {
      return (await getDoc(ref)).exists();
    } catch (error) {
      if (error?.code === "unavailable") return false;
      throw error;
    }
  }

  function requireActive(session) {
    if (session.status !== WorkoutStatus.ACTIVE) {
      throw new FitnessServiceError(ServiceErrorCode.INVALID_STATE, `Workout session ${session.id} is ${session.status}, not ACTIVE.`);
    }
  }

  /** Adds the planned-session side of a completion or abandonment to `batch` (§7.1). */
  async function addPlannedFinish(batch, session, to, now) {
    if (session.origin !== WorkoutOrigin.PLANNED) return;
    const planned = requireValid(DocumentKind.PLANNED_SESSION,
      await readDoc(DocumentKind.PLANNED_SESSION, plannedRef(session.plannedSessionId)), "Planned session");
    const next = transition(LifecycleKind.PLANNED_SESSION, planned, to, now);
    validatePlannedSession(next);
    batch.update(plannedRef(planned.id), { status: next.status, updatedAt: serverTimestamp() });
  }

  /* ---------- Singletons: profile, weekly template ---------- */

  async function getProfile() {
    return readDoc(DocumentKind.PROFILE, profileRef());
  }

  function saveProfile(profile) {
    validateProfile(profile);
    return writeFull(profileRef(), profile);
  }

  async function getWeeklyTemplate() {
    return readDoc(DocumentKind.WEEKLY_TEMPLATE, weeklyTemplateRef());
  }

  function saveWeeklyTemplate(template) {
    validateWeeklyTemplate(template);
    return writeFull(weeklyTemplateRef(), template);
  }

  /* ---------- Exercises and routines (auto-IDs; archived, never deleted) ---------- */

  async function listExercises() {
    return readCollection(DocumentKind.EXERCISE, userCollection(EXERCISES));
  }

  async function getExercise(exerciseId) {
    return readDoc(DocumentKind.EXERCISE, exerciseRef(exerciseId));
  }

  /** Creates the exercise when it has no `id`, otherwise replaces it. */
  function saveExercise(exercise) {
    validateExercise(exercise);
    const ref = exercise.id === undefined ? doc(userCollection(EXERCISES)) : exerciseRef(exercise.id);
    return writeFull(ref, exercise);
  }

  async function listRoutines() {
    return readCollection(DocumentKind.ROUTINE, userCollection(ROUTINES));
  }

  async function getRoutine(routineId) {
    return readDoc(DocumentKind.ROUTINE, routineRef(routineId));
  }

  /**
   * Creates the routine when it has no `id`, otherwise replaces it. Referenced
   * exercises must exist in `exercisesById`. Never touches existing snapshots.
   */
  function saveRoutine(routine, exercisesById) {
    validateRoutine(routine, exercisesById);
    const ref = routine.id === undefined ? doc(userCollection(ROUTINES)) : routineRef(routine.id);
    return writeFull(ref, routine);
  }

  /* ---------- Planned sessions (§6.6, §7.1, §8) ---------- */

  async function getPlannedSession(plannedSessionId) {
    return readDoc(DocumentKind.PLANNED_SESSION, plannedRef(plannedSessionId));
  }

  /** Planned sessions whose current `localDate` is within [startLocalDate, endLocalDate] (§8.3). */
  async function listPlannedSessions(startLocalDate, endLocalDate) {
    requireLocalDateArg(startLocalDate, "startLocalDate");
    requireLocalDateArg(endLocalDate, "endLocalDate");
    if (compareLocalDates(startLocalDate, endLocalDate) > 0) {
      throw new ValidationError("endLocalDate", "endLocalDate must not be before startLocalDate.");
    }
    return readCollection(DocumentKind.PLANNED_SESSION, query(userCollection(PLANNED_SESSIONS),
      where("localDate", ">=", startLocalDate), where("localDate", "<=", endLocalDate)));
  }

  /**
   * Creates a MANUAL planned session with a Firestore auto-ID. Not idempotent:
   * never retry automatically (§9.2).
   */
  function createManualPlannedSession(planned) {
    if (planned?.id !== undefined) throw new ValidationError("id", "A new manual planned session must not have an id.");
    if (planned.origin !== PlannedSessionOrigin.MANUAL) throw new ValidationError("origin", "origin must be MANUAL.");
    if (planned.status !== PlannedSessionStatus.PLANNED) throw new ValidationError("status", "A new planned session must be PLANNED.");
    validatePlannedSession(planned);
    return writeFull(doc(userCollection(PLANNED_SESSIONS)), planned);
  }

  const EDITABLE_PLANNED_FIELDS = Object.freeze(["localDate", "routineId", "routineName", "items"]);

  /**
   * PLANNED → PLANNED edits (§7.1): move (`localDate`) or refresh/edit the
   * snapshot (`routineId`, `routineName`, `items`). `planned` is the session as
   * read; only the changed fields are written.
   */
  function updatePlannedSession(planned, changes) {
    if (planned?.status !== PlannedSessionStatus.PLANNED) {
      throw new FitnessServiceError(ServiceErrorCode.INVALID_STATE, "Only PLANNED sessions can be edited.");
    }
    const keys = Object.keys(changes ?? {});
    const disallowed = keys.filter(key => !EDITABLE_PLANNED_FIELDS.includes(key));
    if (!keys.length || disallowed.length) {
      throw new ValidationError("changes", `changes must contain only ${EDITABLE_PLANNED_FIELDS.join(", ")}.`);
    }
    validatePlannedSession({ ...planned, ...changes });
    return {
      id: planned.id,
      write: updateDoc(plannedRef(planned.id), { ...mapValues(changes, dateToTimestamp), updatedAt: serverTimestamp() })
    };
  }

  /** PLANNED → SKIPPED or CANCELLED. Starting, completing, and abandoning go through workouts. */
  function setPlannedSessionStatus(planned, to, now) {
    if (to !== PlannedSessionStatus.SKIPPED && to !== PlannedSessionStatus.CANCELLED) {
      throw new ValidationError("status", "Use the workout operations to start, complete, or abandon a planned session.");
    }
    const next = transition(LifecycleKind.PLANNED_SESSION, planned, to, now);
    validatePlannedSession(next);
    return { id: planned.id, write: updateDoc(plannedRef(planned.id), { status: next.status, updatedAt: serverTimestamp() }) };
  }

  /**
   * Applies the weekly template to a week (§8.2). REQUIRES CONNECTIVITY: the
   * template, routines, exercises, and the existence of every target ID are read
   * from the server, then one batch creates only the missing sessions. Rejects
   * (typically `unavailable`) when offline. Resolves after server acknowledgement.
   */
  async function applyWeeklyTemplate(weekStart) {
    const templateSnapshot = await getDocFromServer(weeklyTemplateRef());
    const template = requireValid(DocumentKind.WEEKLY_TEMPLATE,
      templateSnapshot.exists() ? fromSnapshot(DocumentKind.WEEKLY_TEMPLATE, templateSnapshot) : null, "Weekly template");

    const targetIds = template.slots.map(slot => buildTemplatePlannedSessionId(weekStart, slot.slotId));
    const [routineSnapshots, exerciseSnapshots, existingSnapshots] = await Promise.all([
      getDocsFromServer(userCollection(ROUTINES)),
      getDocsFromServer(userCollection(EXERCISES)),
      Promise.all(targetIds.map(id => getDocFromServer(plannedRef(id))))
    ]);

    // Routines are passed as read so the engine reports invalid ones (ROUTINE_INVALID);
    // only valid exercises may be snapshotted.
    const routinesById = Object.fromEntries(routineSnapshots.docs.map(snapshot =>
      [snapshot.id, { id: snapshot.id, ...mapValues(snapshot.data(), timestampToDate) }]));
    const exercisesById = Object.fromEntries(
      splitDocs(DocumentKind.EXERCISE, exerciseSnapshots.docs).docs.map(exercise => [exercise.id, exercise]));
    // Any existing document blocks re-creation, whatever its status, date, or validity.
    const existingPlannedSessionIds = existingSnapshots.filter(snapshot => snapshot.exists()).map(snapshot => snapshot.id);

    const plan = planTemplateApplication({ template, weekStart, routinesById, exercisesById, existingPlannedSessionIds });
    if (plan.toCreate.length > MAX_BATCH_WRITES) {
      throw new ValidationError("weeklyTemplate", `Cannot create more than ${MAX_BATCH_WRITES} sessions in one application.`);
    }
    if (plan.toCreate.length) {
      const batch = writeBatch(db);
      for (const { id, plannedSession } of plan.toCreate) {
        validatePlannedSession({ id, ...plannedSession });
        batch.set(plannedRef(id), toWriteData(plannedSession));
      }
      await batch.commit();
    }
    return {
      weekStart: plan.weekStart,
      created: plan.toCreate.map(entry => entry.id),
      skippedExisting: plan.skippedExisting,
      skippedUnavailable: plan.skippedUnavailable
    };
  }

  /* ---------- Workouts (§6.7, §9.3) ---------- */

  async function getWorkoutSession(workoutSessionId) {
    return readDoc(DocumentKind.WORKOUT_SESSION, workoutRef(workoutSessionId));
  }

  function activeSessionsQuery() {
    return query(userCollection(WORKOUT_SESSIONS), where("status", "==", WorkoutStatus.ACTIVE));
  }

  async function listActiveWorkoutSessions() {
    return readCollection(DocumentKind.WORKOUT_SESSION, activeSessionsQuery());
  }

  /**
   * Starts (or resumes) the workout for a planned session without a
   * transaction (§9.3). Reads use the server when reachable and the cache
   * otherwise, so this works offline once the planned session is in the cache.
   * Returns `{ workoutSessionId, resumed, write }`; `write` is null on resume.
   */
  async function startPlannedWorkout(plannedSessionId, now) {
    requireNow(now);
    const planned = requireValid(DocumentKind.PLANNED_SESSION,
      await readDoc(DocumentKind.PLANNED_SESSION, plannedRef(plannedSessionId)), "Planned session");
    if (planned.status === PlannedSessionStatus.STARTED) {
      return { workoutSessionId: planned.workoutSessionId, resumed: true, write: null };
    }
    // Refuses anything that is not PLANNED → STARTED (throws ValidationError).
    const nextPlanned = transition(LifecycleKind.PLANNED_SESSION, planned, PlannedSessionStatus.STARTED, now);
    validatePlannedSession(nextPlanned);

    const workoutSessionId = buildPlannedWorkoutSessionId(planned.id);
    if (await existsPreferServer(workoutRef(workoutSessionId))) {
      return { workoutSessionId, resumed: true, write: null };
    }

    const workout = {
      schemaVersion: SCHEMA_VERSION,
      origin: WorkoutOrigin.PLANNED,
      plannedSessionId: planned.id,
      routineId: planned.routineId,
      routineName: planned.routineName,
      localDate: todayLocal(now),
      status: WorkoutStatus.ACTIVE,
      startedAt: now,
      completedAt: null,
      abandonedAt: null,
      items: planned.items
    };
    validateWorkoutSession({ id: workoutSessionId, ...workout });

    const batch = writeBatch(db);
    batch.set(workoutRef(workoutSessionId), toWriteData(workout));
    batch.update(plannedRef(planned.id), {
      status: nextPlanned.status,
      workoutSessionId: nextPlanned.workoutSessionId,
      updatedAt: serverTimestamp()
    });
    return commit(batch, { workoutSessionId, resumed: false });
  }

  /**
   * Starts an UNPLANNED workout (§9.3) with a client-generated auto-ID, either
   * snapshotting `routineId` or empty. Not idempotent: never retry automatically.
   * The caller checks for existing ACTIVE sessions first (§9.3 step 1).
   */
  async function startUnplannedWorkout({ routineId = null, now } = {}) {
    requireNow(now);
    let routine = null;
    let items = {};
    if (routineId !== null) ({ routine, items } = await readRoutineSnapshot(routineId));

    const ref = doc(userCollection(WORKOUT_SESSIONS));
    const workout = {
      schemaVersion: SCHEMA_VERSION,
      origin: WorkoutOrigin.UNPLANNED,
      plannedSessionId: null,
      routineId: routine ? routine.id : null,
      routineName: routine ? routine.name : null,
      localDate: todayLocal(now),
      status: WorkoutStatus.ACTIVE,
      startedAt: now,
      completedAt: null,
      abandonedAt: null,
      items
    };
    validateWorkoutSession({ id: ref.id, ...workout });
    const { write } = writeFull(ref, workout);
    return { workoutSessionId: ref.id, resumed: false, write };
  }

  /**
   * Adds an ADDED item to an ACTIVE workout with a field-path update (§6.7).
   * Existing items, including prescribed ones, are never replaced.
   */
  function addWorkoutItem(session, item) {
    requireActive(session);
    if (item?.source !== ItemSource.ADDED) throw new ValidationError("source", "Only ADDED items can be added to a workout.");
    if (Object.hasOwn(session.items, item.occurrenceId)) {
      throw new ValidationError("occurrenceId", `Item ${item.occurrenceId} already exists in this workout.`);
    }
    const items = { ...session.items, [item.occurrenceId]: item };
    validateSnapshotItems(items);
    validateWorkoutSession({ ...session, items });
    return {
      workoutSessionId: session.id,
      occurrenceId: item.occurrenceId,
      write: updateDoc(workoutRef(session.id), { [`items.${item.occurrenceId}`]: item, updatedAt: serverTimestamp() })
    };
  }

  /**
   * Saves one set of an ACTIVE workout with a full setDoc on its deterministic
   * ID (§6.8). Idempotent: a retry overwrites the same document. Corrections on
   * completed sessions are not handled here (they must rebuild the summary, §10.1).
   */
  function saveSet(session, set) {
    requireActive(session);
    const item = session.items[set?.occurrenceId];
    if (!item) throw new ValidationError("occurrenceId", `No item ${String(set?.occurrenceId)} in this workout.`);
    validateSet(set, item);
    const setId = buildSetId(set.occurrenceId, set.setNumber, set.side);
    const { write } = writeFull(setRef(session.id, setId), set);
    return { workoutSessionId: session.id, setId, write };
  }

  /** Removes a set of an ACTIVE workout by its deterministic ID (§6.8). */
  function deleteSet(session, { occurrenceId, setNumber, side }) {
    requireActive(session);
    const setId = buildSetId(occurrenceId, setNumber, side);
    return { workoutSessionId: session.id, setId, write: deleteDoc(setRef(session.id, setId)) };
  }

  async function listWorkoutSets(workoutSessionId) {
    return readCollection(DocumentKind.SET, setsCollection(workoutSessionId));
  }

  /**
   * Completes an ACTIVE workout in one batch (§9.3): status, completedAt,
   * performanceSummary, completedExerciseIds (all from the engine, over the
   * locally visible sets), plus planned session → COMPLETED when PLANNED.
   * Refuses if any set document cannot be read, so the summary is never partial.
   */
  async function completeWorkout(workoutSessionId, now) {
    requireNow(now);
    const session = await readWorkout(workoutSessionId);
    const { docs: sets, invalid } = await listWorkoutSets(session.id);
    if (invalid.length) {
      throw new FitnessServiceError(ServiceErrorCode.INVALID_DOCUMENT,
        `${invalid.length} set(s) of workout ${session.id} could not be read.`, invalid);
    }
    const completed = completeWorkoutSession(session, sets, now);

    const batch = writeBatch(db);
    batch.update(workoutRef(session.id), {
      status: completed.status,
      completedAt: Timestamp.fromDate(completed.completedAt),
      performanceSummary: completed.performanceSummary,
      completedExerciseIds: completed.completedExerciseIds,
      updatedAt: serverTimestamp()
    });
    await addPlannedFinish(batch, session, PlannedSessionStatus.COMPLETED, now);
    return commit(batch, { workoutSessionId: session.id, session: completed });
  }

  /** Abandons an ACTIVE workout in one batch, plus planned session → ABANDONED when PLANNED. Sets are kept. */
  async function abandonWorkout(workoutSessionId, now) {
    requireNow(now);
    const session = await readWorkout(workoutSessionId);
    const abandoned = transition(LifecycleKind.WORKOUT_SESSION, session, WorkoutStatus.ABANDONED, now);
    validateWorkoutSession(abandoned);

    const batch = writeBatch(db);
    batch.update(workoutRef(session.id), {
      status: abandoned.status,
      abandonedAt: Timestamp.fromDate(abandoned.abandonedAt),
      updatedAt: serverTimestamp()
    });
    await addPlannedFinish(batch, session, PlannedSessionStatus.ABANDONED, now);
    return commit(batch, { workoutSessionId: session.id, session: abandoned });
  }

  /* ---------- History (§10.1, §10.3): summaries only, no set queries ---------- */

  /**
   * One page of completed workouts, newest first. `cursor` is the opaque value
   * returned by the previous page. Non-completed sessions (completedAt null)
   * sort last and end paging.
   */
  async function listCompletedWorkouts({ pageSize = HISTORY_PAGE_SIZE, cursor = null } = {}) {
    if (!Number.isInteger(pageSize) || pageSize < 1) throw new ValidationError("pageSize", "pageSize must be a positive integer.");
    const constraints = [orderBy("completedAt", "desc"), limit(pageSize)];
    if (cursor !== null) constraints.splice(1, 0, startAfter(cursor));
    const snapshots = (await getDocs(query(userCollection(WORKOUT_SESSIONS), ...constraints))).docs;

    const reachedUncompleted = snapshots.findIndex(snapshot => snapshot.get("completedAt") === null);
    const page = reachedUncompleted === -1 ? snapshots : snapshots.slice(0, reachedUncompleted);
    const { docs, invalid } = splitDocs(DocumentKind.WORKOUT_SESSION, page);
    const done = reachedUncompleted !== -1 || snapshots.length < pageSize;
    return {
      docs: docs.filter(session => session.status === WorkoutStatus.COMPLETED),
      invalid,
      cursor: done || !page.length ? null : page[page.length - 1],
      done
    };
  }

  /** Every completed workout containing `exerciseId`, newest first (array-contains, §10.3). */
  async function listCompletedWorkoutsForExercise(exerciseId) {
    requireId(exerciseId, "exerciseId");
    const { docs, invalid } = await readCollection(DocumentKind.WORKOUT_SESSION,
      query(userCollection(WORKOUT_SESSIONS), where("completedExerciseIds", "array-contains", exerciseId)));
    return {
      docs: docs
        .filter(session => session.status === WorkoutStatus.COMPLETED)
        .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime()),
      invalid
    };
  }

  /* ---------- Subscriptions (§9.2, §9.4): each returns its unsubscribe function ---------- */

  function subscribeActiveWorkoutSessions(onNext, onError) {
    return onSnapshot(activeSessionsQuery(), snapshot => {
      onNext({ ...splitDocs(DocumentKind.WORKOUT_SESSION, snapshot.docs), fromCache: snapshot.metadata.fromCache });
    }, onError);
  }

  function subscribeWorkoutSession(workoutSessionId, onNext, onError) {
    return onSnapshot(workoutRef(workoutSessionId), { includeMetadataChanges: true }, snapshot => {
      onNext({
        session: snapshot.exists() ? fromSnapshot(DocumentKind.WORKOUT_SESSION, snapshot) : null,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
        fromCache: snapshot.metadata.fromCache
      });
    }, onError);
  }

  /** Sets of one workout with per-set pending state (`pendingIds`) for write-state display. */
  function subscribeWorkoutSets(workoutSessionId, onNext, onError) {
    return onSnapshot(setsCollection(workoutSessionId), { includeMetadataChanges: true }, snapshot => {
      onNext({
        ...splitDocs(DocumentKind.SET, snapshot.docs),
        pendingIds: new Set(snapshot.docs.filter(d => d.metadata.hasPendingWrites).map(d => d.id)),
        fromCache: snapshot.metadata.fromCache
      });
    }, onError);
  }

  return Object.freeze({
    uid,
    getProfile, saveProfile,
    getWeeklyTemplate, saveWeeklyTemplate,
    listExercises, getExercise, saveExercise,
    listRoutines, getRoutine, saveRoutine,
    getPlannedSession, listPlannedSessions, createManualPlannedSession,
    updatePlannedSession, setPlannedSessionStatus, applyWeeklyTemplate,
    getWorkoutSession, listActiveWorkoutSessions,
    startPlannedWorkout, startUnplannedWorkout, addWorkoutItem,
    saveSet, deleteSet, listWorkoutSets,
    completeWorkout, abandonWorkout,
    listCompletedWorkouts, listCompletedWorkoutsForExercise,
    subscribeActiveWorkoutSessions, subscribeWorkoutSession, subscribeWorkoutSets
  });
}
