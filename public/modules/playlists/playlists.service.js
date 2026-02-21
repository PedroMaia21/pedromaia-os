// /modules/playlists/playlists.service.js
import { collection, doc, addDoc, updateDoc, deleteDoc, getDoc, setDoc, onSnapshot, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../../js/firebase.js";
import { getCurrentUser } from "../../js/auth.js"; // ✅ use auth.js

/* ===============================
   REFS
================================ */
async function userRef() {
  const user = await getCurrentUser();
  if (!user) throw new Error("No user logged in");
  return doc(db, "users", user.uid);
}

async function playlistsRef() {
  const uRef = await userRef();
  return collection(uRef, "playlists");
}

async function dailyPlanRef(dateKey) {
  const uRef = await userRef();
  return doc(uRef, "dailyPlans", dateKey);
}

/* ===============================
   PLAYLISTS
================================ */
export async function subscribeToPlaylists(callback) {
  const colRef = await playlistsRef();
  return onSnapshot(colRef, snapshot => {
    const playlists = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    callback(playlists);
  });
}

export async function addPlaylist(data) {
  const colRef = await playlistsRef();
  await addDoc(colRef, {
    ...data,
    lastUsed: Timestamp.fromDate(new Date(0)),
    status: "active",
    createdAt: Timestamp.now()
  });
}

export async function updatePlaylist(id, data) {
  const uRef = await userRef();
  await updateDoc(doc(uRef, "playlists", id), data);
}

export async function deletePlaylist(id) {
  const uRef = await userRef();
  await deleteDoc(doc(uRef, "playlists", id));
}

/* ===============================
   DAILY PLAN
================================ */
export async function getOrCreateDailyPlan(dateKey, generatorFn) {
  const ref = await dailyPlanRef(dateKey);
  const snap = await getDoc(ref);

  if (snap.exists()) return snap.data().blocks;

  const plan = generatorFn();

  await setDoc(ref, {
    date: dateKey,
    blocks: plan,
    createdAt: Timestamp.now()
  });

  return plan;
}

export async function subscribeToDailyPlan(dateKey, callback) {
  const ref = await dailyPlanRef(dateKey);
  return onSnapshot(ref, snap => {
    if (!snap.exists()) return;
    callback(snap.data().blocks);
  });
}

export async function updateDailyPlan(dateKey, blocks) {
  const ref = await dailyPlanRef(dateKey);
  await updateDoc(ref, { blocks });
}