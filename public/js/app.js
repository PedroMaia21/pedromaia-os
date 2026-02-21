import { loadModule } from "./router.js";
import { getCurrentUser } from "./auth.js";

document.addEventListener("DOMContentLoaded", async () => {
    const user = await getCurrentUser();
    if (!user) {
        window.location.href = "/login.html";
        return;
    }

    console.log("User ready:", user.uid);

    const appContainer = document.getElementById("app");
    if (appContainer) appContainer.style.display = "grid";

    const btnSideQuests = document.getElementById("btn-side-quests");
    if (btnSideQuests) btnSideQuests.addEventListener("click", () => loadModule("sideQuests"));

    const btnPlaylists = document.getElementById("btn-playlists");
    if (btnPlaylists) btnPlaylists.addEventListener("click", () => loadModule("playlists"));
});