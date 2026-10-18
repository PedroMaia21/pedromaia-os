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
import { SCHEMA_VERSION, TrackingType, Laterality, ValidationError } from "./fitnessPlanner.engine.js";

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
  current = ctx;

  bindEvents(ctx);
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

  await loadExercises(ctx);
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
  "cancel-archive": ctx => closeConfirm(ctx)
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
  }, { signal: ctx.abort.signal });
}

/* ===============================
   RENDERING
   Static markup lives in fitnessPlanner.html; dynamic text uses textContent (§4.7).
================================ */

function part(ctx, name) {
  return ctx.root.querySelector(`[data-fp-${name}]`);
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

function errorMessage(error) {
  const category = classifyError(error);
  if (category === ErrorCategory.VALIDATION) return error.message;
  return ERROR_MESSAGES[category] ?? ERROR_MESSAGES[ErrorCategory.UNKNOWN];
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
