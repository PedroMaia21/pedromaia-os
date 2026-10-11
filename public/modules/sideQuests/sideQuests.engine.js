export function selectRandomTemplate(templates, random = Math.random) {
    if (!Array.isArray(templates) || templates.length === 0) {
        throw new Error("No side quest templates available");
    }

    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new Error(`Random value must be in [0, 1), got ${value}`);
    }

    return templates[Math.floor(value * templates.length)];
}
