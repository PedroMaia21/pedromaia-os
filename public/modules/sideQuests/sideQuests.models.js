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
        cooldownDays = 1,
        tags=[]
    }) {
        this.id = id;
        this.title = title;
        this.description = description;
        this.category = category;
        this.durationMinutes = durationMinutes;
        this.cooldownDays = cooldownDays;
        this.tags = tags;
    }
}

export class SideQuestInstance {
    constructor({
        id,
        templateId,
        status,
        generatedAt,
        expiresAt = null,
        completedAt = null
    }) {
        this.id = id;
        this.templateId = templateId;
        this.status = status;
        this.generatedAt = generatedAt;
        this.expiresAt = expiresAt;
        this.completedAt = completedAt;
    }
}