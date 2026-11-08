// /modules/fitnessPlanner/fitnessPlanner.js
//
// UI controller for the Fitness Planner (technical design v1.1, §4.3, §4.6).
// The router injects fitnessPlanner.html into #content and calls init() on
// every visit; it never tears modules down and the ES module stays cached.
// So the only module-level state is `current`, the active context, and every
// listener and subscription belongs to that context.

import { auth, db } from "../../js/firebase.js";
import { getCurrentUser } from "../../js/auth.js";
import { createFitnessService, classifyError, ErrorCategory } from "./fitnessPlanner.service.js";
import { SCHEMA_VERSION, TrackingType, Laterality, ValidationError, createLocalId } from "./fitnessPlanner.engine.js";

const ROOT_ID = "fitness-planner";

/** The active module context (§4.6 rule 1). */
let current = null;

/* ===============================
   MODULE CONTEXT (§4.6)
================================ */

/**
 * Owns everything one visit to the module creates. `dispose()` aborts every
 * listener registered with `abort.signal` and calls every tracked unsubscribe.
 * Snapshot callbacks and awaited continuations must check `alive()` first.
 * Exported for the lifecycle tests; the router only calls init().
 */
export function createContext(root) {
  const context = {
    root,
    service: null,
    abort: new AbortController(),
    unsubscribers: [],
    disposed: false,

    alive() {
      return !this.disposed && this.root.isConnected;
    },

    /** Tracks an onSnapshot unsubscribe; releases it at once if already disposed. */
    track(unsubscribe) {
      if (this.disposed) {
        callSafely(unsubscribe);
      } else {
        this.unsubscribers.push(unsubscribe);
      }
      return unsubscribe;
    },

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.abort.abort();
      this.unsubscribers.splice(0).forEach(callSafely);
    }
  };
  return context;
}

function callSafely(unsubscribe) {
  try {
    unsubscribe();
  } catch (error) {
    console.error("Fitness Planner: unsubscribe failed", error);
  }
}

/* ===============================
   INIT
================================ */

export async function init() {
  current?.dispose();
  current = null;

  const root = document.getElementById(ROOT_ID);
  if (!root) return;

  const ctx = createContext(root);
  ctx.library = createLibraryState();
  ctx.routines = createRoutineState();
  current = ctx;

  bindEvents(ctx);

  // The HTML and JS are cached separately, so an outdated HTML copy can arrive
  // with newer JS. Report that instead of failing on a missing element.
  if (!hasParts(ctx, SHELL_PARTS)) {
    console.error("Fitness Planner: module markup is missing; reload the page.");
    return;
  }
  if (!hasParts(ctx, LIBRARY_PARTS) || !hasParts(ctx, ROUTINE_PARTS) || !hasFormFields(ctx)) {
    console.error("Fitness Planner: module markup is out of date; reload the page.");
    renderError(ctx, OUTDATED_MARKUP_MESSAGE);
    return;
  }

  setUpExerciseForm(ctx);
  renderLoading(ctx);

  try {
    // §4.5: resolve the user once per initialization; services use the bound uid.
    const uid = auth.currentUser?.uid ?? (await getCurrentUser())?.uid;
    if (!ctx.alive()) { ctx.dispose(); return; }

    if (!uid) {
      renderError(ctx, "You need to be signed in to use the Fitness Planner.");
      return;
    }

    ctx.service = createFitnessService({ db, uid });
    renderReady(ctx);
  } catch (error) {
    console.error("Fitness Planner: initialization failed", error);
    if (ctx.alive()) renderError(ctx, "The Fitness Planner could not be loaded.");
    return;
  }

  await Promise.all([loadExercises(ctx), loadRoutines(ctx)]);
}

/* ===============================
   EVENTS
   Delegated listeners on the root (§4.6 rule 5). Fitness markup uses
   data-fp-action, never data-route (rule 6).
================================ */

const actions = Object.freeze({
  retry: () => init(),
  "reload-exercises": ctx => loadExercises(ctx),
  "add-exercise": ctx => { if (!isBusy(ctx.library)) openForm(ctx, { mode: "create", loaded: null }); },
  "edit-exercise": (ctx, target) => beginEdit(ctx, target.dataset.fpId),
  "archive-exercise": (ctx, target) => beginArchive(ctx, target.dataset.fpId),
  "cancel-form": ctx => closeForm(ctx),
  "confirm-archive": ctx => confirmArchive(ctx),
  "cancel-archive": ctx => closeConfirm(ctx),
  "reload-routines": ctx => loadRoutines(ctx),
  "add-routine": ctx => openRoutineEditor(ctx, null),
  "edit-routine": (ctx, target) => openRoutineEditor(ctx, target.dataset.fpId),
  "cancel-routine": ctx => closeRoutineEditor(ctx),
  "add-occurrence": ctx => addOccurrence(ctx),
  "move-occurrence-up": (ctx, target) => moveOccurrence(ctx, target.dataset.fpId, -1),
  "move-occurrence-down": (ctx, target) => moveOccurrence(ctx, target.dataset.fpId, 1),
  "remove-occurrence": (ctx, target) => removeOccurrence(ctx, target.dataset.fpId)
});

function bindEvents(ctx) {
  ctx.root.addEventListener("click", event => {
    if (!ctx.alive()) { ctx.dispose(); return; }
    const target = event.target.closest?.("[data-fp-action]");
    if (!target || !ctx.root.contains(target)) return;
    const name = target.dataset.fpAction;
    if (Object.hasOwn(actions, name)) actions[name](ctx, target);
  }, { signal: ctx.abort.signal });

  ctx.root.addEventListener("submit", event => {
    event.preventDefault();
    if (!ctx.alive()) { ctx.dispose(); return; }
    if (event.target.closest?.("[data-fp-form]")) saveForm(ctx);
    else if (event.target.closest?.("[data-fp-routine-form]")) saveRoutineForm(ctx);
  }, { signal: ctx.abort.signal });
}

/* ===============================
   RENDERING
   Static markup lives in fitnessPlanner.html; dynamic text uses textContent (§4.7).
================================ */

function part(ctx, name) {
  return ctx.root.querySelector(`[data-fp-${name}]`);
}

/** Every part() the shell, the exercise library, and the routines use; checked by init(). */
const SHELL_PARTS = Object.freeze(["status", "error", "error-message", "main"]);
const LIBRARY_PARTS = Object.freeze([
  "add", "notice", "form", "form-title", "form-error", "confirm", "confirm-title", "confirm-error",
  "confirm-cancel", "library-loading", "library-error", "library-error-message", "library-content",
  "active-list", "active-empty", "invalid", "invalid-summary", "invalid-list", "archived-section", "archived-list"
]);
const ROUTINE_PARTS = Object.freeze([
  "routine-add", "routine-notice", "routine-form", "routine-form-title", "routine-name", "routine-name-error",
  "occurrence-list", "occurrence-empty", "picker", "picker-select", "picker-empty", "routine-form-error",
  "routine-loading", "routine-error", "routine-error-message", "routine-content", "routine-list", "routine-empty",
  "routine-invalid", "routine-invalid-summary", "routine-invalid-list"
]);
const OUTDATED_MARKUP_MESSAGE =
  "This page has an outdated copy of the Fitness Planner. Reload the page. If this keeps happening, clear the browser's cached files.";

function hasParts(ctx, names) {
  return names.every(name => part(ctx, name) !== null);
}

function show(element, visible) {
  element?.classList.toggle("hidden", !visible);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderLoading(ctx) {
  part(ctx, "status").textContent = "Loading…";
  show(part(ctx, "status"), true);
  show(part(ctx, "error"), false);
  show(part(ctx, "main"), false);
}

function renderReady(ctx) {
  show(part(ctx, "status"), false);
  show(part(ctx, "error"), false);
  show(part(ctx, "main"), true);
}

function renderError(ctx, message) {
  part(ctx, "error-message").textContent = message;
  show(part(ctx, "status"), false);
  show(part(ctx, "error"), true);
  show(part(ctx, "main"), false);
}

/* ===============================
   ERROR MESSAGES (§16)
   The service classifies errors; user-facing text belongs to the UI.
================================ */

const ERROR_MESSAGES = Object.freeze({
  [ErrorCategory.NOT_FOUND]: "The exercise no longer exists.",
  [ErrorCategory.INVALID_DOCUMENT]: "The stored exercise data could not be read.",
  [ErrorCategory.INVALID_STATE]: "This change is not allowed for the exercise in its current state.",
  [ErrorCategory.PERMISSION_DENIED]: "Permission denied. Try signing in again.",
  [ErrorCategory.UNAVAILABLE]: "You appear to be offline, and this data is not available on this device yet.",
  [ErrorCategory.FAILED_PRECONDITION]: "The database could not complete the request.",
  [ErrorCategory.RESOURCE_EXHAUSTED]: "Too many requests. Try again shortly.",
  [ErrorCategory.UNKNOWN]: "Something went wrong."
});

const ROUTINE_ERROR_MESSAGES = Object.freeze({
  [ErrorCategory.NOT_FOUND]: "The routine no longer exists.",
  [ErrorCategory.INVALID_DOCUMENT]: "The stored routine data could not be read.",
  [ErrorCategory.INVALID_STATE]: "This change is not allowed for the routine in its current state."
});

/** `overrides` replaces the exercise wording for another subject (routines). */
function errorMessage(error, overrides = {}) {
  const category = classifyError(error);
  if (category === ErrorCategory.VALIDATION) return error.message;
  return overrides[category] ?? ERROR_MESSAGES[category] ?? ERROR_MESSAGES[ErrorCategory.UNKNOWN];
}

/* ===============================
   EXERCISE LIBRARY (Task 4B; design §20.1, O6)
   Active exercises can be edited and archived. Archived exercises are listed
   separately and are read-only: no edit, restore, or delete (O6). Edits and
   archives start from a fresh getExercise() so `createdAt` and unknown fields
   are carried forward. Only one form, confirmation, or read is open at a time.
================================ */

const TRACKING_TYPE_LABELS = Object.freeze({
  [TrackingType.WEIGHT_AND_REPS]: "Weight and reps",
  [TrackingType.REPS_ONLY]: "Reps only"
});

const LATERALITY_LABELS = Object.freeze({
  [Laterality.BILATERAL]: "Bilateral",
  [Laterality.UNILATERAL]: "Unilateral (one side at a time)"
});

const FORM_FIELDS = Object.freeze(["name", "trackingType", "laterality", "equipment", "notes"]);

function createLibraryState() {
  return {
    exercises: new Map(), // id → valid exercise, as last read or saved
    invalid: [],          // { id, invalid, reason } from listExercises()
    loaded: false,
    loading: false,
    loadSeq: 0,
    loadError: null,
    reading: false,       // getExercise() for an edit or archive is in flight
    form: null,           // { mode: "create" | "edit", loaded }
    confirm: null,        // { exercise } awaiting archive confirmation
    syncing: new Map()    // id → number of writes not yet acknowledged
  };
}

function isBusy(library) {
  return library.loading || library.reading || library.form !== null || library.confirm !== null;
}

const labelFor = (labels, value) => labels[value] ?? value;

/** One-line summary shown under the name: tracking · laterality · equipment. */
export function describeExercise(exercise) {
  return [
    labelFor(TRACKING_TYPE_LABELS, exercise.trackingType),
    labelFor(LATERALITY_LABELS, exercise.laterality),
    exercise.equipment.join(", ")
  ].filter(text => text !== "").join(" · ");
}

/**
 * Form values → exercise for saveExercise(). New exercises get schemaVersion 1
 * and isArchived false; edits spread the loaded document so `id`, `createdAt`,
 * `isArchived`, and unknown fields are kept. The engine validates the result.
 */
export function exerciseFromForm(values, loaded = null) {
  const fields = {
    name: values.name.trim(),
    trackingType: values.trackingType,
    laterality: values.laterality,
    equipment: values.equipment.split(",").map(tag => tag.trim()).filter(tag => tag !== ""),
    notes: values.notes.trim()
  };
  return loaded === null
    ? { schemaVersion: SCHEMA_VERSION, ...fields, isArchived: false }
    : { ...loaded, ...fields };
}

async function loadExercises(ctx) {
  const library = ctx.library;
  const seq = ++library.loadSeq;
  library.loading = true;
  renderLibrary(ctx);

  try {
    const { docs, invalid } = await ctx.service.listExercises();
    if (!ctx.alive()) { ctx.dispose(); return; }
    if (seq !== library.loadSeq) return;
    library.exercises = new Map(docs.map(exercise => [exercise.id, exercise]));
    library.invalid = invalid;
    library.loaded = true;
    library.loadError = null;
  } catch (error) {
    if (!ctx.alive()) { ctx.dispose(); return; }
    if (seq !== library.loadSeq) return;
    console.error("Fitness Planner: loading exercises failed", error);
    library.loadError = `Exercises could not be loaded. ${errorMessage(error)}`;
  }
  library.loading = false;
  renderLibrary(ctx);
}

function renderLibrary(ctx) {
  if (!ctx.alive()) return;
  const library = ctx.library;
  const busy = isBusy(library);
  const ready = library.loaded && !library.loading && library.loadError === null;

  show(part(ctx, "library-loading"), library.loading);
  part(ctx, "library-error-message").textContent = library.loadError ?? "";
  show(part(ctx, "library-error"), !library.loading && library.loadError !== null);
  show(part(ctx, "library-content"), ready);
  part(ctx, "add").disabled = busy;

  const byName = [...library.exercises.values()].sort((a, b) => a.name.localeCompare(b.name));
  const active = byName.filter(exercise => !exercise.isArchived);
  const archived = byName.filter(exercise => exercise.isArchived);
  const item = exercise => exerciseItem(exercise, busy, library.syncing.has(exercise.id));

  part(ctx, "active-list").replaceChildren(...active.map(item));
  show(part(ctx, "active-empty"), active.length === 0);
  part(ctx, "archived-list").replaceChildren(...archived.map(item));
  show(part(ctx, "archived-section"), archived.length > 0);

  const count = library.invalid.length;
  part(ctx, "invalid-summary").textContent = count === 1
    ? "1 exercise record could not be read. It is not shown and has not been changed."
    : `${count} exercise records could not be read. They are not shown and have not been changed.`;
  part(ctx, "invalid-list").replaceChildren(...library.invalid.map(record =>
    element("li", "", `${record.id ?? "(unknown ID)"}: ${record.reason}`)));
  show(part(ctx, "invalid"), count > 0);

  // Routine summaries and the exercise picker show exercise names and archive state.
  renderRoutines(ctx);
}

function exerciseItem(exercise, busy, syncing) {
  const item = element("li", "fp-exercise");
  item.dataset.fpExerciseId = exercise.id;

  const body = element("div", "fp-exercise-body");
  const heading = element("div", "fp-exercise-heading");
  heading.append(element("span", "fp-exercise-name", exercise.name));
  if (exercise.isArchived) heading.append(element("span", "badge", "Archived"));
  if (syncing) heading.append(element("span", "fp-exercise-sync text-muted", "Saved on this device, syncing…"));
  body.append(heading, element("span", "fp-exercise-meta text-muted", describeExercise(exercise)));
  if (exercise.notes !== "") body.append(element("p", "fp-exercise-notes text-muted", exercise.notes));
  item.append(body);

  // O6: archived exercises are read-only, so they get no actions at all.
  if (!exercise.isArchived) {
    const buttons = element("div", "fp-exercise-actions");
    buttons.append(
      actionButton("edit-exercise", "Edit", exercise, busy),
      actionButton("archive-exercise", "Archive", exercise, busy)
    );
    item.append(buttons);
  }
  return item;
}

function actionButton(action, label, exercise, disabled) {
  const button = element("button", "btn-secondary btn-sm", label);
  button.type = "button";
  button.dataset.fpAction = action;
  button.dataset.fpId = exercise.id;
  button.setAttribute("aria-label", `${label} ${exercise.name}`);
  button.disabled = disabled;
  return button;
}

/* ---------- Notices and write states (§9.2) ---------- */

function setNotice(ctx, kind, message) {
  const notice = part(ctx, "notice");
  notice.textContent = message;
  notice.classList.toggle("fp-notice-error", kind === "error");
  show(notice, message !== "");
}

/**
 * Follows a write the service has applied locally. The UI is already updated;
 * `write` settles on server acknowledgement (pending while offline). On
 * rejection the change was not saved: report it, run `onFailure`, and reload.
 */
function followWrite(ctx, exercise, write, { saved, failed, onFailure }) {
  const library = ctx.library;
  const id = exercise.id;
  library.syncing.set(id, (library.syncing.get(id) ?? 0) + 1);
  renderLibrary(ctx);
  const settle = () => {
    const remaining = library.syncing.get(id) - 1;
    if (remaining > 0) library.syncing.set(id, remaining);
    else library.syncing.delete(id);
  };

  write.then(() => {
    if (!ctx.alive()) { ctx.dispose(); return; }
    settle();
    setNotice(ctx, "info", saved);
    renderLibrary(ctx);
  }, error => {
    console.error("Fitness Planner: exercise write failed", error);
    if (!ctx.alive()) { ctx.dispose(); return; }
    settle();
    setNotice(ctx, "error", `${failed} ${errorMessage(error)}`);
    onFailure?.();
    loadExercises(ctx);
  });
}

/* ---------- Reading one exercise for edit or archive ---------- */

/** Fresh read of an active exercise; null (with a notice) when it cannot be changed. */
async function readActiveExercise(ctx, id) {
  const library = ctx.library;
  const known = library.exercises.get(id);
  if (!known || known.isArchived || isBusy(library)) return null;

  library.reading = true;
  renderLibrary(ctx);
  let loaded;
  try {
    loaded = await ctx.service.getExercise(id);
  } catch (error) {
    if (!ctx.alive()) { ctx.dispose(); return null; }
    console.error("Fitness Planner: reading exercise failed", error);
    library.reading = false;
    setNotice(ctx, "error", `"${known.name}" could not be opened. ${errorMessage(error)}`);
    renderLibrary(ctx);
    return null;
  }
  if (!ctx.alive()) { ctx.dispose(); return null; }
  library.reading = false;

  if (loaded === null || loaded.invalid === true) {
    setNotice(ctx, "error", loaded === null
      ? `"${known.name}" no longer exists.`
      : `"${known.name}" could not be read, so it cannot be changed.`);
    loadExercises(ctx);
    return null;
  }
  library.exercises.set(id, loaded);
  if (loaded.isArchived) {
    setNotice(ctx, "error", `"${loaded.name}" is archived and is read-only.`);
    renderLibrary(ctx);
    return null;
  }
  return loaded;
}

/* ---------- Create and edit ---------- */

function field(ctx, name) {
  return ctx.root.querySelector(`[data-fp-field="${name}"]`);
}

function fieldError(ctx, name) {
  return ctx.root.querySelector(`[data-fp-field-error="${name}"]`);
}

function hasFormFields(ctx) {
  return FORM_FIELDS.every(name => field(ctx, name) !== null && fieldError(ctx, name) !== null);
}

function setUpExerciseForm(ctx) {
  const fill = (select, values, labels) => select.replaceChildren(...values.map(value => {
    const option = element("option", "", labelFor(labels, value));
    option.value = value;
    return option;
  }));
  fill(field(ctx, "trackingType"), Object.values(TrackingType), TRACKING_TYPE_LABELS);
  fill(field(ctx, "laterality"), Object.values(Laterality), LATERALITY_LABELS);
}

function openForm(ctx, form, draft = null) {
  const library = ctx.library;
  library.form = form;
  const source = draft ?? form.loaded ?? {
    name: "", trackingType: TrackingType.WEIGHT_AND_REPS, laterality: Laterality.BILATERAL, equipment: [], notes: ""
  };
  field(ctx, "name").value = source.name;
  field(ctx, "trackingType").value = source.trackingType;
  field(ctx, "laterality").value = source.laterality;
  field(ctx, "equipment").value = Array.isArray(source.equipment) ? source.equipment.join(", ") : source.equipment;
  field(ctx, "notes").value = source.notes;
  clearFormErrors(ctx);

  part(ctx, "form-title").textContent = form.mode === "create" ? "Add exercise" : `Edit "${form.loaded.name}"`;
  show(part(ctx, "form"), true);
  renderLibrary(ctx);
  field(ctx, "name").focus();
}

function closeForm(ctx) {
  ctx.library.form = null;
  clearFormErrors(ctx);
  show(part(ctx, "form"), false);
  renderLibrary(ctx);
}

function readFormValues(ctx) {
  return Object.fromEntries(FORM_FIELDS.map(name => [name, field(ctx, name).value]));
}

function clearFormErrors(ctx) {
  for (const name of FORM_FIELDS) {
    field(ctx, name).removeAttribute("aria-invalid");
    fieldError(ctx, name).textContent = "";
    show(fieldError(ctx, name), false);
  }
  part(ctx, "form-error").textContent = "";
  show(part(ctx, "form-error"), false);
}

/** Shows a save error next to its field when the ValidationError names a form field. */
function showFormError(ctx, error) {
  clearFormErrors(ctx);
  const name = error instanceof ValidationError ? String(error.field).split(/[.[]/)[0] : null;
  if (FORM_FIELDS.includes(name)) {
    field(ctx, name).setAttribute("aria-invalid", "true");
    fieldError(ctx, name).textContent = error.message;
    show(fieldError(ctx, name), true);
    field(ctx, name).focus();
  } else {
    part(ctx, "form-error").textContent = `The exercise was not saved. ${errorMessage(error)}`;
    show(part(ctx, "form-error"), true);
  }
}

async function beginEdit(ctx, id) {
  const loaded = await readActiveExercise(ctx, id);
  if (loaded) openForm(ctx, { mode: "edit", loaded });
}

function saveForm(ctx) {
  const library = ctx.library;
  const form = library.form;
  if (!form) return;

  const values = readFormValues(ctx);
  const exercise = exerciseFromForm(values, form.loaded);
  let result;
  try {
    result = ctx.service.saveExercise(exercise);
  } catch (error) {
    if (!(error instanceof ValidationError)) console.error("Fitness Planner: saving exercise failed", error);
    showFormError(ctx, error);
    return;
  }

  const saved = { ...exercise, id: result.id };
  library.exercises.set(saved.id, saved);
  closeForm(ctx);
  setNotice(ctx, "info", `"${saved.name}" saved on this device, syncing…`);
  followWrite(ctx, saved, result.write, {
    saved: `"${saved.name}" saved.`,
    failed: `"${saved.name}" was not saved.`,
    // Keep the entered values (§16): reopen the form unless something else is open.
    onFailure: () => { if (!isBusy(library)) openForm(ctx, form, values); }
  });
}

/* ---------- Archive (O6: confirmed, not reversible in this version) ---------- */

async function beginArchive(ctx, id) {
  const loaded = await readActiveExercise(ctx, id);
  if (!loaded) return;
  ctx.library.confirm = { exercise: loaded };
  part(ctx, "confirm-title").textContent = `Archive "${loaded.name}"?`;
  part(ctx, "confirm-error").textContent = "";
  show(part(ctx, "confirm-error"), false);
  show(part(ctx, "confirm"), true);
  renderLibrary(ctx);
  part(ctx, "confirm-cancel").focus();
}

function closeConfirm(ctx) {
  ctx.library.confirm = null;
  show(part(ctx, "confirm"), false);
  renderLibrary(ctx);
}

function confirmArchive(ctx) {
  const library = ctx.library;
  if (!library.confirm) return;

  const exercise = { ...library.confirm.exercise, isArchived: true };
  let result;
  try {
    result = ctx.service.saveExercise(exercise);
  } catch (error) {
    console.error("Fitness Planner: archiving exercise failed", error);
    part(ctx, "confirm-error").textContent = `The exercise was not archived. ${errorMessage(error)}`;
    show(part(ctx, "confirm-error"), true);
    return;
  }

  const archived = { ...exercise, id: result.id };
  library.exercises.set(archived.id, archived);
  closeConfirm(ctx);
  setNotice(ctx, "info", `"${archived.name}" archived on this device, syncing…`);
  followWrite(ctx, archived, result.write, {
    saved: `"${archived.name}" archived.`,
    failed: `"${archived.name}" was not archived.`
  });
}

/* ===============================
   ROUTINES (Task 5; design §6.4, §5.3, O6)
   A routine item is an occurrence of an exercise: its `occurrenceId` comes
   from the engine's createLocalId() when it is added and never changes after
   that. Reordering swaps `order` values, removing leaves the other items
   untouched, and saving spreads the loaded routine and each loaded item so
   `id`, `createdAt`, `isArchived`, and unknown fields are kept.
   O6: only active exercises are offered for new items. Existing items that
   reference an exercise archived later stay in the routine, labelled; the
   engine accepts them (validateRoutine only requires the exercise to exist).
================================ */

const TARGET_FIELDS = Object.freeze(["targetSets", "repMin", "repMax", "targetWeight", "restSeconds", "notes"]);

const TARGET_LABELS = Object.freeze({
  targetSets: "Sets",
  repMin: "Min reps",
  repMax: "Max reps",
  targetWeight: "Weight (kg)",
  restSeconds: "Rest (seconds)",
  notes: "Notes"
});

// Field names in engine messages → words for the user ("repMin must not exceed repMax.").
const MESSAGE_WORDS = Object.freeze({
  targetSets: "sets", repMin: "min reps", repMax: "max reps", targetWeight: "weight",
  restSeconds: "rest", notes: "notes", name: "name", exerciseId: "exercise"
});

const NUMBER_INPUTS = Object.freeze({
  targetSets: { inputmode: "numeric", min: "1", step: "1" },
  repMin: { inputmode: "numeric", min: "1", step: "1" },
  repMax: { inputmode: "numeric", min: "1", step: "1" },
  targetWeight: { inputmode: "decimal", min: "0", step: "any" },
  restSeconds: { inputmode: "numeric", min: "0", step: "1" }
});

function createRoutineState() {
  return {
    routines: new Map(), // id → valid routine, as last read or saved
    invalid: [],         // { id, invalid, reason } from listRoutines()
    loaded: false,
    loading: false,
    loadSeq: 0,
    loadError: null,
    opening: false,      // reads for the editor are in flight
    editor: null,        // { loaded, draft: { name, entries }, errors }
    syncing: new Map()   // id → number of writes not yet acknowledged
  };
}

function isRoutineBusy(state) {
  return state.loading || state.opening || state.editor !== null;
}

/* ---------- Pure helpers (exported for tests) ---------- */

const LOCAL_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Random source for createLocalId(): 12 characters of [a-z0-9], without modulo bias. */
export function randomLocalId() {
  let id = "";
  while (id.length < 12) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 252 && id.length < 12) id += LOCAL_ID_ALPHABET[byte % 36];
    }
  }
  return id;
}

const inputText = value => (value === null || value === undefined ? "" : String(value));

/** Blank → null (the engine rejects null where a value is required); otherwise Number(). */
function numberFromInput(text) {
  const trimmed = String(text).trim();
  return trimmed === "" ? null : Number(trimmed);
}

/** Editor entry for a stored item. `base` is the item as loaded, so unknown fields survive. */
export function entryFromItem(item) {
  return {
    occurrenceId: item.occurrenceId,
    exerciseId: item.exerciseId,
    order: item.order,
    base: item,
    values: Object.fromEntries(TARGET_FIELDS.map(name => [name, inputText(item[name])]))
  };
}

/** Draft for the editor: items sorted by `order`. */
export function draftFromRoutine(routine) {
  if (routine === null) return { name: "", entries: [] };
  return {
    name: routine.name,
    entries: [...routine.items].sort((a, b) => a.order - b.order).map(entryFromItem)
  };
}

/**
 * New occurrence of `exerciseId`: a fresh engine-built occurrenceId that no
 * entry uses, and an `order` after every existing one. Targets start blank;
 * the user enters them and the engine validates them on save.
 */
export function newEntry(exerciseId, entries, randomId = randomLocalId) {
  const taken = new Set(entries.map(entry => entry.occurrenceId));
  let occurrenceId = createLocalId(randomId);
  for (let attempt = 1; taken.has(occurrenceId); attempt += 1) {
    if (attempt >= 10) throw new Error("Could not generate a unique occurrenceId.");
    occurrenceId = createLocalId(randomId);
  }
  return {
    occurrenceId,
    exerciseId,
    order: entries.reduce((max, entry) => Math.max(max, entry.order + 1), 0),
    base: null,
    values: Object.fromEntries(TARGET_FIELDS.map(name => [name, ""]))
  };
}

/**
 * Moves the entry at `index` by `delta` (±1). The two entries swap positions
 * and `order` values; occurrence IDs, targets, and every other order stay as they were.
 */
export function moveEntry(entries, index, delta) {
  const other = index + delta;
  if (index < 0 || index >= entries.length || other < 0 || other >= entries.length) return entries;
  const next = [...entries];
  next[index] = { ...entries[other], order: entries[index].order };
  next[other] = { ...entries[index], order: entries[other].order };
  return next;
}

/**
 * Draft → routine for saveRoutine(). New routines get schemaVersion 1 and
 * isArchived false (no `id`; the service assigns it). Edits spread the loaded
 * routine; each existing item spreads its loaded item. The engine validates.
 */
export function routineFromEditor(draft, loaded = null) {
  const items = draft.entries.map(entry => ({
    ...(entry.base ?? {}),
    occurrenceId: entry.occurrenceId,
    exerciseId: entry.exerciseId,
    order: entry.order,
    targetSets: numberFromInput(entry.values.targetSets),
    repMin: numberFromInput(entry.values.repMin),
    repMax: numberFromInput(entry.values.repMax),
    targetWeight: numberFromInput(entry.values.targetWeight),
    restSeconds: numberFromInput(entry.values.restSeconds),
    notes: entry.values.notes
  }));
  const name = draft.name.trim();
  return loaded === null
    ? { schemaVersion: SCHEMA_VERSION, name, isArchived: false, items }
    : { ...loaded, name, items };
}

/** "3 × 8–12 · 60 kg · rest 90 s" */
export function describeTargets(item) {
  const reps = item.repMin === item.repMax ? `${item.repMin}` : `${item.repMin}–${item.repMax}`;
  const parts = [`${item.targetSets} × ${reps}`];
  if (item.targetWeight !== null) parts.push(`${item.targetWeight} kg`);
  if (item.restSeconds !== null) parts.push(`rest ${item.restSeconds} s`);
  return parts.join(" · ");
}

/** Exercise for a routine item, or a label saying why it cannot be shown. */
function resolveExercise(library, exerciseId) {
  const exercise = library.exercises.get(exerciseId);
  if (exercise) return { exercise, name: exercise.name, problem: null };
  if (!library.loaded) return { exercise: null, name: `Exercise ${exerciseId}`, problem: null };
  const unreadable = library.invalid.some(record => record.id === exerciseId);
  return {
    exercise: null,
    name: unreadable ? `Unreadable exercise (${exerciseId})` : `Missing exercise (${exerciseId})`,
    problem: unreadable ? "Unreadable" : "Missing"
  };
}

/** Engine message → user wording; drops the `items[i].` path prefix. */
function friendlyMessage(message) {
  const text = String(message)
    .replace(/items\[\d+\]\./g, "")
    .replace(/\b(targetSets|repMin|repMax|targetWeight|restSeconds|notes|name|exerciseId)\b/g, word => MESSAGE_WORDS[word]);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ---------- Routine library ---------- */

async function loadRoutines(ctx) {
  const state = ctx.routines;
  const seq = ++state.loadSeq;
  state.loading = true;
  renderRoutines(ctx);

  try {
    const { docs, invalid } = await ctx.service.listRoutines();
    if (!ctx.alive()) { ctx.dispose(); return; }
    if (seq !== state.loadSeq) return;
    state.routines = new Map(docs.map(routine => [routine.id, routine]));
    state.invalid = invalid;
    state.loaded = true;
    state.loadError = null;
  } catch (error) {
    if (!ctx.alive()) { ctx.dispose(); return; }
    if (seq !== state.loadSeq) return;
    console.error("Fitness Planner: loading routines failed", error);
    state.loadError = `Routines could not be loaded. ${errorMessage(error, ROUTINE_ERROR_MESSAGES)}`;
  }
  state.loading = false;
  renderRoutines(ctx);
}

function renderRoutines(ctx) {
  if (!ctx.alive()) return;
  const state = ctx.routines;
  const busy = isRoutineBusy(state);
  const ready = state.loaded && !state.loading && state.loadError === null;

  show(part(ctx, "routine-loading"), state.loading);
  part(ctx, "routine-error-message").textContent = state.loadError ?? "";
  show(part(ctx, "routine-error"), !state.loading && state.loadError !== null);
  show(part(ctx, "routine-content"), ready);
  part(ctx, "routine-add").disabled = busy;

  const byName = [...state.routines.values()].sort((a, b) => a.name.localeCompare(b.name));
  part(ctx, "routine-list").replaceChildren(...byName.map(routine =>
    routineItem(ctx, routine, busy, state.syncing.has(routine.id))));
  show(part(ctx, "routine-empty"), byName.length === 0);

  const count = state.invalid.length;
  part(ctx, "routine-invalid-summary").textContent = count === 1
    ? "1 routine record could not be read. It is not shown and has not been changed."
    : `${count} routine records could not be read. They are not shown and have not been changed.`;
  part(ctx, "routine-invalid-list").replaceChildren(...state.invalid.map(record =>
    element("li", "", `${record.id ?? "(unknown ID)"}: ${record.reason}`)));
  show(part(ctx, "routine-invalid"), count > 0);

  renderPicker(ctx);
}

function routineItem(ctx, routine, busy, syncing) {
  const item = element("li", "fp-routine");
  item.dataset.fpRoutineId = routine.id;

  const body = element("div", "fp-exercise-body");
  const heading = element("div", "fp-exercise-heading");
  heading.append(element("span", "fp-routine-name", routine.name));
  if (routine.isArchived) heading.append(element("span", "badge", "Archived"));
  if (syncing) heading.append(element("span", "fp-routine-sync text-muted", "Saved on this device, syncing…"));
  const count = routine.items.length;
  body.append(heading, element("span", "fp-routine-meta text-muted",
    count === 0 ? "No exercises" : count === 1 ? "1 exercise" : `${count} exercises`));

  if (count > 0) {
    const list = element("ol", "fp-routine-items");
    for (const routineItemEntry of [...routine.items].sort((a, b) => a.order - b.order)) {
      const { exercise, name, problem } = resolveExercise(ctx.library, routineItemEntry.exerciseId);
      const line = element("li", "fp-routine-item");
      line.dataset.fpOccurrenceId = routineItemEntry.occurrenceId;
      line.append(element("span", "fp-routine-item-name", name));
      if (exercise?.isArchived) line.append(" ", element("span", "badge", "Archived exercise"));
      if (problem) line.append(" ", element("span", "badge fp-badge-warning", problem));
      line.append(element("span", "fp-routine-item-targets text-muted", ` — ${describeTargets(routineItemEntry)}`));
      list.append(line);
    }
    body.append(list);
  }
  item.append(body);

  const buttons = element("div", "fp-exercise-actions");
  buttons.append(actionButton("edit-routine", "Edit", routine, busy));
  item.append(buttons);
  return item;
}

function setRoutineNotice(ctx, kind, message) {
  const notice = part(ctx, "routine-notice");
  notice.textContent = message;
  notice.classList.toggle("fp-notice-error", kind === "error");
  show(notice, message !== "");
}

/* ---------- Opening the editor ---------- */

/**
 * `id === null` creates a routine. Editing starts from a fresh getRoutine()
 * so the save carries `createdAt` and unknown fields. Both paths reload the
 * exercise library first, so the picker and the references are current.
 */
async function openRoutineEditor(ctx, id) {
  const state = ctx.routines;
  if (isRoutineBusy(state)) return;
  const known = id === null ? null : state.routines.get(id);
  if (id !== null && !known) return;

  state.opening = true;
  renderRoutines(ctx);
  let loaded = null;
  try {
    [loaded] = await Promise.all([id === null ? null : ctx.service.getRoutine(id), loadExercises(ctx)]);
  } catch (error) {
    if (!ctx.alive()) { ctx.dispose(); return; }
    console.error("Fitness Planner: reading routine failed", error);
    state.opening = false;
    setRoutineNotice(ctx, "error", `"${known.name}" could not be opened. ${errorMessage(error, ROUTINE_ERROR_MESSAGES)}`);
    renderRoutines(ctx);
    return;
  }
  if (!ctx.alive()) { ctx.dispose(); return; }
  state.opening = false;

  if (id !== null && (loaded === null || loaded.invalid === true)) {
    setRoutineNotice(ctx, "error", loaded === null
      ? `"${known.name}" no longer exists.`
      : `"${known.name}" could not be read, so it cannot be changed.`);
    loadRoutines(ctx);
    return;
  }
  const library = ctx.library;
  if (!library.loaded || library.loadError !== null) {
    setRoutineNotice(ctx, "error", "Exercises could not be loaded, so routines cannot be edited. Retry in the exercise library.");
    renderRoutines(ctx);
    return;
  }
  if (loaded !== null) state.routines.set(id, loaded);
  showRoutineEditor(ctx, { loaded, draft: draftFromRoutine(loaded) });
}

function emptyRoutineErrors() {
  return { name: null, form: null, occurrences: {} };
}

function showRoutineEditor(ctx, { loaded, draft }, errors = emptyRoutineErrors()) {
  ctx.routines.editor = { loaded, draft, errors };
  part(ctx, "routine-name").value = draft.name;
  part(ctx, "routine-form-title").textContent = loaded === null ? "Add routine" : `Edit "${loaded.name}"`;
  part(ctx, "occurrence-list").replaceChildren();
  renderRoutineEditor(ctx, { sync: false });
  show(part(ctx, "routine-form"), true);
  renderRoutines(ctx);
  part(ctx, "routine-name").focus();
}

function closeRoutineEditor(ctx) {
  ctx.routines.editor = null;
  part(ctx, "occurrence-list").replaceChildren();
  part(ctx, "routine-name").value = "";
  part(ctx, "routine-name").removeAttribute("aria-invalid");
  show(part(ctx, "routine-name-error"), false);
  show(part(ctx, "routine-form-error"), false);
  show(part(ctx, "routine-form"), false);
  renderRoutines(ctx);
}

/* ---------- Editor rendering ---------- */

function occurrenceRow(ctx, occurrenceId) {
  return part(ctx, "occurrence-list").querySelector(`[data-fp-occurrence-id="${occurrenceId}"]`);
}

/** Copies the editor inputs into the draft, so a re-render never loses typed values. */
function syncDraft(ctx) {
  const editor = ctx.routines.editor;
  if (!editor) return;
  editor.draft.name = part(ctx, "routine-name").value;
  for (const entry of editor.draft.entries) {
    const row = occurrenceRow(ctx, entry.occurrenceId);
    if (!row) continue;
    for (const name of TARGET_FIELDS) {
      const input = row.querySelector(`[data-fp-target="${name}"]`);
      if (input) entry.values[name] = input.value;
    }
  }
}

function renderRoutineEditor(ctx, { sync = true } = {}) {
  const editor = ctx.routines.editor;
  if (!editor || !ctx.alive()) return;
  if (sync) syncDraft(ctx);
  const { draft, errors } = editor;
  const count = draft.entries.length;

  part(ctx, "occurrence-list").replaceChildren(...draft.entries.map((entry, index) =>
    occurrenceEditor(ctx, entry, index, count, errors.occurrences[entry.occurrenceId] ?? null)));
  show(part(ctx, "occurrence-empty"), count === 0);

  const name = part(ctx, "routine-name");
  if (errors.name) name.setAttribute("aria-invalid", "true");
  else name.removeAttribute("aria-invalid");
  part(ctx, "routine-name-error").textContent = errors.name ?? "";
  show(part(ctx, "routine-name-error"), errors.name !== null);
  part(ctx, "routine-form-error").textContent = errors.form ?? "";
  show(part(ctx, "routine-form-error"), errors.form !== null);

  renderPicker(ctx);
}

function occurrenceEditor(ctx, entry, index, count, error) {
  const { exercise, name, problem } = resolveExercise(ctx.library, entry.exerciseId);
  const id = entry.occurrenceId;
  const row = element("li", "fp-occurrence");
  row.dataset.fpOccurrenceId = id;

  const header = element("div", "fp-occurrence-header");
  const body = element("div", "fp-exercise-body");
  const heading = element("div", "fp-exercise-heading");
  heading.append(element("span", "fp-exercise-name", name));
  if (exercise?.isArchived) heading.append(element("span", "badge", "Archived exercise"));
  if (problem) heading.append(element("span", "badge fp-badge-warning", problem));
  body.append(heading);
  if (exercise) body.append(element("span", "fp-exercise-meta text-muted", describeExercise(exercise)));
  header.append(body);

  const label = `${name} (position ${index + 1})`;
  const buttons = element("div", "fp-exercise-actions");
  buttons.append(
    occurrenceButton("move-occurrence-up", "Up", `Move ${label} up`, id, index === 0),
    occurrenceButton("move-occurrence-down", "Down", `Move ${label} down`, id, index === count - 1),
    occurrenceButton("remove-occurrence", "Remove", `Remove ${label}`, id, false)
  );
  header.append(buttons);
  row.append(header);

  // REPS_ONLY items carry no weight (§6.4). A stored weight is still shown so it can be cleared.
  const repsOnly = exercise?.trackingType === TrackingType.REPS_ONLY;
  const showWeight = !repsOnly || entry.values.targetWeight.trim() !== "";
  const targets = element("div", "fp-targets");
  for (const field of TARGET_FIELDS) {
    if (field === "targetWeight" && !showWeight) continue;
    targets.append(targetInput(entry, field, error?.field === field));
  }
  row.append(targets);

  if (repsOnly && showWeight) {
    row.append(element("p", "fp-occurrence-note text-muted", "Reps-only exercises have no target weight. Clear the weight to save."));
  }
  if (exercise?.isArchived) {
    row.append(element("p", "fp-occurrence-note text-muted", "This exercise is archived. It stays in this routine, but it cannot be added again."));
  }
  if (problem) {
    row.append(element("p", "fp-occurrence-note fp-form-error",
      "This exercise is not in your exercise library, so the routine cannot be saved while it is here. Remove it to save."));
  }
  const message = element("p", "fp-field-error", error?.message ?? "");
  message.dataset.fpOccurrenceError = "";
  show(message, error !== null);
  row.append(message);
  return row;
}

function targetInput(entry, field, invalid) {
  const wrapper = element("div", "fp-target");
  const inputId = `fp-occurrence-${entry.occurrenceId}-${field}`;
  const label = element("label", "", TARGET_LABELS[field]);
  label.setAttribute("for", inputId);

  const input = element("input");
  input.setAttribute("id", inputId);
  input.setAttribute("autocomplete", "off");
  const numeric = NUMBER_INPUTS[field];
  if (numeric) {
    input.type = "number";
    for (const [name, value] of Object.entries(numeric)) input.setAttribute(name, value);
  } else {
    input.type = "text";
  }
  input.dataset.fpTarget = field;
  input.value = entry.values[field];
  if (invalid) input.setAttribute("aria-invalid", "true");
  wrapper.append(label, input);
  return wrapper;
}

function occurrenceButton(action, text, ariaLabel, occurrenceId, disabled) {
  const button = element("button", "btn-secondary btn-sm", text);
  button.type = "button";
  button.dataset.fpAction = action;
  button.dataset.fpId = occurrenceId;
  button.setAttribute("aria-label", ariaLabel);
  button.disabled = disabled;
  return button;
}

/** Active exercises only (O6). Keeps the current selection when it is still offered. */
function renderPicker(ctx) {
  if (!ctx.routines.editor) return;
  const select = part(ctx, "picker-select");
  const previous = select.value;
  const active = [...ctx.library.exercises.values()]
    .filter(exercise => !exercise.isArchived)
    .sort((a, b) => a.name.localeCompare(b.name));
  select.replaceChildren(...active.map(exercise => {
    const option = element("option", "", `${exercise.name} (${labelFor(TRACKING_TYPE_LABELS, exercise.trackingType)})`);
    option.value = exercise.id;
    return option;
  }));
  if (active.some(exercise => exercise.id === previous)) select.value = previous;
  show(part(ctx, "picker"), active.length > 0);
  show(part(ctx, "picker-empty"), active.length === 0);
}

/* ---------- Editing occurrences ---------- */

function addOccurrence(ctx) {
  const editor = ctx.routines.editor;
  if (!editor) return;
  const exercise = ctx.library.exercises.get(part(ctx, "picker-select").value);
  if (!exercise || exercise.isArchived) return; // O6: never a new item for an archived exercise
  syncDraft(ctx);
  const entry = newEntry(exercise.id, editor.draft.entries);
  editor.draft.entries = [...editor.draft.entries, entry];
  renderRoutineEditor(ctx, { sync: false });
  occurrenceRow(ctx, entry.occurrenceId)?.querySelector("[data-fp-target]")?.focus();
}

function moveOccurrence(ctx, occurrenceId, delta) {
  const editor = ctx.routines.editor;
  if (!editor) return;
  const index = editor.draft.entries.findIndex(entry => entry.occurrenceId === occurrenceId);
  if (index === -1) return;
  syncDraft(ctx);
  editor.draft.entries = moveEntry(editor.draft.entries, index, delta);
  renderRoutineEditor(ctx, { sync: false });
  const row = occurrenceRow(ctx, occurrenceId);
  const same = row?.querySelector(`[data-fp-action="${delta < 0 ? "move-occurrence-up" : "move-occurrence-down"}"]`);
  const other = row?.querySelector(`[data-fp-action="${delta < 0 ? "move-occurrence-down" : "move-occurrence-up"}"]`);
  (same && !same.disabled ? same : other)?.focus();
}

function removeOccurrence(ctx, occurrenceId) {
  const editor = ctx.routines.editor;
  if (!editor) return;
  syncDraft(ctx);
  editor.draft.entries = editor.draft.entries.filter(entry => entry.occurrenceId !== occurrenceId);
  const { [occurrenceId]: _removed, ...remaining } = editor.errors.occurrences;
  editor.errors.occurrences = remaining;
  renderRoutineEditor(ctx, { sync: false });
  part(ctx, "routine-name").focus();
}

/* ---------- Saving ---------- */

/** Places a save error next to the routine name, an occurrence, or on the form. */
function routineErrors(error, routine) {
  const errors = emptyRoutineErrors();
  if (!(error instanceof ValidationError)) {
    errors.form = `The routine was not saved. ${errorMessage(error, ROUTINE_ERROR_MESSAGES)}`;
    return errors;
  }
  const fieldPath = String(error.field);
  const match = /^items\[(\d+)\](?:\.(\w+))?/.exec(fieldPath);
  const item = match ? routine.items[Number(match[1])] : undefined;
  if (item && typeof item === "object") {
    errors.occurrences[item.occurrenceId] = { field: match[2] ?? null, message: friendlyMessage(error.message) };
  } else if (fieldPath === "name") {
    errors.name = friendlyMessage(error.message);
  } else {
    errors.form = `The routine was not saved. ${friendlyMessage(error.message)}`;
  }
  return errors;
}

function focusFirstError(ctx) {
  const invalid = ctx.root.querySelector("[data-fp-routine-form] [aria-invalid=\"true\"]");
  if (invalid) { invalid.focus(); return; }
  const editor = ctx.routines.editor;
  const occurrenceId = Object.keys(editor?.errors.occurrences ?? {})[0];
  (occurrenceId ? occurrenceRow(ctx, occurrenceId)?.querySelector("[data-fp-target]") : null)?.focus();
}

function saveRoutineForm(ctx) {
  const state = ctx.routines;
  const editor = state.editor;
  if (!editor) return;
  syncDraft(ctx);

  // O6: an item added in this edit must not reference an exercise archived since.
  const archivedNew = editor.draft.entries.find(entry =>
    entry.base === null && ctx.library.exercises.get(entry.exerciseId)?.isArchived === true);
  if (archivedNew) {
    editor.errors = emptyRoutineErrors();
    editor.errors.occurrences[archivedNew.occurrenceId] = {
      field: null,
      message: "This exercise was archived after you added it, so it cannot be added. Remove it to save."
    };
    renderRoutineEditor(ctx, { sync: false });
    focusFirstError(ctx);
    return;
  }

  const routine = routineFromEditor(editor.draft, editor.loaded);
  // Archived exercises stay resolvable: existing items may reference them (§6.3).
  const exercisesById = Object.fromEntries(ctx.library.exercises);
  let result;
  try {
    result = ctx.service.saveRoutine(routine, exercisesById);
  } catch (error) {
    if (!(error instanceof ValidationError)) console.error("Fitness Planner: saving routine failed", error);
    editor.errors = routineErrors(error, routine);
    renderRoutineEditor(ctx, { sync: false });
    focusFirstError(ctx);
    return;
  }

  const saved = { ...routine, id: result.id };
  state.routines.set(saved.id, saved);
  const reopen = { loaded: editor.loaded, draft: editor.draft };
  closeRoutineEditor(ctx);
  setRoutineNotice(ctx, "info", `"${saved.name}" saved on this device, syncing…`);
  followRoutineWrite(ctx, saved, result.write, reopen);
}

/**
 * §9.2: the UI is already updated; `write` settles on server acknowledgement.
 * A rejection means the routine was not saved: report it, reopen the editor
 * with the user's draft when no other editor is open, and reload.
 */
function followRoutineWrite(ctx, routine, write, reopen) {
  const state = ctx.routines;
  const id = routine.id;
  state.syncing.set(id, (state.syncing.get(id) ?? 0) + 1);
  renderRoutines(ctx);
  const settleWrite = () => {
    const remaining = state.syncing.get(id) - 1;
    if (remaining > 0) state.syncing.set(id, remaining);
    else state.syncing.delete(id);
  };

  write.then(() => {
    if (!ctx.alive()) { ctx.dispose(); return; }
    settleWrite();
    setRoutineNotice(ctx, "info", `"${routine.name}" saved.`);
    renderRoutines(ctx);
  }, error => {
    console.error("Fitness Planner: routine write failed", error);
    if (!ctx.alive()) { ctx.dispose(); return; }
    settleWrite();
    const message = `"${routine.name}" was not saved. ${errorMessage(error, ROUTINE_ERROR_MESSAGES)}`;
    setRoutineNotice(ctx, "error", message);
    if (state.editor === null && !state.opening) {
      showRoutineEditor(ctx, reopen, { ...emptyRoutineErrors(), form: message });
    }
    loadRoutines(ctx);
  });
}
