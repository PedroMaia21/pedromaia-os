import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectRandomTemplate } from "../../public/modules/sideQuests/sideQuests.engine.js";
import { SideQuestTemplate, SideQuestCategory } from "../../public/modules/sideQuests/sideQuests.models.js";

const makeTemplate = (id) => new SideQuestTemplate({
  id,
  title: `Title ${id}`,
  description: `Description ${id}`,
  category: SideQuestCategory.DECOMPRESSION,
  durationMinutes: 15
});

const A = makeTemplate("a");
const B = makeTemplate("b");
const C = makeTemplate("c");
const D = makeTemplate("d");
const TEMPLATES = [A, B, C, D];

describe("selectRandomTemplate", () => {
  it("returns the only template in a single-item collection", () => {
    assert.equal(selectRandomTemplate([A], () => 0), A);
    assert.equal(selectRandomTemplate([A], () => 0.999999), A);
  });

  it("selects a known template for a given random value", () => {
    assert.equal(selectRandomTemplate(TEMPLATES, () => 0.25), B);
    assert.equal(selectRandomTemplate(TEMPLATES, () => 0.5), C);
    assert.equal(selectRandomTemplate(TEMPLATES, () => 0.74), C);
  });

  it("maps the [0, 1) range onto every index, including both ends", () => {
    assert.equal(selectRandomTemplate(TEMPLATES, () => 0), A);
    assert.equal(selectRandomTemplate(TEMPLATES, () => 1 - Number.EPSILON), D);
    TEMPLATES.forEach((template, i) => {
      assert.equal(selectRandomTemplate(TEMPLATES, () => i / TEMPLATES.length), template);
    });
  });

  it("gives each template an equal-width slice of the random range", () => {
    const n = TEMPLATES.length;
    TEMPLATES.forEach((template, i) => {
      const lower = i / n;
      const upper = (i + 1) / n;
      assert.equal(selectRandomTemplate(TEMPLATES, () => lower), template);
      assert.equal(selectRandomTemplate(TEMPLATES, () => upper - 1e-9), template);
    });
  });

  it("returns the template object itself, not a copy", () => {
    const selected = selectRandomTemplate(TEMPLATES, () => 0.3);
    assert.equal(selected, B);
    assert.ok(selected instanceof SideQuestTemplate);
  });

  it("does not mutate the template collection", () => {
    const templates = [A, B, C];
    selectRandomTemplate(templates, () => 0.5);
    assert.deepEqual(templates, [A, B, C]);
  });

  it("uses Math.random by default and returns a member of the collection", () => {
    assert.ok(TEMPLATES.includes(selectRandomTemplate(TEMPLATES)));
  });

  it("throws for an empty collection", () => {
    assert.throws(() => selectRandomTemplate([], () => 0), /No side quest templates available/);
  });

  it("throws for a missing or non-array collection", () => {
    for (const bad of [undefined, null, "templates", {}, { length: 1, 0: A }]) {
      assert.throws(() => selectRandomTemplate(bad, () => 0), /No side quest templates available/, String(bad));
    }
  });

  it("throws when the random function returns a value outside [0, 1)", () => {
    for (const bad of [1, 1.5, -0.1, NaN, Infinity, undefined, "0.5"]) {
      assert.throws(() => selectRandomTemplate(TEMPLATES, () => bad), /Random value must be in \[0, 1\)/, String(bad));
    }
  });

  it("does not call the random function when the collection is empty", () => {
    let calls = 0;
    assert.throws(() => selectRandomTemplate([], () => { calls++; return 0; }));
    assert.equal(calls, 0);
  });
});
