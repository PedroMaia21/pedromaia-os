# Side Quest Generator – Module Context

Last updated: 2026-05-17

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

- title
- category
- estimated duration (10–60 minutes typical)
- repeatability (yes, core requirement)
- cooldown interval (prevents immediate repetition)
- source (optional: YouTube channel, blog, game list, etc.)
- mode (execution vs suggestion)

---

## 5. Categories

Defined categories:

- Decompression / Relaxation  
- Skills / Light Knowledge Exposure  
- High-Value Life Activities  
- Creativity / Play  
- Media / Infinite Consumption Lists  

Categories are used only for grouping and random selection weighting (if needed).

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

Each template may define:

- `cooldown_days`: minimum days before reappearance

Purpose:
- prevent fatigue from repeated suggestions
- maintain perceived randomness quality

---

## 9. Data Model (Implementation Reference)

### Template
```json id="m1k9qa"
{
  "id": "",
  "title": "",
  "category": "",
  "estimated_duration": 0,
  "cooldown_days": 0,
  "source": "",
  "repeatable": true
}
```

Instance
```json
{
  "id": "",
  "template_id": "",
  "created_at": "",
  "status": "generated | done | skipped"
}
```

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

- Should cooldown be strict or probabilistic?
- Should categories have weighted randomness?
- Should "suggestion-only" quests exist without execution tracking?
- Should sources (blogs/videos) be versioned or dynamic?

---

### 13. Implementation Notes

When implementing features in this module:

- Always assume randomness-first behavior
- Do not introduce task system coupling
- Keep logic stateless where possible
- Prefer simple selection over optimization
- Preserve repeatability semantics at all times