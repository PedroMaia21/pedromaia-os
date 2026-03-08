let homeHTML = "";

export function initRouter() {

    const content = document.getElementById("content");
    homeHTML = content.innerHTML;

    document.addEventListener("click", (e) => {

        const route = e.target.dataset.route;
        if (!route) return;

        if (route === "home") {
            loadHome();
        } else {
            loadModule(route);
        }

    });
}

export function loadHome() {
    document.getElementById("content").innerHTML = homeHTML;
}

export async function loadModule(name) {

    const path = `/modules/${name}/${name}.html`;

    const res = await fetch(path);

    if (!res.ok) {
        throw new Error(`Failed to load ${path}`);
    }

    const html = await res.text();

    document.getElementById("content").innerHTML = html;

    const module = await import(`/modules/${name}/${name}.js`);

    if (module.init) module.init();
}