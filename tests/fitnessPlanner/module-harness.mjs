// Shared harness for Fitness Planner UI-controller tests (Tasks 4 and 4B).
//
// - node:module hooks replace the browser-only imports: the Firebase CDN
//   modules, the shared public/js/firebase.js, and (for the controller only)
//   createFitnessService, which delegates to a per-test fake service.
//   classifyError/ErrorCategory still come from the real service module.
// - A minimal DOM, built by parsing the real fitnessPlanner.html. It supports
//   only what the controller uses; `innerHTML` throws so any use fails a test.
//
// Import this module before importing the controller.
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { validateExercise } from "../../public/modules/fitnessPlanner/fitnessPlanner.engine.js";

export const MODULE_DIR = new URL("../../public/modules/fitnessPlanner/", import.meta.url);
const CONTROLLER_URL = new URL("fitnessPlanner.js", MODULE_DIR).href;
const SERVICE_URL = new URL("fitnessPlanner.service.js", MODULE_DIR).href;
const MODULE_HTML = readFileSync(new URL("fitnessPlanner.html", MODULE_DIR), "utf8");

/* ===============================
   IMPORT STUBS
================================ */

const CDN = "https://www.gstatic.com/firebasejs/10.12.2/";
const FIRESTORE_FUNCTIONS = ["collection", "doc", "getDoc", "getDocs", "getDocFromServer", "getDocsFromServer",
  "setDoc", "updateDoc", "deleteDoc", "writeBatch", "query", "where", "orderBy", "limit", "startAfter",
  "onSnapshot", "serverTimestamp"];

const stubs = {
  // Every Firestore function records the call, so tests can assert the module makes none.
  firestore: FIRESTORE_FUNCTIONS
    .map(name => `export function ${name}() { globalThis.__fp.firestoreCalls.push("${name}"); }`)
    .join("\n") + "\nexport class Timestamp {}",
  firebaseAuth: `
    export const signInWithEmailAndPassword = () => {};
    export const createUserWithEmailAndPassword = () => {};
    export const signInWithPopup = () => {};`,
  firebase: `
    export const db = globalThis.__fp.db;
    export const auth = {
      get currentUser() { return globalThis.__fp.auth.currentUser; },
      onAuthStateChanged: callback => globalThis.__fp.auth.onAuthStateChanged(callback)
    };
    export const googleProvider = {};`,
  service: `
    export { classifyError, ErrorCategory, FitnessServiceError, ServiceErrorCode } from ${JSON.stringify(SERVICE_URL)};
    export function createFitnessService(args) { return globalThis.__fp.createService(args); }`
};
const dataUrl = source => `data:text/javascript,${encodeURIComponent(source)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === `${CDN}firebase-firestore.js`) return { url: dataUrl(stubs.firestore), shortCircuit: true };
    if (specifier === `${CDN}firebase-auth.js`) return { url: dataUrl(stubs.firebaseAuth), shortCircuit: true };
    const resolved = nextResolve(specifier, context);
    if (resolved.url.endsWith("/public/js/firebase.js")) return { url: dataUrl(stubs.firebase), shortCircuit: true };
    if (resolved.url === SERVICE_URL && context.parentURL === CONTROLLER_URL) {
      return { url: dataUrl(stubs.service), shortCircuit: true };
    }
    return resolved;
  }
});

/* ===============================
   MINIMAL DOM
================================ */

class FakeNode {
  constructor() { this.parentNode = null; }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.childNodes;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === fakeDocument.documentElement;
  }
}

class FakeText extends FakeNode {
  constructor(data) { super(); this.nodeType = 3; this.data = String(data); }
  get textContent() { return this.data; }
}

const kebab = name => name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.childNodes = [];
    this.listeners = [];
    this._value = null;
    const element = this;
    this.dataset = new Proxy({}, {
      get: (_, key) => (typeof key === "string" ? element.getAttribute(`data-${kebab(key)}`) ?? undefined : undefined),
      set: (_, key, value) => { element.setAttribute(`data-${kebab(key)}`, value); return true; },
      has: (_, key) => element.hasAttribute(`data-${kebab(key)}`)
    });
    this.classList = {
      contains: name => element.classes().includes(name),
      add: name => element.classList.toggle(name, true),
      remove: name => element.classList.toggle(name, false),
      toggle(name, force = !element.classList.contains(name)) {
        const set = new Set(element.classes());
        force ? set.add(name) : set.delete(name);
        element.setAttribute("class", [...set].join(" "));
        return force;
      }
    };
  }

  classes() { return (this.getAttribute("class") ?? "").split(/\s+/).filter(Boolean); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }

  get id() { return this.getAttribute("id") ?? ""; }
  get className() { return this.getAttribute("class") ?? ""; }
  set className(value) { this.setAttribute("class", value); }
  get type() { return this.getAttribute("type") ?? ""; }
  set type(value) { this.setAttribute("type", value); }
  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(value) { value ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }

  get value() {
    switch (this.tagName) {
      case "INPUT": return this._value ?? this.getAttribute("value") ?? "";
      case "TEXTAREA": return this._value ?? this.textContent;
      case "OPTION": return this.getAttribute("value") ?? this.textContent;
      case "SELECT": {
        const options = this.querySelectorAll("option");
        if (this._value === null) return options[0]?.value ?? "";
        return options.some(option => option.value === this._value) ? this._value : "";
      }
      default: return undefined;
    }
  }
  set value(value) {
    if (this.tagName === "OPTION") this.setAttribute("value", value);
    else this._value = String(value);
  }

  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get textContent() { return this.childNodes.map(node => node.textContent).join(""); }
  set textContent(value) { this.replaceChildren(...(String(value) === "" ? [] : [new FakeText(value)])); }
  get innerHTML() { throw new Error("innerHTML is not supported by the test DOM"); }
  set innerHTML(_) { throw new Error("innerHTML is not supported by the test DOM"); }

  append(...nodes) {
    for (const item of nodes) {
      const node = typeof item === "string" ? new FakeText(item) : item;
      node.remove();
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) {
    for (const node of [...this.childNodes]) node.remove();
    this.append(...nodes);
  }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  descendants() {
    return this.children.flatMap(child => [child, ...child.descendants()]);
  }
  matches(selector) { return matchesComplex(this, parseSelector(selector)); }
  closest(selector) {
    const parsed = parseSelector(selector);
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matchesComplex(n, parsed)) return n;
    return null;
  }
  querySelectorAll(selector) {
    const parsed = parseSelector(selector);
    return this.descendants().filter(node => matchesComplex(node, parsed));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }

  addEventListener(type, handler, options = {}) {
    if (options.signal?.aborted) return;
    const entry = { type, handler, signal: options.signal ?? null };
    this.listeners.push(entry);
    options.signal?.addEventListener("abort", () => {
      this.listeners.splice(this.listeners.indexOf(entry), 1);
    }, { once: true });
  }
  listenerCount(type) { return this.listeners.filter(entry => entry.type === type).length; }
  dispatchEvent(event) {
    event.target = this;
    for (let n = this; n; n = n.parentNode) {
      for (const { type, handler } of [...(n.listeners ?? [])]) if (type === event.type) handler(event);
    }
    return !event.defaultPrevented;
  }
  focus() { fakeDocument.activeElement = this; }
}

/* Selectors: compound parts (tag, #id, .class, [attr], [attr="value"]) joined by descendant spaces. */
function parseSelector(selector) {
  return selector.trim().split(/\s+(?![^[]*\])/).map(compound => {
    const parts = [];
    for (const m of compound.matchAll(/([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      if (m[1]) parts.push(node => node.tagName === m[1].toUpperCase());
      else if (m[2]) parts.push(node => node.id === m[2]);
      else if (m[3]) parts.push(node => node.classList.contains(m[3]));
      else parts.push(node => node.hasAttribute(m[4]) && (m[5] === undefined || node.getAttribute(m[4]) === m[5]));
    }
    return parts;
  });
}

function matchesComplex(node, compounds) {
  const matches = (n, parts) => parts.every(test => test(n));
  if (!matches(node, compounds.at(-1))) return false;
  let ancestor = node.parentNode;
  for (let i = compounds.length - 2; i >= 0; i -= 1) {
    while (ancestor && ancestor.nodeType === 1 && !matches(ancestor, compounds[i])) ancestor = ancestor.parentNode;
    if (!ancestor || ancestor.nodeType !== 1) return false;
    ancestor = ancestor.parentNode;
  }
  return true;
}

const VOID_ELEMENTS = new Set(["link", "input", "br", "meta", "img", "hr"]);
const decode = text => text.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Parses developer-authored markup; throws on mismatched or unclosed tags. */
export function parseHtml(html) {
  const container = new FakeElement("div");
  const stack = [container];
  const token = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g;
  let consumed = 0;
  for (const m of html.matchAll(token)) {
    consumed += m[0].length;
    if (m[1]) {
      const open = stack.pop();
      if (open.tagName !== m[1].toUpperCase()) throw new Error(`Mismatched </${m[1]}> (open: ${open.tagName})`);
    } else if (m[2]) {
      const node = new FakeElement(m[2]);
      for (const a of m[3].matchAll(/([^\s=>/]+)(?:="([^"]*)")?/g)) node.setAttribute(a[1], decode(a[2] ?? ""));
      stack.at(-1).append(node);
      if (!VOID_ELEMENTS.has(m[2].toLowerCase())) stack.push(node);
    } else if (m[4] && m[4].trim() !== "") {
      stack.at(-1).append(new FakeText(decode(m[4].trim())));
    }
  }
  if (consumed !== html.length) throw new Error("Unparsed markup");
  if (stack.length !== 1) throw new Error(`Unclosed <${stack.at(-1).tagName.toLowerCase()}>`);
  return [...container.childNodes];
}

const fakeDocument = {
  documentElement: new FakeElement("html"),
  activeElement: null,
  createElement: tag => new FakeElement(tag),
  createTextNode: data => new FakeText(data),
  getElementById(id) { return this.documentElement.querySelector(`#${id}`); }
};
const body = new FakeElement("body");
const content = new FakeElement("main");
content.setAttribute("id", "content");
body.append(content);
fakeDocument.documentElement.append(body);
globalThis.document = fakeDocument;

/** Simulates the router: replaces #content with fresh module markup. Returns the new root. */
export function mountModule() {
  content.replaceChildren(...parseHtml(MODULE_HTML));
  return fakeDocument.getElementById("fitness-planner");
}

/** Simulates navigating to another module (the Fitness root leaves the document). */
export function navigateAway() {
  content.replaceChildren(new FakeElement("h1"));
}

/* ===============================
   TEST STATE AND HELPERS
================================ */

export const harness = globalThis.__fp = {
  db: { name: "shared-db" },
  auth: null,
  authListenerCount: 0,
  serviceCalls: [],
  firestoreCalls: [],
  service: null,
  createService(args) {
    if (args.uid === "service-throws") throw new Error("service failure");
    harness.serviceCalls.push(args);
    return harness.service;
  }
};

/** Resets per-test state. `service` is what createFitnessService returns. */
export function setUp({ currentUser = { uid: "user-a" }, authStateUser = currentUser, service = createFakeService() } = {}) {
  harness.auth = {
    currentUser,
    onAuthStateChanged(callback) {
      harness.authListenerCount += 1;
      queueMicrotask(() => callback(authStateUser));
      return () => {};
    }
  };
  harness.authListenerCount = 0;
  harness.serviceCalls = [];
  harness.firestoreCalls = [];
  harness.service = service;
  return harness;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * In-memory stand-in for the exercise part of createFitnessService. Writes are
 * validated by the real engine first (synchronous ValidationError, like the
 * service), applied locally, and return `{ id, write }`. `write` stays pending
 * until the test settles it, unless `autoAck` is set. A rejected write reverts
 * the stored document, as Firestore does.
 */
export function createFakeService(initial = [], { invalid = [], autoAck = true } = {}) {
  const clone = value => structuredClone(value);
  const store = new Map(initial.map(exercise => [exercise.id, clone(exercise)]));
  let nextId = 1;
  const service = {
    uid: "user-a",
    calls: [],
    store,
    invalid,
    autoAck,
    writes: [],
    hold: { list: false, get: false },
    held: { list: [], get: [] },
    fail: { list: null, get: null },

    async listExercises() {
      service.calls.push({ op: "list" });
      if (service.hold.list) { const d = deferred(); service.held.list.push(d); await d.promise; }
      if (service.fail.list) throw service.fail.list;
      return { docs: [...store.values()].map(clone), invalid: service.invalid.map(clone) };
    },

    async getExercise(id) {
      service.calls.push({ op: "get", id });
      if (service.hold.get) { const d = deferred(); service.held.get.push(d); await d.promise; }
      if (service.fail.get) throw service.fail.get;
      return store.has(id) ? clone(store.get(id)) : null;
    },

    saveExercise(exercise) {
      service.calls.push({ op: "save", exercise: clone(exercise) });
      validateExercise(exercise);
      const id = exercise.id ?? `auto${String(nextId++).padStart(4, "0")}`;
      const previous = store.get(id);
      const { id: _ignored, ...fields } = exercise;
      store.set(id, { id, ...clone(fields) });
      const write = deferred();
      const entry = {
        id,
        resolve: () => write.resolve(),
        reject: error => {
          previous === undefined ? store.delete(id) : store.set(id, previous);
          write.reject(error);
        }
      };
      service.writes.push(entry);
      if (service.autoAck) entry.resolve();
      return { id, write: write.promise };
    }
  };
  return service;
}

export function exercise(overrides = {}) {
  return {
    id: "ex-bench",
    schemaVersion: 1,
    name: "Bench press",
    trackingType: "WEIGHT_AND_REPS",
    laterality: "BILATERAL",
    equipment: ["barbell", "bench"],
    notes: "",
    isArchived: false,
    createdAt: new Date(Date.UTC(2026, 9, 1, 12, 0, 0)),
    updatedAt: new Date(Date.UTC(2026, 9, 1, 12, 0, 0)),
    ...overrides
  };
}

/** Lets pending promise continuations run. */
export async function settle() {
  for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve));
}

export function click(node) {
  assert(node, "click target exists");
  node.dispatchEvent({ type: "click", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
}

export function submit(form) {
  const event = { type: "submit", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  form.dispatchEvent(event);
  return event;
}

/** True when the node and every ancestor up to the module root lack `.hidden`. */
export function isShown(node) {
  for (let n = node; n && n.nodeType === 1; n = n.parentNode) {
    if (n.classList.contains("hidden")) return false;
    if (n.id === "fitness-planner") return true;
  }
  return true;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}
