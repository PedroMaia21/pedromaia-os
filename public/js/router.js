export async function loadModule(name) {
    const path = `/modules/${name}/${name}.html`;
    
    const res = await fetch(path);
    
    if(!res.ok) {
        throw new Error("Failed to load ${path}");
    }

    const html = await res.text();

    document.getElementById("content").innerHTML = html;


    const module = await import(
        `/modules/${name}/${name}.js`
    );
    module.init();
}