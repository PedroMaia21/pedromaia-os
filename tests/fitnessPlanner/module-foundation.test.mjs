// Module foundation (Task 4): static checks on the module files, and lifecycle
// tests of fitnessPlanner.js run in Node. Browser-only imports (Firebase CDN,
// shared firebase.js, the service) are replaced with in-memory stubs through
// node:module hooks, and the DOM is a minimal hand-written fake.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

const MODULE_DIR = new URL("../../public/modules/fitnessPlanner/", import.meta.url);
const read = name => readFile(new URL(name, MODULE_DIR), "utf8");
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ---------- Stubs ---------- */

const stubs = {
  firebase: `
    export const db = globalThis.__fp.db;
    export const auth = {
      get currentUser() { return globalThis.__fp.auth.currentUser; },
      onAuthStateChanged: callback => globalThis.__fp.auth.onAuthStateChanged(callback)
    };
    export const googleProvider = {};`,
  firebaseAuth: `
    export const signInWithEmailAndPassword = () => {};
    export const createUserWithEmailAndPassword = () => {};
    export const signInWithPopup = () => {};`,
  service: `
    export function createFitnessService(args) {
      if (args.uid === "service-throws") throw new Error("service failure");
      globalThis.__fp.serviceCalls.push(args);
      return Object.freeze({ uid: args.uid });
    }`,
  // Every Firestore function records the call, so tests can assert init makes none.
  firestore: ["collection", "doc", "getDoc", "getDocs", "getDocFromServer", "getDocsFromServer",
    "setDoc", "updateDoc", "deleteDoc", "writeBatch", "query", "where", "orderBy", "limit",
    "startAfter", "onSnapshot", "serverTimestamp"]
    .map(name => `export function ${name}() { globalThis.__fp.firestoreCalls.push("${name}"); }`)
    .join("\n") + "\nexport class Timestamp {}"
};
const dataUrl = source => `data:text/javascript,${encodeURIComponent(source)}`;
const CDN = "https://www.gstatic.com/firebasejs/10.12.2/";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === `${CDN}firebase-firestore.js`) return { url: dataUrl(stubs.firestore), shortCircuit: true };
    if (specifier === `${CDN}firebase-auth.js`) return { url: dataUrl(stubs.firebaseAuth), shortCircuit: true };
    const resolved = nextResolve(specifier, context);
    if (resolved.url.endsWith("/public/js/firebase.js")) return { url: dataUrl(stubs.firebase), shortCircuit: true };
    if (resolved.url.endsWith("/fitnessPlanner/fitnessPlanner.service.js") && globalThis.__fp.stubService) {
      return { url: dataUrl(stubs.service), shortCircuit: true };
    }
    return resolved;
  }
});

/* ---------- Fake DOM ---------- */

function fakePart() {
  const classes = new Set(["hidden"]);
  return {
    textContent: "",
    classList: {
      toggle(name, force) { force ? classes.add(name) : classes.delete(name); },
      contains: name => classes.has(name)
    }
  };
}

/** A root element with the parts the controller queries; tracks live listeners. */
function fakeRoot() {
  const parts = Object.fromEntries(["status", "error", "error-message", "main"].map(name => [name, fakePart()]));
  const listeners = new Set();
  const root = {
    isConnected: true,
    parts,
    listeners,
    querySelector(selector) {
      const match = /^\[data-fp-([a-z-]+)\]$/.exec(selector);
      return match ? parts[match[1]] ?? null : null;
    },
    contains: node => node.owner === root,
    addEventListener(type, handler, options) {
      assert.ok(options?.signal, "every listener must use the context signal");
      const entry = { type, handler };
      listeners.add(entry);
      options.signal.addEventListener("abort", () => listeners.delete(entry), { once: true });
    },
    click(action) {
      const button = { owner: root, dataset: { fpAction: action } };
      button.closest = () => button;
      for (const { type, handler } of [...listeners]) if (type === "click") handler({ target: button });
    }
  };
  return root;
}

const visible = part => !part.classList.contains("hidden");

function setUp({ currentUser = { uid: "user-a" }, authStateUser = currentUser } = {}) {
  const state = {
    auth: {
      currentUser,
      onAuthStateChanged(callback) {
        globalThis.__fp.authListenerCount += 1;
        queueMicrotask(() => callback(authStateUser));
        return () => {};
      }
    },
    authListenerCount: 0,
    serviceCalls: [],
    firestoreCalls: [],
    stubService: true,
    root: fakeRoot()
  };
  Object.assign(globalThis.__fp, state);
  return globalThis.__fp;
}

globalThis.__fp = { db: { name: "shared-db" }, stubService: true };
globalThis.document = { getElementById: id => (id === "fitness-planner" ? globalThis.__fp.root : null) };
const controller = await import(new URL("fitnessPlanner.js", MODULE_DIR));

/** Simulates the router replacing #content and calling init() again. */
async function navigateBack(fp) {
  fp.root.isConnected = false;
  fp.root = fakeRoot();
  await controller.init();
  return fp.root;
}

/* ---------- Static checks ---------- */

describe("module files (static)", () => {
  it("HTML has one .fp root, links the module stylesheet first, and has no data-route", async () => {
    const html = await read("fitnessPlanner.html");
    assert.match(html.trimStart(), /^<link rel="stylesheet" href="\/modules\/fitnessPlanner\/fitnessPlanner\.css">/);
    assert.equal(html.match(/class="fp"/g)?.length, 1);
    assert.match(html, /<div id="fitness-planner" class="fp">/);
    assert.doesNotMatch(html, /data-route/);
    assert.doesNotMatch(html, /<script|<main|\son[a-z]+=/i, "no scripts, nested <main>, or inline handlers");
  });

  it("every HTML hook the controller queries exists in the markup", async () => {
    const [html, js] = await Promise.all([read("fitnessPlanner.html"), read("fitnessPlanner.js")]);
    const queried = [...js.matchAll(/part\(ctx, "([a-z-]+)"\)/g)].map(m => m[1]);
    assert.ok(queried.length > 0);
    for (const name of new Set(queried)) assert.match(html, new RegExp(`\\sdata-fp-${name}[\\s>]`), name);
    const actions = [...html.matchAll(/data-fp-action="([a-z-]+)"/g)].map(m => m[1]);
    for (const name of actions) assert.match(js, new RegExp(`\\b${name}:`), `action ${name} has a handler`);
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
    assert.match(js, /import \{ createFitnessService \} from "\.\/fitnessPlanner\.service\.js";/);
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
    const ctx = controller.createContext(fakeRoot());
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
    const ctx = controller.createContext(fakeRoot());
    ctx.dispose();
    let released = 0;
    ctx.track(() => { released += 1; });
    assert.equal(released, 1);
    assert.equal(ctx.unsubscribers.length, 0);
  });

  it("alive() is false once the root leaves the document", () => {
    const root = fakeRoot();
    const ctx = controller.createContext(root);
    root.isConnected = false;
    assert.equal(ctx.alive(), false);
  });
});

describe("init()", () => {
  beforeEach(() => setUp());

  it("binds one owned listener, creates the service with { db, uid }, and renders the shell", async () => {
    const fp = globalThis.__fp;
    await controller.init();
    assert.equal(fp.root.listeners.size, 1);
    assert.deepEqual(fp.serviceCalls, [{ db: fp.db, uid: "user-a" }]);
    assert.equal(fp.serviceCalls[0].db, fp.db, "shared db instance");
    assert.equal(fp.authListenerCount, 0, "auth.currentUser is preferred; no auth listener added");
    assert.deepEqual(fp.firestoreCalls, [], "the foundation makes no Firestore calls");
    assert.equal(visible(fp.root.parts.main), true);
    assert.equal(visible(fp.root.parts.status), false);
    assert.equal(visible(fp.root.parts.error), false);
  });

  it("repeated navigation disposes the previous context and never accumulates listeners", async () => {
    const fp = globalThis.__fp;
    await controller.init();
    const roots = [fp.root];
    for (let visit = 0; visit < 5; visit += 1) roots.push(await navigateBack(fp));

    roots.slice(0, -1).forEach(root => assert.equal(root.listeners.size, 0));
    assert.equal(roots.at(-1).listeners.size, 1);
    assert.equal(fp.serviceCalls.length, 6, "one service per initialization");
  });

  it("re-init on the same root (no navigation) still leaves exactly one listener", async () => {
    const fp = globalThis.__fp;
    await controller.init();
    await controller.init();
    await controller.init();
    assert.equal(fp.root.listeners.size, 1);
  });

  it("falls back to getCurrentUser() once when auth.currentUser is not populated", async () => {
    const fp = setUp({ currentUser: null, authStateUser: { uid: "user-b" } });
    await controller.init();
    assert.equal(fp.authListenerCount, 1);
    assert.deepEqual(fp.serviceCalls, [{ db: fp.db, uid: "user-b" }]);
    assert.equal(visible(fp.root.parts.main), true);
  });

  it("renders an error state and creates no service when no user is available", async () => {
    const fp = setUp({ currentUser: null, authStateUser: null });
    await controller.init();
    assert.deepEqual(fp.serviceCalls, []);
    assert.equal(visible(fp.root.parts.error), true);
    assert.equal(visible(fp.root.parts.main), false);
    assert.match(fp.root.parts["error-message"].textContent, /signed in/);
  });

  it("navigating away while the user resolves disposes the context without rendering", async () => {
    const fp = setUp({ currentUser: null, authStateUser: { uid: "user-b" } });
    const pending = controller.init();
    const root = fp.root;
    root.isConnected = false;
    await pending;
    assert.equal(root.listeners.size, 0);
    assert.deepEqual(fp.serviceCalls, []);
    assert.equal(visible(root.parts.main), false);
  });

  it("a service failure renders the error state instead of rejecting", async () => {
    const fp = setUp({ currentUser: { uid: "service-throws" } });
    const originalError = console.error;
    console.error = () => {};
    try {
      await controller.init();
    } finally {
      console.error = originalError;
    }
    assert.equal(visible(fp.root.parts.error), true);
    assert.equal(visible(fp.root.parts.main), false);
    assert.match(fp.root.parts["error-message"].textContent, /could not be loaded/);
  });

  it("retry re-initializes; unknown and prototype actions are ignored", async () => {
    const fp = setUp({ currentUser: null, authStateUser: null });
    await controller.init();
    assert.equal(visible(fp.root.parts.error), true);

    fp.auth.currentUser = { uid: "user-a" };
    fp.root.click("retry");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(visible(fp.root.parts.main), true);
    assert.equal(fp.root.listeners.size, 1);

    fp.root.click("constructor");
    fp.root.click("does-not-exist");
    assert.equal(fp.serviceCalls.length, 1);
  });

  it("the real service module loads against the pinned Firestore SDK and accepts the shared db", async () => {
    const fp = globalThis.__fp;
    fp.stubService = false;
    const { createFitnessService } = await import(new URL("fitnessPlanner.service.js", MODULE_DIR));
    const service = createFitnessService({ db: fp.db, uid: "user-a" });
    assert.equal(service.uid, "user-a");
    assert.equal(typeof service.subscribeActiveWorkoutSessions, "function");
    assert.deepEqual(fp.firestoreCalls, [], "creating the service touches no Firestore API");
    assert.throws(() => createFitnessService({ db: fp.db, uid: "bad/uid" }), { code: "VALIDATION" });
  });
});
