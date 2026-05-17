import { loginEmail, registerEmail, loginGoogle, getCurrentUser } from "./auth.js";

document.addEventListener("DOMContentLoaded", async () => {
    const user = await getCurrentUser();
    if (user) {
        window.location.href = "/index.html";
        return;
    }

    document.getElementById("btn-login").addEventListener("click", async () => {
        const email = document.getElementById("email").value;
        const password = document.getElementById("password").value;
        try {
            await loginEmail(email, password);
            window.location.href = "/index.html";
        } catch (err) {
            alert(err.message);
        }
    });

    document.getElementById("btn-register").addEventListener("click", async () => {
        const email = document.getElementById("email").value;
        const password = document.getElementById("password").value;
        try {
            await registerEmail(email, password);
            window.location.href = "/index.html";
        } catch (err) {
            alert(err.message);
        }
    });

    document.getElementById("btn-google").addEventListener("click", async () => {
        try {
            await loginGoogle();
            window.location.href = "/index.html";
        } catch (err) {
            alert(err.message);
        }
    });
});