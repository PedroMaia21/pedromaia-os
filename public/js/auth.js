import { auth, googleProvider } from "./firebase.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export async function getCurrentUser() {
    return new Promise(resolve => {
        auth.onAuthStateChanged(user => {
            resolve(user || null);
        });
    });
}

export async function loginEmail(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
}

export async function registerEmail(email, password) {
    return createUserWithEmailAndPassword(auth, email, password);
}

export async function loginGoogle() {
    return signInWithPopup(auth, googleProvider);
}