import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError, LifecycleKind, PlannedSessionStatus, WorkoutStatus,
  canTransition, transition, completeWorkoutSession, validatePlannedSession, validateWorkoutSession
} from "../../public/modules/fitnessPlanner/fitnessPlanner.engine.js";
import { MONDAY, SLOT_1, OCC_A, T0, T1, plannedSession, workoutSession, set } from "./fixtures.mjs";

const P = LifecycleKind.PLANNED_SESSION;
const W = LifecycleKind.WORKOUT_SESSION;

const PLANNED_ALLOWED = new Set([
  "PLANNED>STARTED", "PLANNED>SKIPPED", "PLANNED>CANCELLED",
  "STARTED>COMPLETED", "STARTED>ABANDONED"
]);
const WORKOUT_ALLOWED = new Set(["ACTIVE>COMPLETED", "ACTIVE>ABANDONED"]);

describe("canTransition", () => {
  it("matches the planned-session transition table exactly (§7.1)", () => {
    const statuses = Object.values(PlannedSessionStatus);
    for (const from of statuses) {
      for (const to of statuses) {
        assert.equal(canTransition(P, from, to), PLANNED_ALLOWED.has(`${from}>${to}`), `${from} → ${to}`);
      }
    }
  });

  it("matches the workout-session transition table exactly (§7.2)", () => {
    const statuses = Object.values(WorkoutStatus);
    for (const from of statuses) {
      for (const to of statuses) {
        assert.equal(canTransition(W, from, to), WORKOUT_ALLOWED.has(`${from}>${to}`), `${from} → ${to}`);
      }
    }
  });

  it("treats terminal states as terminal and repeated operations as invalid", () => {
    for (const terminal of ["SKIPPED", "CANCELLED", "COMPLETED", "ABANDONED"]) {
      for (const to of Object.values(PlannedSessionStatus)) assert.equal(canTransition(P, terminal, to), false);
    }
    assert.equal(canTransition(P, "STARTED", "STARTED"), false);
    assert.equal(canTransition(W, "COMPLETED", "COMPLETED"), false);
    assert.equal(canTransition(W, "ABANDONED", "ACTIVE"), false);
  });

  it("returns false for unknown statuses and does not mix kinds", () => {
    assert.equal(canTransition(P, "UNKNOWN", "STARTED"), false);
    assert.equal(canTransition(P, "PLANNED", "ACTIVE"), false);
    assert.equal(canTransition(W, "PLANNED", "STARTED"), false);
    assert.equal(canTransition(W, undefined, "COMPLETED"), false);
    assert.equal(canTransition(W, "constructor", "COMPLETED"), false);
  });

  it("throws for an unknown kind", () => {
    assert.throws(() => canTransition("ROUTINE", "PLANNED", "STARTED"), ValidationError);
  });
});

describe("transition: planned sessions", () => {
  it("PLANNED → STARTED sets the deterministic workoutSessionId and yields a valid document", () => {
    const planned = plannedSession();
    const next = transition(P, planned, "STARTED", T0);
    assert.equal(next.status, "STARTED");
    assert.equal(next.workoutSessionId, `p_${MONDAY}_${SLOT_1}`);
    validatePlannedSession(next);
    assert.equal(planned.status, "PLANNED", "input not mutated");
    assert.equal(planned.workoutSessionId, null);
  });

  it("PLANNED → STARTED requires the planned-session id", () => {
    const { id, ...withoutId } = plannedSession();
    assert.throws(() => transition(P, withoutId, "STARTED", T0), error => error instanceof ValidationError && error.field === "id");
  });

  it("PLANNED → SKIPPED / CANCELLED change only the status", () => {
    for (const to of ["SKIPPED", "CANCELLED"]) {
      const next = transition(P, plannedSession(), to, T0);
      assert.deepEqual(next, { ...plannedSession(), status: to });
      validatePlannedSession(next);
    }
  });

  it("STARTED → COMPLETED / ABANDONED keep the workout link", () => {
    const started = transition(P, plannedSession(), "STARTED", T0);
    for (const to of ["COMPLETED", "ABANDONED"]) {
      const next = transition(P, started, to, T1);
      assert.equal(next.status, to);
      assert.equal(next.workoutSessionId, started.workoutSessionId);
      validatePlannedSession(next);
    }
  });

  it("rejects invalid and repeated transitions", () => {
    const started = transition(P, plannedSession(), "STARTED", T0);
    assert.throws(() => transition(P, started, "STARTED", T0), error => error.field === "status");
    assert.throws(() => transition(P, plannedSession({ status: "SKIPPED" }), "PLANNED", T0), ValidationError);
    assert.throws(() => transition(P, plannedSession(), "COMPLETED", T0), ValidationError);
  });
});

describe("transition: workout sessions", () => {
  it("ACTIVE → ABANDONED sets abandonedAt and yields a valid document", () => {
    const session = workoutSession();
    const next = transition(W, session, "ABANDONED", T1);
    assert.equal(next.status, "ABANDONED");
    assert.equal(next.abandonedAt, T1);
    assert.equal(next.completedAt, null);
    validateWorkoutSession(next);
    assert.equal(session.status, "ACTIVE", "input not mutated");
    assert.equal(session.abandonedAt, null);
  });

  it("ACTIVE → COMPLETED sets completedAt", () => {
    const next = transition(W, workoutSession(), "COMPLETED", T1);
    assert.equal(next.completedAt, T1);
    assert.equal(next.abandonedAt, null);
  });

  it("an interrupted (still ACTIVE) session stays resumable; terminal sessions cannot change", () => {
    assert.equal(canTransition(W, "ACTIVE", "COMPLETED"), true);
    const abandoned = transition(W, workoutSession(), "ABANDONED", T1);
    assert.throws(() => transition(W, abandoned, "COMPLETED", T1), ValidationError);
    assert.throws(() => transition(W, abandoned, "ABANDONED", T1), ValidationError);
  });

  it("requires a valid `now` and an object document", () => {
    for (const now of [undefined, null, new Date(NaN), "2026-10-12", Date.now()]) {
      assert.throws(() => transition(W, workoutSession(), "ABANDONED", now), ValidationError);
    }
    assert.throws(() => transition(W, null, "ABANDONED", T1), ValidationError);
  });
});

describe("completeWorkoutSession", () => {
  it("returns a valid COMPLETED session with summary and completedExerciseIds", () => {
    const session = workoutSession();
    const sets = [set(), set({ setNumber: 2, reps: 9 })];
    const next = completeWorkoutSession(session, sets, T1);
    assert.equal(next.status, "COMPLETED");
    assert.equal(next.completedAt, T1);
    assert.deepEqual(next.completedExerciseIds, ["bench"]);
    assert.deepEqual(next.performanceSummary.bench.occurrences[0].sets.map(s => s.reps), [10, 9]);
    validateWorkoutSession(next);
    assert.equal(session.status, "ACTIVE");
    assert.equal(session.performanceSummary, undefined);
  });

  it("completes a session with no logged sets as an empty summary", () => {
    const next = completeWorkoutSession(workoutSession(), [], T1);
    assert.deepEqual(next.performanceSummary, {});
    assert.deepEqual(next.completedExerciseIds, []);
  });

  it("refuses to complete a non-ACTIVE session or invalid sets", () => {
    const abandoned = transition(W, workoutSession(), "ABANDONED", T1);
    assert.throws(() => completeWorkoutSession(abandoned, [], T1), ValidationError);
    assert.throws(() => completeWorkoutSession(workoutSession(), [set({ occurrenceId: "zzzzzzzzzzzz" })], T1), ValidationError);
    assert.throws(() => completeWorkoutSession(workoutSession(), [set({ id: `${OCC_A}_9_B` })], T1), ValidationError);
  });
});
