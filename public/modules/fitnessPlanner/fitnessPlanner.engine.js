// /modules/fitnessPlanner/fitnessPlanner.engine.js
//
// Pure domain engine for the Fitness Planner (technical design v1.1).
// No Firebase, DOM, storage, network, clock, or randomness: `now` and
// `randomId` are always supplied by the caller. Importable by Node (`node:test`).

/* ===============================
   CONSTANTS AND ENUMS (§5.1)
================================ */
export const SCHEMA_VERSION = 1;
export const NAME_MAX_LENGTH = 100;

export const TrackingType = Object.freeze({
  WEIGHT_AND_REPS: "WEIGHT_AND_REPS",
  REPS_ONLY: "REPS_ONLY"
});

export const Laterality = Object.freeze({
  BILATERAL: "BILATERAL",
  UNILATERAL: "UNILATERAL"
});

export const Side = Object.freeze({
  LEFT: "LEFT",
  RIGHT: "RIGHT"
});

export const WeightUnit = Object.freeze({
  KG: "KG"
});

export const ItemSource = Object.freeze({
  PRESCRIBED: "PRESCRIBED",
  ADDED: "ADDED"
});

export const PlannedSessionOrigin = Object.freeze({
  TEMPLATE: "TEMPLATE",
  MANUAL: "MANUAL"
});

export const PlannedSessionStatus = Object.freeze({
  PLANNED: "PLANNED",
  STARTED: "STARTED",
  SKIPPED: "SKIPPED",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED",
  ABANDONED: "ABANDONED"
});

export const WorkoutOrigin = Object.freeze({
  PLANNED: "PLANNED",
  UNPLANNED: "UNPLANNED"
});

export const WorkoutStatus = Object.freeze({
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  ABANDONED: "ABANDONED"
});

export const LifecycleKind = Object.freeze({
  PLANNED_SESSION: "PLANNED_SESSION",
  WORKOUT_SESSION: "WORKOUT_SESSION"
});

export const DocumentKind = Object.freeze({
  PROFILE: "PROFILE",
  WEEKLY_TEMPLATE: "WEEKLY_TEMPLATE",
  EXERCISE: "EXERCISE",
  ROUTINE: "ROUTINE",
  PLANNED_SESSION: "PLANNED_SESSION",
  WORKOUT_SESSION: "WORKOUT_SESSION",
  SET: "SET"
});

export const TemplateSkipReason = Object.freeze({
  ROUTINE_NOT_FOUND: "ROUTINE_NOT_FOUND",
  ROUTINE_ARCHIVED: "ROUTINE_ARCHIVED",
  ROUTINE_INVALID: "ROUTINE_INVALID"
});

/* ===============================
   VALIDATION ERROR (§5.4)
================================ */
export class ValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = "ValidationError";
    this.code = "VALIDATION";
    this.field = field;
  }
}

function fail(field, message) {
  throw new ValidationError(field, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function requireObject(value, field) {
  if (!isPlainObject(value)) fail(field, `${field} must be an object.`);
}

function requireSchemaVersion(doc, field) {
  requireObject(doc, field);
  if (!("schemaVersion" in doc)) fail("schemaVersion", "Missing schemaVersion.");
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    fail("schemaVersion", `Unsupported schemaVersion: ${String(doc.schemaVersion)}.`);
  }
}

function requireNonBlankString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(field, `${field} must be a non-blank string.`);
  }
}

function requireName(value, field) {
  requireNonBlankString(value, field);
  if (value !== value.trim()) fail(field, `${field} must not have leading or trailing whitespace.`);
  if (value.length > NAME_MAX_LENGTH) fail(field, `${field} must be at most ${NAME_MAX_LENGTH} characters.`);
}

function requireString(value, field) {
  if (typeof value !== "string") fail(field, `${field} must be a string.`);
}

function requireBoolean(value, field) {
  if (typeof value !== "boolean") fail(field, `${field} must be a boolean.`);
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) fail(field, `${field} must be a positive integer.`);
}

function requireNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) fail(field, `${field} must be a non-negative integer.`);
}

function requireWeight(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(field, `${field} must be a finite number ≥ 0.`);
  }
}

function requireNullableWeight(value, field) {
  if (value !== null) requireWeight(value, field);
}

function requireNullableNonNegativeInteger(value, field) {
  if (value !== null) requireNonNegativeInteger(value, field);
}

function requireEnum(value, enumObject, field) {
  if (!Object.values(enumObject).includes(value)) {
    fail(field, `${field} must be one of ${Object.values(enumObject).join(", ")}.`);
  }
}

function requireDate(value, field) {
  if (!isValidDate(value)) fail(field, `${field} must be a valid Date.`);
}

function requireNull(value, field) {
  if (value !== null) fail(field, `${field} must be null.`);
}

function requireLocalIdField(value, field) {
  if (!isValidLocalId(value)) fail(field, `${field} must match ${LOCAL_ID_PATTERN}.`);
}

function requireDocumentIdField(value, field) {
  if (!isValidDocumentId(value)) fail(field, `${field} must be a valid document ID.`);
}

function requireOptionalId(doc) {
  if ("id" in doc && doc.id !== undefined) requireDocumentIdField(doc.id, "id");
}

/* ===============================
   IDENTIFIERS (§5.3)
================================ */
const LOCAL_ID_PATTERN = /^[a-z0-9]{12}$/;
const RESERVED_DOCUMENT_ID = /^__.*__$/;
const MAX_DOCUMENT_ID_BYTES = 1500;
const SIDE_TOKENS = Object.freeze({ BOTH: "B", LEFT: "L", RIGHT: "R" });

export function isValidLocalId(value) {
  return typeof value === "string" && LOCAL_ID_PATTERN.test(value);
}

export function isValidDocumentId(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).length <= MAX_DOCUMENT_ID_BYTES &&
    !value.includes("/") &&
    value !== "." &&
    value !== ".." &&
    !RESERVED_DOCUMENT_ID.test(value);
}

/** Generates an occurrenceId or slotId from a caller-supplied random source. */
export function createLocalId(randomId) {
  if (typeof randomId !== "function") fail("randomId", "randomId must be a function.");
  const id = randomId();
  requireLocalIdField(id, "randomId()");
  return id;
}

export function buildTemplatePlannedSessionId(weekStart, slotId) {
  requireMonday(weekStart, "weekStart");
  requireLocalIdField(slotId, "slotId");
  return `${weekStart}_${slotId}`;
}

export function buildPlannedWorkoutSessionId(plannedSessionId) {
  requireDocumentIdField(plannedSessionId, "plannedSessionId");
  const id = `p_${plannedSessionId}`;
  requireDocumentIdField(id, "workoutSessionId");
  return id;
}

export function buildSetId(occurrenceId, setNumber, side) {
  requireLocalIdField(occurrenceId, "occurrenceId");
  requirePositiveInteger(setNumber, "setNumber");
  let token;
  if (side === null) token = SIDE_TOKENS.BOTH;
  else if (side === Side.LEFT) token = SIDE_TOKENS.LEFT;
  else if (side === Side.RIGHT) token = SIDE_TOKENS.RIGHT;
  else fail("side", "side must be null, LEFT, or RIGHT.");
  return `${occurrenceId}_${setNumber}_${token}`;
}

/* ===============================
   LOCAL CALENDAR DATES (§13.1)
================================ */
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year, month) {
  const d = new Date(0);
  d.setUTCFullYear(year, month, 0);
  return d.getUTCDate();
}

function pad(value, length) {
  return String(value).padStart(length, "0");
}

// Calendar arithmetic on components in UTC, so the device time zone and DST never apply.
function componentsToUtc({ year, month, day }) {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  return d;
}

function utcToComponents(d) {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function parseLocalDate(value) {
  if (typeof value !== "string") fail("localDate", "Local date must be a YYYY-MM-DD string.");
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) fail("localDate", `Invalid local date: ${value}.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    fail("localDate", `Invalid local date: ${value}.`);
  }
  return { year, month, day };
}

export function isValidLocalDate(value) {
  try {
    parseLocalDate(value);
    return true;
  } catch (error) {
    if (error instanceof ValidationError) return false;
    throw error;
  }
}

export function formatLocalDate(components) {
  requireObject(components, "localDate");
  const { year, month, day } = components;
  if (![year, month, day].every(Number.isInteger)) {
    fail("localDate", "year, month, and day must be integers.");
  }
  const formatted = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  parseLocalDate(formatted);
  return formatted;
}

/** The only function that interprets the device time zone. */
export function todayLocal(now) {
  requireDate(now, "now");
  return formatLocalDate({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

export function addDays(localDate, days) {
  const components = parseLocalDate(localDate);
  if (!Number.isInteger(days)) fail("days", "days must be an integer.");
  const d = componentsToUtc({ ...components, day: components.day + days });
  return formatLocalDate(utcToComponents(d));
}

export function compareLocalDates(a, b) {
  parseLocalDate(a);
  parseLocalDate(b);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(localDate) {
  const day = componentsToUtc(parseLocalDate(localDate)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function weekStartOf(localDate) {
  return addDays(localDate, 1 - isoWeekday(localDate));
}

function requireMonday(localDate, field) {
  if (!isValidLocalDate(localDate)) fail(field, `${field} must be a valid YYYY-MM-DD date.`);
  if (isoWeekday(localDate) !== 1) fail(field, `${field} must be a Monday.`);
}

export function weekDates(weekStart) {
  requireMonday(weekStart, "weekStart");
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/* ===============================
   DOCUMENT VALIDATORS (§6, §16)
   Validators throw ValidationError and never mutate input.
   Unknown extra fields are allowed (§5.2: additive fields keep v1).
   Audit fields (createdAt, updatedAt) are not validated (§13.2).
================================ */
export function validateProfile(profile) {
  requireSchemaVersion(profile, "profile");
  requireOptionalId(profile);
  if (!Array.isArray(profile.goals)) fail("goals", "goals must be an array.");
  profile.goals.forEach((goal, i) => requireNonBlankString(goal, `goals[${i}]`));
  requireString(profile.notes, "notes");
  requireEnum(profile.weightUnit, WeightUnit, "weightUnit");
  if (typeof profile.progressionIncrementKg !== "number" ||
      !Number.isFinite(profile.progressionIncrementKg) ||
      profile.progressionIncrementKg <= 0) {
    fail("progressionIncrementKg", "progressionIncrementKg must be a finite number > 0.");
  }
}

export function validateExercise(exercise) {
  requireSchemaVersion(exercise, "exercise");
  requireOptionalId(exercise);
  requireName(exercise.name, "name");
  requireEnum(exercise.trackingType, TrackingType, "trackingType");
  requireEnum(exercise.laterality, Laterality, "laterality");
  if (!Array.isArray(exercise.equipment)) fail("equipment", "equipment must be an array.");
  exercise.equipment.forEach((tag, i) => requireNonBlankString(tag, `equipment[${i}]`));
  requireString(exercise.notes, "notes");
  requireBoolean(exercise.isArchived, "isArchived");
}

function validatePrescription(item, trackingType, field) {
  requirePositiveInteger(item.targetSets, `${field}.targetSets`);
  requirePositiveInteger(item.repMin, `${field}.repMin`);
  requirePositiveInteger(item.repMax, `${field}.repMax`);
  if (item.repMin > item.repMax) fail(`${field}.repMin`, "repMin must not exceed repMax.");
  requireNullableWeight(item.targetWeight, `${field}.targetWeight`);
  if (trackingType === TrackingType.REPS_ONLY && item.targetWeight !== null) {
    fail(`${field}.targetWeight`, "targetWeight must be null for REPS_ONLY exercises.");
  }
}

// entries: [fieldPath, entry] pairs; orders must be unique within each group.
function requireUniqueOrders(entries, groupOf = () => "") {
  const seen = new Set();
  for (const [path, entry] of entries) {
    const key = `${groupOf(entry)}|${entry.order}`;
    if (seen.has(key)) fail(`${path}.order`, "Duplicate order.");
    seen.add(key);
  }
}

/**
 * @param routine Routine domain object.
 * @param exercisesById Optional `{ [exerciseId]: exercise }`; when supplied,
 *   referenced exercises must exist and REPS_ONLY items must not carry a targetWeight.
 */
export function validateRoutine(routine, exercisesById) {
  requireSchemaVersion(routine, "routine");
  requireOptionalId(routine);
  requireName(routine.name, "name");
  requireBoolean(routine.isArchived, "isArchived");
  if (!Array.isArray(routine.items)) fail("items", "items must be an array.");
  if (exercisesById !== undefined) requireObject(exercisesById, "exercisesById");

  const occurrenceIds = new Set();
  routine.items.forEach((item, i) => {
    const field = `items[${i}]`;
    requireObject(item, field);
    requireLocalIdField(item.occurrenceId, `${field}.occurrenceId`);
    if (occurrenceIds.has(item.occurrenceId)) fail(`${field}.occurrenceId`, "Duplicate occurrenceId.");
    occurrenceIds.add(item.occurrenceId);
    requireDocumentIdField(item.exerciseId, `${field}.exerciseId`);
    requireNonNegativeInteger(item.order, `${field}.order`);
    requireNullableNonNegativeInteger(item.restSeconds, `${field}.restSeconds`);
    requireString(item.notes, `${field}.notes`);

    let trackingType = null;
    if (exercisesById !== undefined) {
      const exercise = exercisesById[item.exerciseId];
      if (!isPlainObject(exercise)) fail(`${field}.exerciseId`, `Exercise not found: ${item.exerciseId}.`);
      trackingType = exercise.trackingType;
    }
    validatePrescription(item, trackingType, field);
  });
  requireUniqueOrders(routine.items.map((item, i) => [`items[${i}]`, item]));
}

/** Validates a prescription snapshot map keyed by occurrenceId (§6.5). */
export function validateSnapshotItems(items) {
  requireObject(items, "items");
  const entries = Object.entries(items);
  for (const [key, item] of entries) {
    const field = `items.${key}`;
    requireObject(item, field);
    requireLocalIdField(item.occurrenceId, `${field}.occurrenceId`);
    if (item.occurrenceId !== key) fail(`${field}.occurrenceId`, "Map key must equal occurrenceId.");
    requireNonNegativeInteger(item.order, `${field}.order`);
    requireDocumentIdField(item.exerciseId, `${field}.exerciseId`);
    requireNonBlankString(item.exerciseName, `${field}.exerciseName`);
    requireEnum(item.trackingType, TrackingType, `${field}.trackingType`);
    requireEnum(item.laterality, Laterality, `${field}.laterality`);
    requireEnum(item.source, ItemSource, `${field}.source`);
    requireNullableNonNegativeInteger(item.restSeconds, `${field}.restSeconds`);
    requireString(item.notes, `${field}.notes`);
    if (item.source === ItemSource.PRESCRIBED) {
      validatePrescription(item, item.trackingType, field);
    } else {
      for (const name of ["targetSets", "repMin", "repMax", "targetWeight"]) {
        requireNull(item[name], `${field}.${name}`);
      }
    }
  }
  requireUniqueOrders(entries.map(([key, item]) => [`items.${key}`, item]));
}

export function validateWeeklyTemplate(template) {
  requireSchemaVersion(template, "weeklyTemplate");
  requireOptionalId(template);
  if (!Array.isArray(template.slots)) fail("slots", "slots must be an array.");
  const slotIds = new Set();
  template.slots.forEach((slot, i) => {
    const field = `slots[${i}]`;
    requireObject(slot, field);
    requireLocalIdField(slot.slotId, `${field}.slotId`);
    if (slotIds.has(slot.slotId)) fail(`${field}.slotId`, "Duplicate slotId.");
    slotIds.add(slot.slotId);
    if (!Number.isInteger(slot.weekday) || slot.weekday < 1 || slot.weekday > 7) {
      fail(`${field}.weekday`, "weekday must be an integer from 1 (Monday) to 7 (Sunday).");
    }
    requireDocumentIdField(slot.routineId, `${field}.routineId`);
    requireNonNegativeInteger(slot.order, `${field}.order`);
  });
  requireUniqueOrders(template.slots.map((slot, i) => [`slots[${i}]`, slot]), slot => slot.weekday);
}

const PLANNED_STATUSES_WITH_WORKOUT = new Set([
  PlannedSessionStatus.STARTED,
  PlannedSessionStatus.COMPLETED,
  PlannedSessionStatus.ABANDONED
]);

export function validatePlannedSession(planned) {
  requireSchemaVersion(planned, "plannedSession");
  requireOptionalId(planned);
  requireEnum(planned.origin, PlannedSessionOrigin, "origin");
  if (planned.origin === PlannedSessionOrigin.TEMPLATE) {
    requireLocalIdField(planned.templateSlotId, "templateSlotId");
    requireMonday(planned.weekStart, "weekStart");
    if (planned.id !== undefined &&
        planned.id !== buildTemplatePlannedSessionId(planned.weekStart, planned.templateSlotId)) {
      fail("id", "Template planned-session id must equal `${weekStart}_${templateSlotId}`.");
    }
  } else {
    requireNull(planned.templateSlotId, "templateSlotId");
    requireNull(planned.weekStart, "weekStart");
  }
  if (!isValidLocalDate(planned.localDate)) fail("localDate", "localDate must be a valid YYYY-MM-DD date.");
  if (!isValidLocalDate(planned.originalLocalDate)) {
    fail("originalLocalDate", "originalLocalDate must be a valid YYYY-MM-DD date.");
  }
  requireDocumentIdField(planned.routineId, "routineId");
  requireNonBlankString(planned.routineName, "routineName");
  validateSnapshotItems(planned.items);
  requireEnum(planned.status, PlannedSessionStatus, "status");
  if (PLANNED_STATUSES_WITH_WORKOUT.has(planned.status)) {
    requireDocumentIdField(planned.workoutSessionId, "workoutSessionId");
    if (planned.id !== undefined && planned.workoutSessionId !== buildPlannedWorkoutSessionId(planned.id)) {
      fail("workoutSessionId", "workoutSessionId must equal `p_${id}`.");
    }
  } else {
    requireNull(planned.workoutSessionId, "workoutSessionId");
  }
}

/** Validates the §10.2 summary map keyed by exerciseId. */
export function validatePerformanceSummary(summary) {
  requireObject(summary, "performanceSummary");
  for (const [exerciseId, entry] of Object.entries(summary)) {
    const field = `performanceSummary.${exerciseId}`;
    requireObject(entry, field);
    if (entry.exerciseId !== exerciseId) fail(`${field}.exerciseId`, "Map key must equal exerciseId.");
    requireDocumentIdField(entry.exerciseId, `${field}.exerciseId`);
    requireNonBlankString(entry.exerciseName, `${field}.exerciseName`);
    requireEnum(entry.trackingType, TrackingType, `${field}.trackingType`);
    requireEnum(entry.laterality, Laterality, `${field}.laterality`);
    const weighted = entry.trackingType === TrackingType.WEIGHT_AND_REPS;
    if (weighted) requireEnum(entry.weightUnit, WeightUnit, `${field}.weightUnit`);
    else requireNull(entry.weightUnit, `${field}.weightUnit`);
    if (!Array.isArray(entry.occurrences) || entry.occurrences.length === 0) {
      fail(`${field}.occurrences`, "occurrences must be a non-empty array.");
    }
    let setCount = 0;
    entry.occurrences.forEach((occurrence, i) => {
      const of = `${field}.occurrences[${i}]`;
      requireObject(occurrence, of);
      requireLocalIdField(occurrence.occurrenceId, `${of}.occurrenceId`);
      requireEnum(occurrence.source, ItemSource, `${of}.source`);
      if (occurrence.source === ItemSource.PRESCRIBED) {
        requireObject(occurrence.prescribed, `${of}.prescribed`);
        validatePrescription(occurrence.prescribed, entry.trackingType, `${of}.prescribed`);
      } else {
        requireNull(occurrence.prescribed, `${of}.prescribed`);
      }
      if (!Array.isArray(occurrence.sets)) fail(`${of}.sets`, "sets must be an array.");
      occurrence.sets.forEach((set, j) => {
        const sf = `${of}.sets[${j}]`;
        requireObject(set, sf);
        requirePositiveInteger(set.setNumber, `${sf}.setNumber`);
        requireSideForLaterality(set.side, entry.laterality, `${sf}.side`);
        requireNonNegativeInteger(set.reps, `${sf}.reps`);
        if (weighted) requireWeight(set.weight, `${sf}.weight`);
        else requireNull(set.weight, `${sf}.weight`);
      });
      setCount += occurrence.sets.length;
    });
    if (setCount === 0) fail(`${field}.occurrences`, "A summarized exercise must contain at least one set.");
  }
}

export function validateWorkoutSession(session) {
  requireSchemaVersion(session, "workoutSession");
  requireOptionalId(session);
  requireEnum(session.origin, WorkoutOrigin, "origin");
  if (session.origin === WorkoutOrigin.PLANNED) {
    requireDocumentIdField(session.plannedSessionId, "plannedSessionId");
    requireDocumentIdField(session.routineId, "routineId");
    if (session.id !== undefined && session.id !== buildPlannedWorkoutSessionId(session.plannedSessionId)) {
      fail("id", "Planned workout id must equal `p_${plannedSessionId}`.");
    }
  } else {
    requireNull(session.plannedSessionId, "plannedSessionId");
  }
  if (session.routineId === null) {
    requireNull(session.routineName, "routineName");
  } else {
    requireDocumentIdField(session.routineId, "routineId");
    requireNonBlankString(session.routineName, "routineName");
  }
  if (!isValidLocalDate(session.localDate)) fail("localDate", "localDate must be a valid YYYY-MM-DD date.");
  requireEnum(session.status, WorkoutStatus, "status");
  requireDate(session.startedAt, "startedAt");
  validateSnapshotItems(session.items);

  const completed = session.status === WorkoutStatus.COMPLETED;
  if (completed) requireDate(session.completedAt, "completedAt");
  else requireNull(session.completedAt, "completedAt");
  if (session.status === WorkoutStatus.ABANDONED) requireDate(session.abandonedAt, "abandonedAt");
  else requireNull(session.abandonedAt, "abandonedAt");

  if (completed) {
    validatePerformanceSummary(session.performanceSummary);
    const expected = listCompletedExerciseIds(session.performanceSummary);
    const actual = session.completedExerciseIds;
    if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((id, i) => id !== expected[i])) {
      fail("completedExerciseIds", "completedExerciseIds must equal the sorted performanceSummary keys.");
    }
  } else {
    // §6.7 / §10.3: only completed sessions carry these fields.
    if (session.performanceSummary !== undefined) fail("performanceSummary", "Only COMPLETED sessions have a performanceSummary.");
    if (session.completedExerciseIds !== undefined) fail("completedExerciseIds", "Only COMPLETED sessions have completedExerciseIds.");
  }
}

function requireSideForLaterality(side, laterality, field) {
  if (laterality === Laterality.UNILATERAL) {
    if (side !== Side.LEFT && side !== Side.RIGHT) fail(field, "side must be LEFT or RIGHT for a unilateral exercise.");
  } else if (side !== null) {
    fail(field, "side must be null for a bilateral exercise.");
  }
}

/**
 * @param set Set domain object.
 * @param item Optional snapshot item the set belongs to; when supplied, the set
 *   must match its occurrence, exercise, tracking type, and laterality.
 */
export function validateSet(set, item) {
  requireSchemaVersion(set, "set");
  requireOptionalId(set);
  requireLocalIdField(set.occurrenceId, "occurrenceId");
  requireDocumentIdField(set.exerciseId, "exerciseId");
  requirePositiveInteger(set.setNumber, "setNumber");
  if (set.side !== null && set.side !== Side.LEFT && set.side !== Side.RIGHT) {
    fail("side", "side must be null, LEFT, or RIGHT.");
  }
  requireEnum(set.trackingType, TrackingType, "trackingType");
  requireNonNegativeInteger(set.reps, "reps");
  if (set.trackingType === TrackingType.WEIGHT_AND_REPS) {
    requireWeight(set.weight, "weight");
    requireEnum(set.weightUnit, WeightUnit, "weightUnit");
  } else {
    requireNull(set.weight, "weight");
    requireNull(set.weightUnit, "weightUnit");
  }
  requireDate(set.loggedAt, "loggedAt");
  if (set.correctedAt !== null) requireDate(set.correctedAt, "correctedAt");
  if (set.id !== undefined && set.id !== buildSetId(set.occurrenceId, set.setNumber, set.side)) {
    fail("id", "Set id must equal buildSetId(occurrenceId, setNumber, side).");
  }
  if (item !== undefined) {
    requireObject(item, "item");
    if (set.occurrenceId !== item.occurrenceId) fail("occurrenceId", "Set does not belong to this item.");
    if (set.exerciseId !== item.exerciseId) fail("exerciseId", "Set exerciseId does not match its item.");
    if (set.trackingType !== item.trackingType) fail("trackingType", "Set trackingType does not match its item.");
    requireSideForLaterality(set.side, item.laterality, "side");
  }
}

const VALIDATORS = Object.freeze({
  [DocumentKind.PROFILE]: validateProfile,
  [DocumentKind.WEEKLY_TEMPLATE]: validateWeeklyTemplate,
  [DocumentKind.EXERCISE]: validateExercise,
  [DocumentKind.ROUTINE]: doc => validateRoutine(doc),
  [DocumentKind.PLANNED_SESSION]: validatePlannedSession,
  [DocumentKind.WORKOUT_SESSION]: validateWorkoutSession,
  [DocumentKind.SET]: doc => validateSet(doc)
});

/**
 * Read-side classification (§5.2): returns the document unchanged when valid,
 * otherwise `{ id, invalid: true, reason }`. Never repairs or rewrites.
 */
export function checkDocument(kind, doc) {
  const validator = VALIDATORS[kind];
  if (!validator) fail("kind", `Unknown document kind: ${String(kind)}.`);
  try {
    validator(doc);
    return doc;
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    const id = isPlainObject(doc) && typeof doc.id === "string" ? doc.id : null;
    return { id, invalid: true, reason: `${error.field}: ${error.message}` };
  }
}

/* ===============================
   LIFECYCLE (§7)
================================ */
const TRANSITIONS = Object.freeze({
  [LifecycleKind.PLANNED_SESSION]: Object.freeze({
    [PlannedSessionStatus.PLANNED]: [PlannedSessionStatus.STARTED, PlannedSessionStatus.SKIPPED, PlannedSessionStatus.CANCELLED],
    [PlannedSessionStatus.STARTED]: [PlannedSessionStatus.COMPLETED, PlannedSessionStatus.ABANDONED]
  }),
  [LifecycleKind.WORKOUT_SESSION]: Object.freeze({
    [WorkoutStatus.ACTIVE]: [WorkoutStatus.COMPLETED, WorkoutStatus.ABANDONED]
  })
});

export function canTransition(kind, from, to) {
  const table = TRANSITIONS[kind];
  if (!table) fail("kind", `Unknown lifecycle kind: ${String(kind)}.`);
  return Object.hasOwn(table, from) && table[from].includes(to);
}

/**
 * Returns a new object with the status changed. Sets `completedAt` /
 * `abandonedAt` for workout sessions and `workoutSessionId` (from `doc.id`)
 * for PLANNED → STARTED. Completing a workout must use completeWorkoutSession(),
 * which also derives the performance summary.
 */
export function transition(kind, doc, to, now) {
  requireObject(doc, "doc");
  requireDate(now, "now");
  if (!canTransition(kind, doc.status, to)) {
    fail("status", `Invalid ${kind} transition: ${String(doc.status)} → ${String(to)}.`);
  }
  const next = { ...doc, status: to };
  if (kind === LifecycleKind.WORKOUT_SESSION) {
    if (to === WorkoutStatus.COMPLETED) next.completedAt = now;
    if (to === WorkoutStatus.ABANDONED) next.abandonedAt = now;
  } else if (to === PlannedSessionStatus.STARTED) {
    if (doc.id === undefined) fail("id", "Starting a planned session requires its id.");
    next.workoutSessionId = buildPlannedWorkoutSessionId(doc.id);
  }
  return next;
}

/**
 * Builds the COMPLETED workout state (§9.3): status, completedAt,
 * performanceSummary, and completedExerciseIds, from the given sets.
 */
export function completeWorkoutSession(session, sets, now) {
  const next = transition(LifecycleKind.WORKOUT_SESSION, session, WorkoutStatus.COMPLETED, now);
  next.performanceSummary = buildPerformanceSummary(session.items, sets);
  next.completedExerciseIds = listCompletedExerciseIds(next.performanceSummary);
  validateWorkoutSession(next);
  return next;
}

/* ===============================
   SNAPSHOTS (§6.5)
================================ */
export function buildSnapshotItems(routine, exercisesById) {
  requireObject(exercisesById, "exercisesById");
  validateRoutine(routine, exercisesById);
  const items = {};
  for (const item of [...routine.items].sort((a, b) => a.order - b.order)) {
    const exercise = exercisesById[item.exerciseId];
    requireName(exercise.name, `exercises.${item.exerciseId}.name`);
    requireEnum(exercise.trackingType, TrackingType, `exercises.${item.exerciseId}.trackingType`);
    requireEnum(exercise.laterality, Laterality, `exercises.${item.exerciseId}.laterality`);
    items[item.occurrenceId] = {
      occurrenceId: item.occurrenceId,
      order: item.order,
      exerciseId: item.exerciseId,
      exerciseName: exercise.name,
      trackingType: exercise.trackingType,
      laterality: exercise.laterality,
      source: ItemSource.PRESCRIBED,
      targetSets: item.targetSets,
      repMin: item.repMin,
      repMax: item.repMax,
      targetWeight: item.targetWeight,
      restSeconds: item.restSeconds,
      notes: item.notes
    };
  }
  return items;
}

/* ===============================
   WEEKLY TEMPLATE APPLICATION PLANNING (§8.2)
   Pure planning only. Idempotency against the server depends on the caller
   passing the IDs that already exist (read from the server by the service).
================================ */
export function planTemplateApplication({ template, weekStart, routinesById, exercisesById, existingPlannedSessionIds }) {
  validateWeeklyTemplate(template);
  requireMonday(weekStart, "weekStart");
  requireObject(routinesById, "routinesById");
  requireObject(exercisesById, "exercisesById");
  if (!Array.isArray(existingPlannedSessionIds) && !(existingPlannedSessionIds instanceof Set)) {
    fail("existingPlannedSessionIds", "existingPlannedSessionIds must be an array or Set.");
  }
  const existing = new Set(existingPlannedSessionIds);

  const slots = [...template.slots].sort((a, b) =>
    a.weekday - b.weekday || a.order - b.order || (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));

  const toCreate = [];
  const skippedExisting = [];
  const skippedUnavailable = [];

  for (const slot of slots) {
    const plannedSessionId = buildTemplatePlannedSessionId(weekStart, slot.slotId);
    if (existing.has(plannedSessionId)) {
      skippedExisting.push({ plannedSessionId, slotId: slot.slotId });
      continue;
    }
    const routine = routinesById[slot.routineId];
    if (!isPlainObject(routine)) {
      skippedUnavailable.push({ plannedSessionId, slotId: slot.slotId, reason: TemplateSkipReason.ROUTINE_NOT_FOUND, message: `Routine not found: ${slot.routineId}.` });
      continue;
    }
    if (routine.isArchived === true) {
      skippedUnavailable.push({ plannedSessionId, slotId: slot.slotId, reason: TemplateSkipReason.ROUTINE_ARCHIVED, message: `Routine is archived: ${slot.routineId}.` });
      continue;
    }
    let items;
    try {
      items = buildSnapshotItems(routine, exercisesById);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      skippedUnavailable.push({ plannedSessionId, slotId: slot.slotId, reason: TemplateSkipReason.ROUTINE_INVALID, message: `${error.field}: ${error.message}` });
      continue;
    }
    const localDate = addDays(weekStart, slot.weekday - 1);
    toCreate.push({
      id: plannedSessionId,
      plannedSession: {
        schemaVersion: SCHEMA_VERSION,
        origin: PlannedSessionOrigin.TEMPLATE,
        templateSlotId: slot.slotId,
        weekStart,
        localDate,
        originalLocalDate: localDate,
        routineId: slot.routineId,
        routineName: routine.name,
        items,
        status: PlannedSessionStatus.PLANNED,
        workoutSessionId: null
      }
    });
  }
  return { weekStart, toCreate, skippedExisting, skippedUnavailable };
}

/* ===============================
   PERFORMANCE SUMMARY (§10.2)
================================ */
const SIDE_ORDER = { null: 0, LEFT: 1, RIGHT: 2 };

function compareSets(a, b) {
  return a.setNumber - b.setNumber || SIDE_ORDER[a.side] - SIDE_ORDER[b.side];
}

/**
 * Derives the per-exercise summary from snapshot items and logged sets.
 * Only exercises with at least one logged set are included; within an included
 * exercise every occurrence is listed (empty `sets` = nothing logged for it).
 */
export function buildPerformanceSummary(items, sets) {
  validateSnapshotItems(items);
  if (!Array.isArray(sets)) fail("sets", "sets must be an array.");

  const setsByOccurrence = new Map();
  const identities = new Set();
  sets.forEach((set, i) => {
    if (!isPlainObject(set)) fail(`sets[${i}]`, "Set must be an object.");
    const item = items[set.occurrenceId];
    if (!item) fail(`sets[${i}].occurrenceId`, `No item for occurrenceId ${String(set.occurrenceId)}.`);
    validateSet(set, item);
    const identity = buildSetId(set.occurrenceId, set.setNumber, set.side);
    if (identities.has(identity)) fail(`sets[${i}]`, `Duplicate set ${identity}.`);
    identities.add(identity);
    if (!setsByOccurrence.has(set.occurrenceId)) setsByOccurrence.set(set.occurrenceId, []);
    setsByOccurrence.get(set.occurrenceId).push(set);
  });

  const itemsByExercise = new Map();
  for (const item of Object.values(items).sort((a, b) => a.order - b.order)) {
    if (!itemsByExercise.has(item.exerciseId)) itemsByExercise.set(item.exerciseId, []);
    itemsByExercise.get(item.exerciseId).push(item);
  }

  const summary = {};
  for (const exerciseId of [...itemsByExercise.keys()].sort()) {
    const exerciseItems = itemsByExercise.get(exerciseId);
    if (!exerciseItems.some(item => setsByOccurrence.has(item.occurrenceId))) continue;
    const first = exerciseItems[0];
    for (const item of exerciseItems) {
      if (item.trackingType !== first.trackingType || item.laterality !== first.laterality) {
        fail(`items.${item.occurrenceId}`, `Occurrences of exercise ${exerciseId} disagree on trackingType or laterality.`);
      }
    }
    const weighted = first.trackingType === TrackingType.WEIGHT_AND_REPS;
    summary[exerciseId] = {
      exerciseId,
      exerciseName: first.exerciseName,
      trackingType: first.trackingType,
      laterality: first.laterality,
      weightUnit: weighted ? WeightUnit.KG : null,
      occurrences: exerciseItems.map(item => ({
        occurrenceId: item.occurrenceId,
        source: item.source,
        prescribed: item.source === ItemSource.PRESCRIBED
          ? { targetSets: item.targetSets, repMin: item.repMin, repMax: item.repMax, targetWeight: item.targetWeight }
          : null,
        sets: (setsByOccurrence.get(item.occurrenceId) || [])
          .map(set => ({ setNumber: set.setNumber, side: set.side, reps: set.reps, weight: set.weight }))
          .sort(compareSets)
      }))
    };
  }
  return summary;
}

export function listCompletedExerciseIds(summary) {
  requireObject(summary, "performanceSummary");
  return Object.keys(summary).sort();
}

/* ===============================
   COMPARISONS, TRENDS, PERSONAL BESTS (§10.4, §10.5)
   `reference` = { exerciseId, trackingType, laterality } of the current exercise.
   `sessions` = workout-session domain objects with `id`; invalid markers,
   non-COMPLETED sessions, and non-comparable entries are ignored.
================================ */
function requireReference(reference) {
  requireObject(reference, "reference");
  requireDocumentIdField(reference.exerciseId, "reference.exerciseId");
  requireEnum(reference.trackingType, TrackingType, "reference.trackingType");
  requireEnum(reference.laterality, Laterality, "reference.laterality");
}

export function isComparable(reference, entry) {
  requireReference(reference);
  if (!isPlainObject(entry)) return false;
  const expectedUnit = reference.trackingType === TrackingType.WEIGHT_AND_REPS ? WeightUnit.KG : null;
  return entry.exerciseId === reference.exerciseId &&
    entry.trackingType === reference.trackingType &&
    entry.laterality === reference.laterality &&
    entry.weightUnit === expectedUnit;
}

function compareChronological(a, b) {
  return a.completedAt.getTime() - b.completedAt.getTime() || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0);
}

function comparableHistory(sessions, reference, excludeSessionId) {
  requireReference(reference);
  if (!Array.isArray(sessions)) fail("sessions", "sessions must be an array.");
  const history = [];
  for (const session of sessions) {
    if (!isPlainObject(session) || session.invalid === true) continue;
    if (session.status !== WorkoutStatus.COMPLETED || !isValidDate(session.completedAt)) continue;
    if (excludeSessionId !== undefined && session.id === excludeSessionId) continue;
    const entry = isPlainObject(session.performanceSummary) ? session.performanceSummary[reference.exerciseId] : undefined;
    if (!isComparable(reference, entry)) continue;
    history.push({ sessionId: session.id, completedAt: session.completedAt, localDate: session.localDate, entry });
  }
  return history.sort(compareChronological);
}

function setsOf(entry) {
  return entry.occurrences.flatMap(occurrence => occurrence.sets);
}

function sideKeys(laterality) {
  return laterality === Laterality.UNILATERAL ? [Side.LEFT, Side.RIGHT] : [null];
}

/** Most recent comparable COMPLETED session entry for the exercise, or null. */
export function findPreviousPerformance(sessions, reference, { excludeSessionId } = {}) {
  const history = comparableHistory(sessions, reference, excludeSessionId);
  return history.length ? history[history.length - 1] : null;
}

/** Chronological per-session (and per-side) series for simple trends. */
export function buildTrendSeries(sessions, reference) {
  const history = comparableHistory(sessions, reference);
  const weighted = reference.trackingType === TrackingType.WEIGHT_AND_REPS;
  const points = [];
  for (const { sessionId, completedAt, localDate, entry } of history) {
    for (const side of sideKeys(reference.laterality)) {
      const sets = setsOf(entry).filter(set => set.side === side);
      if (!sets.length) continue;
      const totalReps = sets.reduce((sum, set) => sum + set.reps, 0);
      const point = { sessionId, completedAt, localDate, side, totalReps };
      if (weighted) {
        const top = sets.filter(set => set.reps >= 1)
          .reduce((best, set) => (!best || set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps)) ? set : best, null);
        point.topWeight = top ? top.weight : null;
        point.topWeightReps = top ? top.reps : null;
      } else {
        point.bestReps = Math.max(...sets.map(set => set.reps));
      }
      points.push(point);
    }
  }
  return points;
}

/**
 * Personal bests (§10.5), computed per side, never persisted.
 * WEIGHT_AND_REPS: heaviest weight with reps ≥ 1 (ties: more reps, then earlier),
 *   and most reps at each exact weight (ties: earlier).
 * REPS_ONLY: most reps in a single set (ties: earlier).
 */
export function computePersonalBests(sessions, reference) {
  const history = comparableHistory(sessions, reference);
  const weighted = reference.trackingType === TrackingType.WEIGHT_AND_REPS;
  const bySide = sideKeys(reference.laterality).map(side => {
    let heaviest = null;
    let mostReps = null;
    const repsByWeight = new Map();
    // History is chronological, so strict comparisons keep the earliest record on ties.
    for (const { sessionId, completedAt, localDate, entry } of history) {
      for (const set of setsOf(entry)) {
        if (set.side !== side || set.reps < 1) continue;
        const record = { reps: set.reps, sessionId, completedAt, localDate };
        if (weighted) {
          const weightedRecord = { weight: set.weight, ...record };
          if (!heaviest || set.weight > heaviest.weight || (set.weight === heaviest.weight && set.reps > heaviest.reps)) {
            heaviest = weightedRecord;
          }
          const current = repsByWeight.get(set.weight);
          if (!current || set.reps > current.reps) repsByWeight.set(set.weight, weightedRecord);
        } else if (!mostReps || set.reps > mostReps.reps) {
          mostReps = record;
        }
      }
    }
    return weighted
      ? { side, heaviest, mostRepsByWeight: [...repsByWeight.values()].sort((a, b) => a.weight - b.weight) }
      : { side, mostReps };
  });
  return { exerciseId: reference.exerciseId, trackingType: reference.trackingType, bySide };
}

/* ===============================
   HTML ESCAPING (§4.7)
================================ */
const HTML_ESCAPES = Object.freeze({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" });

/**
 * Escapes text for HTML element content and quoted attribute values.
 * null/undefined become "". Escapes exactly once: "&amp;" becomes "&amp;amp;"
 * so the literal text is preserved. Prefer textContent where possible.
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
}
