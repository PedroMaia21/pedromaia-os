// Module foundation (Task 4): static checks on the module files, and lifecycle
// tests of fitnessPlanner.js run in Node. Browser-only imports and the DOM are
// provided by module-harness.mjs (import hooks plus a minimal DOM built from
// the real fitnessPlanner.html).
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MODULE_DIR, harness, setUp, mountModule, navigateAway, settle, click, isShown
} from "./module-harness.mjs";

const read = name => readFile(new URL(name, MODULE_DIR), "utf8");
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const controller = await import(new URL("fitnessPlanner.js", MODULE_DIR));

const parts = root => ({
  status: root.querySelector("[data-fp-status]"),
  error: root.querySelector("[data-fp-error]"),
  errorMessage: root.querySelector("[data-fp-error-message]"),
  main: root.querySelector("[data-fp-main]")
});

/** Live listeners on the root, per event type. */
const listeners = root => ({ click: root.listenerCount("click"), submit: root.listenerCount("submit") });
const ONE_EACH = { click: 1, submit: 1 };
const NONE = { click: 0, submit: 0 };

/* ---------- Static checks ---------- */

describe("module files (static)", () => {
  it("HTML has one .fp root, links the module stylesheet first, and has no data-route", async () => {
    const html = await read("fitnessPlanner.html");
    assert.match(html.trimStart(), /^<link rel="stylesheet" href="\/modules\/fitnessPlanner\/fitnessPlanner\.css">/);
    assert.equal(html.match(/class="fp"/g)?.length, 1);
    assert.match(html, /<div id="fitness-planner" class="fp">/);
    assert.doesNotMatch(html, /data-route/);
    assert.doesNotMatch(html, /<script|<main|\son[a-z]+=|\sstyle=/i, "no scripts, nested <main>, inline handlers, or inline styles");
  });

  it("every HTML hook the controller queries exists in the markup", async () => {
    const [html, js] = await Promise.all([read("fitnessPlanner.html"), read("fitnessPlanner.js")]);
    const queried = [...js.matchAll(/part\(ctx, "([a-z-]+)"\)/g)].map(m => m[1]);
    assert.ok(queried.length > 0);
    for (const name of new Set(queried)) assert.match(html, new RegExp(`\\sdata-fp-${name}[\\s>]`), name);
    const actions = [...html.matchAll(/data-fp-action="([a-z-]+)"/g)].map(m => m[1]);
    for (const name of actions) assert.match(js, new RegExp(`(\\b|")${name}"?:`), `action ${name} has a handler`);
  });

  it("CSS scopes every selector under .fp", async () => {
    const css = (await read("fitnessPlanner.css")).replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].flatMap(m => m[1].split(",")).map(s => s.trim());
    assert.ok(selectors.length > 0);
    for (const selector of selectors) assert.match(selector, /^\.fp(?![\w-])/, selector);
  });

  it("controller uses only shared Firebase objects and the Task 3 service", async () => {
    const js = stripComments(await read("fitnessPlanner.js"));
    assert.match(js, /import \{ auth, db \} from "\.\.\/\.\.\/js\/firebase\.js";/);
    assert.match(js, /import \{ getCurrentUser \} from "\.\.\/\.\.\/js\/auth\.js";/);
    assert.match(js, /import \{ createFitnessService\b[^}]*\} from "\.\/fitnessPlanner\.service\.js";/);
    assert.match(js, /createFitnessService\(\{ db, uid \}\)/);
    assert.doesNotMatch(js, /initializeApp|getFirestore|initializeFirestore|gstatic|firebasejs\/(?!10\.12\.2)/);
    assert.equal(js.match(/getCurrentUser\(\)/g)?.length, 1, "user resolved in one place");
    assert.match(js, /^export async function init\(\)/m);
  });

  it("controller has one module-level mutable binding and no unowned listeners", async () => {
    const js = stripComments(await read("fitnessPlanner.js"));
    assert.deepEqual([...js.matchAll(/^let\s+(\w+)/gm)].map(m => m[1]), ["current"]);
    assert.doesNotMatch(js, /^var\s/m);
    assert.doesNotMatch(js, /\b(document|window)\.addEventListener|setInterval|setTimeout|onSnapshot|innerHTML/);
    const calls = js.match(/\.addEventListener\(/g) ?? [];
    const owned = js.match(/\.addEventListener\([\s\S]*?\{ signal: ctx\.abort\.signal \}\)/g) ?? [];
    assert.equal(owned.length, calls.length, "every addEventListener passes ctx.abort.signal");
  });

  it("no Fitness Planner file other than the service imports the Firestore SDK", async () => {
    for (const name of ["fitnessPlanner.js", "fitnessPlanner.engine.js"]) {
      assert.doesNotMatch(stripComments(await read(name)), /firebase-firestore|firebase-app/, name);
    }
  });

  it("sidebar has exactly one Fitness Planner route button", async () => {
    const index = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
    assert.equal(index.match(/data-route="fitnessPlanner"/g)?.length, 1);
  });
});

/* ---------- Lifecycle ---------- */

describe("module context", () => {
  it("dispose aborts listeners, calls every unsubscriber once, and is idempotent", () => {
    const ctx = controller.createContext(mountModule());
    const calls = [];
    ctx.track(() => calls.push("a"));
    ctx.track(() => { calls.push("b"); throw new Error("boom"); });
    ctx.track(() => calls.push("c"));
    assert.equal(ctx.alive(), true);

    const originalError = console.error;
    console.error = () => {};
    try { ctx.dispose(); ctx.dispose(); } finally { console.error = originalError; }

    assert.deepEqual(calls, ["a", "b", "c"], "a throwing unsubscriber does not stop the others");
    assert.equal(ctx.abort.signal.aborted, true);
    assert.equal(ctx.unsubscribers.length, 0);
    assert.equal(ctx.alive(), false);
  });

  it("track after dispose releases the subscription immediately", () => {
    const ctx = controller.createContext(mountModule());
    ctx.dispose();
    let released = 0;
    ctx.track(() => { released += 1; });
    assert.equal(released, 1);
    assert.equal(ctx.unsubscribers.length, 0);
  });

  it("alive() is false once the root leaves the document", () => {
    const ctx = controller.createContext(mountModule());
    navigateAway();
    assert.equal(ctx.alive(), false);
  });
});

describe("init()", () => {
  beforeEach(() => setUp());

  it("binds one owned listener, creates the service with { db, uid }, and renders the shell", async () => {
    const root = mountModule();
    await controller.init();
    assert.deepEqual(listeners(root), ONE_EACH, "one owned listener per event type");
    assert.deepEqual(harness.serviceCalls, [{ db: harness.db, uid: "user-a" }]);
    assert.equal(harness.serviceCalls[0].db, harness.db, "shared db instance");
    assert.equal(harness.authListenerCount, 0, "auth.currentUser is preferred; no auth listener added");
    assert.deepEqual(harness.firestoreCalls, [], "the module makes no Firestore calls of its own");
    const { status, error, main } = parts(root);
    assert.equal(isShown(main), true);
    assert.equal(isShown(status), false);
    assert.equal(isShown(error), false);
  });

  it("repeated navigation disposes the previous context and never accumulates listeners", async () => {
    const roots = [mountModule()];
    await controller.init();
    for (let visit = 0; visit < 5; visit += 1) {
      navigateAway();
      roots.push(mountModule());
      await controller.init();
    }
    roots.slice(0, -1).forEach(root => assert.deepEqual(listeners(root), NONE));
    assert.deepEqual(listeners(roots.at(-1)), ONE_EACH);
    assert.equal(harness.serviceCalls.length, 6, "one service per initialization");
  });

  it("re-init on the same root (no navigation) still leaves exactly one listener", async () => {
    const root = mountModule();
    await controller.init();
    await controller.init();
    await controller.init();
    assert.deepEqual(listeners(root), ONE_EACH);
  });

  it("falls back to getCurrentUser() once when auth.currentUser is not populated", async () => {
    setUp({ currentUser: null, authStateUser: { uid: "user-b" } });
    const root = mountModule();
    await controller.init();
    assert.equal(harness.authListenerCount, 1);
    assert.deepEqual(harness.serviceCalls, [{ db: harness.db, uid: "user-b" }]);
    assert.equal(isShown(parts(root).main), true);
  });

  it("renders an error state and creates no service when no user is available", async () => {
    setUp({ currentUser: null, authStateUser: null });
    const root = mountModule();
    await controller.init();
    const { error, main, errorMessage } = parts(root);
    assert.deepEqual(harness.serviceCalls, []);
    assert.equal(isShown(error), true);
    assert.equal(isShown(main), false);
    assert.match(errorMessage.textContent, /signed in/);
  });

  it("navigating away while the user resolves disposes the context without rendering", async () => {
    setUp({ currentUser: null, authStateUser: { uid: "user-b" } });
    const root = mountModule();
    const pending = controller.init();
    navigateAway();
    await pending;
    assert.deepEqual(listeners(root), NONE);
    assert.deepEqual(harness.serviceCalls, []);
    assert.equal(isShown(parts(root).main), false);
  });

  it("a service failure renders the error state instead of rejecting", async () => {
    setUp({ currentUser: { uid: "service-throws" } });
    const root = mountModule();
    const originalError = console.error;
    console.error = () => {};
    try {
      await controller.init();
    } finally {
      console.error = originalError;
    }
    const { error, main, errorMessage } = parts(root);
    assert.equal(isShown(error), true);
    assert.equal(isShown(main), false);
    assert.match(errorMessage.textContent, /could not be loaded/);
  });

  it("retry re-initializes; unknown and prototype actions are ignored", async () => {
    setUp({ currentUser: null, authStateUser: null });
    const root = mountModule();
    await controller.init();
    assert.equal(isShown(parts(root).error), true);

    harness.auth.currentUser = { uid: "user-a" };
    click(root.querySelector('[data-fp-action="retry"]'));
    await settle();
    assert.equal(isShown(parts(root).main), true);
    assert.deepEqual(listeners(root), ONE_EACH);

    for (const action of ["constructor", "does-not-exist"]) {
      const button = document.createElement("button");
      button.dataset.fpAction = action;
      root.append(button);
      click(button);
    }
    await settle();
    assert.equal(harness.serviceCalls.length, 1);
  });

  it("the real service module loads against the pinned Firestore SDK and accepts the shared db", async () => {
    const { createFitnessService } = await import(new URL("fitnessPlanner.service.js", MODULE_DIR));
    const service = createFitnessService({ db: harness.db, uid: "user-a" });
    assert.equal(service.uid, "user-a");
    assert.equal(typeof service.subscribeActiveWorkoutSessions, "function");
    assert.deepEqual(harness.firestoreCalls, [], "creating the service touches no Firestore API");
    assert.throws(() => createFitnessService({ db: harness.db, uid: "bad/uid" }), { code: "VALIDATION" });
  });
});
