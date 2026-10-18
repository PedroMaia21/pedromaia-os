// Exercise library (Task 4B, design §20.1, O6): rendering, create, edit,
// archive, lifecycle, and HTML safety of the UI controller, run in Node with
// module-harness.mjs (fake service validated by the real engine, minimal DOM).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MODULE_DIR, harness, setUp, mountModule, navigateAway, createFakeService, exercise,
  settle, click, submit, isShown
} from "./module-harness.mjs";
import { TrackingType, Laterality } from "../../public/modules/fitnessPlanner/fitnessPlanner.engine.js";

const controller = await import(new URL("fitnessPlanner.js", MODULE_DIR));

/* ---------- Helpers ---------- */

const q = (root, selector) => root.querySelector(selector);
const hook = (root, name) => q(root, `[data-fp-${name}]`);
const fieldOf = (root, name) => q(root, `[data-fp-field="${name}"]`);
const itemFor = (root, id) => q(root, `[data-fp-exercise-id="${id}"]`);
const namesIn = (root, list) => hook(root, `${list}-list`).children.map(li => q(li, ".fp-exercise-name").textContent);
const actionFor = (root, id, action) => q(root, `[data-fp-exercise-id="${id}"] [data-fp-action="${action}"]`);
const ops = service => service.calls.map(call => call.op);
const saves = service => service.calls.filter(call => call.op === "save").map(call => call.exercise);

async function open(service = createFakeService()) {
  setUp({ service });
  const root = mountModule();
  await controller.init();
  return root;
}

function fillForm(root, values) {
  for (const [name, value] of Object.entries(values)) fieldOf(root, name).value = value;
}

/** Runs `fn` with console.error silenced (expected error paths log). */
async function quietly(fn) {
  const original = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = original; }
}

const firestoreError = code => Object.assign(new Error(code), { code });

const squat = () => exercise({
  id: "ex-squat", name: "Split squat", trackingType: "REPS_ONLY", laterality: "UNILATERAL", equipment: []
});
const curl = () => exercise({ id: "ex-curl", name: "Old curl", isArchived: true, equipment: ["dumbbell"] });

/* ---------- Rendering and state ---------- */

describe("exercise library: rendering", () => {
  it("renders active exercises by name with tracking type, laterality, and equipment", async () => {
    const root = await open(createFakeService([squat(), exercise()]));
    assert.equal(isShown(hook(root, "library-content")), true);
    assert.deepEqual(namesIn(root, "active"), ["Bench press", "Split squat"]);
    assert.equal(q(itemFor(root, "ex-bench"), ".fp-exercise-meta").textContent, "Weight and reps · Bilateral · barbell, bench");
    assert.equal(q(itemFor(root, "ex-squat"), ".fp-exercise-meta").textContent, "Reps only · Unilateral (one side at a time)");
    assert.equal(actionFor(root, "ex-bench", "edit-exercise").getAttribute("aria-label"), "Edit Bench press");
    assert.equal(actionFor(root, "ex-bench", "archive-exercise").getAttribute("aria-label"), "Archive Bench press");
    assert.equal(isShown(hook(root, "archived-section")), false);
    assert.equal(isShown(hook(root, "active-empty")), false);
  });

  it("renders archived exercises in a separate read-only Archived section", async () => {
    const root = await open(createFakeService([exercise(), curl()]));
    assert.deepEqual(namesIn(root, "active"), ["Bench press"]);
    assert.deepEqual(namesIn(root, "archived"), ["Old curl"]);
    assert.equal(isShown(hook(root, "archived-section")), true);
    const item = itemFor(root, "ex-curl");
    assert.equal(q(item, ".badge").textContent, "Archived");
    assert.equal(item.querySelectorAll("[data-fp-action]").length, 0, "no edit, archive, restore, or delete");
  });

  it("shows the empty active state and hides Archived when there are no exercises", async () => {
    const root = await open(createFakeService([]));
    assert.equal(isShown(hook(root, "library-content")), true);
    assert.equal(isShown(hook(root, "active-empty")), true);
    assert.match(hook(root, "active-empty").textContent, /No exercises yet/);
    assert.equal(isShown(hook(root, "archived-section")), false);
    assert.equal(hook(root, "add").disabled, false);
  });

  it("shows the empty active state alongside Archived when every exercise is archived", async () => {
    const root = await open(createFakeService([curl()]));
    assert.equal(isShown(hook(root, "active-empty")), true);
    assert.equal(isShown(hook(root, "archived-section")), true);
  });

  it("reports invalid documents and does not render them as exercises", async () => {
    const invalid = [{ id: "bad1", invalid: true, reason: "name: name must be a non-blank string." }];
    const root = await open(createFakeService([exercise()], { invalid }));
    assert.equal(isShown(hook(root, "invalid")), true);
    assert.match(hook(root, "invalid-summary").textContent, /^1 exercise record could not be read/);
    assert.deepEqual(hook(root, "invalid-list").children.map(li => li.textContent),
      ["bad1: name: name must be a non-blank string."]);
    assert.equal(itemFor(root, "bad1"), null);
    assert.deepEqual(namesIn(root, "active"), ["Bench press"]);
  });

  it("shows a loading state while exercises load", async () => {
    const service = createFakeService([exercise()]);
    service.hold.list = true;
    setUp({ service });
    const root = mountModule();
    const pending = controller.init();
    await settle();
    assert.equal(isShown(hook(root, "library-loading")), true);
    assert.equal(isShown(hook(root, "library-content")), false);
    assert.equal(hook(root, "add").disabled, true);

    service.held.list[0].resolve();
    await pending;
    assert.equal(isShown(hook(root, "library-loading")), false);
    assert.equal(isShown(hook(root, "library-content")), true);
  });

  it("shows a load error with Retry, and Retry reloads", async () => {
    const service = createFakeService([exercise()]);
    service.fail.list = firestoreError("unavailable");
    const root = await quietly(() => open(service));
    assert.equal(isShown(hook(root, "library-error")), true);
    assert.match(hook(root, "library-error-message").textContent, /could not be loaded.*offline/);
    assert.equal(isShown(hook(root, "library-content")), false);

    service.fail.list = null;
    click(q(root, '[data-fp-action="reload-exercises"]'));
    await settle();
    assert.equal(isShown(hook(root, "library-error")), false);
    assert.deepEqual(namesIn(root, "active"), ["Bench press"]);
    assert.equal(ops(service).filter(op => op === "list").length, 2);
  });
});

/* ---------- Create ---------- */

describe("exercise library: create", () => {
  it("Add exercise opens an empty form whose options are the engine enum values", async () => {
    const root = await open();
    click(hook(root, "add"));
    assert.equal(isShown(hook(root, "form")), true);
    assert.equal(hook(root, "form-title").textContent, "Add exercise");
    assert.deepEqual(fieldOf(root, "trackingType").children.map(o => o.value), Object.values(TrackingType));
    assert.deepEqual(fieldOf(root, "laterality").children.map(o => o.value), Object.values(Laterality));
    assert.equal(fieldOf(root, "trackingType").value, TrackingType.WEIGHT_AND_REPS);
    assert.equal(fieldOf(root, "laterality").value, Laterality.BILATERAL);
    assert.equal(fieldOf(root, "name").value, "");
    assert.equal(document.activeElement, fieldOf(root, "name"));
  });

  it("saves a new exercise with schemaVersion 1, isArchived false, and no client-generated ID", async () => {
    const service = createFakeService([]);
    const root = await open(service);
    click(hook(root, "add"));
    fillForm(root, {
      name: "  Deadlift  ", trackingType: "WEIGHT_AND_REPS", laterality: "BILATERAL",
      equipment: " barbell, , straps ", notes: " Hook grip "
    });
    const event = submit(hook(root, "form"));
    assert.equal(event.defaultPrevented, true, "the browser form submission is suppressed");

    assert.deepEqual(saves(service), [{
      schemaVersion: 1, name: "Deadlift", trackingType: "WEIGHT_AND_REPS", laterality: "BILATERAL",
      equipment: ["barbell", "straps"], notes: "Hook grip", isArchived: false
    }]);
    assert.equal("id" in saves(service)[0], false, "the service generates the document ID");
    assert.equal(isShown(hook(root, "form")), false);
    assert.ok(itemFor(root, "auto0001"), "the returned ID is used in the UI state");
    assert.deepEqual(namesIn(root, "active"), ["Deadlift"]);
  });

  it("supports reps-only and unilateral exercises", async () => {
    const service = createFakeService([]);
    const root = await open(service);
    click(hook(root, "add"));
    fillForm(root, { name: "Pistol squat", trackingType: "REPS_ONLY", laterality: "UNILATERAL", equipment: "", notes: "" });
    submit(hook(root, "form"));
    assert.equal(saves(service)[0].trackingType, "REPS_ONLY");
    assert.equal(saves(service)[0].laterality, "UNILATERAL");
    assert.deepEqual(saves(service)[0].equipment, []);
    assert.equal("targetWeight" in saves(service)[0], false);
  });

  it("shows the §9.2 write state until the server acknowledges the write", async () => {
    const service = createFakeService([], { autoAck: false });
    const root = await open(service);
    click(hook(root, "add"));
    fillForm(root, { name: "Deadlift" });
    submit(hook(root, "form"));
    assert.match(hook(root, "notice").textContent, /saved on this device, syncing/);
    assert.ok(q(itemFor(root, "auto0001"), ".fp-exercise-sync"));

    service.writes[0].resolve();
    await settle();
    assert.equal(hook(root, "notice").textContent, "\"Deadlift\" saved.");
    assert.equal(q(itemFor(root, "auto0001"), ".fp-exercise-sync"), null);
  });

  it("a newly created exercise can be edited through its returned ID", async () => {
    const service = createFakeService([]);
    const root = await open(service);
    click(hook(root, "add"));
    fillForm(root, { name: "Deadlift" });
    submit(hook(root, "form"));
    click(actionFor(root, "auto0001", "edit-exercise"));
    await settle();
    assert.deepEqual(service.calls.at(-1), { op: "get", id: "auto0001" });
    assert.equal(hook(root, "form-title").textContent, "Edit \"Deadlift\"");
  });

  it("an engine validation error keeps the form and its values and names the field", async () => {
    const service = createFakeService([]);
    const root = await open(service);
    click(hook(root, "add"));
    fillForm(root, { name: "   ", notes: "keep me" });
    submit(hook(root, "form"));
    assert.equal(isShown(hook(root, "form")), true);
    assert.equal(fieldOf(root, "notes").value, "keep me");
    assert.equal(fieldOf(root, "name").getAttribute("aria-invalid"), "true");
    assert.equal(isShown(q(root, '[data-fp-field-error="name"]')), true);
    assert.match(q(root, '[data-fp-field-error="name"]').textContent, /name/);
    assert.equal(service.store.size, 0);
    assert.deepEqual(namesIn(root, "active"), []);
  });

  it("a rejected write is reported, reopens the form with the entered values, and reloads", async () => {
    const service = createFakeService([], { autoAck: false });
    const root = await open(service);
    click(hook(root, "add"));
    fillForm(root, { name: "Deadlift", equipment: "barbell" });
    submit(hook(root, "form"));

    await quietly(async () => {
      service.writes[0].reject(firestoreError("permission-denied"));
      await settle();
    });
    assert.match(hook(root, "notice").textContent, /"Deadlift" was not saved\. Permission denied/);
    assert.equal(isShown(hook(root, "form")), true);
    assert.equal(fieldOf(root, "name").value, "Deadlift");
    assert.equal(fieldOf(root, "equipment").value, "barbell");
    assert.deepEqual(namesIn(root, "active"), [], "not shown as saved after the reload");
    assert.equal(ops(service).filter(op => op === "list").length, 2);
  });

  it("Cancel closes the form without saving", async () => {
    const service = createFakeService([]);
    const root = await open(service);
    click(hook(root, "add"));
    fillForm(root, { name: "Deadlift" });
    click(q(root, '[data-fp-action="cancel-form"]'));
    assert.equal(isShown(hook(root, "form")), false);
    assert.deepEqual(saves(service), []);
  });

  it("while a form is open, Add and list actions are disabled and ignored", async () => {
    const service = createFakeService([exercise()]);
    const root = await open(service);
    click(hook(root, "add"));
    fillForm(root, { name: "Draft" });
    assert.equal(hook(root, "add").disabled, true);
    assert.equal(actionFor(root, "ex-bench", "edit-exercise").disabled, true);
    assert.equal(actionFor(root, "ex-bench", "archive-exercise").disabled, true);
    click(actionFor(root, "ex-bench", "archive-exercise"));
    click(hook(root, "add"));
    await settle();
    assert.deepEqual(ops(service), ["list"]);
    assert.equal(isShown(hook(root, "confirm")), false);
    assert.equal(fieldOf(root, "name").value, "Draft", "a second Add does not reset the open form");
  });
});

/* ---------- Edit ---------- */

describe("exercise library: edit", () => {
  it("edits a fresh copy and saves it under the same ID, keeping createdAt, isArchived, and unknown fields", async () => {
    const seeded = exercise({ futureField: "kept" });
    const service = createFakeService([seeded]);
    const root = await open(service);
    service.store.get("ex-bench").notes = "changed elsewhere";

    click(actionFor(root, "ex-bench", "edit-exercise"));
    await settle();
    assert.deepEqual(service.calls.at(-1), { op: "get", id: "ex-bench" });
    assert.equal(hook(root, "form-title").textContent, "Edit \"Bench press\"");
    assert.equal(fieldOf(root, "notes").value, "changed elsewhere", "form uses the fresh read");
    assert.equal(fieldOf(root, "equipment").value, "barbell, bench");

    fillForm(root, { name: "Incline bench press" });
    submit(hook(root, "form"));
    const [saved] = saves(service);
    assert.equal(saved.id, "ex-bench");
    assert.deepEqual(saved.createdAt, seeded.createdAt);
    assert.equal(saved.isArchived, false);
    assert.equal(saved.futureField, "kept");
    assert.equal(saved.name, "Incline bench press");
    assert.deepEqual(namesIn(root, "active"), ["Incline bench press"]);
    assert.equal(hook(root, "active-list").children.length, 1, "no duplicate entry");
  });

  it("exerciseFromForm builds new and edited exercises without changing isArchived", () => {
    const values = { name: " Row ", trackingType: "WEIGHT_AND_REPS", laterality: "BILATERAL", equipment: "cable,  bar ", notes: "" };
    assert.deepEqual(controller.exerciseFromForm(values), {
      schemaVersion: 1, name: "Row", trackingType: "WEIGHT_AND_REPS", laterality: "BILATERAL",
      equipment: ["cable", "bar"], notes: "", isArchived: false
    });
    const loaded = exercise({ futureField: 1 });
    const edited = controller.exerciseFromForm(values, loaded);
    assert.equal(edited.id, loaded.id);
    assert.equal(edited.isArchived, false);
    assert.equal(edited.createdAt, loaded.createdAt);
    assert.equal(edited.futureField, 1);
    assert.equal(edited.name, "Row");
  });

  it("archived exercises cannot enter the edit flow", async () => {
    const service = createFakeService([curl()]);
    const root = await open(service);
    assert.equal(actionFor(root, "ex-curl", "edit-exercise"), null);

    const forged = document.createElement("button");
    forged.dataset.fpAction = "edit-exercise";
    forged.dataset.fpId = "ex-curl";
    root.append(forged);
    click(forged);
    await settle();
    assert.deepEqual(ops(service), ["list"], "no read or write");
    assert.equal(isShown(hook(root, "form")), false);
  });

  it("refuses to edit an exercise the fresh read shows as archived, and moves it to Archived", async () => {
    const service = createFakeService([exercise()]);
    const root = await open(service);
    service.store.get("ex-bench").isArchived = true;
    click(actionFor(root, "ex-bench", "edit-exercise"));
    await settle();
    assert.equal(isShown(hook(root, "form")), false);
    assert.match(hook(root, "notice").textContent, /archived and is read-only/);
    assert.deepEqual(namesIn(root, "archived"), ["Bench press"]);
    assert.deepEqual(saves(service), []);
  });

  it("reports an exercise that no longer exists and reloads", async () => {
    const service = createFakeService([exercise()]);
    const root = await open(service);
    service.store.delete("ex-bench");
    click(actionFor(root, "ex-bench", "edit-exercise"));
    await settle();
    assert.match(hook(root, "notice").textContent, /no longer exists/);
    assert.equal(isShown(hook(root, "form")), false);
    assert.deepEqual(namesIn(root, "active"), []);
  });

  it("disables list actions while the fresh read is in flight, so a double click reads once", async () => {
    const service = createFakeService([exercise()]);
    service.hold.get = true;
    const root = await open(service);
    click(actionFor(root, "ex-bench", "edit-exercise"));
    await settle();
    assert.equal(actionFor(root, "ex-bench", "edit-exercise").disabled, true);
    click(actionFor(root, "ex-bench", "edit-exercise"));
    await settle();
    assert.deepEqual(ops(service), ["list", "get"]);
    service.held.get[0].resolve();
    await settle();
    assert.equal(isShown(hook(root, "form")), true);
  });
});

/* ---------- Archive ---------- */

describe("exercise library: archive (O6)", () => {
  async function openConfirm(service) {
    const root = await open(service);
    click(actionFor(root, "ex-bench", "archive-exercise"));
    await settle();
    return root;
  }

  it("asks for confirmation that names the exercise and says it cannot be restored", async () => {
    const service = createFakeService([exercise()]);
    const root = await openConfirm(service);
    assert.deepEqual(service.calls.at(-1), { op: "get", id: "ex-bench" });
    assert.equal(isShown(hook(root, "confirm")), true);
    assert.equal(hook(root, "confirm-title").textContent, "Archive \"Bench press\"?");
    assert.match(hook(root, "confirm").textContent, /cannot be edited, restored, or added to new routines/);
    assert.match(hook(root, "confirm").textContent, /cannot be undone/);
    assert.equal(document.activeElement, hook(root, "confirm-cancel"), "focus starts on Cancel");
    assert.deepEqual(saves(service), []);
  });

  it("cancelling performs no write and leaves the exercise active", async () => {
    const service = createFakeService([exercise()]);
    const root = await openConfirm(service);
    click(q(root, '[data-fp-action="cancel-archive"]'));
    assert.equal(isShown(hook(root, "confirm")), false);
    assert.deepEqual(saves(service), []);
    assert.deepEqual(namesIn(root, "active"), ["Bench press"]);
  });

  it("confirming saves the same exercise with isArchived true; no delete and no new document", async () => {
    const seeded = exercise();
    const service = createFakeService([seeded]);
    const root = await openConfirm(service);
    click(q(root, '[data-fp-action="confirm-archive"]'));
    click(q(root, '[data-fp-action="confirm-archive"]'));

    assert.deepEqual(saves(service), [{ ...seeded, isArchived: true }], "one write, same ID and createdAt");
    assert.deepEqual([...new Set(ops(service))].sort(), ["get", "list", "save"], "no delete operation");
    assert.equal(service.store.size, 1);
    assert.equal(isShown(hook(root, "confirm")), false);
    assert.deepEqual(namesIn(root, "active"), []);
    assert.deepEqual(namesIn(root, "archived"), ["Bench press"]);
    assert.equal(itemFor(root, "ex-bench").querySelectorAll("[data-fp-action]").length, 0, "now read-only");
    assert.deepEqual(harness.firestoreCalls, []);
  });

  it("keeps the exercise active and the confirmation open when the archive save throws", async () => {
    const service = createFakeService([exercise()]);
    const root = await openConfirm(service);
    service.saveExercise = () => { throw firestoreError("unavailable"); };
    await quietly(() => click(q(root, '[data-fp-action="confirm-archive"]')));
    assert.equal(isShown(hook(root, "confirm")), true);
    assert.match(hook(root, "confirm-error").textContent, /was not archived/);
    assert.deepEqual(namesIn(root, "active"), ["Bench press"]);
  });

  it("a rejected archive write is reported and the reload returns the exercise to active", async () => {
    const service = createFakeService([exercise()], { autoAck: false });
    const root = await openConfirm(service);
    click(q(root, '[data-fp-action="confirm-archive"]'));
    assert.deepEqual(namesIn(root, "archived"), ["Bench press"], "applied locally");
    await quietly(async () => {
      service.writes[0].reject(firestoreError("permission-denied"));
      await settle();
    });
    assert.match(hook(root, "notice").textContent, /"Bench press" was not archived/);
    assert.deepEqual(namesIn(root, "active"), ["Bench press"]);
    assert.deepEqual(namesIn(root, "archived"), []);
  });
});

/* ---------- Lifecycle ---------- */

describe("exercise library: lifecycle", () => {
  it("a list response that arrives after navigation does not update any view", async () => {
    const stale = createFakeService([exercise()]);
    stale.hold.list = true;
    setUp({ service: stale });
    const oldRoot = mountModule();
    const pending = controller.init();
    await settle();

    navigateAway();
    const fresh = createFakeService([squat()]);
    setUp({ service: fresh });
    const newRoot = mountModule();
    await controller.init();

    stale.held.list[0].resolve();
    await pending;
    await settle();
    assert.deepEqual(namesIn(oldRoot, "active"), []);
    assert.deepEqual(namesIn(newRoot, "active"), ["Split squat"]);
    assert.equal(oldRoot.listenerCount("click"), 0);
  });

  it("a write acknowledged after navigation does not touch the new view", async () => {
    const service = createFakeService([], { autoAck: false });
    const oldRoot = await open(service);
    click(hook(oldRoot, "add"));
    fillForm(oldRoot, { name: "Deadlift" });
    submit(hook(oldRoot, "form"));

    navigateAway();
    const newRoot = await open(service);
    service.writes[0].resolve();
    await settle();
    assert.equal(isShown(hook(newRoot, "notice")), false);
    assert.deepEqual(namesIn(newRoot, "active"), ["Deadlift"], "re-entry rebuilds state from the service");
  });

  it("a fresh read that resolves after navigation opens no form", async () => {
    const service = createFakeService([exercise()]);
    service.hold.get = true;
    const oldRoot = await open(service);
    click(actionFor(oldRoot, "ex-bench", "edit-exercise"));
    await settle();

    navigateAway();
    service.hold.get = false;
    const newRoot = await open(service);
    service.held.get[0].resolve();
    await settle();
    assert.equal(isShown(hook(oldRoot, "form")), false);
    assert.equal(isShown(hook(newRoot, "form")), false);
  });

  it("re-initialization does not duplicate rendering or writes", async () => {
    const service = createFakeService([exercise()]);
    await open(service);
    navigateAway();
    await open(service);
    navigateAway();
    const root = await open(service);

    assert.equal(hook(root, "active-list").children.length, 1);
    assert.equal(fieldOf(root, "trackingType").children.length, Object.values(TrackingType).length);
    click(hook(root, "add"));
    fillForm(root, { name: "Deadlift" });
    submit(hook(root, "form"));
    assert.equal(saves(service).length, 1);
    assert.deepEqual(namesIn(root, "active"), ["Bench press", "Deadlift"]);
    assert.equal(root.listenerCount("click"), 1);
    assert.equal(root.listenerCount("submit"), 1);
  });
});

/* ---------- Safety ---------- */

describe("exercise library: safety", () => {
  it("renders names, notes, and equipment as text, never as markup", async () => {
    const hostile = exercise({
      name: "<img src=x onerror=alert(1)>",
      notes: "<b>bold</b> & \"quoted\"",
      equipment: ["<script>alert(2)</script>"]
    });
    const service = createFakeService([hostile]);
    const root = await open(service);
    const item = itemFor(root, "ex-bench");
    assert.equal(q(item, ".fp-exercise-name").textContent, hostile.name);
    assert.equal(q(item, ".fp-exercise-notes").textContent, hostile.notes);
    assert.match(q(item, ".fp-exercise-meta").textContent, /<script>alert\(2\)<\/script>/);
    for (const tag of ["img", "b", "script"]) assert.equal(root.querySelectorAll(tag).length, 0, tag);

    click(actionFor(root, "ex-bench", "archive-exercise"));
    await settle();
    assert.equal(hook(root, "confirm-title").textContent, `Archive "${hostile.name}"?`);
    assert.equal(root.querySelectorAll("img").length, 0);
  });

  it("the controller imports only the shared modules, the service, and the engine, and never deletes", async () => {
    const js = await readFile(new URL("fitnessPlanner.js", MODULE_DIR), "utf8");
    const imports = [...js.matchAll(/^import [\s\S]*? from "([^"]+)";/gm)].map(m => m[1]);
    assert.deepEqual(imports, ["../../js/firebase.js", "../../js/auth.js", "./fitnessPlanner.service.js", "./fitnessPlanner.engine.js"]);
    assert.doesNotMatch(js, /\b(setDoc|updateDoc|deleteDoc|getDocs?|collection|writeBatch)\(/, "no Firestore calls");
    assert.doesNotMatch(js, /delete[A-Z]\w*\(|\.delete\(\s*["'`]/, "no delete operations");
    assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});
