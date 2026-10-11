// Test-only module hooks: Node cannot import the browser-hosted Firestore SDK
// (https:) or the real firebase.js (needs config + network), so both are
// replaced with in-memory stubs whose behaviour each test controls.
import { registerHooks } from "node:module";

const FIRESTORE_URL = "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const FIREBASE_STUB_URL = "data:text/javascript,export const db = {};";

export class FakeTimestamp {
  constructor(seconds, nanoseconds) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  static fromMillis(ms) {
    return new FakeTimestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }

  toMillis() {
    return this.seconds * 1000 + this.nanoseconds / 1e6;
  }
}

export const firestore = {
  getDocs: async () => ({ docs: [] }),
  setDoc: async () => {},
  now: () => FakeTimestamp.fromMillis(Date.now()),
  autoId: () => "auto-id"
};
globalThis.__sideQuestsFirestoreStub = firestore;
globalThis.__sideQuestsFakeTimestamp = FakeTimestamp;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === FIRESTORE_URL) return { url: FIRESTORE_URL, shortCircuit: true };
    if (specifier.endsWith("/js/firebase.js")) return { url: FIREBASE_STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url !== FIRESTORE_URL) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: `
        const stub = globalThis.__sideQuestsFirestoreStub;
        const FakeTimestamp = globalThis.__sideQuestsFakeTimestamp;
        export const collection = (_db, ...segments) => ({ type: "collection", path: segments.join("/") });
        export const doc = (parent, ...segments) => {
          if (parent?.type === "collection" && segments.length === 0) {
            const id = stub.autoId();
            return { type: "doc", id, path: parent.path + "/" + id };
          }
          return { type: "doc", id: segments.at(-1), path: segments.join("/") };
        };
        export const getDocs = (ref) => stub.getDocs(ref);
        export const setDoc = (ref, data) => stub.setDoc(ref, data);
        export const addDoc = async () => {};
        export const Timestamp = class extends FakeTimestamp {
          static now() { return stub.now(); }
        };
      `
    };
  }
});

export function snapshotOf(records) {
  return {
    docs: records.map(({ id, ...data }) => ({ id, data: () => data }))
  };
}
