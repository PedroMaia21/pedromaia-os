import { seedSideQuests } from "./sideQuests.seed.js";
import { getAllTemplates } from "./sideQuests.service.js";
import { getCurrentUser } from "../../js/auth.js";

export async function init() {
    const user = await getCurrentUser();

    document.getElementById("content").insertAdjacentHTML(
        "beforeend",
        "<p>Side Quests module loaded</p>"
    );

    const templates = await getAllTemplates(user.uid);

    if (templates.length === 0) {
        await seedSideQuests(user.uid);
    }
}