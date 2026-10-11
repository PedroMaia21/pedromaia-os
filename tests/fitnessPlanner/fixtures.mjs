// Shared builders for Fitness Planner engine tests. Each call returns fresh objects.
export const ENGINE_URL = new URL("../../public/modules/fitnessPlanner/fitnessPlanner.engine.js", import.meta.url);

export const OCC_A = "occaaaaaaaa1";
export const OCC_B = "occbbbbbbbb2";
export const OCC_C = "occcccccccc3";
export const SLOT_1 = "slot00000001";
export const SLOT_2 = "slot00000002";
export const SLOT_3 = "slot00000003";
export const MONDAY = "2026-10-12";

export const T0 = new Date(Date.UTC(2026, 9, 12, 18, 0, 0));
export const T1 = new Date(Date.UTC(2026, 9, 12, 19, 0, 0));

export function exercise(overrides = {}) {
  return {
    schemaVersion: 1,
    name: "Bench press",
    trackingType: "WEIGHT_AND_REPS",
    laterality: "BILATERAL",
    equipment: ["barbell"],
    notes: "",
    isArchived: false,
    ...overrides
  };
}

export function exercisesById() {
  return {
    bench: exercise({ id: "bench" }),
    pullup: exercise({ id: "pullup", name: "Pull-up", trackingType: "REPS_ONLY", equipment: [] }),
    lunge: exercise({ id: "lunge", name: "Dumbbell lunge", laterality: "UNILATERAL", equipment: ["dumbbell"] })
  };
}

export function routineItem(overrides = {}) {
  return {
    occurrenceId: OCC_A,
    exerciseId: "bench",
    order: 0,
    targetSets: 3,
    repMin: 8,
    repMax: 12,
    targetWeight: 60,
    restSeconds: null,
    notes: "",
    ...overrides
  };
}

export function routine(overrides = {}) {
  return {
    schemaVersion: 1,
    name: "Upper body A",
    isArchived: false,
    items: [
      routineItem(),
      routineItem({ occurrenceId: OCC_B, exerciseId: "pullup", order: 1, targetWeight: null })
    ],
    ...overrides
  };
}

export function snapshotItem(overrides = {}) {
  return {
    occurrenceId: OCC_A,
    order: 0,
    exerciseId: "bench",
    exerciseName: "Bench press",
    trackingType: "WEIGHT_AND_REPS",
    laterality: "BILATERAL",
    source: "PRESCRIBED",
    targetSets: 3,
    repMin: 8,
    repMax: 12,
    targetWeight: 60,
    restSeconds: null,
    notes: "",
    ...overrides
  };
}

export function addedItem(overrides = {}) {
  return snapshotItem({ source: "ADDED", targetSets: null, repMin: null, repMax: null, targetWeight: null, ...overrides });
}

export function snapshotItems() {
  return {
    [OCC_A]: snapshotItem(),
    [OCC_B]: snapshotItem({
      occurrenceId: OCC_B, order: 1, exerciseId: "pullup", exerciseName: "Pull-up",
      trackingType: "REPS_ONLY", targetWeight: null
    }),
    [OCC_C]: addedItem({
      occurrenceId: OCC_C, order: 2, exerciseId: "lunge", exerciseName: "Dumbbell lunge", laterality: "UNILATERAL"
    })
  };
}

export function weeklyTemplate(overrides = {}) {
  return {
    schemaVersion: 1,
    slots: [
      { slotId: SLOT_1, weekday: 1, routineId: "routineA", order: 0 },
      { slotId: SLOT_2, weekday: 4, routineId: "routineA", order: 0 }
    ],
    ...overrides
  };
}

export function plannedSession(overrides = {}) {
  return {
    schemaVersion: 1,
    id: `${MONDAY}_${SLOT_1}`,
    origin: "TEMPLATE",
    templateSlotId: SLOT_1,
    weekStart: MONDAY,
    localDate: MONDAY,
    originalLocalDate: MONDAY,
    routineId: "routineA",
    routineName: "Upper body A",
    items: snapshotItems(),
    status: "PLANNED",
    workoutSessionId: null,
    ...overrides
  };
}

export function workoutSession(overrides = {}) {
  return {
    schemaVersion: 1,
    id: `p_${MONDAY}_${SLOT_1}`,
    origin: "PLANNED",
    plannedSessionId: `${MONDAY}_${SLOT_1}`,
    routineId: "routineA",
    routineName: "Upper body A",
    localDate: MONDAY,
    status: "ACTIVE",
    startedAt: T0,
    completedAt: null,
    abandonedAt: null,
    items: snapshotItems(),
    ...overrides
  };
}

export function set(overrides = {}) {
  return {
    schemaVersion: 1,
    occurrenceId: OCC_A,
    exerciseId: "bench",
    setNumber: 1,
    side: null,
    trackingType: "WEIGHT_AND_REPS",
    reps: 10,
    weight: 60,
    weightUnit: "KG",
    loggedAt: T0,
    correctedAt: null,
    ...overrides
  };
}

export function repsOnlySet(overrides = {}) {
  return set({ occurrenceId: OCC_B, exerciseId: "pullup", trackingType: "REPS_ONLY", weight: null, weightUnit: null, ...overrides });
}

export function lungeSet(overrides = {}) {
  return set({ occurrenceId: OCC_C, exerciseId: "lunge", side: "LEFT", weight: 20, ...overrides });
}

/** A COMPLETED workout carrying a hand-written performance summary entry. */
export function completedSession({ id, completedAt, localDate = MONDAY, entries }) {
  const performanceSummary = {};
  for (const entry of entries) performanceSummary[entry.exerciseId] = entry;
  return {
    ...workoutSession({ id, origin: "UNPLANNED", plannedSessionId: null, routineId: null, routineName: null }),
    status: "COMPLETED",
    localDate,
    completedAt,
    performanceSummary,
    completedExerciseIds: Object.keys(performanceSummary).sort()
  };
}

export function benchEntry(sets, overrides = {}) {
  return {
    exerciseId: "bench",
    exerciseName: "Bench press",
    trackingType: "WEIGHT_AND_REPS",
    laterality: "BILATERAL",
    weightUnit: "KG",
    occurrences: [{ occurrenceId: OCC_A, source: "PRESCRIBED", prescribed: { targetSets: 3, repMin: 8, repMax: 12, targetWeight: 60 }, sets }],
    ...overrides
  };
}

export function day(n) {
  return new Date(Date.UTC(2026, 0, n, 12));
}
