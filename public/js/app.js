import { loadModule } from "./router.js";
import "./auth.js";

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btn-side-quests").addEventListener("click", () => {
        loadModule("sideQuests");
    });
});

