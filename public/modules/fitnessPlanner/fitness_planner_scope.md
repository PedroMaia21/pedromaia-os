# Fitness Planner — Product Scope

- **Document status:** Product scope draft for repository review
- **Version:** 0.3
- **Date:** 2026-10-10
- **Implementation status:** Not yet started; repository review required before technical design
- **Product:** Personal OS

## 1. Purpose

The Fitness Planner is a personal strength-training management module within Personal OS. It helps the user organize training around real-life constraints, record workouts while training, understand performance over time, and make informed training decisions.

The module is not merely a workout logger and is not intended to be an autonomous fitness coach. It combines structured planning, reliable workout execution and history, and limited, explainable training guidance while keeping the user in control.

### Mission statement

> Help me organize my strength training around my real life, record what I actually do, understand how my performance evolves, and make better training decisions over time.

## 2. Product principles

1. **Personal use first.** Optimize for one user's routines, preferences, and workflow. Multi-user support is not an MVP requirement.
2. **Strength training first.** The initial scope focuses on resistance/strength workouts. Other fitness disciplines may be considered later.
3. **Flexible planning.** Plans provide structure without assuming that every workout happens on its originally planned day.
4. **Low-friction live logging.** Workout logging is designed for use between sets, on a phone, with minimal interaction and typing.
5. **Durable in-progress data.** Each logged set is saved as it is entered. An unfinished workout can be recovered and resumed.
6. **History is trustworthy.** Editing a routine must not rewrite what was prescribed or performed in a completed workout.
7. **Guidance is explainable and user-controlled.** Suggestions state their rationale and require user approval before changing a training prescription.
8. **Extend Personal OS.** Follow the existing application's architecture and conventions; do not introduce a separate competing application architecture without a repository-backed reason.
9. **Avoid speculative abstraction.** Keep the model coherent and extensible, but do not build generalized systems for hypothetical future features.
10. **No external dependency for the core workflow.** Manual data entry must be sufficient to plan, execute, and review training.

## 3. Goals and success criteria

The module should enable the user to:

- Define personal training goals and establish a training structure they approve.
- Maintain a reusable weekly training template.
- Create concrete, dated workout sessions from that structure.
- Move, skip, modify, or add sessions without corrupting the plan or history.
- Start and log a workout live, recording actual performance as the workout proceeds.
- Leave and return to an unfinished workout without losing previously logged sets.
- Review completed workouts and compare exercise performance over time.
- Receive understandable rep-range-based load suggestions and decide whether to apply them.
- Receive suggestions for suitable exercise variations within the approved training structure, without being forced to accept them.

The MVP should be considered successful when the user can complete this end-to-end cycle reliably:

**Configure training → plan week → start session → log sets live → finish session → review history → evaluate and optionally approve a suggestion.**

## 4. Target user and assumptions

### Target user

A single user who wants a personal strength-training system, currently defines their own routine and goals, prefers flexible weekly planning, and wants more help interpreting performance than a basic workout-history app provides.

### Confirmed product decisions

- Primary purpose: integrated fitness management focused initially on strength training.
- Planning model: reusable weekly template plus concrete dated sessions.
- Scheduling: keep training plans inside Fitness Planner initially; no required integration with the general Personal OS scheduler.
- Data capture: manual entry.
- Architecture: extend the existing Personal OS architecture.
- Session lifecycle: a planned session exists when scheduled; starting it makes it active; finishing records its outcome.
- Set data: strength-training set model with optional fields to accommodate exercises that do not use an ordinary external load.
- History: preserve completed records and snapshot relevant routine details.
- Progression: explicit rep-range-based suggestions, requiring user approval.
- Variety: suggest variations within a user-approved training structure.
- Active workout persistence: save each logged set and recover unfinished sessions.
- Initial training structure: the user defines their current routine and goals; the app does not require automated program generation.

## 5. In-scope capabilities

### 5.1 Training profile and structure

The user can record the goals, preferences, and constraints that materially influence their training. The user establishes their initial training structure and routines.

The MVP should not require a comprehensive health profile. Only collect profile data needed by an in-scope workflow.

### 5.2 Exercise library

The user can create and maintain a personal library of exercises and reuse them in routines.

Exercise definitions should support the information needed to prescribe and record strength training. Do not assume every exercise uses an external weight or the same measurement fields.

External exercise-database integration is not required.

### 5.3 Routine management

The user can create and edit reusable workout routines, including exercise order, target sets and rep ranges, and relevant optional parameters such as rest targets or notes where appropriate.

A routine is a reusable prescription, not a workout that has already occurred. Routine edits affect future use and must not rewrite completed workout history.

### 5.4 Weekly planning and dated sessions

The module supports:

- A reusable weekly template representing the user's preferred training structure.
- Concrete dated sessions created from that structure.
- Moving sessions to different dates.
- Marking sessions skipped or otherwise recording that the plan changed.
- Creating an unplanned workout when needed.
- Maintaining a distinction between the reusable template, dated session, and actual completed workout.

The module owns its own training plan and session dates in the MVP. It does not own the user's general calendar, reminders, or task management.

### 5.5 Guided variety

The app may suggest exercise variations within the user's approved training structure to reduce unnecessary repetition while retaining meaningful continuity.

Suggestions should be reviewable and should not silently change the approved structure. The exact variation rules and minimum viable implementation remain to be defined.

Variety is not the same as progression:
- **Variation** concerns exercise selection or another appropriate program parameter.
- **Progression** concerns how the training prescription changes in response to performance.

### 5.6 Live workout execution and logging

A planned session can be started and enters an active state. The live interface presents the exercises and targets relevant to the workout and enables the user to record actual performance with low interaction cost.

The user can record sets during the workout, correct entries, handle deviations from the prescription, and finish the session. An unplanned workout can also be started.

Each logged set must be saved as it is entered. If the user leaves the interface or the application is interrupted, previously saved sets must remain available and the unfinished session must be recoverable.

The exact interface controls are a UX decision, but live logging and recovery are MVP requirements—not a later enhancement.

### 5.7 Completed workout history and data integrity

Finishing a session records the actual outcome. Completed workout history must preserve the relevant prescription snapshot and actual recorded results, even if the source routine or exercise definition changes later.

The design must distinguish, at minimum:
- Reusable routine/template.
- Planned, dated session.
- Active, unfinished workout execution.
- Completed workout record and its actual set results.

The final domain model and terminology should be validated against existing Personal OS conventions during repository review.

### 5.8 Progress history and summaries

The module displays useful, verifiable information derived from recorded data, such as:
- Previous performance for an exercise.
- Comparisons across comparable sessions.
- Personal bests where the relevant metric is well-defined.
- Basic performance trends over time.

Do not present comparisons as meaningful where exercise definitions, units, equipment, or recorded fields make the data incomparable. The first release does not require advanced analytics or prediction.

### 5.9 Rep-range-based progression suggestions

The app supports explicit, testable progression rules for suitable exercises. For example, a configured rule may suggest increasing the load after the prescribed sets consistently reach the upper end of a target rep range.

Every suggestion should:
- Be based on recorded data and an identifiable rule.
- Explain why it was suggested.
- Propose a change without silently applying it.
- Require explicit user approval before changing the relevant future prescription.
- Leave completed workout records unchanged.

The exact criteria, load increments, handling of incomplete or incomparable data, and destination of an approved change must be finalized before implementing the progression engine. The MVP should begin with a small rule set, not an opaque or universal coaching system.

## 6. Out of scope for the initial release

The following are explicitly deferred unless repository review reveals an existing required dependency or the product scope is deliberately revised:

- General Personal OS calendar, task, reminder, or habit management.
- Automatic synchronization with the global scheduler.
- Nutrition, meal logging, calorie or macro tracking.
- Wearable and health-platform integration or automatic imports.
- Comprehensive sleep, recovery, readiness, or health tracking.
- Medical advice, diagnosis, or injury-treatment recommendations.
- Autonomous program generation or autonomous plan modification.
- Complex predictive analytics or an opaque AI coaching engine.
- Social features, shared plans, multi-user accounts, or community features.
- External exercise catalog integrations.
- Support for every fitness discipline from the first release.

These are MVP exclusions, not a claim that they can never be considered.

## 7. Core workflows

### Workflow A — Establish training

1. The user defines their goals and initial training structure.
2. The user creates or edits exercises and routines.
3. The user establishes a reusable weekly template.

### Workflow B — Plan a week

1. The user applies or reviews the weekly template.
2. The module creates concrete dated sessions.
3. The user reviews proposed exercise variations where available.
4. The user accepts, edits, or rejects proposals.
5. The user can move or skip sessions as real-life constraints change.

### Workflow C — Perform a workout

1. The user starts a planned session or creates an unplanned workout.
2. The module enters an active workout state.
3. The user logs actual sets as they train.
4. Each set is saved as entered.
5. The user can correct entries and resume after interruption.
6. The user finishes the workout, creating a completed record.

### Workflow D — Review and improve

1. The user reviews the completed workout and previous performance.
2. The module evaluates configured progression rules where sufficient comparable data exists.
3. The module presents an explainable suggestion, if warranted.
4. The user accepts or rejects the suggestion.
5. An accepted suggestion updates the appropriate future prescription without changing history.

## 8. Domain concepts to validate during repository review

These are conceptual responsibilities, not a final schema or commitment to particular class/table names.

- **Training profile / goals:** user-defined training context.
- **Exercise:** reusable exercise definition and relevant measurement characteristics.
- **Routine:** reusable training prescription.
- **Routine exercise/item:** exercise placement and prescription within a routine.
- **Weekly template:** reusable weekly arrangement of intended sessions.
- **Planned session:** a concrete session on a date, linked to the relevant routine or prescription.
- **Active workout:** in-progress execution with durable set-by-set logging and recovery.
- **Completed workout:** preserved record of what occurred, including relevant prescription snapshot.
- **Recorded set:** actual performance fields, with optional values appropriate to the exercise.
- **Progression rule / suggestion:** explicit rule evaluation and a proposed future change awaiting user decision.
- **Variation suggestion:** proposed modification within the approved training structure.

Repository review must determine whether existing entities or patterns should be reused, whether some concepts should be represented as states rather than separate persisted entities, and how persistence and migrations are handled.

## 9. Non-functional and integrity requirements

- **Durability:** each logged set is persisted as it is entered; interruptions do not discard previously saved work.
- **Recoverability:** unfinished workouts can be reopened and resumed without duplicating already saved sets.
- **Historical integrity:** completed records retain relevant prescribed and actual values despite later edits.
- **Consistency:** session state transitions and completion behavior are explicit and validated.
- **Usability:** live logging minimizes navigation and unnecessary typing.
- **Explainability:** progression and variation suggestions communicate their basis.
- **User control:** suggestions do not change the plan without approval.
- **Testability:** domain rules are testable independently of the interface where the existing architecture permits.
- **Architectural fit:** follow Personal OS conventions for modules, persistence, navigation, validation, error handling, and tests.

## 10. Remaining material decisions

The product direction is sufficiently defined for repository review, but the following decisions should not be silently guessed during implementation.

### A. Progression rule details

- Whether all prescribed sets must reach the upper rep limit, and how many comparable sessions are required.
- How to handle incomplete sets, missing loads, changed exercises, and incomparable equipment or units.
- How to choose load increments when equipment availability differs.
- Whether approval updates the routine, the next planned session, or both.
- How to handle rejection or dismissal and whether the same suggestion should reappear.

### B. Guided variation behavior

- Which training parameters can vary in the MVP.
- Which constraints must remain fixed to preserve the user's approved structure.
- Whether suggestions are generated when planning a week, when editing a routine, or both.
- How the user sees the rationale and accepts, edits, or rejects a variation.

### C. Session and workout edge cases

- Exact rules for cancelling, skipping, moving, restarting, or abandoning a session.
- What happens when a planned session's routine is edited after the session was created but before it starts.
- Whether a completed workout can be corrected, and what audit or edit behavior is required.
- How an unfinished session is surfaced to the user on return.

### D. Set data and measurement semantics

- Supported fields for the first release and which are optional by exercise type.
- Units and unit conversion behavior.
- How bodyweight, assisted, unilateral, timed, or other non-standard movements should be represented if needed.
- Which personal-best metrics are reliable enough to display.

### E. Product UX details

- Exact live workout layout and interaction design.
- Rest timer behavior, if any.
- Whether previous-set values are shown as entry defaults and how defaults can be corrected.
- Whether routine and session edits require confirmation in particular cases.

These should be prioritized after repository inspection. Do not let lower-impact UX details block the initial architectural review.

## 11. Repository review required before implementation planning

Inspect the existing Personal OS repository and document evidence for:

1. Module structure, naming, boundaries, and dependency conventions.
2. Navigation and UI component patterns, including responsive/mobile behavior relevant to live logging.
3. Persistence layer, entity conventions, migrations, and data validation.
4. Existing scheduling, task, habit, or recurrence abstractions, without making them mandatory dependencies for the MVP.
5. State management and persistence patterns suitable for durable active-workout state.
6. Testing structure and conventions for domain, persistence, and UI workflows.
7. Existing design-system components and accessibility conventions.
8. Build, lint, type-check, test, and migration-validation commands.

Do not infer repository conventions from this scope document. If the repository conflicts with an assumption here, report the conflict and its evidence before implementation; do not silently redesign either the application or this scope.

## 12. MVP acceptance criteria

The MVP is ready for use when:

- The user can create and maintain exercises and reusable routines.
- The user can define a weekly template and create dated sessions.
- The user can move or skip sessions without corrupting history.
- The user can start planned and unplanned workouts.
- The user can record actual sets live, with each set saved as it is entered.
- The user can leave and recover an unfinished workout without losing or duplicating logged sets.
- The user can finish a workout and review the actual results later.
- Editing a routine does not rewrite completed workout history.
- The user can compare relevant exercise performance over time.
- At least one explicitly defined rep-range-based progression rule can produce an explainable suggestion from eligible data.
- Suggestions require approval before changing future training prescriptions.
- The user can review and decide on a proposed variation within their approved training structure.
- The core workflow requires no external integration.

## 13. Recommended next step

Do not begin implementation from this document alone. First perform the repository review described in Section 11.

After the review:
1. Reconcile this product scope with actual architecture and conventions.
2. Resolve material data-model and lifecycle decisions.
3. Produce a separate implementation plan with dependency-aware tasks, acceptance criteria, and estimates.
4. Begin implementation only after conflicts or assumptions requiring user decisions have been reported.

**Scope boundary in one sentence:** Fitness Planner owns personal strength-training configuration, flexible weekly planning, live workout execution, durable history, and explainable user-approved guidance; it does not own general life scheduling or broader health management in the initial release.
