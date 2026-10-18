// /modules/fitnessPlanner/fitnessPlanner.js
//
// UI controller for the Fitness Planner (technical design v1.1, §4.3, §4.6).
// The router injects fitnessPlanner.html into #content and calls init() on
// every visit; it never tears modules down and the ES module stays cached.
// So the only module-level state is `current`, the active context, and every
// listener and subscription belongs to that context.

import { auth, db } from "../../js/firebase.js";
import { getCurrentUser } from "../../js/auth.js";
import { createFitnessService } from "./fitnessPlanner.service.js";

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
  current = ctx;

  bindEvents(ctx);
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
  }
}

/* ===============================
   EVENTS
   One delegated listener on the root (§4.6 rule 5). Fitness markup uses
   data-fp-action, never data-route (rule 6).
================================ */

const actions = {
  retry: () => init()
};

function bindEvents(ctx) {
  ctx.root.addEventListener("click", event => {
    if (!ctx.alive()) { ctx.dispose(); return; }
    const target = event.target.closest?.("[data-fp-action]");
    if (!target || !ctx.root.contains(target)) return;
    const name = target.dataset.fpAction;
    if (Object.hasOwn(actions, name)) actions[name](ctx, target);
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
