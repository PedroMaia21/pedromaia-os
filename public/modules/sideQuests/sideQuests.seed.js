import { SideQuestCategory } from "./sideQuests.models.js";
import { createTemplate } from "./sideQuests.service.js";

const seedTemplates = [
    // --- Decompression ---
    {
        id: "decompression-walk-20",
        title: "Take a 20 minute walk",
        description: "Step outside and walk for 20 minutes with no destination in mind. Leave your phone in your pocket.",
        category: SideQuestCategory.DECOMPRESSION,
        durationMinutes: 20,
        cooldownDays: 1,
        tags: ["outdoor", "movement", "mindfulness"]
    },
    {
        id: "decompression-comedy-clip",
        title: "Watch a comedy clip",
        description: "Find a short comedy sketch, stand-up clip, or funny video. Keep it to one or two clips.",
        category: SideQuestCategory.DECOMPRESSION,
        durationMinutes: 15,
        cooldownDays: 2,
        tags: ["video", "humor", "light"]
    },
    {
        id: "decompression-favorite-album",
        title: "Listen to a favorite album",
        description: "Put on a full album you love. No shuffle. Just listen.",
        category: SideQuestCategory.DECOMPRESSION,
        durationMinutes: 45,
        cooldownDays: 3,
        tags: ["music", "audio", "relaxation"]
    },
    {
        id: "decompression-comic-chapter",
        title: "Read a comic chapter",
        description: "Pick up any comic or manga and read one chapter or issue.",
        category: SideQuestCategory.DECOMPRESSION,
        durationMinutes: 20,
        cooldownDays: 2,
        tags: ["reading", "visual", "light"]
    },
    {
        id: "decompression-sit-outside",
        title: "Sit outside for 15 minutes",
        description: "Go outside, find a spot, and just sit. No phone, no headphones. Observe.",
        category: SideQuestCategory.DECOMPRESSION,
        durationMinutes: 15,
        cooldownDays: 1,
        tags: ["outdoor", "mindfulness", "stillness"]
    },

    // --- Media ---
    {
        id: "media-documentary-episode",
        title: "Watch a documentary episode",
        description: "Pick any documentary series and watch one episode. Nature, history, science — your call.",
        category: SideQuestCategory.MEDIA,
        durationMinutes: 45,
        cooldownDays: 2,
        tags: ["video", "documentary", "learning"]
    },
    {
        id: "media-educational-youtube",
        title: "Watch an educational YouTube video",
        description: "Find a video that teaches you something interesting. Aim for something unrelated to your work.",
        category: SideQuestCategory.MEDIA,
        durationMinutes: 20,
        cooldownDays: 1,
        tags: ["video", "youtube", "learning"]
    },
    {
        id: "media-saved-article",
        title: "Read a saved article",
        description: "Open your read-later list and actually read one article from start to finish.",
        category: SideQuestCategory.MEDIA,
        durationMinutes: 15,
        cooldownDays: 1,
        tags: ["reading", "articles", "knowledge"]
    },
    {
        id: "media-conference-talk",
        title: "Watch a conference talk",
        description: "Pick a talk from a conference you follow — tech, design, science, whatever interests you.",
        category: SideQuestCategory.MEDIA,
        durationMinutes: 40,
        cooldownDays: 3,
        tags: ["video", "conference", "learning"]
    },
    {
        id: "media-travel-video",
        title: "Watch a travel video",
        description: "Find a travel video about a place you've never been. Let yourself daydream a little.",
        category: SideQuestCategory.MEDIA,
        durationMinutes: 20,
        cooldownDays: 2,
        tags: ["video", "travel", "exploration"]
    },

    // --- Skill ---
    {
        id: "skill-german-10",
        title: "Practice German for 10 minutes",
        description: "Open Duolingo, Anki, or any resource and do a focused 10-minute German session.",
        category: SideQuestCategory.SKILL,
        durationMinutes: 10,
        cooldownDays: 1,
        tags: ["language", "german", "practice"]
    },
    {
        id: "skill-guitar-riff",
        title: "Learn one guitar riff",
        description: "Pick up the guitar and learn or practice one riff. Just one. Keep it fun.",
        category: SideQuestCategory.SKILL,
        durationMinutes: 20,
        cooldownDays: 2,
        tags: ["music", "guitar", "practice"]
    },
    {
        id: "skill-new-technology",
        title: "Read about a new technology",
        description: "Pick a technology you've been curious about and spend some time reading the basics.",
        category: SideQuestCategory.SKILL,
        durationMinutes: 20,
        cooldownDays: 3,
        tags: ["reading", "tech", "learning"]
    },

    // --- Life ---
    {
        id: "life-organize-drawer",
        title: "Organize one drawer",
        description: "Pick any one drawer at home and spend 10–15 minutes getting it in order. One drawer only.",
        category: SideQuestCategory.LIFE,
        durationMinutes: 15,
        cooldownDays: 7,
        tags: ["home", "tidying", "quick-win"]
    },
    {
        id: "life-clean-phone-gallery",
        title: "Clean phone gallery for 10 minutes",
        description: "Set a timer for 10 minutes and delete duplicates, blurry shots, and screenshots you no longer need.",
        category: SideQuestCategory.LIFE,
        durationMinutes: 10,
        cooldownDays: 7,
        tags: ["phone", "digital", "tidying"]
    },
    {
        id: "life-plan-future-trip",
        title: "Plan one future trip",
        description: "Spend 20–30 minutes loosely planning a trip you'd genuinely want to take. Doesn't have to be realistic.",
        category: SideQuestCategory.LIFE,
        durationMinutes: 30,
        cooldownDays: 14,
        tags: ["travel", "planning", "dreaming"]
    }
];

export async function seedSideQuests(userId) {
    console.log(`Seeding ${seedTemplates.length} side quest templates for user ${userId}...`);

    for (const template of seedTemplates) {
        await createTemplate(userId, template);
        console.log(`  ✓ ${template.id}`);
    }

    console.log("Seed complete.");
}