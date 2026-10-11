# Fitness Planner — Technical Design and Implementation Plan

**Version:** 1.0  
**Date:** 2026-10-11  
**Status:** Proposed — ready for repository verification  
**Scope:** Fitness Planner module MVP

## 1. Purpose

The Fitness Planner helps the user define fitness goals, maintain a reusable workout routine, plan workouts on specific dates, record actual performance, recover interrupted sessions, and receive transparent progression suggestions.

The MVP is strength-first. It prioritizes reliable workout execution and historical accuracy over sophisticated optimization.

### 1.1 Product principles

1. **Planning and execution are separate.** A planned workout describes what the user intends to do; a workout session records what actually happened.
2. **The user remains in control.** Progression and exercise variations are suggestions, not automatic changes to the user's routine.
3. **Completed history is trustworthy.** Editing a routine must not silently rewrite previous workouts.
4. **Recording a set is a durable operation.** A refresh or accidental navigation must not cause completed work to disappear.
5. **Recovery is built into the workflow.** Interrupted active workouts must be identifiable and resumable.
6. **The module fits the existing application.** Reuse established authentication, Firestore access, navigation, and styling conventions rather than introducing a new application architecture.
7. **Unsupported behaviour is explicit.** Do not display controls for functionality that is not fully implemented.

## 2. MVP scope

### 2.1 Included

- Define fitness goals and basic training preferences.
- Maintain an exercise library with exercise-specific tracking rules.
- Create and edit reusable workout routines.
- Generate dated workout sessions from a routine.
- View and adjust the upcoming weekly plan.
- Start a planned workout and record actual sets.
- Record actual repetitions and weight where supported.
- Resume interrupted active workouts.
- View completed workout history.
- Correct actual set records without rewriting the historical prescription.
- Calculate simple, explainable progression suggestions.
- Suggest constrained variations within the user's existing routine structure.
- Persist data to the existing authenticated user's data store.
- Validate inputs and provide clear loading, empty, error, and recovery states.

### 2.2 Explicitly out of scope

- AI-generated training programs or unrestricted exercise substitutions.
- Automatic routine restructuring or automatic progression.
- Advanced periodization, fatigue modelling, deload automation, or readiness scoring.
- A social feed, coaching marketplace, or multi-user collaboration.
- A dedicated rest timer.
- Full cardio, distance, duration, and interval-training support unless the existing scope explicitly requires these.
- Application-wide dashboard, home-screen, or navigation redesign.
- A new backend or wholesale replacement of the existing persistence architecture.

These exclusions prevent the MVP from becoming a general-purpose training platform before its core workflow is reliable.

## 3. Architecture

### 3.1 Proposed module files

Use the existing repository's naming and folder conventions. If they match the reviewed structure, use:

```text
public/modules/fitnessPlanner/
├── fitnessPlanner.html
├── fitnessPlanner.js
├── fitnessPlanner.engine.js
├── fitnessPlanner.service.js
├── fitnessPlanner.css
└── context.md
```

Responsibilities:

| File | Responsibility |
|---|---|
| `fitnessPlanner.html` | Module structure and semantic UI containers. |
| `fitnessPlanner.js` | UI orchestration, event handling, rendering, and module initialization. |
| `fitnessPlanner.engine.js` | Pure domain logic, validation, date handling, progression calculations, and state transitions. |
| `fitnessPlanner.service.js` | Persistence operations and conversion between domain data and stored documents. |
| `fitnessPlanner.css` | Module-specific presentation, following existing design conventions. |
| `context.md` | Module-specific guidance for future coding sessions, invariants, and implementation notes. |

These are proposed boundaries, not permission to duplicate existing abstractions. If the repository already has an established service or module pattern, adapt to it and document the deviation.

### 3.2 Dependency direction

```text
HTML / CSS
    ↑
UI controller
    ├── Domain engine
    └── Persistence service
            └── Existing Firebase infrastructure
```

The domain engine must not import Firebase, manipulate the DOM, or depend on application-specific global state.

The persistence service must not contain business rules that belong in the engine. The UI controller should orchestrate the two without duplicating domain calculations.

### 3.3 Integration requirements

Before implementation, verify:

- How modules are loaded and initialized.
- Whether the application uses native ES modules.
- How the current authenticated user is obtained.
- Which Firebase SDK version and import mechanism are used at runtime.
- Whether Firestore has already been initialized and whether persistence is configured.
- How styles are registered and navigation is handled.
- Which existing shared components and utilities should be reused.

Do not introduce a second Firebase initialization or persistence setup simply to support this module.

## 4. Domain model

The model separates the user's preferences, reusable training definitions, dated intentions, and actual workout records.

### 4.1 Fitness profile

One document per user.

Suggested fields:

```js
{
  schemaVersion: 1,
  goals: [],
  preferredTrainingDays: [],
  preferredUnits: {
    weight: "kg"
  },
  progressionPreferences: {
    enabled: true,
    incrementKg: 2.5
  },
  updatedAt: timestamp
}
```

The example uses kilograms as the initial default. Support pounds only if the conversion and display paths are implemented consistently.

Do not invent a comprehensive goal taxonomy at this stage. Start with the goals and preferences required by the approved UI scope.

### 4.2 Exercise

An exercise defines what movement is performed and how its performance is recorded.

Suggested fields:

```js
{
  schemaVersion: 1,
  name: "Example exercise",
  category: "strength",
  trackingType: "WEIGHT_AND_REPS",
  laterality: "BILATERAL",
  equipment: [],
  isArchived: false,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

Initial tracking types:

- `WEIGHT_AND_REPS`
- `REPS_ONLY`

The schema may reserve identifiers for future tracking types, but the UI must not expose unsupported ones.

`laterality` should distinguish bilateral exercises from unilateral exercises. If unilateral logging is included in the MVP, each recorded set represents one side, with an explicit `LEFT` or `RIGHT` value. The UI must make it clear whether the user is logging one side or both.

Archived exercises remain available to historical sessions. Archiving must not invalidate past records.

### 4.3 Reusable routine

A routine describes a repeatable workout template.

```js
{
  schemaVersion: 1,
  name: "Upper body A",
  isArchived: false,
  exercises: [
    {
      occurrenceId: "stable-occurrence-id",
      exerciseId: "exercise-id",
      order: 0,
      targetSets: 3,
      repMin: 8,
      repMax: 12,
      restSeconds: null,
      notes: ""
    }
  ],
  createdAt: timestamp,
  updatedAt: timestamp
}
```

Requirements:

- `occurrenceId` is stable and unique within the routine.
- `exerciseId` references the exercise definition.
- Exercise order is explicit.
- Targets are validated before saving.
- Optional values remain optional; the UI must not silently invent values.
- Editing a routine affects future planning, not already-created session snapshots.

If the same exercise appears twice in one routine, each occurrence needs a different `occurrenceId`.

### 4.4 Dated planned session

A planned session represents an intention to train on a particular local calendar date.

```js
{
  schemaVersion: 1,
  routineId: "routine-id",
  localDate: "2026-10-12",
  status: "PLANNED",
  workoutSessionId: null,
  prescriptionSnapshot: {
    // Routine and exercise targets copied at planning time.
  },
  createdAt: timestamp,
  updatedAt: timestamp
}
```

The `prescriptionSnapshot` is important: a subsequent routine edit must not change what an already-planned workout was intended to contain.

If the user explicitly chooses to update a planned session from a modified routine, create a new snapshot or apply a clearly defined edit operation.

### 4.5 Actual workout session

An actual session records the workout execution.

```js
{
  schemaVersion: 1,
  plannedSessionId: "planned-session-id",
  routineId: "routine-id",
  status: "ACTIVE",
  startedAt: timestamp,
  completedAt: null,
  prescriptionSnapshot: {},
  schemaMetadata: {},
  createdAt: timestamp,
  updatedAt: timestamp
}
```

The workout session retains its own prescription snapshot so the historical record does not depend on the current routine.

`status` is authoritative. Do not infer completion merely because all currently visible sets appear to have values.

### 4.6 Actual set

Each actual set is stored independently from the workout session document.

```js
{
  schemaVersion: 1,
  occurrenceId: "stable-occurrence-id",
  setNumber: 1,
  side: null,
  trackingType: "WEIGHT_AND_REPS",
  reps: 10,
  weight: 40,
  completedAt: timestamp,
  updatedAt: timestamp
}
```

Use deterministic set document IDs derived from stable identifiers such as the exercise occurrence, set number, and side. Do not derive IDs from array indexes or current display order.

This enables an individual set to be saved or corrected without rewriting a large workout document.

Validate values against the exercise's tracking type. For example, a `REPS_ONLY` set must not depend on a weight value.

## 5. Persistence design

### 5.1 Proposed Firestore paths

Under the existing authenticated user's document:

```text
users/{userId}/fitnessProfile/current
users/{userId}/fitnessExercises/{exerciseId}
users/{userId}/fitnessRoutines/{routineId}
users/{userId}/fitnessPlannedSessions/{plannedSessionId}
users/{userId}/fitnessWorkoutSessions/{workoutSessionId}
users/{userId}/fitnessWorkoutSessions/{workoutSessionId}/sets/{setId}
```

These are proposed paths. Verify compatibility with existing Firestore naming, security rules, and data ownership conventions before implementation.

### 5.2 Persistence rules

- All reads and writes are scoped to the authenticated user.
- Do not accept a user ID supplied by the UI as proof of authorization.
- Use existing Firebase initialization and service conventions.
- Persist each set independently.
- Use server timestamps where appropriate for audit fields, but use local calendar dates for schedule identity.
- Handle loading, offline, permission, and network failures explicitly.
- Avoid silently converting failed writes into successful UI states.
- Do not delete historical records as a side effect of archiving a routine or exercise.

### 5.3 Multi-tab and offline behaviour

Before implementing Firestore persistence, inspect the existing SDK and persistence configuration.

If supported by the installed SDK and compatible with the application's existing initialization, use the established offline-persistence strategy. Multi-tab persistence must be enabled only where the SDK and application lifecycle support it.

Do not assume IndexedDB is a complete backup or that every offline write is already synchronized. The UI should distinguish a locally pending operation from a confirmed server write when the existing infrastructure exposes that distinction.

If configuring persistence conflicts with an existing Firebase setup, stop and report the conflict rather than initializing competing persistence layers.

### 5.4 Session-start idempotency

Starting a planned session must not accidentally create multiple active workout records.

Use the planned session's persisted `workoutSessionId` as the stable target. A transaction or equivalent supported atomic operation should create or reuse the intended workout record and update the planned session consistently.

Verify the chosen operation against the actual SDK and transaction constraints. If it cannot be implemented safely with the available infrastructure, stop and present the smallest viable alternatives before proceeding.

## 6. Workout lifecycle

### 6.1 Planned-session states

```text
PLANNED ──→ STARTED
   │
   ├──────→ SKIPPED
   └──────→ CANCELLED
```

`STARTED` indicates that an actual workout session exists or is being resumed. `SKIPPED` means the user chose not to perform it. `CANCELLED` means the plan was intentionally removed or cancelled.

Do not mark a workout as skipped simply because its scheduled date has passed.

### 6.2 Actual-session states

```text
ACTIVE ──→ COMPLETED
   │
   └──────→ ABANDONED
```

- `ACTIVE`: the user is still recording or may resume the workout.
- `COMPLETED`: the user explicitly completed the workout.
- `ABANDONED`: the user explicitly discarded or abandoned an active session.

Abandonment should require confirmation. An interrupted session must not be automatically marked abandoned.

An abandoned session is not automatically resumable in the MVP. If the product later requires restoring abandoned sessions, introduce that behaviour deliberately.

### 6.3 Completion rules

When completing a workout:

1. Present a summary of completed, skipped, and unfinished work.
2. Let the user confirm the final outcome.
3. Persist the completion status and timestamp.
4. Preserve unfinished sets as unfinished; do not fabricate performance records.
5. Keep the historical prescription unchanged.

Completed actual sets may be corrected later if needed, with appropriate validation. Such corrections must not silently alter the original prescription or rerun historical progression decisions without an explicit rule.

## 7. Dates and scheduling

The weekly plan uses the user's local calendar dates.

Never create a schedule date by taking an ISO UTC timestamp and slicing its first ten characters. That can shift the intended date around timezone boundaries.

Use a dedicated date helper that builds and formats `YYYY-MM-DD` from local calendar components.

The helper should cover:

- Current local date.
- Week start and end.
- Adding or subtracting calendar days.
- Comparing local date strings.
- Generating dates for a weekly plan.

Keep date calculations in the pure engine and test timezone-sensitive behaviour where the runtime permits it.

The MVP does not require a recurring scheduling engine. The reusable routine plus dated planned sessions is sufficient to generate and adjust a weekly plan.

## 8. Progression engine

### 8.1 Principles

Progression suggestions must be deterministic, explainable, and explicitly accepted by the user.

The engine should return a structured result rather than changing a routine directly.

### 8.2 Initial rule

For `WEIGHT_AND_REPS` exercises:

1. Find the most recent eligible completed workout for the exercise.
2. Verify that all prescribed working sets for that exercise were completed.
3. Verify that each completed working set reached or exceeded the prescribed upper repetition target.
4. If every condition is satisfied, propose the next configured weight increment.
5. Present the evidence and let the user accept, edit, or reject the suggestion.

The initial MVP can use one qualifying completed session as the trigger. More advanced confirmation rules can be introduced later.

The default increment may be 2.5 kg, with the profile allowing a different configured increment. Unit conversion must be consistent if pounds are supported.

Do not apply this rule to `REPS_ONLY` exercises unless a separate progression rule has been explicitly designed and tested.

### 8.3 Structured result

```js
{
  status: "SUGGESTED",
  exerciseId: "exercise-id",
  currentTarget: {},
  proposedTarget: {},
  reason: "All prescribed working sets reached the upper rep target."
}
```

Possible outcomes should include clear states such as:

- `SUGGESTED`
- `NOT_ELIGIBLE`
- `INSUFFICIENT_HISTORY`
- `UNSUPPORTED_TRACKING_TYPE`

These are illustrative identifiers; align naming with existing conventions.

The engine must not silently modify the routine. Applying an accepted suggestion is a separate operation that updates the appropriate future target.

### 8.4 Out of scope

The initial engine does not calculate deloads, readiness, fatigue, or RPE/RIR-based progression. It does not automatically increase weight based on an incomplete or ambiguous session.

## 9. Guided variations

The MVP may suggest variations within the user's existing structure, but must not generate an entirely new training program.

Supported variation actions may include:

- Reordering planned exercises.
- Selecting a user-approved substitution from an existing, compatible exercise list.
- Editing a future session's targets.
- Accepting, editing, or rejecting a suggestion.

Any substitution must be compatible with the exercise's supported tracking type and required equipment or movement constraints, where those constraints are actually modelled.

A variation changes the future plan only. It must not rewrite a started or completed workout.

Do not add AI-generated substitutions until the data model, validation, user controls, and scope explicitly support them.

## 10. User interface and accessibility

The core flow should be:

1. Configure the fitness profile.
2. Create or select exercises.
3. Build a reusable routine.
4. Generate or edit dated planned sessions.
5. Start a planned workout.
6. Record and save sets as they happen.
7. Resume an interrupted session when returning.
8. Complete the workout and review its summary.
9. Review history and progression suggestions.

### UX requirements

- Provide clear empty states for a new user.
- Show saving, saved, pending, and failed states as supported by the persistence layer.
- Do not clear an input before its write has been safely handled.
- Keep active-session recovery discoverable during module initialization.
- Offer a resume action when an active session exists.
- Avoid adding a global Home banner or changing application routing for the MVP.
- Confirm destructive operations.
- Preserve keyboard access, semantic labels, and visible focus.
- Escape user-provided text before inserting it into HTML.
- Do not expose controls for unsupported tracking types or progression actions.

A dedicated rest timer is not part of the MVP.

## 11. Validation and error handling

Validation belongs in the domain engine, with the UI presenting understandable messages.

Examples:

- Routine names must not be blank.
- Set counts must be positive integers.
- Repetition targets must be valid integers and `repMin` must not exceed `repMax`.
- Weights must be finite and non-negative.
- Set numbers must be positive integers.
- Unilateral sets require a valid side if unilateral logging is enabled.
- Each tracking type must enforce its own required fields.
- Referenced exercises must exist or be represented by a valid historical snapshot.
- State transitions must follow the lifecycle rules.
- Invalid or incomplete data must not qualify for progression.

Persistence failures should preserve recoverable user input and offer a clear retry path where safe. Never retry a non-idempotent operation blindly.

## 12. Testing strategy

Use the repository's existing test infrastructure if one already exists. Otherwise, `node:test` is the proposed default for the pure engine, subject to the actual Node configuration.

### 12.1 Domain-engine tests

Cover:

- Routine validation.
- Set validation by tracking type.
- Stable set identity.
- Lifecycle transition validity.
- Local date and week calculations.
- Session snapshot independence from later routine edits.
- Progression eligibility and ineligibility.
- Unsupported tracking types.
- Unilateral-side validation if supported.
- Incomplete and skipped sets.
- Duplicate or invalid identifiers.

### 12.2 Persistence tests

Test the service through existing test doubles or the repository's established emulator approach.

Cover:

- User-scoped reads and writes.
- Session start idempotency.
- Set creation and correction.
- Planned-session updates.
- Resume lookup.
- Completion persistence.
- Permission failures.
- Network failures and retry behaviour.
- No accidental deletion of historical records.

### 12.3 Manual verification

Before release, verify:

- Create a routine and schedule it for a specific date.
- Start it and record multiple sets.
- Refresh or leave and return to the module.
- Resume the active session without duplicating it.
- Complete a workout with unfinished sets.
- Confirm unfinished sets remain unfinished.
- Edit the routine and verify historical snapshots remain unchanged.
- Confirm progression is suggested only when eligible.
- Reject a progression suggestion and verify targets remain unchanged.
- Verify unauthorized access is prevented by the existing security rules.

## 13. Repository verification gates

The following are **not considered confirmed by this design alone** and must be inspected before implementation:

- [ ] Actual repository branch, working tree, and relevant module files.
- [ ] Runtime Firebase SDK version and import mechanism.
- [ ] Existing Firestore initialization and persistence configuration.
- [ ] Authentication and user-data path conventions.
- [ ] Firestore security rules for the proposed collections.
- [ ] Module loading, routing, and CSS registration.
- [ ] Existing test runner, Node version, and test conventions.
- [ ] Required Firestore indexes, if any.
- [ ] Whether repository changes already exist that overlap with this module.
- [ ] Whether the proposed file names and collection paths match existing conventions.

If the repository differs from the design, do not force it into the proposed structure. Identify the conflict, explain its impact, and offer the smallest compatible adjustment.

## 14. Implementation plan

Estimates below are approximate focused development time, excluding unexpected repository or environment issues.

| Task | Scope | Estimate |
|---|---|---:|
| 1. Repository and integration verification | Inspect existing architecture, SDK, persistence, rules, tests, and working tree. | 45–90 min |
| 2. Domain engine foundation | Define schema constants, validation, date helpers, and lifecycle transitions with unit tests. | 1.5–2.5 h |
| 3. Persistence integration | Implement the service using existing Firebase infrastructure and validate the data paths. | 1–2 h |
| 4. Exercise library | Create, edit, archive, and validate supported exercise definitions. | 2–3 h |
| 5. Routine management | Create and edit reusable routines with stable exercise occurrences and targets. | 2–3 h |
| 6. Weekly planning | Create dated sessions from routines and edit the upcoming plan. | 2–3 h |
| 7. Live workout logging | Start sessions, record sets, save independently, and complete workouts. | 3–4 h |
| 8. Recovery and resumption | Find active sessions, resume safely, and handle interrupted workflows. | 1.5–2.5 h |
| 9. History and corrections | Display completed sessions and allow validated corrections to actual sets. | 2–3 h |
| 10. Progression suggestions | Implement and test the initial explicit rep-range progression rule. | 1.5–2.5 h |
| 11. Guided variations | Add constrained suggestions and user-controlled acceptance. | 1.5–2.5 h |
| 12. Release verification | Run tests, validate persistence and security, fix integration defects, and document limitations. | 2–3 h |

**Estimated total: approximately 21–32 hours.**

This is a planning estimate, not a commitment. Repository verification may change the total, especially if persistence, security rules, or module loading require additional work.

### Recommended implementation order

Tasks 1–3 are the initial technical gate. Do not begin feature implementation until the repository integration approach is confirmed.

After that, tasks 4–8 establish the primary end-to-end workflow. Tasks 9–11 extend the experience, and task 12 verifies the complete module.

Each task should be implemented and tested in a separate focused development session where practical.

## 15. Development-session instructions

Use the following instructions when delegating an implementation task to GitHub Copilot or another coding assistant:

> Implement only the specified Fitness Planner task.
>
> Before editing, inspect the relevant source files, repository conventions, and existing tests. Treat the approved product scope, this technical design, and existing architectural decisions as constraints.
>
> If the task conflicts with the actual repository, an existing architecture decision, the Firebase SDK, persistence behaviour, or the established data model, stop before making speculative changes. Report the conflicting assumption, provide the relevant evidence, explain the impact, and propose the smallest viable alternatives.
>
> Do not silently broaden the task, introduce unrelated refactors, duplicate existing infrastructure, or repeatedly retry a failing approach without new evidence.
>
> Add or update tests for the behaviour changed. Run the relevant test suite and report the commands executed, results, files changed, known limitations, and any remaining decisions.
>
> Do not claim that tests, persistence, or security checks passed unless they were actually executed and verified.

## 16. Definition of done

The MVP is ready for release when:

- The module integrates with the existing application without duplicating shared infrastructure.
- Exercises, routines, and dated planned sessions can be created and managed.
- Actual sets are recorded independently and survive ordinary navigation or refresh.
- An active workout can be resumed without creating a duplicate session.
- Completing a workout preserves unfinished work accurately.
- Routine edits do not silently rewrite historical prescriptions.
- Progression suggestions are deterministic, explainable, and user-approved.
- Invalid inputs and persistence errors are handled clearly.
- Data access follows the application's authentication and security conventions.
- The relevant automated tests pass.
- The manual verification checklist has been completed.
- The module context file documents the implemented architecture and any deliberate deviations.

## 17. Final decisions and remaining checks

**Decisions established by this design**

- Strength-first MVP with a flexible weekly plan.
- Reusable routine templates and separately dated sessions.
- Explicit planned, active, and completed lifecycle.
- Per-set persistence and active-session recovery.
- Historical prescription snapshots.
- Pure domain engine separated from persistence and UI orchestration.
- Explicit, user-approved progression suggestions.
- Constrained variations rather than unrestricted program generation.
- No application-wide Home banner or routing redesign in the MVP.
- `schemaVersion: 1` for newly introduced persisted records, with migration needs evaluated before any existing data is changed.
- `node:test` as the proposed pure-engine test runner, subject to repository verification.

**Items that remain repository-dependent**

- Exact file names and placement.
- Exact collection names and security-rule changes.
- Firebase SDK calls and persistence configuration.
- Atomic session-start implementation.
- Test-runner integration and release commands.
- Any required indexes or data migration.