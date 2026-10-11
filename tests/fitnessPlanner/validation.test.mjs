import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SCHEMA_VERSION, NAME_MAX_LENGTH,
  TrackingType, Laterality, Side, WeightUnit, ItemSource, PlannedSessionOrigin,
  PlannedSessionStatus, WorkoutOrigin, WorkoutStatus, LifecycleKind, DocumentKind, TemplateSkipReason,
  ValidationError,
  validateProfile, validateExercise, validateRoutine, validateSnapshotItems, validateWeeklyTemplate,
  validatePlannedSession, validateWorkoutSession, validatePerformanceSummary, validateSet, checkDocument
} from "../../public/modules/fitnessPlanner/fitnessPlanner.engine.js";
import {
  OCC_A, OCC_B, OCC_C, SLOT_1, MONDAY, T0, T1,
  exercise, exercisesById, routine, routineItem, snapshotItem, addedItem, snapshotItems, weeklyTemplate,
  plannedSession, workoutSession, set, repsOnlySet, lungeSet, benchEntry, completedSession
} from "./fixtures.mjs";

function throwsField(fn, field) {
  assert.throws(fn, error => {
    assert.ok(error instanceof ValidationError, `expected ValidationError, got ${error}`);
    assert.equal(error.code, "VALIDATION");
    assert.equal(error.field, field);
    return true;
  });
}

function assertNotMutated(value, fn) {
  const before = structuredClone(value);
  fn(value);
  assert.deepEqual(value, before);
}

function profile(overrides = {}) {
  return { schemaVersion: 1, goals: ["Get stronger"], notes: "", weightUnit: "KG", progressionIncrementKg: 2.5, ...overrides };
}

describe("constants and enums", () => {
  it("uses schema version 1 and a 100-character name limit", () => {
    assert.equal(SCHEMA_VERSION, 1);
    assert.equal(NAME_MAX_LENGTH, 100);
  });

  it("enums are frozen and every value equals its UPPER_SNAKE_CASE key", () => {
    const enums = { TrackingType, Laterality, Side, WeightUnit, ItemSource, PlannedSessionOrigin,
      PlannedSessionStatus, WorkoutOrigin, WorkoutStatus, LifecycleKind, DocumentKind, TemplateSkipReason };
    for (const [name, values] of Object.entries(enums)) {
      assert.ok(Object.isFrozen(values), `${name} is frozen`);
      for (const [key, value] of Object.entries(values)) {
        assert.equal(value, key, `${name}.${key}`);
        assert.match(value, /^[A-Z][A-Z0-9_]*$/);
      }
    }
  });

  it("defines exactly the documented lifecycle statuses", () => {
    assert.deepEqual(Object.values(PlannedSessionStatus).sort(),
      ["ABANDONED", "CANCELLED", "COMPLETED", "PLANNED", "SKIPPED", "STARTED"]);
    assert.deepEqual(Object.values(WorkoutStatus).sort(), ["ABANDONED", "ACTIVE", "COMPLETED"]);
    assert.deepEqual(Object.values(TrackingType).sort(), ["REPS_ONLY", "WEIGHT_AND_REPS"]);
    assert.deepEqual(Object.values(WeightUnit), ["KG"]);
  });

  it("ValidationError carries code, field, and message", () => {
    const error = new ValidationError("name", "bad");
    assert.ok(error instanceof Error);
    assert.equal(error.code, "VALIDATION");
    assert.equal(error.field, "name");
    assert.equal(error.message, "bad");
    assert.equal(error.name, "ValidationError");
  });
});

describe("schemaVersion handling", () => {
  const cases = [
    ["profile", validateProfile, profile()],
    ["exercise", validateExercise, exercise()],
    ["routine", doc => validateRoutine(doc), routine()],
    ["weekly template", validateWeeklyTemplate, weeklyTemplate()],
    ["planned session", validatePlannedSession, plannedSession()],
    ["workout session", validateWorkoutSession, workoutSession()],
    ["set", doc => validateSet(doc), set()]
  ];
  for (const [label, validate, valid] of cases) {
    it(`${label}: accepts v1, rejects missing and unknown versions`, () => {
      validate(valid);
      const { schemaVersion, ...missing } = valid;
      throwsField(() => validate(missing), "schemaVersion");
      throwsField(() => validate({ ...valid, schemaVersion: 2 }), "schemaVersion");
      throwsField(() => validate({ ...valid, schemaVersion: "1" }), "schemaVersion");
    });
    it(`${label}: allows unknown additive fields and audit fields, and does not mutate input`, () => {
      assertNotMutated({ ...valid, futureField: "x", createdAt: null, updatedAt: T0 }, validate);
    });
  }

  it("rejects non-object documents", () => {
    for (const bad of [null, undefined, 1, "doc", []]) {
      assert.throws(() => validateExercise(bad), ValidationError);
    }
  });
});

describe("validateProfile", () => {
  it("rejects blank goals, non-KG units, and non-positive increments", () => {
    throwsField(() => validateProfile(profile({ goals: "strength" })), "goals");
    throwsField(() => validateProfile(profile({ goals: [" "] })), "goals[0]");
    throwsField(() => validateProfile(profile({ notes: null })), "notes");
    throwsField(() => validateProfile(profile({ weightUnit: "LB" })), "weightUnit");
    for (const increment of [0, -2.5, Infinity, NaN, "2.5"]) {
      throwsField(() => validateProfile(profile({ progressionIncrementKg: increment })), "progressionIncrementKg");
    }
  });

  it("accepts an empty goal list", () => {
    validateProfile(profile({ goals: [] }));
  });
});

describe("validateExercise", () => {
  it("enforces name rules", () => {
    throwsField(() => validateExercise(exercise({ name: "" })), "name");
    throwsField(() => validateExercise(exercise({ name: "   " })), "name");
    throwsField(() => validateExercise(exercise({ name: " Bench" })), "name");
    throwsField(() => validateExercise(exercise({ name: "x".repeat(101) })), "name");
    validateExercise(exercise({ name: "x".repeat(100) }));
  });

  it("enforces enums, equipment, notes, and isArchived", () => {
    throwsField(() => validateExercise(exercise({ trackingType: "DISTANCE" })), "trackingType");
    throwsField(() => validateExercise(exercise({ laterality: "LEFT" })), "laterality");
    throwsField(() => validateExercise(exercise({ equipment: "barbell" })), "equipment");
    throwsField(() => validateExercise(exercise({ equipment: [""] })), "equipment[0]");
    throwsField(() => validateExercise(exercise({ notes: undefined })), "notes");
    throwsField(() => validateExercise(exercise({ isArchived: "false" })), "isArchived");
  });

  it("validates an optional id as a document ID", () => {
    validateExercise(exercise({ id: "abc" }));
    throwsField(() => validateExercise(exercise({ id: "a/b" })), "id");
  });
});

describe("validateRoutine", () => {
  it("accepts a valid routine with and without exercise lookup", () => {
    validateRoutine(routine());
    validateRoutine(routine(), exercisesById());
    validateRoutine(routine({ items: [] }));
  });

  it("validates targets", () => {
    const withItem = item => routine({ items: [routineItem(item)] });
    throwsField(() => validateRoutine(withItem({ targetSets: 0 })), "items[0].targetSets");
    throwsField(() => validateRoutine(withItem({ targetSets: 2.5 })), "items[0].targetSets");
    throwsField(() => validateRoutine(withItem({ repMin: 0 })), "items[0].repMin");
    throwsField(() => validateRoutine(withItem({ repMax: "12" })), "items[0].repMax");
    throwsField(() => validateRoutine(withItem({ repMin: 13, repMax: 12 })), "items[0].repMin");
    validateRoutine(withItem({ repMin: 12, repMax: 12 }));
    throwsField(() => validateRoutine(withItem({ targetWeight: -1 })), "items[0].targetWeight");
    throwsField(() => validateRoutine(withItem({ targetWeight: Infinity })), "items[0].targetWeight");
    validateRoutine(withItem({ targetWeight: 0 }));
    validateRoutine(withItem({ targetWeight: null }));
    throwsField(() => validateRoutine(withItem({ restSeconds: -5 })), "items[0].restSeconds");
    validateRoutine(withItem({ restSeconds: 90 }));
  });

  it("requires valid, unique occurrenceIds and unique orders", () => {
    throwsField(() => validateRoutine(routine({ items: [routineItem({ occurrenceId: "SHORT" })] })), "items[0].occurrenceId");
    throwsField(() => validateRoutine(routine({ items: [routineItem(), routineItem({ order: 1 })] })), "items[1].occurrenceId");
    throwsField(() => validateRoutine(routine({ items: [routineItem(), routineItem({ occurrenceId: OCC_B })] })), "items[1].order");
    throwsField(() => validateRoutine(routine({ items: [routineItem({ order: -1 })] })), "items[0].order");
  });

  it("with exercisesById, requires referenced exercises and null weight for REPS_ONLY", () => {
    throwsField(() => validateRoutine(routine({ items: [routineItem({ exerciseId: "missing" })] }), exercisesById()), "items[0].exerciseId");
    throwsField(() => validateRoutine(routine({ items: [routineItem({ exerciseId: "pullup", targetWeight: 10 })] }), exercisesById()), "items[0].targetWeight");
  });

  it("does not mutate items when validating with lookup", () => {
    assertNotMutated(routine(), r => validateRoutine(r, exercisesById()));
  });
});

describe("validateSnapshotItems", () => {
  it("accepts prescribed and added items", () => {
    validateSnapshotItems(snapshotItems());
    validateSnapshotItems({});
  });

  it("requires map keys to equal occurrenceId", () => {
    throwsField(() => validateSnapshotItems({ [OCC_B]: snapshotItem() }), `items.${OCC_B}.occurrenceId`);
  });

  it("requires null targets on ADDED items and valid targets on PRESCRIBED items", () => {
    throwsField(() => validateSnapshotItems({ [OCC_A]: addedItem({ targetSets: 3 }) }), `items.${OCC_A}.targetSets`);
    throwsField(() => validateSnapshotItems({ [OCC_A]: snapshotItem({ repMax: null }) }), `items.${OCC_A}.repMax`);
    throwsField(() => validateSnapshotItems({ [OCC_A]: snapshotItem({ trackingType: "REPS_ONLY" }) }), `items.${OCC_A}.targetWeight`);
  });

  it("rejects unknown source, blank exercise name, and duplicate orders", () => {
    throwsField(() => validateSnapshotItems({ [OCC_A]: snapshotItem({ source: "AI" }) }), `items.${OCC_A}.source`);
    throwsField(() => validateSnapshotItems({ [OCC_A]: snapshotItem({ exerciseName: "" }) }), `items.${OCC_A}.exerciseName`);
    throwsField(() => validateSnapshotItems({ [OCC_A]: snapshotItem(), [OCC_B]: snapshotItem({ occurrenceId: OCC_B }) }), `items.${OCC_B}.order`);
  });
});

describe("validateWeeklyTemplate", () => {
  it("accepts several slots on one weekday with distinct orders, and an empty template", () => {
    validateWeeklyTemplate(weeklyTemplate({ slots: [
      { slotId: SLOT_1, weekday: 1, routineId: "routineA", order: 0 },
      { slotId: "slot00000002", weekday: 1, routineId: "routineB", order: 1 }
    ] }));
    validateWeeklyTemplate(weeklyTemplate({ slots: [] }));
  });

  it("rejects bad weekdays, duplicate slotIds, duplicate weekday orders, and bad routine ids", () => {
    const slot = overrides => weeklyTemplate({ slots: [{ slotId: SLOT_1, weekday: 1, routineId: "routineA", order: 0, ...overrides }] });
    for (const weekday of [0, 8, 1.5, "1"]) throwsField(() => validateWeeklyTemplate(slot({ weekday })), "slots[0].weekday");
    throwsField(() => validateWeeklyTemplate(slot({ slotId: "bad id" })), "slots[0].slotId");
    throwsField(() => validateWeeklyTemplate(slot({ routineId: "" })), "slots[0].routineId");
    const template = weeklyTemplate();
    throwsField(() => validateWeeklyTemplate({ ...template, slots: [template.slots[0], { ...template.slots[1], slotId: SLOT_1 }] }), "slots[1].slotId");
    throwsField(() => validateWeeklyTemplate({ ...template, slots: [template.slots[0], { ...template.slots[1], weekday: 1 }] }), "slots[1].order");
  });
});

describe("validatePlannedSession", () => {
  it("accepts TEMPLATE and MANUAL sessions", () => {
    validatePlannedSession(plannedSession());
    validatePlannedSession(plannedSession({ id: "manual123", origin: "MANUAL", templateSlotId: null, weekStart: null }));
  });

  it("enforces origin-specific fields and the deterministic template id", () => {
    throwsField(() => validatePlannedSession(plannedSession({ origin: "MANUAL" })), "templateSlotId");
    throwsField(() => validatePlannedSession(plannedSession({ weekStart: "2026-10-13" })), "weekStart");
    throwsField(() => validatePlannedSession(plannedSession({ id: "other" })), "id");
    throwsField(() => validatePlannedSession(plannedSession({ templateSlotId: null })), "templateSlotId");
  });

  it("allows a moved localDate but requires valid dates", () => {
    validatePlannedSession(plannedSession({ localDate: "2026-10-20" }));
    throwsField(() => validatePlannedSession(plannedSession({ localDate: "2026-02-30" })), "localDate");
    throwsField(() => validatePlannedSession(plannedSession({ originalLocalDate: "" })), "originalLocalDate");
  });

  it("ties workoutSessionId to status", () => {
    for (const status of ["PLANNED", "SKIPPED", "CANCELLED"]) {
      validatePlannedSession(plannedSession({ status }));
      throwsField(() => validatePlannedSession(plannedSession({ status, workoutSessionId: `p_${MONDAY}_${SLOT_1}` })), "workoutSessionId");
    }
    for (const status of ["STARTED", "COMPLETED", "ABANDONED"]) {
      validatePlannedSession(plannedSession({ status, workoutSessionId: `p_${MONDAY}_${SLOT_1}` }));
      throwsField(() => validatePlannedSession(plannedSession({ status })), "workoutSessionId");
      throwsField(() => validatePlannedSession(plannedSession({ status, workoutSessionId: "p_other" })), "workoutSessionId");
    }
    throwsField(() => validatePlannedSession(plannedSession({ status: "DONE" })), "status");
  });

  it("validates its items", () => {
    throwsField(() => validatePlannedSession(plannedSession({ items: [] })), "items");
  });
});

describe("validateWorkoutSession", () => {
  it("accepts planned and unplanned ACTIVE sessions, with or without a routine", () => {
    validateWorkoutSession(workoutSession());
    validateWorkoutSession(workoutSession({ id: "u1", origin: "UNPLANNED", plannedSessionId: null }));
    validateWorkoutSession(workoutSession({ id: "u2", origin: "UNPLANNED", plannedSessionId: null, routineId: null, routineName: null, items: {} }));
  });

  it("enforces origin rules", () => {
    throwsField(() => validateWorkoutSession(workoutSession({ plannedSessionId: null })), "plannedSessionId");
    throwsField(() => validateWorkoutSession(workoutSession({ origin: "UNPLANNED" })), "plannedSessionId");
    throwsField(() => validateWorkoutSession(workoutSession({ id: "random" })), "id");
    throwsField(() => validateWorkoutSession(workoutSession({ routineId: null, routineName: null })), "routineId");
    throwsField(() => validateWorkoutSession(workoutSession({ id: "u3", origin: "UNPLANNED", plannedSessionId: null, routineName: null })), "routineName");
    throwsField(() => validateWorkoutSession(workoutSession({ id: "u4", origin: "UNPLANNED", plannedSessionId: null, routineId: null })), "routineName");
  });

  it("ties event timestamps to status", () => {
    throwsField(() => validateWorkoutSession(workoutSession({ startedAt: "2026-10-12" })), "startedAt");
    throwsField(() => validateWorkoutSession(workoutSession({ startedAt: new Date(NaN) })), "startedAt");
    throwsField(() => validateWorkoutSession(workoutSession({ completedAt: T1 })), "completedAt");
    throwsField(() => validateWorkoutSession(workoutSession({ abandonedAt: T1 })), "abandonedAt");
    validateWorkoutSession(workoutSession({ status: "ABANDONED", abandonedAt: T1 }));
    throwsField(() => validateWorkoutSession(workoutSession({ status: "ABANDONED" })), "abandonedAt");
  });

  it("allows completion fields only on COMPLETED sessions and requires them to agree", () => {
    throwsField(() => validateWorkoutSession(workoutSession({ completedExerciseIds: [] })), "completedExerciseIds");
    throwsField(() => validateWorkoutSession(workoutSession({ performanceSummary: {} })), "performanceSummary");
    const completed = completedSession({ id: "c1", completedAt: T1, entries: [benchEntry([{ setNumber: 1, side: null, reps: 10, weight: 60 }])] });
    validateWorkoutSession(completed);
    throwsField(() => validateWorkoutSession({ ...completed, completedExerciseIds: [] }), "completedExerciseIds");
    throwsField(() => validateWorkoutSession({ ...completed, completedExerciseIds: ["other"] }), "completedExerciseIds");
    throwsField(() => validateWorkoutSession({ ...completed, completedAt: null }), "completedAt");
    const { performanceSummary, ...noSummary } = completed;
    throwsField(() => validateWorkoutSession(noSummary), "performanceSummary");
  });
});

describe("validatePerformanceSummary", () => {
  const ok = [{ setNumber: 1, side: null, reps: 10, weight: 60 }];
  it("accepts a valid summary and rejects structural errors", () => {
    validatePerformanceSummary({ bench: benchEntry(ok) });
    validatePerformanceSummary({});
    throwsField(() => validatePerformanceSummary({ other: benchEntry(ok) }), "performanceSummary.other.exerciseId");
    throwsField(() => validatePerformanceSummary({ bench: benchEntry([]) }), "performanceSummary.bench.occurrences");
    throwsField(() => validatePerformanceSummary({ bench: benchEntry(ok, { occurrences: [] }) }), "performanceSummary.bench.occurrences");
    throwsField(() => validatePerformanceSummary({ bench: benchEntry(ok, { weightUnit: null }) }), "performanceSummary.bench.weightUnit");
    throwsField(() => validatePerformanceSummary({ bench: benchEntry([{ setNumber: 1, side: "LEFT", reps: 10, weight: 60 }]) }), "performanceSummary.bench.occurrences[0].sets[0].side");
    throwsField(() => validatePerformanceSummary({ bench: benchEntry([{ setNumber: 1, side: null, reps: 10, weight: null }]) }), "performanceSummary.bench.occurrences[0].sets[0].weight");
  });
});

describe("validateSet", () => {
  const items = snapshotItems();

  it("accepts weighted, reps-only, and unilateral sets", () => {
    validateSet(set(), items[OCC_A]);
    validateSet(repsOnlySet(), items[OCC_B]);
    validateSet(lungeSet(), items[OCC_C]);
    validateSet(lungeSet({ side: "RIGHT" }), items[OCC_C]);
    validateSet(set({ reps: 0, weight: 0 }));
    validateSet(set({ correctedAt: T1 }));
  });

  it("enforces fields by tracking type", () => {
    throwsField(() => validateSet(set({ weight: null })), "weight");
    throwsField(() => validateSet(set({ weight: -1 })), "weight");
    throwsField(() => validateSet(set({ weightUnit: null })), "weightUnit");
    throwsField(() => validateSet(repsOnlySet({ weight: 0 })), "weight");
    throwsField(() => validateSet(repsOnlySet({ weightUnit: "KG" })), "weightUnit");
    throwsField(() => validateSet(set({ reps: -1 })), "reps");
    throwsField(() => validateSet(set({ reps: 1.5 })), "reps");
    throwsField(() => validateSet(set({ setNumber: 0 })), "setNumber");
    throwsField(() => validateSet(set({ side: "BOTH" })), "side");
    throwsField(() => validateSet(set({ loggedAt: null })), "loggedAt");
    throwsField(() => validateSet(set({ correctedAt: "yesterday" })), "correctedAt");
  });

  it("enforces side by laterality when the item is supplied", () => {
    throwsField(() => validateSet(lungeSet({ side: null }), items[OCC_C]), "side");
    throwsField(() => validateSet(set({ side: "LEFT" }), items[OCC_A]), "side");
  });

  it("requires the set to match its item", () => {
    throwsField(() => validateSet(set(), items[OCC_B]), "occurrenceId");
    throwsField(() => validateSet(set({ exerciseId: "other" }), items[OCC_A]), "exerciseId");
    throwsField(() => validateSet(set(), { ...items[OCC_A], trackingType: "REPS_ONLY" }), "trackingType");
  });

  it("requires a present id to be the deterministic set id", () => {
    validateSet(set({ id: `${OCC_A}_1_B` }));
    throwsField(() => validateSet(set({ id: `${OCC_A}_2_B` })), "id");
  });
});

describe("checkDocument", () => {
  it("returns the same object for valid documents", () => {
    const doc = exercise({ id: "bench" });
    assert.equal(checkDocument(DocumentKind.EXERCISE, doc), doc);
    const s = set({ id: `${OCC_A}_1_B` });
    assert.equal(checkDocument(DocumentKind.SET, s), s);
  });

  it("returns an invalid marker with id and reason, without mutating", () => {
    const older = { ...exercise({ id: "old" }), schemaVersion: 0 };
    const before = structuredClone(older);
    const result = checkDocument(DocumentKind.EXERCISE, older);
    assert.deepEqual(result, { id: "old", invalid: true, reason: "schemaVersion: Unsupported schemaVersion: 0." });
    assert.deepEqual(older, before);
    const { schemaVersion, ...missing } = routine({ id: "r1" });
    assert.deepEqual(checkDocument(DocumentKind.ROUTINE, missing), { id: "r1", invalid: true, reason: "schemaVersion: Missing schemaVersion." });
    assert.deepEqual(checkDocument(DocumentKind.WORKOUT_SESSION, null), { id: null, invalid: true, reason: "workoutSession: workoutSession must be an object." });
  });

  it("covers every document kind and rejects unknown kinds", () => {
    const valid = {
      PROFILE: profile(), WEEKLY_TEMPLATE: weeklyTemplate(), EXERCISE: exercise(), ROUTINE: routine(),
      PLANNED_SESSION: plannedSession(), WORKOUT_SESSION: workoutSession(), SET: set()
    };
    assert.deepEqual(Object.keys(valid).sort(), Object.values(DocumentKind).sort());
    for (const [kind, doc] of Object.entries(valid)) assert.equal(checkDocument(kind, doc), doc);
    assert.throws(() => checkDocument("PLAYLIST", {}), ValidationError);
  });
});
