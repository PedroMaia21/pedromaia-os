// Test-only module hooks: Node cannot import the browser-hosted Firestore SDK
// (https:) or the real firebase.js (needs config + network), so both are
// replaced with in-memory stubs whose behaviour each test controls.
import { registerHooks } from "node:module";

const FIRESTORE_URL = "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const FIREBASE_STUB_URL = "data:text/javascript,export const db = {};";

export const firestore = {
  getDocs: async () => ({ docs: [] })
};
globalThis.__sideQuestsFirestoreStub = firestore;

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
        export const collection = (_db, ...segments) => ({ path: segments.join("/") });
        export const doc = (_db, ...segments) => ({ path: segments.join("/") });
        export const getDocs = (ref) => stub.getDocs(ref);
        export const setDoc = async () => {};
        export const addDoc = async () => {};
      `
    };
  }
});

export function snapshotOf(records) {
  return {
    docs: records.map(({ id, ...data }) => ({ id, data: () => data }))
  };
}
