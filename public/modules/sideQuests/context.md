# Side Quest Generator – Module Context

Last updated: 2026-06-07

---

## 1. Module Purpose

The Side Quest Generator is a module inside the Personal OS system that generates **repeatable, low-friction, optional activities ("side quests")**.

These activities are designed to:
- introduce randomness into daily life
- provide decompression and mental breaks
- offer lightweight enrichment or novelty
- avoid planning overhead or cognitive load

This module is NOT part of structured task management.

---

## 2. Core Concept

A side quest is a **repeatable archetype**, not a one-off task.

Example:
- "Play a short casual game"
- "Watch a random video from a known YouTube channel"
- "Sit outside for 15 minutes"
- "Read a few articles from a selected blog"

The same archetype can be executed multiple times over time.

---

## 3. Core Behavior

The module:

- generates side quests on demand
- may optionally generate a small batch (e.g. 3 daily quests)
- selects quests randomly from predefined pools
- enforces cooldowns to avoid repetition fatigue
- does NOT consider user context or productivity state

The system is intentionally **non-context-aware**.

---

## 4. Side Quest Structure

A side quest is defined as a reusable template with the following properties:

- `id` — stable string identifier (e.g. `"decompression-walk-20"`)
- `title` — short display name
- `description` — actionable instructions for execution
- `category` — one of the defined category values (see §5)
- `durationMinutes` — estimated duration (10–60 minutes typical)
- `cooldownDays` — minimum days before reappearance (defaults to 1)
- `tags` — optional list of descriptive labels (defaults to `[]`)

> **Changed from design doc:** `source`, `mode`, and `repeatable` fields were dropped from the implementation. `description` and `tags` were added. Field names moved from `snake_case` to `camelCase` to match JS conventions (`estimated_duration` → `durationMinutes`, `cooldown_days` → `cooldownDays`).

---

## 5. Categories

Implemented categories (`SideQuestCategory` enum):

- `DECOMPRESSION` — relaxation and mental rest activities
- `MEDIA` — video, articles, and passive consumption
- `SKILL` — light practice or learning
- `LIFE` — low-effort home or digital maintenance

> **Changed from design doc:** "Creativity / Play" was not implemented as a category. The five conceptual categories collapsed into four concrete enum values. `MEDIA` covers the former "Media / Infinite Consumption Lists". `LIFE` covers "High-Value Life Activities".

Categories are used for grouping. Weighted random selection is not yet implemented.

---

## 6. Generation Rules

- Selection is random (no contextual weighting required)
- Must respect cooldown rules per template
- Must avoid repetition bias within short time windows
- Must produce self-contained, immediately actionable outputs

No planning, no dependency resolution, no chaining.

---

## 7. Constraints

Hard constraints of the module:

- No integration with Todoist or task systems
- No long-running or multi-step quests
- No project-like structures
- No external orchestration with other modules
- No contextual intelligence or behavioral adaptation
- No requirement for completion tracking beyond optional state marking

---

## 8. Cooldown System

Each template defines:

- `cooldownDays`: minimum days before reappearance (defaults to `1` if not specified)

Purpose:
- prevent fatigue from repeated suggestions
- maintain perceived randomness quality

---

## 9. Data Model (Implementation Reference)

Models are defined in `sideQuests.models.js`. Templates and instances are persisted in Firestore under `users/{userId}/sideQuestTemplates` and `users/{userId}/sideQuestInstances`.

### SideQuestTemplate
```json
{
  "id": "",
  "title": "",
  "description": "",
  "category": "DECOMPRESSION | MEDIA | SKILL | LIFE",
  "durationMinutes": 0,
  "cooldownDays": 1,
  "tags": []
}
```

### SideQuestInstance
```json
{
  "id": "",
  "templateId": "",
  "status": "AVAILABLE | ACTIVE | COMPLETED | EXPIRED | SKIPPED",
  "generatedAt": "",
  "expiresAt": null,
  "completedAt": null
}
```

> **Changed from design doc:** Field names are `camelCase`. `SideQuestInstance` has a richer status set (`AVAILABLE`, `ACTIVE`, `COMPLETED`, `EXPIRED`, `SKIPPED`) replacing the original `generated | done | skipped`. `created_at` is now `generatedAt`. `expiresAt` and `completedAt` are tracked explicitly.

---

## 10. Output Modes

### Mode 1 — Single Quest

- returns one randomly selected side quest

### Mode 2 — Daily Batch

- returns 3 independent quests
- no ordering or prioritization
- purely random selection

---

## 11. Known Design Decisions

### Repeatability is fundamental

Side quests are not consumable tasks, but reusable experiences.

### Randomness-first design

No personalization or contextual filtering is applied.

### Decompression priority

Primary purpose is mental relief and novelty, not productivity.

---

### 12. Open Implementation Questions

- Should cooldown be strict or probabilistic? *(unresolved)*
- Should categories have weighted randomness? *(unresolved; not implemented)*
- Should "suggestion-only" quests exist without execution tracking? *(unresolved)*
- Should sources (blogs/videos) be versioned or dynamic? *(unresolved; `source` field was dropped from the model)*
- Should a `CREATIVITY` category be added to match the original design intent?
- `expiresAt` is tracked on instances — what is the expiry logic and who sets it?
- The module auto-seeds on first load if no templates exist — should re-seeding ever be supported?

---

### 13. Implementation Notes

When implementing features in this module:

- Always assume randomness-first behavior
- Do not introduce task system coupling
- Keep logic stateless where possible
- Prefer simple selection over optimization
- Preserve repeatability semantics at all times

---

### 14. Implementation State (as of 2026-06-07)

What is currently built:

- **Models** (`sideQuests.models.js`): `SideQuestTemplate`, `SideQuestInstance`, `SideQuestCategory` enum, `SideQuestStatus` enum — all defined and stable.
- **Service** (`sideQuests.service.js`): Firestore CRUD — `createTemplate`, `getAllTemplates`, `saveInstance`, `getInstances`. No query filtering, cooldown enforcement, or random selection logic yet.
- **Seed** (`sideQuests.seed.js`): 16 hand-authored templates across 4 categories (5 DECOMPRESSION, 5 MEDIA, 3 SKILL, 3 LIFE). Auto-runs on first load if the user has no templates.
- **Entry point** (`sideQuests.js`): Initializes module, checks for empty template collection, seeds if needed. No quest generation UI or logic yet.

What is **not yet built**:

- Random selection logic
- Cooldown enforcement (no filtering by last-used date)
- Daily batch generation (Mode 2)
- Any UI beyond a placeholder paragraph
- Instance lifecycle management (status transitions, expiry)
- Completion or skip tracking