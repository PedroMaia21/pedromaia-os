export async function loadModule(name) {
    const res = await fetch('/modules/${name}/${name}.html')
    const html = await res.text();

    document.getElementById("content").innerHTML = html;

    const moduleScript = await import(
        '/modules/${name}/${name}.js'
    );

    moduleScript.init();
}