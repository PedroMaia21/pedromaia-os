import { db } from "../../js/firebase";
import {
    collection,
    doc,
    getDocs,
    setDoc,
    addDoc
} from "firebase/firestore";
import { SideQuestTemplate, SideQuestInstance } from "./sideQuests.models";

const TEMPLATES_COLLECTION = "sideQuestTemplates";
const INSTANCES_COLLECTION = "sideQuestInstances";

// --- Templates ---
export async function createTemplate(template) {
    const ref = doc(db, TEMPLATES_COLLECTION, template.id);
    await setDoc(ref, { ...template });
}

export async function getAllTemplates() {
    const snapshot = await getDocs(collection(db, TEMPLATES_COLLECTION));
    return snapshot.docs.map(doc => 
        new SideQuestTemplate({ id: doc.id, ...doc.data() })
    );
}

// --- Instances ---
export async function saveInstance(instance) {
    const ref = doc(db, INSTANCES_COLLECTION, instance.id);
    await setDoc(ref, { ...instance });
}

export async function getInstances() {
    const snapshot = await getDocs(collection(db, INSTANCES_COLLECTION));
    return snapshot.docs.map(doc => 
        new SideQuestInstance({ id: doc.id, ...doc.data() })
    );
}