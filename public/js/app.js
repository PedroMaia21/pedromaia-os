import { initRouter } from "./router.js";
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

    initRouter();

});