import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { escapeHtml } from "../../public/modules/fitnessPlanner/fitnessPlanner.engine.js";
import * as engine from "../../public/modules/fitnessPlanner/fitnessPlanner.engine.js";
import { ENGINE_URL } from "./fixtures.mjs";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    assert.equal(escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`),
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;");
    assert.equal(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes once, preserving already-encoded text literally", () => {
    assert.equal(escapeHtml("&amp;"), "&amp;amp;");
    assert.equal(escapeHtml("&lt;b&gt;"), "&amp;lt;b&amp;gt;");
  });

  it("leaves safe text unchanged and stringifies non-strings", () => {
    assert.equal(escapeHtml("Bench press 3×10 @ 60 kg — ok"), "Bench press 3×10 @ 60 kg — ok");
    assert.equal(escapeHtml(""), "");
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
    assert.equal(escapeHtml(62.5), "62.5");
    assert.equal(escapeHtml(0), "0");
    assert.equal(escapeHtml(false), "false");
  });
});

describe("engine purity (§4.2)", () => {
  it("imports nothing and references no browser, Firebase, storage, network, clock, or randomness APIs", async () => {
    const source = await readFile(ENGINE_URL, "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /^\s*import\b/m, "no static imports");
    assert.doesNotMatch(code, /\bimport\s*\(/, "no dynamic imports");
    assert.doesNotMatch(code, /\brequire\s*\(/, "no require");
    for (const forbidden of [
      /\bdocument\s*\./, /\bwindow\s*\./, /\bglobalThis\b/, /\bnavigator\b/, /\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/,
      /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /firebase/i, /gstatic/, /\bDate\.now\b/, /\bMath\.random\b/,
      /new Date\(\)/, /\bcrypto\b/, /\bprocess\b/
    ]) {
      assert.doesNotMatch(code, forbidden, String(forbidden));
    }
  });

  it("exports the documented API", () => {
    const expected = [
      "SCHEMA_VERSION", "NAME_MAX_LENGTH", "TrackingType", "Laterality", "Side", "WeightUnit", "ItemSource",
      "PlannedSessionOrigin", "PlannedSessionStatus", "WorkoutOrigin", "WorkoutStatus", "LifecycleKind", "DocumentKind",
      "TemplateSkipReason", "ValidationError",
      "isValidLocalId", "isValidDocumentId", "createLocalId",
      "buildTemplatePlannedSessionId", "buildPlannedWorkoutSessionId", "buildSetId",
      "parseLocalDate", "isValidLocalDate", "formatLocalDate", "todayLocal", "addDays", "compareLocalDates",
      "isoWeekday", "weekStartOf", "weekDates",
      "validateProfile", "validateExercise", "validateRoutine", "validateSnapshotItems", "validateWeeklyTemplate",
      "validatePlannedSession", "validatePerformanceSummary", "validateWorkoutSession", "validateSet", "checkDocument",
      "canTransition", "transition", "completeWorkoutSession",
      "buildSnapshotItems", "planTemplateApplication",
      "buildPerformanceSummary", "listCompletedExerciseIds",
      "isComparable", "findPreviousPerformance", "buildTrendSeries", "computePersonalBests",
      "escapeHtml"
    ];
    assert.deepEqual(Object.keys(engine).sort(), [...expected].sort());
  });
});
