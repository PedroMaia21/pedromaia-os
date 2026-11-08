// Routine management (Task 5, design §6.4, §5.3, O6): routine library, create,
// edit, stable occurrence IDs, ordering, targets, O6 exercise selection,
// lifecycle, and HTML safety of the UI controller. Runs in Node with
// module-harness.mjs (fake service validated by the real engine, minimal DOM).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MODULE_DIR, setUp, mountModule, navigateAway, createFakeService, exercise, routine, routineItem,
  settle, click, submit, isShown
} from "./module-harness.mjs";
import { isValidLocalId, validateRoutine } from "../../public/modules/fitnessPlanner/fitnessPlanner.engine.js";

const controller = await import(new URL("fitnessPlanner.js", MODULE_DIR));

/* ---------- Helpers ---------- */

const q = (root, selector) => root.querySelector(selector);
const hook = (root, name) => q(root, `[data-fp-${name}]`);
const routineRow = (root, id) => q(root, `[data-fp-routine-id="${id}"]`);
const routineNames = root => hook(root, "routine-list").children.map(li => q(li, ".fp-routine-name").textContent);
const occurrenceIds = root => hook(root, "occurrence-list").children.map(li => li.dataset.fpOccurrenceId);
const occurrence = (root, id) => q(hook(root, "occurrence-list"), `[data-fp-occurrence-id="${id}"]`);
const target = (root, id, name) => q(occurrence(root, id), `[data-fp-target="${name}"]`);
const occurrenceAction = (root, id, action) => q(occurrence(root, id), `[data-fp-action="${action}"]`);
const occurrenceError = (root, id) => q(occurrence(root, id), "[data-fp-occurrence-error]");
const rops = service => service.routineCalls.map(call => call.op);
const routineSaves = service => service.routineCalls.filter(call => call.op === "save");
const lastSaved = service => routineSaves(service).at(-1).routine;
const pickerValues = root => hook(root, "picker-select").children.map(option => option.value);

async function open(service) {
  setUp({ service });
  const root = mountModule();
  await controller.init();
  return root;
}

async function openCreate(root) {
  click(hook(root, "routine-add"));
  await settle();
  assert.equal(isShown(hook(root, "routine-form")), true, "editor open");
}

async function openEdit(root, id) {
  click(q(routineRow(root, id), "[data-fp-action=\"edit-routine\"]"));
  await settle();
  assert.equal(isShown(hook(root, "routine-form")), true, "editor open");
}

function pick(root, exerciseId) {
  hook(root, "picker-select").value = exerciseId;
  click(q(root, "[data-fp-action=\"add-occurrence\"]"));
  return occurrenceIds(root).at(-1);
}

function fillTargets(root, id, values) {
  for (const [name, value] of Object.entries(values)) target(root, id, name).value = value;
}

async function quietly(fn) {
  const original = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = original; }
}

const firestoreError = code => Object.assign(new Error(code), { code });

const bench = () => exercise();
const squat = () => exercise({
  id: "ex-squat", name: "Split squat", trackingType: "REPS_ONLY", laterality: "UNILATERAL", equipment: []
});
const curl = () => exercise({ id: "ex-curl", name: "Old curl", isArchived: true, equipment: ["dumbbell"] });
const exercises = () => [bench(), squat(), curl()];

/* ---------- Routine library ---------- */

describe("routines: library", () => {
  it("lists routines by name with each occurrence's exercise and targets", async () => {
    const service = createFakeService(exercises(), {
      routines: [routine(), routine({ id: "rt-legs", name: "Legs", items: [] })]
    });
    const root = await open(service);
    assert.equal(isShown(hook(root, "routine-content")), true);
    assert.deepEqual(routineNames(root), ["Legs", "Upper body A"]);

    const row = routineRow(root, "rt-upper");
    assert.equal(q(row, ".fp-routine-meta").textContent, "2 exercises");
    const lines = q(row, ".fp-routine-items").children;
    assert.deepEqual(lines.map(li => li.dataset.fpOccurrenceId), ["occaaaaaaaa1", "occbbbbbbbb2"]);
    assert.equal(q(lines[0], ".fp-routine-item-name").textContent, "Bench press");
    assert.equal(q(lines[0], ".fp-routine-item-targets").textContent, " — 3 × 8–12 · 60 kg · rest 90 s");
    assert.equal(q(lines[1], ".fp-routine-item-targets").textContent, " — 3 × 8–12");
    assert.equal(q(routineRow(root, "rt-legs"), ".fp-routine-meta").textContent, "No exercises");
    assert.equal(q(row, "[data-fp-action=\"edit-routine\"]").getAttribute("aria-label"), "Edit Upper body A");
    assert.equal(isShown(hook(root, "routine-empty")), false);
  });

  it("lists items in `order`, not array position", async () => {
    const service = createFakeService(exercises(), {
      routines: [routine({ items: [routineItem({ order: 5 }), routineItem({ occurrenceId: "occbbbbbbbb2", exerciseId: "ex-squat", order: 2, targetWeight: null })] })]
    });
    const root = await open(service);
    const lines = q(routineRow(root, "rt-upper"), ".fp-routine-items").children;
    assert.deepEqual(lines.map(li => li.dataset.fpOccurrenceId), ["occbbbbbbbb2", "occaaaaaaaa1"]);
  });

  it("shows the empty state when there are no routines", async () => {
    const root = await open(createFakeService(exercises()));
    assert.equal(isShown(hook(root, "routine-content")), true);
    assert.equal(isShown(hook(root, "routine-empty")), true);
    assert.match(hook(root, "routine-empty").textContent, /No routines yet/);
  });

  it("reports invalid routine documents and never renders or rewrites them", async () => {
    const service = createFakeService(exercises(), {
      routines: [routine()],
      invalidRoutines: [{ id: "rt-bad", invalid: true, reason: "items[0].order: Duplicate order." }]
    });
    const root = await open(service);
    assert.deepEqual(routineNames(root), ["Upper body A"]);
    assert.equal(isShown(hook(root, "routine-invalid")), true);
    assert.match(hook(root, "routine-invalid-summary").textContent, /1 routine record could not be read/);
    assert.equal(hook(root, "routine-invalid-list").textContent, "rt-bad: items[0].order: Duplicate order.");
    assert.equal(routineRow(root, "rt-bad"), null);
    assert.deepEqual(rops(service), ["list"], "no write");
  });

  it("labels references to archived, missing, and unreadable exercises", async () => {
    const service = createFakeService(exercises(), {
      invalid: [{ id: "ex-broken", invalid: true, reason: "name: bad" }],
      routines: [routine({
        items: [
          routineItem({ exerciseId: "ex-curl" }),
          routineItem({ occurrenceId: "occbbbbbbbb2", exerciseId: "ex-gone", order: 1 }),
          routineItem({ occurrenceId: "occcccccccc3", exerciseId: "ex-broken", order: 2 })
        ]
      })]
    });
    const root = await open(service);
    const lines = q(routineRow(root, "rt-upper"), ".fp-routine-items").children;
    assert.equal(q(lines[0], ".fp-routine-item-name").textContent, "Old curl");
    assert.equal(q(lines[0], ".badge").textContent, "Archived exercise");
    assert.equal(q(lines[1], ".fp-routine-item-name").textContent, "Missing exercise (ex-gone)");
    assert.equal(q(lines[1], ".badge").textContent, "Missing");
    assert.equal(q(lines[2], ".fp-routine-item-name").textContent, "Unreadable exercise (ex-broken)");
    assert.equal(q(lines[2], ".badge").textContent, "Unreadable");
  });

  it("shows a loading state while routines load", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    service.routineHold.list = true;
    setUp({ service });
    const root = mountModule();
    const pending = controller.init();
    await settle();
    assert.equal(isShown(hook(root, "routine-loading")), true);
    assert.equal(isShown(hook(root, "routine-content")), false);
    assert.equal(hook(root, "routine-add").disabled, true);

    service.routineHeld.list[0].resolve();
    await pending;
    assert.equal(isShown(hook(root, "routine-loading")), false);
    assert.deepEqual(routineNames(root), ["Upper body A"]);
    assert.equal(hook(root, "routine-add").disabled, false);
  });

  it("shows a load error with Retry, and Retry reloads", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    service.routineFail.list = firestoreError("unavailable");
    const root = await quietly(() => open(service));
    assert.equal(isShown(hook(root, "routine-error")), true);
    assert.match(hook(root, "routine-error-message").textContent, /^Routines could not be loaded\. You appear to be offline/);
    assert.equal(isShown(hook(root, "routine-content")), false);
    assert.equal(isShown(hook(root, "library-content")), true, "the exercise library is unaffected");

    service.routineFail.list = null;
    click(q(hook(root, "routine-error"), "[data-fp-action=\"reload-routines\"]"));
    await settle();
    assert.equal(isShown(hook(root, "routine-error")), false);
    assert.deepEqual(routineNames(root), ["Upper body A"]);
    assert.deepEqual(rops(service), ["list", "list"]);
  });

  it("a slower earlier load never overwrites a newer one", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    service.routineFail.list = firestoreError("unavailable");
    const root = await quietly(() => open(service));
    service.routineFail.list = null;
    service.routineHold.list = true;
    click(q(hook(root, "routine-error"), "[data-fp-action=\"reload-routines\"]"));
    click(q(hook(root, "routine-error"), "[data-fp-action=\"reload-routines\"]"));
    await settle();
    service.routineStore.set("rt-new", routine({ id: "rt-new", name: "Newer" }));
    service.routineHeld.list[1].resolve();
    await settle();
    assert.deepEqual(routineNames(root), ["Newer", "Upper body A"]);
    service.routineStore.delete("rt-new");
    service.routineHeld.list[0].resolve();
    await settle();
    assert.deepEqual(routineNames(root), ["Newer", "Upper body A"], "stale response ignored");
  });
});

/* ---------- Create ---------- */

describe("routines: create", () => {
  it("Add routine reloads exercises and offers only active exercises (O6)", async () => {
    const service = createFakeService(exercises());
    const root = await open(service);
    const listsBefore = service.calls.filter(call => call.op === "list").length;
    await openCreate(root);
    assert.equal(service.calls.filter(call => call.op === "list").length, listsBefore + 1, "fresh exercise list");
    assert.equal(hook(root, "routine-form-title").textContent, "Add routine");
    assert.deepEqual(pickerValues(root), ["ex-bench", "ex-squat"], "archived ex-curl is not offered");
    assert.equal(isShown(hook(root, "picker")), true);
    assert.equal(isShown(hook(root, "picker-empty")), false);
    assert.equal(isShown(hook(root, "occurrence-empty")), true);
    assert.equal(hook(root, "routine-add").disabled, true, "one editor at a time");
  });

  it("an archived exercise cannot be added even if its ID is forced into the picker", async () => {
    const root = await open(createFakeService(exercises()));
    await openCreate(root);
    const option = document.createElement("option");
    option.value = "ex-curl";
    hook(root, "picker-select").append(option);
    hook(root, "picker-select").value = "ex-curl";
    click(q(root, "[data-fp-action=\"add-occurrence\"]"));
    assert.deepEqual(occurrenceIds(root), []);
  });

  it("shows the no-active-exercises state when every exercise is archived", async () => {
    const root = await open(createFakeService([curl()]));
    await openCreate(root);
    assert.equal(isShown(hook(root, "picker")), false);
    assert.equal(isShown(hook(root, "picker-empty")), true);
    assert.match(hook(root, "picker-empty").textContent, /No active exercises/);
  });

  it("saves an empty routine with schemaVersion 1, isArchived false, and no client ID", async () => {
    const service = createFakeService(exercises());
    const root = await open(service);
    await openCreate(root);
    hook(root, "routine-name").value = "  Rest day mobility  ";
    submit(hook(root, "routine-form"));

    assert.deepEqual(lastSaved(service), { schemaVersion: 1, name: "Rest day mobility", isArchived: false, items: [] });
    assert.equal(isShown(hook(root, "routine-form")), false);
    await settle();
    assert.deepEqual(routineNames(root), ["Rest day mobility"]);
    assert.equal(hook(root, "routine-notice").textContent, "\"Rest day mobility\" saved.");
  });

  it("saves occurrences with engine-format IDs, explicit orders, and every target field", async () => {
    const service = createFakeService(exercises());
    const root = await open(service);
    await openCreate(root);
    hook(root, "routine-name").value = "Push";
    const first = pick(root, "ex-bench");
    const second = pick(root, "ex-squat");
    fillTargets(root, first, { targetSets: "4", repMin: "5", repMax: "8", targetWeight: "62.5", restSeconds: "180", notes: "Paused" });
    fillTargets(root, second, { targetSets: "3", repMin: "10", repMax: "10" });
    submit(hook(root, "routine-form"));

    const saved = routineSaves(service).at(-1);
    assert.ok(isValidLocalId(first) && isValidLocalId(second) && first !== second);
    assert.deepEqual(saved.routine.items, [
      { occurrenceId: first, exerciseId: "ex-bench", order: 0, targetSets: 4, repMin: 5, repMax: 8, targetWeight: 62.5, restSeconds: 180, notes: "Paused" },
      { occurrenceId: second, exerciseId: "ex-squat", order: 1, targetSets: 3, repMin: 10, repMax: 10, targetWeight: null, restSeconds: null, notes: "" }
    ]);
    assert.deepEqual(Object.keys(saved.exercisesById).sort(), ["ex-bench", "ex-curl", "ex-squat"],
      "references are validated against the exercise library, archived included");
    assert.doesNotThrow(() => validateRoutine(saved.routine, saved.exercisesById));
  });

  it("the same exercise can appear more than once, each with its own occurrence ID", async () => {
    const service = createFakeService(exercises());
    const root = await open(service);
    await openCreate(root);
    hook(root, "routine-name").value = "Bench twice";
    const a = pick(root, "ex-bench");
    const b = pick(root, "ex-bench");
    fillTargets(root, a, { targetSets: "3", repMin: "5", repMax: "5", targetWeight: "80" });
    fillTargets(root, b, { targetSets: "2", repMin: "10", repMax: "12", targetWeight: "60" });
    submit(hook(root, "routine-form"));
    const items = lastSaved(service).items;
    assert.deepEqual(items.map(item => item.exerciseId), ["ex-bench", "ex-bench"]);
    assert.notEqual(items[0].occurrenceId, items[1].occurrenceId);
    assert.deepEqual(items.map(item => item.targetWeight), [80, 60]);
  });

  it("the service-assigned routine ID is used for later edits", async () => {
    const service = createFakeService(exercises());
    const root = await open(service);
    await openCreate(root);
    hook(root, "routine-name").value = "Pull";
    submit(hook(root, "routine-form"));
    await settle();
    assert.ok(routineRow(root, "routine0001"));
    await openEdit(root, "routine0001");
    assert.deepEqual(service.routineCalls.at(-1), { op: "get", id: "routine0001" });
    hook(root, "routine-name").value = "Pull A";
    submit(hook(root, "routine-form"));
    assert.equal(lastSaved(service).id, "routine0001");
    assert.equal(service.routineStore.size, 1, "no second document");
  });

  it("Cancel closes the editor without saving", async () => {
    const service = createFakeService(exercises());
    const root = await open(service);
    await openCreate(root);
    hook(root, "routine-name").value = "Draft";
    pick(root, "ex-bench");
    click(q(root, "[data-fp-action=\"cancel-routine\"]"));
    assert.equal(isShown(hook(root, "routine-form")), false);
    assert.equal(routineSaves(service).length, 0);
    assert.equal(hook(root, "routine-add").disabled, false);
    await openCreate(root);
    assert.equal(hook(root, "routine-name").value, "", "a new editor starts clean");
    assert.deepEqual(occurrenceIds(root), []);
  });
});

/* ---------- Stable occurrences and ordering ---------- */

describe("routines: occurrences and ordering", () => {
  const three = () => routine({
    items: [
      routineItem(),
      routineItem({ occurrenceId: "occbbbbbbbb2", exerciseId: "ex-squat", order: 1, targetWeight: null, notes: "" }),
      routineItem({ occurrenceId: "occcccccccc3", order: 2, targetWeight: 40, notes: "Back-off" })
    ]
  });

  it("moving an occurrence swaps positions and orders and keeps every ID and target", async () => {
    const service = createFakeService(exercises(), { routines: [three()] });
    const root = await open(service);
    await openEdit(root, "rt-upper");
    assert.deepEqual(occurrenceIds(root), ["occaaaaaaaa1", "occbbbbbbbb2", "occcccccccc3"]);
    assert.equal(occurrenceAction(root, "occaaaaaaaa1", "move-occurrence-up").disabled, true);
    assert.equal(occurrenceAction(root, "occcccccccc3", "move-occurrence-down").disabled, true);

    click(occurrenceAction(root, "occcccccccc3", "move-occurrence-up"));
    assert.deepEqual(occurrenceIds(root), ["occaaaaaaaa1", "occcccccccc3", "occbbbbbbbb2"]);
    click(occurrenceAction(root, "occaaaaaaaa1", "move-occurrence-down"));
    assert.deepEqual(occurrenceIds(root), ["occcccccccc3", "occaaaaaaaa1", "occbbbbbbbb2"]);
    submit(hook(root, "routine-form"));

    const before = Object.fromEntries(three().items.map(item => [item.occurrenceId, item]));
    const items = lastSaved(service).items;
    assert.deepEqual(items.map(item => [item.occurrenceId, item.order]),
      [["occcccccccc3", 0], ["occaaaaaaaa1", 1], ["occbbbbbbbb2", 2]]);
    for (const item of items) {
      assert.deepEqual({ ...item, order: 0 }, { ...before[item.occurrenceId], order: 0 }, "only order changed");
    }
  });

  it("removing an occurrence keeps every other ID, order, and target", async () => {
    const service = createFakeService(exercises(), { routines: [three()] });
    const root = await open(service);
    await openEdit(root, "rt-upper");
    click(occurrenceAction(root, "occbbbbbbbb2", "remove-occurrence"));
    assert.deepEqual(occurrenceIds(root), ["occaaaaaaaa1", "occcccccccc3"]);
    submit(hook(root, "routine-form"));
    const [first, , third] = three().items;
    assert.deepEqual(lastSaved(service).items, [first, third]);
  });

  it("adding an occurrence keeps existing IDs and orders and appends after the highest order", async () => {
    const stored = routine({ items: [routineItem({ order: 4 }), routineItem({ occurrenceId: "occbbbbbbbb2", order: 9, targetWeight: 70 })] });
    const service = createFakeService(exercises(), { routines: [stored] });
    const root = await open(service);
    await openEdit(root, "rt-upper");
    const added = pick(root, "ex-squat");
    fillTargets(root, added, { targetSets: "2", repMin: "12", repMax: "15" });
    submit(hook(root, "routine-form"));

    const items = lastSaved(service).items;
    assert.deepEqual(items.slice(0, 2), stored.items, "existing items unchanged");
    assert.equal(items[2].occurrenceId, added);
    assert.ok(!["occaaaaaaaa1", "occbbbbbbbb2"].includes(added));
    assert.equal(items[2].order, 10);
  });

  it("typed values survive adding, moving, and removing other occurrences", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    const root = await open(service);
    await openEdit(root, "rt-upper");
    fillTargets(root, "occaaaaaaaa1", { targetWeight: "65", notes: "Edited" });
    hook(root, "routine-name").value = "Upper body B";
    const added = pick(root, "ex-bench");
    fillTargets(root, added, { targetSets: "1", repMin: "1", repMax: "3", targetWeight: "100" });
    click(occurrenceAction(root, added, "move-occurrence-up"));
    click(occurrenceAction(root, "occbbbbbbbb2", "remove-occurrence"));
    assert.equal(target(root, "occaaaaaaaa1", "targetWeight").value, "65");
    assert.equal(target(root, added, "targetWeight").value, "100");
    assert.equal(hook(root, "routine-name").value, "Upper body B");
    submit(hook(root, "routine-form"));
    const saved = lastSaved(service);
    assert.equal(saved.name, "Upper body B");
    assert.deepEqual(saved.items.map(item => [item.occurrenceId, item.order, item.targetWeight]),
      [["occaaaaaaaa1", 0, 65], [added, 1, 100]]);
  });

  it("any sequence of add, move, and remove keeps IDs stable and orders unique", () => {
    let entries = controller.draftFromRoutine(three()).entries;
    const seen = new Map(entries.map(entry => [entry.occurrenceId, entry.exerciseId]));
    let seed = 7;
    const next = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let step = 0; step < 300; step += 1) {
      const op = next(3);
      if (op === 0 || entries.length === 0) {
        const entry = controller.newEntry("ex-bench", entries);
        seen.set(entry.occurrenceId, entry.exerciseId);
        entries = [...entries, entry];
      } else if (op === 1) {
        entries = controller.moveEntry(entries, next(entries.length), next(2) === 0 ? -1 : 1);
      } else {
        const removed = entries[next(entries.length)].occurrenceId;
        entries = entries.filter(entry => entry.occurrenceId !== removed);
      }
      const orders = entries.map(entry => entry.order);
      assert.equal(new Set(orders).size, orders.length, "unique orders");
      assert.deepEqual(orders, [...orders].sort((a, b) => a - b), "display order follows `order`");
      assert.equal(new Set(entries.map(entry => entry.occurrenceId)).size, entries.length, "unique IDs");
      for (const entry of entries) assert.equal(seen.get(entry.occurrenceId), entry.exerciseId, "ID keeps its exercise");
    }
  });

  it("newEntry builds IDs with the engine and never reuses one already in the routine", () => {
    const entries = controller.draftFromRoutine(routine()).entries;
    const ids = ["occaaaaaaaa1", "occbbbbbbbb2", "occnewnew003"];
    const entry = controller.newEntry("ex-bench", entries, () => ids.shift());
    assert.equal(entry.occurrenceId, "occnewnew003");
    assert.throws(() => controller.newEntry("ex-bench", entries, () => "BAD"), { code: "VALIDATION" });
    for (let i = 0; i < 200; i += 1) assert.ok(isValidLocalId(controller.randomLocalId()));
  });

  it("the engine rejects duplicate order values", () => {
    const draft = controller.draftFromRoutine(routine());
    draft.entries[1] = { ...draft.entries[1], order: 0 };
    const built = controller.routineFromEditor(draft, routine());
    assert.throws(() => validateRoutine(built, { "ex-bench": bench(), "ex-squat": squat() }),
      { code: "VALIDATION", field: "items[1].order" });
  });
});

/* ---------- Targets ---------- */

describe("routines: targets", () => {
  it("targetWeight is shown when editing and saved back unchanged", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    const root = await open(service);
    await openEdit(root, "rt-upper");
    assert.equal(target(root, "occaaaaaaaa1", "targetWeight").value, "60");
    assert.equal(target(root, "occaaaaaaaa1", "restSeconds").value, "90");
    assert.equal(target(root, "occaaaaaaaa1", "notes").value, "Pause on chest");
    fillTargets(root, "occaaaaaaaa1", { targetWeight: "62.5" });
    submit(hook(root, "routine-form"));
    await settle();
    assert.equal(service.routineStore.get("rt-upper").items[0].targetWeight, 62.5);

    await openEdit(root, "rt-upper");
    assert.equal(target(root, "occaaaaaaaa1", "targetWeight").value, "62.5", "restored from the stored routine");
  });

  it("clearing an optional weight or rest saves null", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    const root = await open(service);
    await openEdit(root, "rt-upper");
    fillTargets(root, "occaaaaaaaa1", { targetWeight: " ", restSeconds: "" });
    submit(hook(root, "routine-form"));
    assert.deepEqual([lastSaved(service).items[0].targetWeight, lastSaved(service).items[0].restSeconds], [null, null]);
  });

  it("reps-only exercises get no weight input and save a null targetWeight", async () => {
    const service = createFakeService(exercises());
    const root = await open(service);
    await openCreate(root);
    hook(root, "routine-name").value = "Legs";
    const id = pick(root, "ex-squat");
    assert.equal(target(root, id, "targetWeight"), null);
    for (const name of ["targetSets", "repMin", "repMax", "restSeconds", "notes"]) assert.ok(target(root, id, name), name);
    assert.equal(target(root, id, "targetSets").getAttribute("inputmode"), "numeric");
    fillTargets(root, id, { targetSets: "3", repMin: "8", repMax: "10" });
    submit(hook(root, "routine-form"));
    assert.equal(lastSaved(service).items[0].targetWeight, null);
  });

  it("weight-and-reps exercises use a decimal weight input", async () => {
    const root = await open(createFakeService(exercises()));
    await openCreate(root);
    const id = pick(root, "ex-bench");
    assert.equal(target(root, id, "targetWeight").getAttribute("inputmode"), "decimal");
    assert.equal(q(occurrence(root, id), `label[for="fp-occurrence-${id}-targetWeight"]`).textContent, "Weight (kg)");
  });

  it("a stored weight on a now reps-only exercise is shown, rejected by the engine, and can be cleared", async () => {
    // ex-squat stored with a weight (e.g. its tracking type changed to REPS_ONLY later).
    const stored = routine({ items: [routineItem({ exerciseId: "ex-squat", targetWeight: 20 })] });
    const service = createFakeService(exercises(), { routines: [stored] });
    const root = await open(service);
    await openEdit(root, "rt-upper");
    assert.equal(target(root, "occaaaaaaaa1", "targetWeight").value, "20");
    assert.match(occurrence(root, "occaaaaaaaa1").textContent, /Reps-only exercises have no target weight/);

    submit(hook(root, "routine-form"));
    assert.equal(isShown(hook(root, "routine-form")), true);
    assert.equal(service.routineStore.get("rt-upper").items[0].targetWeight, 20, "nothing stored");
    assert.equal(occurrenceError(root, "occaaaaaaaa1").textContent, "Weight must be null for REPS_ONLY exercises.");
    assert.equal(target(root, "occaaaaaaaa1", "targetWeight").getAttribute("aria-invalid"), "true");

    fillTargets(root, "occaaaaaaaa1", { targetWeight: "" });
    submit(hook(root, "routine-form"));
    assert.equal(isShown(hook(root, "routine-form")), false);
    assert.equal(service.routineStore.get("rt-upper").items[0].targetWeight, null);
  });

  it("invalid targets are rejected by the engine; the editor keeps the values and marks the field", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    const root = await open(service);
    await openEdit(root, "rt-upper");
    fillTargets(root, "occbbbbbbbb2", { repMin: "12", repMax: "8" });
    submit(hook(root, "routine-form"));
    assert.equal(isShown(hook(root, "routine-form")), true);
    assert.equal(occurrenceError(root, "occbbbbbbbb2").textContent, "Min reps must not exceed max reps.");
    assert.equal(isShown(occurrenceError(root, "occbbbbbbbb2")), true);
    assert.equal(target(root, "occbbbbbbbb2", "repMin").getAttribute("aria-invalid"), "true");
    assert.equal(target(root, "occbbbbbbbb2", "repMin").value, "12");
    assert.equal(isShown(occurrenceError(root, "occaaaaaaaa1")), false);
    assert.deepEqual(service.routineStore.get("rt-upper"), routine(), "nothing stored");

    fillTargets(root, "occbbbbbbbb2", { repMin: "", repMax: "8" });
    submit(hook(root, "routine-form"));
    assert.equal(occurrenceError(root, "occbbbbbbbb2").textContent, "Min reps must be a positive integer.");

    fillTargets(root, "occbbbbbbbb2", { repMin: "6" });
    fillTargets(root, "occaaaaaaaa1", { targetWeight: "-5" });
    submit(hook(root, "routine-form"));
    assert.equal(isShown(occurrenceError(root, "occbbbbbbbb2")), false, "fixed error cleared");
    assert.match(occurrenceError(root, "occaaaaaaaa1").textContent, /^Weight must be a finite number/);

    fillTargets(root, "occaaaaaaaa1", { targetWeight: "60", targetSets: "2.5" });
    submit(hook(root, "routine-form"));
    assert.equal(occurrenceError(root, "occaaaaaaaa1").textContent, "Sets must be a positive integer.");
  });
});

/* ---------- Editing ---------- */

describe("routines: edit", () => {
  it("edits a fresh copy and an unchanged save writes back the same routine", async () => {
    const stored = routine({
      futureField: { keep: true },
      items: [routineItem({ futureItemField: "kept" }), routine().items[1]]
    });
    const service = createFakeService(exercises(), { routines: [stored] });
    const root = await open(service);
    await openEdit(root, "rt-upper");
    assert.deepEqual(service.routineCalls.at(-1), { op: "get", id: "rt-upper" });
    assert.equal(hook(root, "routine-form-title").textContent, "Edit \"Upper body A\"");
    submit(hook(root, "routine-form"));
    assert.deepEqual(lastSaved(service), stored, "id, createdAt, isArchived, unknown fields, and items preserved");
  });

  it("renaming keeps the routine ID, metadata, and every item", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    const root = await open(service);
    await openEdit(root, "rt-upper");
    hook(root, "routine-name").value = "Upper body (heavy)";
    submit(hook(root, "routine-form"));
    assert.deepEqual(lastSaved(service), { ...routine(), name: "Upper body (heavy)" });
    await settle();
    assert.deepEqual(routineNames(root), ["Upper body (heavy)"]);
  });

  it("edits use the fresh read, not the list copy", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    const root = await open(service);
    service.routineStore.set("rt-upper", routine({ name: "Changed elsewhere", items: [routineItem({ targetWeight: 70 })] }));
    await openEdit(root, "rt-upper");
    assert.equal(hook(root, "routine-name").value, "Changed elsewhere");
    assert.deepEqual(occurrenceIds(root), ["occaaaaaaaa1"]);
    assert.equal(target(root, "occaaaaaaaa1", "targetWeight").value, "70");
  });

  it("an archived routine keeps isArchived when edited", async () => {
    const service = createFakeService(exercises(), { routines: [routine({ isArchived: true })] });
    const root = await open(service);
    assert.equal(q(routineRow(root, "rt-upper"), ".badge").textContent, "Archived");
    await openEdit(root, "rt-upper");
    submit(hook(root, "routine-form"));
    assert.equal(lastSaved(service).isArchived, true);
  });

  it("keeps occurrences of exercises archived later, labelled and editable, but never offers them (O6)", async () => {
    const stored = routine({ items: [routineItem({ exerciseId: "ex-curl" })] });
    const service = createFakeService(exercises(), { routines: [stored] });
    const root = await open(service);
    await openEdit(root, "rt-upper");
    assert.deepEqual(occurrenceIds(root), ["occaaaaaaaa1"]);
    assert.equal(q(occurrence(root, "occaaaaaaaa1"), ".badge").textContent, "Archived exercise");
    assert.match(occurrence(root, "occaaaaaaaa1").textContent, /cannot be added again/);
    assert.ok(!pickerValues(root).includes("ex-curl"));

    fillTargets(root, "occaaaaaaaa1", { targetWeight: "15" });
    submit(hook(root, "routine-form"));
    assert.equal(isShown(hook(root, "routine-form")), false);
    assert.deepEqual(lastSaved(service).items, [{ ...stored.items[0], targetWeight: 15 }]);
  });

  it("an occurrence added in this edit whose exercise is archived meanwhile is refused before saving", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    const root = await open(service);
    await openEdit(root, "rt-upper");
    const added = pick(root, "ex-bench");
    fillTargets(root, added, { targetSets: "1", repMin: "1", repMax: "1" });

    // Archive Bench press in the exercise library while the editor is open.
    click(q(root, "[data-fp-exercise-id=\"ex-bench\"] [data-fp-action=\"archive-exercise\"]"));
    await settle();
    click(q(root, "[data-fp-action=\"confirm-archive\"]"));
    await settle();
    assert.ok(!pickerValues(root).includes("ex-bench"), "picker follows the library");

    submit(hook(root, "routine-form"));
    assert.equal(routineSaves(service).length, 0);
    assert.match(occurrenceError(root, added).textContent, /archived after you added it/);
    click(occurrenceAction(root, added, "remove-occurrence"));
    submit(hook(root, "routine-form"));
    assert.equal(routineSaves(service).length, 1, "the existing Bench press occurrence is still allowed");
    assert.deepEqual(lastSaved(service).items, routine().items);
  });

  it("a missing exercise reference is shown and blocks saving until the user removes it", async () => {
    const stored = routine({ items: [routineItem({ exerciseId: "ex-gone" }), routine().items[1]] });
    const service = createFakeService(exercises(), { routines: [stored] });
    const root = await open(service);
    await openEdit(root, "rt-upper");
    assert.equal(q(occurrence(root, "occaaaaaaaa1"), ".fp-exercise-name").textContent, "Missing exercise (ex-gone)");
    assert.match(occurrence(root, "occaaaaaaaa1").textContent, /Remove it to save/);

    submit(hook(root, "routine-form"));
    assert.equal(isShown(hook(root, "routine-form")), true);
    assert.equal(occurrenceError(root, "occaaaaaaaa1").textContent, "Exercise not found: ex-gone.");
    assert.deepEqual(service.routineStore.get("rt-upper"), stored, "not rewritten");

    click(occurrenceAction(root, "occaaaaaaaa1", "remove-occurrence"));
    submit(hook(root, "routine-form"));
    assert.deepEqual(lastSaved(service).items, [stored.items[1]]);
  });

  it("reports a routine that no longer exists or cannot be read, and reloads", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    const root = await open(service);
    service.routineStore.delete("rt-upper");
    click(q(routineRow(root, "rt-upper"), "[data-fp-action=\"edit-routine\"]"));
    await settle();
    assert.equal(isShown(hook(root, "routine-form")), false);
    assert.equal(hook(root, "routine-notice").textContent, "\"Upper body A\" no longer exists.");
    assert.deepEqual(routineNames(root), []);

    service.routineStore.set("rt-upper", routine());
    click(q(root, "[data-fp-action=\"reload-routines\"]"));
    await settle();
    service.routineGetResult = { id: "rt-upper", invalid: true, reason: "name: bad" };
    click(q(routineRow(root, "rt-upper"), "[data-fp-action=\"edit-routine\"]"));
    await settle();
    assert.equal(isShown(hook(root, "routine-form")), false);
    assert.equal(hook(root, "routine-notice").textContent, "\"Upper body A\" could not be read, so it cannot be changed.");
  });

  it("a failed routine read is reported and the editor stays closed", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    const root = await open(service);
    service.routineFail.get = firestoreError("unavailable");
    await quietly(async () => {
      click(q(routineRow(root, "rt-upper"), "[data-fp-action=\"edit-routine\"]"));
      await settle();
    });
    assert.equal(isShown(hook(root, "routine-form")), false);
    assert.match(hook(root, "routine-notice").textContent, /could not be opened\. You appear to be offline/);
    assert.equal(hook(root, "routine-add").disabled, false);
  });

  it("does not open the editor when the exercise library cannot be loaded", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    const root = await open(service);
    service.fail.list = firestoreError("unavailable");
    await quietly(async () => {
      click(hook(root, "routine-add"));
      await settle();
    });
    assert.equal(isShown(hook(root, "routine-form")), false);
    assert.match(hook(root, "routine-notice").textContent, /Exercises could not be loaded/);
  });
});

/* ---------- Validation, write states, and submissions ---------- */

describe("routines: saving", () => {
  it("a name validation error is shown next to the name and keeps the editor", async () => {
    const service = createFakeService(exercises());
    const root = await open(service);
    await openCreate(root);
    const id = pick(root, "ex-bench");
    fillTargets(root, id, { targetSets: "3" });
    hook(root, "routine-name").value = "   ";
    submit(hook(root, "routine-form"));
    assert.equal(isShown(hook(root, "routine-form")), true);
    assert.equal(isShown(hook(root, "routine-name-error")), true);
    assert.equal(hook(root, "routine-name-error").textContent, "Name must be a non-blank string.");
    assert.equal(hook(root, "routine-name").getAttribute("aria-invalid"), "true");
    assert.equal(target(root, id, "targetSets").value, "3", "entered values kept");
    assert.equal(service.routineStore.size, 0);
  });

  it("shows the §9.2 write state until the server acknowledges", async () => {
    const service = createFakeService(exercises(), { autoAck: false });
    const root = await open(service);
    await openCreate(root);
    hook(root, "routine-name").value = "Push";
    submit(hook(root, "routine-form"));
    await settle();
    assert.equal(hook(root, "routine-notice").textContent, "\"Push\" saved on this device, syncing…");
    assert.ok(q(routineRow(root, "routine0001"), ".fp-routine-sync"));
    service.routineWrites[0].resolve();
    await settle();
    assert.equal(hook(root, "routine-notice").textContent, "\"Push\" saved.");
    assert.equal(q(routineRow(root, "routine0001"), ".fp-routine-sync"), null);
  });

  it("a rejected write is reported, reopens the editor with the user's edits, and reloads", async () => {
    const service = createFakeService(exercises(), { routines: [routine()], autoAck: false });
    const root = await open(service);
    await openEdit(root, "rt-upper");
    hook(root, "routine-name").value = "Upper renamed";
    fillTargets(root, "occaaaaaaaa1", { targetWeight: "75" });
    click(occurrenceAction(root, "occbbbbbbbb2", "move-occurrence-up"));
    submit(hook(root, "routine-form"));
    assert.equal(isShown(hook(root, "routine-form")), false);

    await quietly(async () => {
      service.routineWrites[0].reject(firestoreError("permission-denied"));
      await settle();
    });
    assert.match(hook(root, "routine-notice").textContent, /^"Upper renamed" was not saved\. Permission denied/);
    assert.equal(isShown(hook(root, "routine-form")), true);
    assert.match(hook(root, "routine-form-error").textContent, /was not saved/);
    assert.equal(hook(root, "routine-name").value, "Upper renamed");
    assert.deepEqual(occurrenceIds(root), ["occbbbbbbbb2", "occaaaaaaaa1"]);
    assert.equal(target(root, "occaaaaaaaa1", "targetWeight").value, "75");
    assert.deepEqual(routineNames(root), ["Upper body A"], "reloaded: the rejected change is gone");

    service.autoAck = true;
    submit(hook(root, "routine-form"));
    assert.equal(lastSaved(service).id, "rt-upper", "retry writes the same document");
    assert.equal(lastSaved(service).createdAt.getTime(), routine().createdAt.getTime());
  });

  it("a double submit saves once", async () => {
    const service = createFakeService(exercises());
    const root = await open(service);
    await openCreate(root);
    hook(root, "routine-name").value = "Once";
    submit(hook(root, "routine-form"));
    submit(hook(root, "routine-form"));
    assert.equal(routineSaves(service).length, 1);
    await settle();
    assert.deepEqual(routineNames(root), ["Once"]);
  });

  it("Edit and Add routine are disabled while an editor or read is open, so a double click reads once", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    service.routineHold.get = true;
    const root = await open(service);
    const edit = q(routineRow(root, "rt-upper"), "[data-fp-action=\"edit-routine\"]");
    click(edit);
    click(edit);
    click(hook(root, "routine-add"));
    await settle();
    assert.deepEqual(rops(service), ["list", "get"]);
    assert.equal(hook(root, "routine-add").disabled, true);
    service.routineHeld.get[0].resolve();
    await settle();
    assert.equal(isShown(hook(root, "routine-form")), true);
    assert.equal(q(routineRow(root, "rt-upper"), "[data-fp-action=\"edit-routine\"]").disabled, true);
  });
});

/* ---------- Lifecycle ---------- */

describe("routines: lifecycle", () => {
  it("a routine list that arrives after navigation does not update any view", async () => {
    const stale = createFakeService(exercises(), { routines: [routine()] });
    stale.routineHold.list = true;
    setUp({ service: stale });
    const oldRoot = mountModule();
    const pending = controller.init();
    await settle();

    navigateAway();
    const fresh = createFakeService(exercises(), { routines: [routine({ id: "rt-legs", name: "Legs", items: [] })] });
    setUp({ service: fresh });
    const newRoot = await (async () => { const root = mountModule(); await controller.init(); return root; })();

    stale.routineHeld.list[0].resolve();
    await pending;
    await settle();
    assert.deepEqual(routineNames(oldRoot), []);
    assert.deepEqual(routineNames(newRoot), ["Legs"]);
    assert.equal(oldRoot.listenerCount("click"), 0);
  });

  it("a routine read that resolves after navigation opens no editor", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    service.routineHold.get = true;
    const oldRoot = await open(service);
    click(q(routineRow(oldRoot, "rt-upper"), "[data-fp-action=\"edit-routine\"]"));
    await settle();

    navigateAway();
    service.routineHold.get = false;
    const newRoot = await open(service);
    service.routineHeld.get[0].resolve();
    await settle();
    assert.equal(isShown(hook(oldRoot, "routine-form")), false);
    assert.equal(isShown(hook(newRoot, "routine-form")), false);
    assert.equal(hook(newRoot, "routine-add").disabled, false);
  });

  it("a write settled after navigation does not touch the new view or reopen an editor", async () => {
    const service = createFakeService(exercises(), { autoAck: false });
    const oldRoot = await open(service);
    await openCreate(oldRoot);
    hook(oldRoot, "routine-name").value = "Push";
    submit(hook(oldRoot, "routine-form"));

    navigateAway();
    const newRoot = await open(service);
    await quietly(async () => {
      service.routineWrites[0].reject(firestoreError("permission-denied"));
      await settle();
    });
    assert.equal(isShown(hook(newRoot, "routine-notice")), false);
    assert.equal(isShown(hook(newRoot, "routine-form")), false);
  });

  it("re-initialization does not accumulate listeners or duplicate writes", async () => {
    const service = createFakeService(exercises(), { routines: [routine()] });
    await open(service);
    navigateAway();
    await open(service);
    navigateAway();
    const root = await open(service);

    assert.equal(hook(root, "routine-list").children.length, 1);
    await openEdit(root, "rt-upper");
    assert.equal(hook(root, "picker-select").children.length, 2);
    pick(root, "ex-bench");
    assert.equal(occurrenceIds(root).length, 3, "one click adds one occurrence");
    click(occurrenceAction(root, occurrenceIds(root).at(-1), "remove-occurrence"));
    submit(hook(root, "routine-form"));
    assert.equal(routineSaves(service).length, 1);
    assert.equal(root.listenerCount("click"), 1);
    assert.equal(root.listenerCount("submit"), 1);
  });
});

/* ---------- Safety ---------- */

describe("routines: safety", () => {
  it("renders routine names, item notes, and exercise names as text, never as markup", async () => {
    const hostileExercise = exercise({ name: "<img src=x onerror=alert(1)>" });
    const hostile = routine({
      name: "<script>alert(2)</script>",
      items: [routineItem({ notes: "<b>bold</b> & \"q\"" })]
    });
    const service = createFakeService([hostileExercise, squat()], { routines: [hostile] });
    const root = await open(service);
    assert.equal(q(routineRow(root, "rt-upper"), ".fp-routine-name").textContent, hostile.name);
    assert.equal(q(routineRow(root, "rt-upper"), ".fp-routine-item-name").textContent, hostileExercise.name);

    await openEdit(root, "rt-upper");
    assert.equal(hook(root, "routine-form-title").textContent, `Edit "${hostile.name}"`);
    assert.equal(target(root, "occaaaaaaaa1", "notes").value, hostile.items[0].notes);
    assert.match(hook(root, "picker-select").children[0].textContent, /^<img src=x/);
    for (const tag of ["img", "b", "script"]) assert.equal(root.querySelectorAll(tag).length, 0, tag);
  });

  it("occurrence IDs come from the engine builder, and the controller makes no Firestore calls or deletes", async () => {
    const js = await readFile(new URL("fitnessPlanner.js", MODULE_DIR), "utf8");
    assert.match(js, /createLocalId\(randomId\)/);
    assert.doesNotMatch(js, /occurrenceId: (index|i)\b|occurrenceId: `/, "no index-based IDs");
    assert.doesNotMatch(js, /\b(setDoc|updateDoc|deleteDoc|getDocs?|collection|writeBatch)\(/);
    assert.doesNotMatch(js, /delete[A-Z]\w*\(|\.delete\(\s*["'`]/);
  });
});
