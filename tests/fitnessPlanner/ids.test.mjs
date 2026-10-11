import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError, isValidLocalId, isValidDocumentId, createLocalId,
  buildTemplatePlannedSessionId, buildPlannedWorkoutSessionId, buildSetId
} from "../../public/modules/fitnessPlanner/fitnessPlanner.engine.js";
import { OCC_A, OCC_B, SLOT_1, SLOT_2, MONDAY } from "./fixtures.mjs";

describe("isValidLocalId", () => {
  it("accepts exactly 12 lowercase alphanumerics", () => {
    assert.equal(isValidLocalId("abc123def456"), true);
    for (const bad of ["abc123def45", "abc123def4567", "ABC123DEF456", "abc_23def456", "abc-23def456", "", null, 123456789012]) {
      assert.equal(isValidLocalId(bad), false, String(bad));
    }
  });
});

describe("isValidDocumentId", () => {
  it("follows Firestore document-ID constraints", () => {
    for (const ok of ["a", "p_2026-10-12_slot00000001", "x".repeat(1500), "__a", "a__", "__", "___"]) {
      assert.equal(isValidDocumentId(ok), true, ok.slice(0, 20));
    }
    for (const bad of ["", ".", "..", "a/b", "__a__", "____", "x".repeat(1501), "é".repeat(751), null, 5]) {
      assert.equal(isValidDocumentId(bad), false, String(bad).slice(0, 20));
    }
  });
});

describe("createLocalId", () => {
  it("returns the injected random value when it is a valid local id", () => {
    assert.equal(createLocalId(() => "k3j9x2m1q8zt"), "k3j9x2m1q8zt");
  });

  it("rejects a missing generator or malformed output", () => {
    assert.throws(() => createLocalId(), ValidationError);
    assert.throws(() => createLocalId(() => "Not-Valid"), ValidationError);
    assert.throws(() => createLocalId(() => undefined), ValidationError);
  });
});

describe("buildTemplatePlannedSessionId", () => {
  it("is `${weekStart}_${slotId}` and deterministic", () => {
    assert.equal(buildTemplatePlannedSessionId(MONDAY, SLOT_1), `2026-10-12_${SLOT_1}`);
    assert.equal(buildTemplatePlannedSessionId(MONDAY, SLOT_1), buildTemplatePlannedSessionId(MONDAY, SLOT_1));
  });

  it("distinguishes weeks and slots", () => {
    const ids = new Set([
      buildTemplatePlannedSessionId(MONDAY, SLOT_1),
      buildTemplatePlannedSessionId(MONDAY, SLOT_2),
      buildTemplatePlannedSessionId("2026-10-19", SLOT_1)
    ]);
    assert.equal(ids.size, 3);
  });

  it("requires a Monday week start and a valid slot id", () => {
    assert.throws(() => buildTemplatePlannedSessionId("2026-10-13", SLOT_1), ValidationError);
    assert.throws(() => buildTemplatePlannedSessionId("2026-13-01", SLOT_1), ValidationError);
    assert.throws(() => buildTemplatePlannedSessionId(MONDAY, "SLOT"), ValidationError);
  });
});

describe("buildPlannedWorkoutSessionId", () => {
  it("is `p_${plannedSessionId}` and deterministic", () => {
    assert.equal(buildPlannedWorkoutSessionId(`${MONDAY}_${SLOT_1}`), `p_${MONDAY}_${SLOT_1}`);
    assert.equal(buildPlannedWorkoutSessionId("manualAuto1"), "p_manualAuto1");
  });

  it("rejects invalid planned-session ids, including ones whose result would be too long", () => {
    for (const bad of ["", "a/b", "..", null]) assert.throws(() => buildPlannedWorkoutSessionId(bad), ValidationError);
    assert.throws(() => buildPlannedWorkoutSessionId("x".repeat(1499)), ValidationError);
  });
});

describe("buildSetId", () => {
  it("encodes occurrence, set number, and side token", () => {
    assert.equal(buildSetId(OCC_A, 1, null), `${OCC_A}_1_B`);
    assert.equal(buildSetId(OCC_A, 1, "LEFT"), `${OCC_A}_1_L`);
    assert.equal(buildSetId(OCC_A, 1, "RIGHT"), `${OCC_A}_1_R`);
    assert.equal(buildSetId(OCC_A, 12, null), `${OCC_A}_12_B`);
  });

  it("is deterministic and distinct for every distinct identity", () => {
    assert.equal(buildSetId(OCC_A, 3, "LEFT"), buildSetId(OCC_A, 3, "LEFT"));
    const ids = new Set();
    for (const occ of [OCC_A, OCC_B]) {
      for (const n of [1, 2, 11, 21]) {
        for (const side of [null, "LEFT", "RIGHT"]) ids.add(buildSetId(occ, n, side));
      }
    }
    assert.equal(ids.size, 2 * 4 * 3);
  });

  it("rejects invalid components", () => {
    for (const n of [0, -1, 1.5, "1", null]) assert.throws(() => buildSetId(OCC_A, n, null), ValidationError);
    for (const side of [undefined, "BOTH", "left", "L"]) assert.throws(() => buildSetId(OCC_A, 1, side), ValidationError);
    for (const occ of ["short", `${OCC_A}_1`, "OCCAAAAAAAA1"]) assert.throws(() => buildSetId(occ, 1, null), ValidationError);
  });

  it("produces valid document ids", () => {
    assert.equal(isValidDocumentId(buildSetId(OCC_A, 999, "RIGHT")), true);
  });
});
