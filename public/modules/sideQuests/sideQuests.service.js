import { db } from "../../js/firebase.js";
import {
    collection,
    doc,
    getDocs,
    setDoc,
    addDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { SideQuestTemplate, SideQuestInstance } from "./sideQuests.models.js";

const TEMPLATES_COLLECTION = "sideQuestTemplates";
const INSTANCES_COLLECTION = "sideQuestInstances";

function templatesRef(userId){
    return collection(db, "users", userId, TEMPLATES_COLLECTION);
}

function instancesRef(userId){
    return collection(db, "users", userId, INSTANCES_COLLECTION);
}

// --- Templates ---
export async function createTemplate(userId, template) {
    const ref = doc(db, "users", userId, TEMPLATES_COLLECTION, template.id);
    await setDoc(ref, { ...template });
}

export async function getAllTemplates(userId) {
    const snapshot = await getDocs(templatesRef(userId));
    return snapshot.docs.map(doc => 
        new SideQuestTemplate({ id: doc.id, ...doc.data() })
    );
}

// --- Instances ---
export async function saveInstance(userId, instance) {
    const ref = doc(db, "users", userId, INSTANCES_COLLECTION, instance.id);
    await setDoc(ref, { ...instance });
}

export async function getInstances(userId) {
    const snapshot = await getDocs(instancesRef(userId));
    return snapshot.docs.map(doc => 
        new SideQuestInstance({ id: doc.id, ...doc.data() })
    );
}