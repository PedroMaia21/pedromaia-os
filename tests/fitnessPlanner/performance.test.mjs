import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError, buildPerformanceSummary, listCompletedExerciseIds, validatePerformanceSummary,
  isComparable, findPreviousPerformance, buildTrendSeries, computePersonalBests
} from "../../public/modules/fitnessPlanner/fitnessPlanner.engine.js";
import {
  OCC_A, OCC_B, OCC_C, snapshotItem, snapshotItems, set, repsOnlySet, lungeSet,
  completedSession, benchEntry, workoutSession, day
} from "./fixtures.mjs";

const BENCH = { exerciseId: "bench", trackingType: "WEIGHT_AND_REPS", laterality: "BILATERAL" };
const PULLUP = { exerciseId: "pullup", trackingType: "REPS_ONLY", laterality: "BILATERAL" };
const LUNGE = { exerciseId: "lunge", trackingType: "WEIGHT_AND_REPS", laterality: "UNILATERAL" };

const s = (setNumber, reps, weight, side = null) => ({ setNumber, side, reps, weight });

function pullupEntry(sets) {
  return {
    exerciseId: "pullup", exerciseName: "Pull-up", trackingType: "REPS_ONLY", laterality: "BILATERAL", weightUnit: null,
    occurrences: [{ occurrenceId: OCC_B, source: "PRESCRIBED", prescribed: { targetSets: 3, repMin: 8, repMax: 12, targetWeight: null }, sets }]
  };
}

function lungeEntry(sets) {
  return {
    exerciseId: "lunge", exerciseName: "Dumbbell lunge", trackingType: "WEIGHT_AND_REPS", laterality: "UNILATERAL", weightUnit: "KG",
    occurrences: [{ occurrenceId: OCC_C, source: "ADDED", prescribed: null, sets }]
  };
}

describe("buildPerformanceSummary", () => {
  it("summarizes logged sets per exercise in the §10.2 shape", () => {
    const summary = buildPerformanceSummary(snapshotItems(), [
      set({ setNumber: 2, reps: 9 }),
      set({ setNumber: 1, reps: 10 }),
      repsOnlySet({ reps: 7 }),
      lungeSet({ side: "RIGHT" }),
      lungeSet({ side: "LEFT", reps: 8 })
    ]);
    assert.deepEqual(Object.keys(summary), ["bench", "lunge", "pullup"]);
    assert.deepEqual(summary.bench, {
      exerciseId: "bench", exerciseName: "Bench press", trackingType: "WEIGHT_AND_REPS", laterality: "BILATERAL", weightUnit: "KG",
      occurrences: [{
        occurrenceId: OCC_A, source: "PRESCRIBED",
        prescribed: { targetSets: 3, repMin: 8, repMax: 12, targetWeight: 60 },
        sets: [s(1, 10, 60), s(2, 9, 60)]
      }]
    });
    assert.equal(summary.pullup.weightUnit, null);
    assert.deepEqual(summary.pullup.occurrences[0].sets, [s(1, 7, null)]);
    assert.equal(summary.lunge.occurrences[0].prescribed, null);
    assert.equal(summary.lunge.occurrences[0].source, "ADDED");
    assert.deepEqual(summary.lunge.occurrences[0].sets.map(x => x.side), ["LEFT", "RIGHT"]);
    validatePerformanceSummary(summary);
    assert.deepEqual(JSON.parse(JSON.stringify(summary)), summary);
  });

  it("omits exercises with no logged sets, which therefore are not in completedExerciseIds", () => {
    const summary = buildPerformanceSummary(snapshotItems(), [set()]);
    assert.deepEqual(listCompletedExerciseIds(summary), ["bench"]);
    assert.deepEqual(buildPerformanceSummary(snapshotItems(), []), {});
  });

  it("lists every occurrence of a repeated exercise in order, keeping unlogged occurrences visible", () => {
    const items = {
      [OCC_A]: snapshotItem(),
      [OCC_C]: snapshotItem({ occurrenceId: OCC_C, order: 5, targetSets: 2, repMin: 15, repMax: 20, targetWeight: 40 })
    };
    const summary = buildPerformanceSummary(items, [set()]);
    assert.deepEqual(summary.bench.occurrences.map(o => [o.occurrenceId, o.sets.length]), [[OCC_A, 1], [OCC_C, 0]]);
  });

  it("does not depend on input order", () => {
    const sets = [set({ setNumber: 3 }), repsOnlySet(), set({ setNumber: 1 }), set({ setNumber: 2 })];
    assert.deepEqual(buildPerformanceSummary(snapshotItems(), sets), buildPerformanceSummary(snapshotItems(), [...sets].reverse()));
  });

  it("rejects orphan, duplicate, and inconsistent sets", () => {
    assert.throws(() => buildPerformanceSummary(snapshotItems(), [set({ occurrenceId: "zzzzzzzzzzzz" })]), ValidationError);
    assert.throws(() => buildPerformanceSummary(snapshotItems(), [set(), set({ reps: 5 })]), ValidationError);
    assert.throws(() => buildPerformanceSummary(snapshotItems(), [lungeSet({ side: null })]), ValidationError);
    assert.throws(() => buildPerformanceSummary(snapshotItems(), [set({ trackingType: "REPS_ONLY", weight: null, weightUnit: null })]), ValidationError);
    assert.throws(() => buildPerformanceSummary(snapshotItems(), "sets"), ValidationError);
    const mixed = { [OCC_A]: snapshotItem(), [OCC_C]: snapshotItem({ occurrenceId: OCC_C, order: 1, laterality: "UNILATERAL" }) };
    assert.throws(() => buildPerformanceSummary(mixed, [set()]), ValidationError);
  });

  it("does not mutate its inputs", () => {
    const items = snapshotItems();
    const sets = [set({ setNumber: 2 }), set()];
    const before = structuredClone({ items, sets });
    buildPerformanceSummary(items, sets);
    assert.deepEqual({ items, sets }, before);
  });
});

describe("isComparable", () => {
  it("requires same exercise, tracking type, laterality, and unit", () => {
    const entry = benchEntry([s(1, 10, 60)]);
    assert.equal(isComparable(BENCH, entry), true);
    assert.equal(isComparable({ ...BENCH, exerciseId: "other" }, entry), false);
    assert.equal(isComparable({ ...BENCH, laterality: "UNILATERAL" }, entry), false);
    assert.equal(isComparable({ ...BENCH, trackingType: "REPS_ONLY" }, entry), false);
    assert.equal(isComparable(BENCH, { ...entry, weightUnit: "LB" }), false);
    assert.equal(isComparable(PULLUP, pullupEntry([s(1, 5, null)])), true);
    assert.equal(isComparable(BENCH, undefined), false);
  });

  it("rejects an invalid reference", () => {
    assert.throws(() => isComparable({ exerciseId: "bench" }, benchEntry([])), ValidationError);
  });
});

function history() {
  return [
    completedSession({ id: "s1", completedAt: day(1), localDate: "2026-01-01", entries: [benchEntry([s(1, 10, 60), s(2, 8, 60)])] }),
    completedSession({ id: "s3", completedAt: day(3), localDate: "2026-01-03", entries: [benchEntry([s(1, 12, 60), s(2, 5, 65)])] }),
    completedSession({ id: "s2", completedAt: day(2), localDate: "2026-01-02", entries: [benchEntry([s(1, 6, 65)]), pullupEntry([s(1, 9, null)])] })
  ];
}

describe("findPreviousPerformance", () => {
  it("returns the most recent completed comparable session", () => {
    const previous = findPreviousPerformance(history(), BENCH);
    assert.equal(previous.sessionId, "s3");
    assert.equal(previous.localDate, "2026-01-03");
    assert.deepEqual(previous.completedAt, day(3));
    assert.deepEqual(previous.entry.occurrences[0].sets, [s(1, 12, 60), s(2, 5, 65)]);
  });

  it("excludes the current session when asked", () => {
    assert.equal(findPreviousPerformance(history(), BENCH, { excludeSessionId: "s3" }).sessionId, "s2");
  });

  it("ignores active, abandoned, invalid, and non-comparable sessions", () => {
    const sessions = [
      ...history(),
      workoutSession({ id: "active" }),
      { ...completedSession({ id: "ab", completedAt: day(9), entries: [benchEntry([s(1, 20, 100)])] }), status: "ABANDONED" },
      { id: "bad", invalid: true, reason: "x" },
      completedSession({ id: "changed", completedAt: day(8), entries: [benchEntry([s(1, 20, 100)], { laterality: "UNILATERAL" })] })
    ];
    assert.equal(findPreviousPerformance(sessions, BENCH).sessionId, "s3");
  });

  it("includes unplanned sessions and returns null for empty history", () => {
    assert.equal(findPreviousPerformance(history(), PULLUP).sessionId, "s2");
    assert.equal(findPreviousPerformance([], BENCH), null);
    assert.equal(findPreviousPerformance(history(), LUNGE), null);
  });

  it("breaks completedAt ties deterministically by session id", () => {
    const tied = [
      completedSession({ id: "b", completedAt: day(5), entries: [benchEntry([s(1, 5, 50)])] }),
      completedSession({ id: "a", completedAt: day(5), entries: [benchEntry([s(1, 5, 50)])] })
    ];
    assert.equal(findPreviousPerformance(tied, BENCH).sessionId, "b");
    assert.equal(findPreviousPerformance([...tied].reverse(), BENCH).sessionId, "b");
  });

  it("rejects a non-array history", () => {
    assert.throws(() => findPreviousPerformance(null, BENCH), ValidationError);
  });
});

describe("buildTrendSeries", () => {
  it("returns chronological points with top weight (and its reps) and total reps", () => {
    const series = buildTrendSeries(history(), BENCH);
    assert.deepEqual(series.map(p => [p.sessionId, p.topWeight, p.topWeightReps, p.totalReps]), [
      ["s1", 60, 10, 18],
      ["s2", 65, 6, 6],
      ["s3", 65, 5, 17]
    ]);
    assert.equal(series[0].side, null);
  });

  it("uses best reps for REPS_ONLY and ignores zero-rep sets for top weight", () => {
    assert.deepEqual(buildTrendSeries(history(), PULLUP).map(p => [p.sessionId, p.bestReps, p.totalReps]), [["s2", 9, 9]]);
    const zero = [completedSession({ id: "z", completedAt: day(1), entries: [benchEntry([s(1, 0, 100), s(2, 5, 50)])] })];
    assert.deepEqual(buildTrendSeries(zero, BENCH).map(p => [p.topWeight, p.topWeightReps, p.totalReps]), [[50, 5, 5]]);
    const failed = [completedSession({ id: "f", completedAt: day(1), entries: [benchEntry([s(1, 0, 100)])] })];
    assert.deepEqual(buildTrendSeries(failed, BENCH).map(p => [p.topWeight, p.topWeightReps]), [[null, null]]);
  });

  it("produces separate points per side for unilateral exercises", () => {
    const sessions = [completedSession({ id: "u", completedAt: day(1), entries: [lungeEntry([s(1, 10, 20, "LEFT"), s(1, 8, 22, "RIGHT")])] })];
    assert.deepEqual(buildTrendSeries(sessions, LUNGE).map(p => [p.side, p.topWeight, p.totalReps]), [["LEFT", 20, 10], ["RIGHT", 22, 8]]);
  });
});

describe("computePersonalBests", () => {
  it("finds the heaviest weight with reps ≥ 1 and most reps at each exact weight", () => {
    const result = computePersonalBests(history(), BENCH);
    assert.equal(result.exerciseId, "bench");
    assert.equal(result.bySide.length, 1);
    const { side, heaviest, mostRepsByWeight } = result.bySide[0];
    assert.equal(side, null);
    // 65 kg reached on s2 (6 reps) and s3 (5 reps): more reps wins.
    assert.deepEqual([heaviest.weight, heaviest.reps, heaviest.sessionId], [65, 6, "s2"]);
    assert.deepEqual(mostRepsByWeight.map(r => [r.weight, r.reps, r.sessionId]), [[60, 12, "s3"], [65, 6, "s2"]]);
  });

  it("breaks equal records in favour of the earlier session", () => {
    const sessions = [
      completedSession({ id: "late", completedAt: day(10), entries: [benchEntry([s(1, 8, 70)])] }),
      completedSession({ id: "early", completedAt: day(4), entries: [benchEntry([s(1, 8, 70)])] })
    ];
    const { heaviest, mostRepsByWeight } = computePersonalBests(sessions, BENCH).bySide[0];
    assert.equal(heaviest.sessionId, "early");
    assert.equal(mostRepsByWeight[0].sessionId, "early");
  });

  it("ignores zero-rep sets, abandoned sessions, and non-comparable entries", () => {
    const sessions = [
      completedSession({ id: "zero", completedAt: day(1), entries: [benchEntry([s(1, 0, 200), s(2, 3, 50)])] }),
      { ...completedSession({ id: "ab", completedAt: day(2), entries: [benchEntry([s(1, 5, 150)])] }), status: "ABANDONED" },
      completedSession({ id: "nc", completedAt: day(3), entries: [benchEntry([s(1, 5, 300)], { trackingType: "REPS_ONLY", weightUnit: null })] })
    ];
    const { heaviest, mostRepsByWeight } = computePersonalBests(sessions, BENCH).bySide[0];
    assert.deepEqual([heaviest.weight, heaviest.reps, heaviest.sessionId], [50, 3, "zero"]);
    assert.deepEqual(mostRepsByWeight.map(r => r.weight), [50]);
  });

  it("computes most reps for REPS_ONLY", () => {
    const sessions = [...history(), completedSession({ id: "p2", completedAt: day(4), entries: [pullupEntry([s(1, 11, null), s(2, 4, null)])] })];
    const result = computePersonalBests(sessions, PULLUP);
    assert.deepEqual(result.bySide, [{ side: null, mostReps: { reps: 11, sessionId: "p2", completedAt: day(4), localDate: "2026-10-12" } }]);
  });

  it("computes bests per side for unilateral exercises", () => {
    const sessions = [
      completedSession({ id: "u1", completedAt: day(1), entries: [lungeEntry([s(1, 10, 20, "LEFT"), s(1, 10, 24, "RIGHT")])] }),
      completedSession({ id: "u2", completedAt: day(2), entries: [lungeEntry([s(1, 6, 22, "LEFT")])] })
    ];
    const [left, right] = computePersonalBests(sessions, LUNGE).bySide;
    assert.equal(left.side, "LEFT");
    assert.deepEqual([left.heaviest.weight, left.heaviest.sessionId], [22, "u2"]);
    assert.equal(right.side, "RIGHT");
    assert.deepEqual([right.heaviest.weight, right.heaviest.sessionId], [24, "u1"]);
  });

  it("returns null/empty records for empty history", () => {
    assert.deepEqual(computePersonalBests([], BENCH).bySide, [{ side: null, heaviest: null, mostRepsByWeight: [] }]);
    assert.deepEqual(computePersonalBests([], PULLUP).bySide, [{ side: null, mostReps: null }]);
    assert.deepEqual(computePersonalBests([], LUNGE).bySide.map(b => b.side), ["LEFT", "RIGHT"]);
  });

  it("does not mutate the history", () => {
    const sessions = history();
    const before = structuredClone(sessions);
    computePersonalBests(sessions, BENCH);
    buildTrendSeries(sessions, BENCH);
    findPreviousPerformance(sessions, BENCH);
    assert.deepEqual(sessions, before);
  });
});
