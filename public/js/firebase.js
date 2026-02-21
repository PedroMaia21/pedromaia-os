import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCRs03-iAhseSiLl5Q20SMCVtEhcega52E",
  authDomain: "pedromaia-os.firebaseapp.com",
  projectId: "pedromaia-os",
  storageBucket: "pedromaia-os.firebasestorage.app",
  messagingSenderId: "794714317669",
  appId: "1:794714317669:web:26743812b2fbadee77f78c"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();