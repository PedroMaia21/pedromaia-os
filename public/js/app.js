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

    initMobileSidebar();
});

function initMobileSidebar() {

    const toggle = document.getElementById("menuToggle");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    const buttons = sidebar.querySelectorAll("button[data-route]");

    if (!toggle || !sidebar || !overlay) return;

    // Open / close sidebar with hamburger
    toggle.addEventListener("click", () => {
        sidebar.classList.toggle("open");
        overlay.style.display = sidebar.classList.contains("open") ? "block" : "none";
    });

    // Click on overlay closes sidebar
    overlay.addEventListener("click", () => {
        sidebar.classList.remove("open");
        overlay.style.display = "none";
    });

    // Clicking any module button hides sidebar on mobile
    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            if (window.innerWidth <= 768) {
                sidebar.classList.remove("open");
                overlay.style.display = "none";
            }
        });
    });

    // Optional: hide sidebar on window resize if desktop
    window.addEventListener("resize", () => {
        if (window.innerWidth > 768) {
            sidebar.classList.remove("open");
            overlay.style.display = "none";
        }
    });

}