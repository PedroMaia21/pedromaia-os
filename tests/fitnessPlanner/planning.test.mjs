import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError, TemplateSkipReason, buildSnapshotItems, planTemplateApplication, validatePlannedSession
} from "../../public/modules/fitnessPlanner/fitnessPlanner.engine.js";
import {
  OCC_A, OCC_B, SLOT_1, SLOT_2, SLOT_3, MONDAY,
  exercisesById, routine, routineItem, weeklyTemplate
} from "./fixtures.mjs";

describe("buildSnapshotItems", () => {
  it("copies routine targets and exercise attributes into a map keyed by occurrenceId", () => {
    const items = buildSnapshotItems(routine(), exercisesById());
    assert.deepEqual(Object.keys(items).sort(), [OCC_A, OCC_B].sort());
    assert.deepEqual(items[OCC_A], {
      occurrenceId: OCC_A, order: 0, exerciseId: "bench", exerciseName: "Bench press",
      trackingType: "WEIGHT_AND_REPS", laterality: "BILATERAL", source: "PRESCRIBED",
      targetSets: 3, repMin: 8, repMax: 12, targetWeight: 60, restSeconds: null, notes: ""
    });
    assert.equal(items[OCC_B].trackingType, "REPS_ONLY");
    assert.equal(items[OCC_B].targetWeight, null);
  });

  it("is independent of later routine and exercise edits", () => {
    const r = routine();
    const exercises = exercisesById();
    const items = buildSnapshotItems(r, exercises);
    const frozen = structuredClone(items);
    r.items[0].targetSets = 5;
    r.items[0].repMax = 15;
    exercises.bench.name = "Renamed press";
    exercises.bench.trackingType = "REPS_ONLY";
    assert.deepEqual(items, frozen);
  });

  it("does not mutate its inputs", () => {
    const r = routine();
    const exercises = exercisesById();
    const before = structuredClone({ r, exercises });
    buildSnapshotItems(r, exercises);
    assert.deepEqual({ r, exercises }, before);
  });

  it("allows archived exercises (history must stay resolvable)", () => {
    const exercises = exercisesById();
    exercises.bench.isArchived = true;
    assert.equal(buildSnapshotItems(routine(), exercises)[OCC_A].exerciseName, "Bench press");
  });

  it("rejects missing exercises, invalid routines, and missing lookup", () => {
    assert.throws(() => buildSnapshotItems(routine({ items: [routineItem({ exerciseId: "nope" })] }), exercisesById()), ValidationError);
    assert.throws(() => buildSnapshotItems(routine({ name: "" }), exercisesById()), ValidationError);
    assert.throws(() => buildSnapshotItems(routine(), undefined), ValidationError);
  });
});

function plan(overrides = {}) {
  return planTemplateApplication({
    template: weeklyTemplate(),
    weekStart: MONDAY,
    routinesById: { routineA: routine() },
    exercisesById: exercisesById(),
    existingPlannedSessionIds: [],
    ...overrides
  });
}

describe("planTemplateApplication", () => {
  it("creates one PLANNED TEMPLATE session per slot with deterministic ids and local dates", () => {
    const result = plan();
    assert.equal(result.weekStart, MONDAY);
    assert.deepEqual(result.toCreate.map(c => c.id), [`${MONDAY}_${SLOT_1}`, `${MONDAY}_${SLOT_2}`]);
    assert.deepEqual(result.toCreate.map(c => c.plannedSession.localDate), ["2026-10-12", "2026-10-15"]);
    const first = result.toCreate[0].plannedSession;
    assert.equal(first.status, "PLANNED");
    assert.equal(first.origin, "TEMPLATE");
    assert.equal(first.templateSlotId, SLOT_1);
    assert.equal(first.weekStart, MONDAY);
    assert.equal(first.originalLocalDate, first.localDate);
    assert.equal(first.workoutSessionId, null);
    assert.equal(first.routineName, "Upper body A");
    assert.equal(first.schemaVersion, 1);
    for (const { id, plannedSession } of result.toCreate) validatePlannedSession({ ...plannedSession, id });
    assert.deepEqual(result.skippedExisting, []);
    assert.deepEqual(result.skippedUnavailable, []);
  });

  it("is deterministic for identical inputs and JSON-serializable", () => {
    assert.deepEqual(plan(), plan());
    assert.deepEqual(JSON.parse(JSON.stringify(plan())), plan());
  });

  it("orders output by weekday, then order, then slotId, regardless of template order", () => {
    const template = weeklyTemplate({ slots: [
      { slotId: SLOT_3, weekday: 7, routineId: "routineA", order: 0 },
      { slotId: SLOT_2, weekday: 2, routineId: "routineA", order: 1 },
      { slotId: SLOT_1, weekday: 2, routineId: "routineA", order: 0 }
    ] });
    const result = plan({ template });
    assert.deepEqual(result.toCreate.map(c => c.plannedSession.templateSlotId), [SLOT_1, SLOT_2, SLOT_3]);
    assert.deepEqual(result.toCreate.map(c => c.plannedSession.localDate), ["2026-10-13", "2026-10-13", "2026-10-18"]);
  });

  it("maps weekday 7 to the Sunday of the same week, across month boundaries", () => {
    const template = weeklyTemplate({ slots: [{ slotId: SLOT_1, weekday: 7, routineId: "routineA", order: 0 }] });
    assert.equal(plan({ template, weekStart: "2026-12-28" }).toCreate[0].plannedSession.localDate, "2027-01-03");
  });

  it("skips ids that already exist, whatever their status or (moved) date", () => {
    // The engine sees only ids: a moved, skipped, cancelled, or started session
    // for this slot and week must never be recreated or overwritten.
    const existingId = `${MONDAY}_${SLOT_1}`;
    const result = plan({ existingPlannedSessionIds: new Set([existingId, "unrelated"]) });
    assert.deepEqual(result.skippedExisting, [{ plannedSessionId: existingId, slotId: SLOT_1 }]);
    assert.deepEqual(result.toCreate.map(c => c.id), [`${MONDAY}_${SLOT_2}`]);
  });

  it("re-applying with the ids from a previous application plans nothing new", () => {
    const first = plan();
    const second = plan({ existingPlannedSessionIds: first.toCreate.map(c => c.id) });
    assert.deepEqual(second.toCreate, []);
    assert.equal(second.skippedExisting.length, 2);
  });

  it("applying to a different week produces different ids", () => {
    const next = plan({ weekStart: "2026-10-19", existingPlannedSessionIds: plan().toCreate.map(c => c.id) });
    assert.deepEqual(next.toCreate.map(c => c.id), [`2026-10-19_${SLOT_1}`, `2026-10-19_${SLOT_2}`]);
  });

  it("reports missing, archived, and invalid routines and continues with other slots", () => {
    const template = weeklyTemplate({ slots: [
      { slotId: SLOT_1, weekday: 1, routineId: "missing", order: 0 },
      { slotId: SLOT_2, weekday: 2, routineId: "archived", order: 0 },
      { slotId: SLOT_3, weekday: 3, routineId: "broken", order: 0 },
      { slotId: "slot00000004", weekday: 4, routineId: "routineA", order: 0 }
    ] });
    const result = plan({
      template,
      routinesById: {
        routineA: routine(),
        archived: routine({ isArchived: true }),
        broken: routine({ items: [routineItem({ exerciseId: "deleted" })] })
      }
    });
    assert.deepEqual(result.skippedUnavailable.map(s => [s.slotId, s.reason]), [
      [SLOT_1, TemplateSkipReason.ROUTINE_NOT_FOUND],
      [SLOT_2, TemplateSkipReason.ROUTINE_ARCHIVED],
      [SLOT_3, TemplateSkipReason.ROUTINE_INVALID]
    ]);
    assert.equal(result.skippedUnavailable[2].plannedSessionId, `${MONDAY}_${SLOT_3}`);
    assert.match(result.skippedUnavailable[2].message, /deleted/);
    assert.deepEqual(result.toCreate.map(c => c.plannedSession.templateSlotId), ["slot00000004"]);
  });

  it("an existing id wins over an unavailable routine", () => {
    const result = plan({ routinesById: {}, existingPlannedSessionIds: [`${MONDAY}_${SLOT_1}`] });
    assert.equal(result.skippedExisting.length, 1);
    assert.equal(result.skippedUnavailable.length, 1);
    assert.equal(result.skippedUnavailable[0].slotId, SLOT_2);
  });

  it("returns an empty plan for an empty template", () => {
    assert.deepEqual(plan({ template: weeklyTemplate({ slots: [] }) }),
      { weekStart: MONDAY, toCreate: [], skippedExisting: [], skippedUnavailable: [] });
  });

  it("rejects invalid templates, non-Monday weeks, and malformed arguments", () => {
    assert.throws(() => plan({ template: weeklyTemplate({ slots: [{ slotId: SLOT_1, weekday: 9, routineId: "routineA", order: 0 }] }) }), ValidationError);
    assert.throws(() => plan({ template: { slots: [] } }), ValidationError);
    assert.throws(() => plan({ weekStart: "2026-10-14" }), ValidationError);
    assert.throws(() => plan({ existingPlannedSessionIds: "id" }), ValidationError);
    assert.throws(() => plan({ routinesById: null }), ValidationError);
  });

  it("does not mutate its inputs", () => {
    const args = {
      template: weeklyTemplate(), weekStart: MONDAY, routinesById: { routineA: routine() },
      exercisesById: exercisesById(), existingPlannedSessionIds: [`${MONDAY}_${SLOT_2}`]
    };
    const before = structuredClone(args);
    planTemplateApplication(args);
    assert.deepEqual(args, before);
  });
});
