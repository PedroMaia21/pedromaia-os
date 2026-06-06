export const SideQuestCategory = {
    DECOMPRESSION: "DECOMPRESSION",
    MEDIA: "MEDIA",
    SKILL: "SKILL",
    LIFE: "LIFE"
}

export const SideQuestStatus = {
    AVAILABLE: "AVAILABLE",
    ACTIVE: "ACTIVE",
    COMPLETED: "COMPLETED",
    EXPIRED: "EXPIRED",
    SKIPPED: "SKIPPED"
}

export class SideQuestTemplate {
    constructor({
        id,
        title,
        description,
        category,
        durationMinutes,
        tags=[]
    }) {
        this.id = id;
        this.title = title;
        this.description = description;
        this.category = category;
        this.durationMinutes = durationMinutes;
        this.tags = tags;
    }
}