# Fitness Planner — Technical Design and Implementation Plan

**Version:** 1.1  
**Date:** 2026-10-11  
**Status:** Reconciled with product scope v0.3 and Task 1 repository verification — ready for Task 2 (pure engine)  
**Scope:** Fitness Planner module MVP

## 0. Document control

### 0.1 Sources of truth and precedence

1. `fitness_planner_scope.md` (product scope v0.3).
2. Accepted architectural decisions (§23).
3. Verified repository constraints (§3; Task 1 repository verification report).
4. This design, where it does not conflict with the above.
5. Recommendations in this document, only where a decision is genuinely open (§21).

There are no ADRs, `CONTRIBUTING`, or project-instruction files in the repository. `README.md` documents the module standard, router behaviour, and "no bundler / no framework" decisions; those are treated as architectural constraints.

### 0.2 Changes in v1.1

- Added the weekly template as a persisted concept and defined how it produces dated planned sessions (§8).
- Added unplanned workouts; `plannedSessionId` is nullable and `origin` is explicit (§6.6, §9).
- Added progress comparisons and personal-best definitions with an index-free query strategy (§10).
- Replaced "inspect persistence later" with a concrete offline-durability and recovery contract based on the accepted IndexedDB persistent-cache decision (§9).
- Replaced the transaction-based session start with deterministic IDs plus write batches, which work offline (§9.3).
- Fixed SDK, identity, lifecycle, date, CSS, HTML-safety, and schema conventions (§4, §5, §13).
- Revised the task plan and dependencies (§20).

## 1. Purpose

The Fitness Planner helps the user define fitness goals, maintain reusable workout routines and a weekly template, plan workouts on specific dates, record actual performance live, recover interrupted sessions, review progress, and receive transparent, user-approved progression and variation suggestions.

The MVP is strength-first. It prioritizes reliable workout execution and historical accuracy over sophisticated optimization.

### 1.1 Product principles

1. **Planning and execution are separate.** A planned session describes what the user intends to do; a workout session records what actually happened.
2. **The user remains in control.** Progression and exercise variations are suggestions, not automatic changes to the user's routine.
3. **Completed history is trustworthy.** Editing a routine, exercise, or template must not rewrite previous workouts.
4. **Recording a set is a durable operation.** A refresh or accidental navigation must not cause recorded work to disappear (subject to the guarantees and limits in §9.5).
5. **Recovery is built into the workflow.** Interrupted active workouts are identified and resumable from the module's initialization flow.
6. **The module fits the existing application.** Reuse the existing authentication, Firestore instance, router, and styling.
7. **Unsupported behaviour is explicit.** Do not display controls for functionality that is not fully implemented.

## 2. MVP scope

### 2.1 Included

- Fitness profile: goals, notes/constraints, unit and progression preferences (scope §5.1).
- Personal exercise library with tracking type and laterality (scope §5.2).
- Reusable routines with ordered, prescribed exercise occurrences (scope §5.3).
- A reusable weekly template and dated planned sessions created from it; manual planned sessions; move, skip, cancel (scope §5.4).
- Live logging of planned **and unplanned** workouts, with each set saved as entered (scope §5.6).
- Interruption recovery and resume (scope §5.6, §9).
- Completed-workout history and validated corrections of actual sets (scope §5.7).
- Previous-performance display, comparable-session comparisons, personal bests, and basic trends (scope §5.8).
- One explicit rep-range progression rule with user approval (scope §5.9).
- Constrained, user-approved variation suggestions (scope §5.5).
- Clear loading, empty, offline, pending, error, and recovery states.

### 2.2 Explicitly out of scope

- AI-generated training programs or unrestricted exercise substitutions.
- Automatic routine restructuring or automatic progression.
- Advanced periodization, fatigue modelling, deload automation, readiness scoring, RPE/RIR progression.
- Estimated one-rep-max or other predictive metrics.
- Social features, shared plans, or multi-user collaboration.
- A dedicated rest timer.
- Cardio, distance, duration, and interval tracking.
- Pound units (kg only in MVP).
- A service worker or offline app-shell loading (§9.5).
- Application-wide dashboard, Home banner, router, or navigation redesign.
- A new backend or replacement of the shared Firebase integration.

## 3. Verified repository baseline

Facts below were verified in Task 1 by source inspection unless stated otherwise.

| Area | Verified fact | Evidence |
|---|---|---|
| Runtime | Vanilla JS, native ES modules, no bundler, no framework | `README.md` "Known Technical Decisions"; `public/index.html:35` |
| Module loading | `loadModule(name)` fetches `/modules/{name}/{name}.html` into `#content`, then `import()`s `/modules/{name}/{name}.js` and calls `init()`. No teardown hook. Navigation is triggered by any clicked element with `data-route`. | `public/js/router.js:8-43` |
| Auth gate | `app.js` awaits `getCurrentUser()` and only then calls `initRouter()`; module `init()` therefore always runs with a signed-in user | `public/js/app.js:6-18` |
| Auth helper | `getCurrentUser()` registers a new `onAuthStateChanged` listener on every call and never unsubscribes | `public/js/auth.js:4-10` |
| Firebase SDK (runtime) | **10.12.2 via `https://www.gstatic.com/firebasejs/10.12.2/…`** | `public/js/firebase.js:1-3`, `auth.js:2`, `playlists.service.js:2` |
| Firebase SDK (npm) | `firebase ^12.8.0` declared and installed but not used by the browser | `package.json:8`, `npm ls` |
| Firestore init | Single shared instance `db = getFirestore(app)`; default memory cache; no persistence, emulator, transactions, batches, or queries anywhere in the repo | `public/js/firebase.js:9`; repository grep |
| SDK API availability | The 10.12.2 CDN build exports `initializeFirestore`, `persistentLocalCache`, `persistentMultipleTabManager`, `writeBatch`, `runTransaction`, `serverTimestamp`, `getDocFromServer`, `getDocsFromCache`, `waitForPendingWrites`, `onSnapshotsInSync`, `where`, `orderBy`, `limit`; it falls back to memory cache with a logged error if the persistent cache cannot start | Export list and source strings of the CDN file (Task 2A, source inspection only; not executed in a browser) |
| Rules | `match /users/{userId}/{document=**}` allows read/write when `request.auth.uid == userId`; no field validation; no collection-group rule | `firestore.rules:6-13` |
| Indexes | None declared | `firestore.indexes.json` |
| Data conventions | Per-user subcollections `users/{uid}/<camelCaseCollection>`; client `Timestamp.now()`; no `schemaVersion`; no migrations | `playlists.service.js`; `feature/foundation` side-quests service |
| Date helper | `getTodayKey()` slices a UTC ISO string — **must not be reused** | `playlists.engine.js:91-93` |
| CSS | Router loads no module CSS; shared tokens in `base.css`, components in `components.css`, mobile breakpoint 768px | `router.js`, `public/css/*` |
| HTML safety | No escaping helper; existing code interpolates user data into `innerHTML` | `playlists.js:255` |
| Tests/CI | No test framework, lint, or type check; CI runs `npm ci && npm run build` (an `echo`) and deploys Hosting only | `package.json`, `.github/workflows/*` |
| Node | Local Node v24.18.1; `node:test` available; Node parses ESM-syntax `.js` files under this `package.json` (no `"type"`) as ES modules | Task 1 command results |
| Deploy | `public/js/config.js` is gitignored but imported by `firebase.js`; CI deploys Hosting without it; Firestore rules/indexes are not deployed by CI | `.gitignore:210`, `firebase.js:5`, workflows |

## 4. Architecture

### 4.1 Module files

```text
public/modules/fitnessPlanner/
├── fitnessPlanner.html          # module markup; first element links the module stylesheet
├── fitnessPlanner.js            # init(), module context, UI orchestration, rendering, events
├── fitnessPlanner.engine.js     # pure domain logic (no imports except other pure engine files)
├── fitnessPlanner.service.js    # Firestore persistence, document mapping, query shapes
├── fitnessPlanner.css           # module styles, all selectors scoped under .fp
├── fitness_planner_scope.md     # product scope (existing)
└── technical_design_and_implementation_plan.md   # this document

tests/fitnessPlanner/
└── *.test.mjs                   # node:test suites for the pure engine
```

- Names follow the README module standard (`fitnessPlanner/fitnessPlanner.{html,js}`) and the playlists `engine`/`service` split.
- Tests live **outside `public/`** because Firebase Hosting publishes everything under `public/` except dotfiles. Test files use `.mjs` so they are ES modules regardless of `package.json`.
- A module `context.md` is created at the end of Task 3 to record the *implemented* conventions and deviations (§23.1). It must not duplicate this design.
- Navigation integration: add one sidebar button `<button data-route="fitnessPlanner" class="btn-primary">Fitness Planner</button>` to `public/index.html` (Task 4). No router change.

### 4.2 Dependency direction

```text
fitnessPlanner.html / fitnessPlanner.css
        ↑
fitnessPlanner.js (UI controller, module context)
   ├── fitnessPlanner.engine.js   (pure)
   └── fitnessPlanner.service.js
          ├── fitnessPlanner.engine.js (validation, ID builders, pure mappers)
          ├── public/js/firebase.js     (shared app, auth, db)
          └── Firestore 10.12.2 CDN functions
```

- The engine imports nothing from Firebase, the DOM, `window`, `document`, `localStorage`, or URLs. It must be importable by Node (`node --test`). It must never import the service (avoid the playlists engine↔service cycle, which makes `playlists.engine.js` unloadable in Node).
- The engine never reads the clock or generates randomness itself: `now: Date` and `randomId: () => string` are passed in.
- The service contains no business rules beyond enforcing engine validation before writes.

### 4.3 Responsibilities

| Component | Responsibilities | Must not |
|---|---|---|
| Engine | Enums, document validation, ID builders, local-date arithmetic, lifecycle transitions, prescription snapshots, performance summaries, comparisons, personal bests, progression and variation evaluation, `escapeHtml` | Import Firebase/DOM; read clock or randomness; persist |
| Service | `createFitnessService({ db, uid })` factory; paths; doc ⇄ domain mapping; Timestamp ⇄ Date conversion; batches; query shapes; subscription helpers returning unsubscribe functions; persistence error mapping | Resolve the user; contain domain rules; render |
| UI controller | `init()`; module context lifecycle (§4.6); obtain `uid` once; render; event handling; write-state display; confirmations | Duplicate domain calculations; interpolate unescaped data into HTML |
| Session recovery | Part of `init()`: subscribe to ACTIVE workout sessions, present resume/abandon choices | Auto-abandon or auto-complete anything |
| Shared infrastructure (`firebase.js`, `auth.js`) | Single app/auth/db instances; persistent cache (after Task 3A) | Be modified by feature tasks other than Task 3A |

### 4.4 SDK and dependency convention

- All Firestore functions in Fitness browser code are imported from exactly `https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`.
- `db` and `auth` are imported from `public/js/firebase.js`. Fitness code never calls `initializeApp`, `getFirestore`, or `initializeFirestore`.
- Do not import the npm `firebase` package (12.8.0) into browser modules; do not upgrade or mix SDK versions. Changing the runtime SDK requires a separate, authorized decision.
- No new runtime or dev dependencies. `node:test` and `node:assert` are built into Node.

### 4.5 User identity

- `init()` obtains the user once: `const uid = auth.currentUser?.uid ?? (await getCurrentUser())?.uid`. `auth.currentUser` is populated because `app.js` awaits authentication before `initRouter()`; the `getCurrentUser()` fallback adds at most one listener per module initialization.
- `init()` creates `createFitnessService({ db, uid })`. All service functions use the bound `uid`; none calls `getCurrentUser()`. This avoids one auth listener per set write (the playlists pattern).
- The `uid` comes from Firebase Auth, never from form input or URL. Authorization is enforced by the Firestore rule, not by the service.
- If `uid` is unavailable, render an error state and make no Firestore calls.
- Do not modify `auth.js`.

### 4.6 Module lifecycle and subscriptions

The router replaces `#content` on every navigation, never tears modules down, and the browser caches the ES module, so module-level variables survive navigation and `init()` runs again on every visit.

Rules:

1. Module-level state is limited to `let current = null;` (the active module context).
2. `init()` first calls `current?.dispose()`, then creates a new context:
   ```js
   {
     root,                 // the module's root element (#fitness-planner)
     service,
     abort: new AbortController(), // every addEventListener uses { signal: abort.signal }
     unsubscribers: [],    // every onSnapshot unsubscribe is pushed here
     disposed: false,
     alive() { return !this.disposed && this.root.isConnected; },
     dispose() { /* abort listeners, call all unsubscribers, set disposed */ }
   }
   ```
3. All UI state (current workout, cached history, form state) lives in the context, never in module-level variables. Re-entry rebuilds state from Firestore (served from the persistent cache when available).
4. Every snapshot callback and every awaited continuation starts with `if (!ctx.alive()) { ctx.dispose(); return; }`. This releases listeners lazily when the user has navigated to another module.
5. Prefer delegated listeners on `ctx.root`. Any listener on `document` or `window` must use `ctx.abort.signal`.
6. Fitness markup must not use the `data-route` attribute (the global router click handler reacts to it).
7. Known limitation: after navigating away, a Fitness listener stays attached until it next fires or Fitness is re-entered. At most one context's listeners can exist at a time.

### 4.7 Module CSS and HTML safety

- **CSS:** `fitnessPlanner.html` begins with `<link rel="stylesheet" href="/modules/fitnessPlanner/fitnessPlanner.css">`. The link is inserted with the module HTML and removed when `#content` is replaced. All selectors are scoped under the root `.fp` class; reuse `base.css` tokens and `components.css` components (`.card`, `.tabs`, `.tab-panel`, `.modal-overlay`, `.btn-*`, `.toast`, `.hidden`) before adding new styles. No changes to shared CSS, `index.html` `<head>`, or the router. *Browser application of the injected link must be confirmed manually in Task 4.*
- **HTML safety:** user-controlled or stored values (names, notes, goals, enum strings read from Firestore, numbers from documents) are inserted with `textContent`, `value`, or `setAttribute`. `innerHTML` is allowed only for developer-authored static markup, or for templates where every interpolated value passes through the engine's `escapeHtml()`. The playlists `innerHTML` interpolation pattern must not be copied.

## 5. Data conventions

### 5.1 Objects, enums, mapping

- Domain values are **plain objects**. No model classes.
- Enums are frozen objects whose values are identical UPPER_SNAKE_CASE strings, e.g. `Object.freeze({ PLANNED: "PLANNED" })`. Stored values are always these strings.
- Mapping happens in the service: `fromDoc(snapshot)` converts Firestore `Timestamp` to `Date`, adds `id`, then calls the engine validator; `toDoc(domain)` validates via the engine, converts `Date` to `Timestamp`, and adds `schemaVersion` and audit fields. The validators and the structural parts of the mappers are pure engine functions and are unit-tested.

### 5.2 Schema version

- Every Fitness document written by the module contains `schemaVersion: 1`.
- Additive, optional fields do not change the schema version. Removing, renaming, or changing the meaning of a field requires `schemaVersion: 2` and a read-time upgrade function in the service. No migration system is introduced.
- On read, a document with a missing or unknown `schemaVersion` or failing validation is returned as `{ id, invalid: true, reason }`. It is excluded from computations, reported in a non-blocking "N records could not be read" notice, and **never automatically rewritten or deleted**.

### 5.3 Identifiers

| Entity | ID | Rationale |
|---|---|---|
| Profile, weekly template | Fixed IDs `profile`, `weeklyTemplate` in `fitnessConfig` | Singletons |
| Exercise, routine | Firestore auto-ID | No natural key |
| Routine/session item | `occurrenceId`: engine-generated, `^[a-z0-9]{12}$`, unique within its routine or session | Stable across reorder; safe in set IDs |
| Template slot | `slotId`: engine-generated, same format | Stable across edits |
| Planned session (from template) | `${weekStart}_${slotId}` | Re-applying a template to a week is idempotent |
| Planned session (manual) | Firestore auto-ID | No natural key |
| Workout session (planned) | `p_${plannedSessionId}` | At most one workout per planned session; idempotent offline start |
| Workout session (unplanned) | Firestore auto-ID generated client-side (`doc(collection(...)).id`) | Works offline |
| Set | `${occurrenceId}_${setNumber}_${sideToken}`, `sideToken ∈ {B, L, R}` (B = not unilateral) | Deterministic; retries and offline sync overwrite instead of duplicating |

IDs never encode array indexes or display order. Fields, not parsed IDs, are authoritative. Generated IDs never match Firestore's reserved `__.*__` form or contain `/`.

### 5.4 Validation boundaries

- The engine validates every domain object before it is written and every document after it is read.
- The service rejects writes that fail validation before calling Firestore, throwing an engine `ValidationError` (`{ code: "VALIDATION", field, message }`).
- The UI shows validation messages next to the input and keeps the input.
- Firestore rules do not validate fields (unchanged in the MVP).

## 6. Domain model and data contracts

### 6.1 Firestore paths

```text
users/{uid}/fitnessConfig/profile
users/{uid}/fitnessConfig/weeklyTemplate
users/{uid}/fitnessExercises/{exerciseId}
users/{uid}/fitnessRoutines/{routineId}
users/{uid}/fitnessPlannedSessions/{plannedSessionId}
users/{uid}/fitnessWorkoutSessions/{workoutSessionId}
users/{uid}/fitnessWorkoutSessions/{workoutSessionId}/sets/{setId}
```

All paths are covered by the existing `users/{userId}/{document=**}` owner rule. `fitnessProfile/current` (v1.0) is replaced by the `fitnessConfig` singletons so that both singletons share one collection.

Audit fields `createdAt` and `updatedAt` are `serverTimestamp()` on every document and are never used by domain logic (§13.2).

### 6.2 Profile — `fitnessConfig/profile`

```js
{
  schemaVersion: 1,
  goals: ["string"],          // free text, user-defined; no goal taxonomy
  notes: "",                  // constraints/preferences in free text
  weightUnit: "KG",           // only KG in the MVP
  progressionIncrementKg: 2.5,
  createdAt, updatedAt
}
```

Preferred training days are not stored here; the weekly template is their single source (§8).

### 6.3 Exercise — `fitnessExercises/{id}`

```js
{
  schemaVersion: 1,
  name: "Bench press",
  trackingType: "WEIGHT_AND_REPS",  // or "REPS_ONLY"
  laterality: "BILATERAL",          // or "UNILATERAL"
  equipment: ["barbell"],           // free-text tags, informational
  notes: "",
  isArchived: false,
  createdAt, updatedAt
}
```

- Exercises are archived, never deleted, so history and snapshots remain resolvable.
- Changing `trackingType` or `laterality` is allowed, but history recorded under a different value is treated as not comparable (§10.3).
- The v1.0 `category: "strength"` field is dropped as speculative.

### 6.4 Routine — `fitnessRoutines/{id}`

```js
{
  schemaVersion: 1,
  name: "Upper body A",
  isArchived: false,
  items: [
    {
      occurrenceId: "k3j9x2m1q8zt",
      exerciseId: "exercise-id",
      order: 0,
      targetSets: 3,           // positive integer
      repMin: 8,               // positive integer
      repMax: 12,              // ≥ repMin
      targetWeight: null,      // number ≥ 0 in KG, or null (REPS_ONLY: always null)
      restSeconds: null,       // informational; no timer
      notes: ""
    }
  ],
  createdAt, updatedAt
}
```

`targetWeight` is new in v1.1 because the progression rule proposes a future load and needs a defined destination.

### 6.5 Prescription snapshot item

Planned and workout sessions hold `items` as a **map keyed by `occurrenceId`**, so a single item can be added with a field-path update.

```js
items: {
  "k3j9x2m1q8zt": {
    occurrenceId: "k3j9x2m1q8zt",
    order: 0,
    exerciseId: "exercise-id",
    exerciseName: "Bench press",       // name at snapshot time
    trackingType: "WEIGHT_AND_REPS",   // at snapshot time
    laterality: "BILATERAL",           // at snapshot time
    source: "PRESCRIBED",              // or "ADDED" (added during a workout or to an unplanned session)
    targetSets: 3, repMin: 8, repMax: 12, targetWeight: 60,  // null for ADDED items
    restSeconds: null,
    notes: ""
  }
}
```

The engine builds snapshots from a routine plus the exercise documents (`buildSnapshotItems(routine, exercisesById)`).

### 6.6 Planned session — `fitnessPlannedSessions/{id}`

```js
{
  schemaVersion: 1,
  origin: "TEMPLATE",            // or "MANUAL"
  templateSlotId: "slot-id",     // null when MANUAL
  weekStart: "2026-10-12",       // week the template was applied to; null when MANUAL
  localDate: "2026-10-14",       // current scheduled local date
  originalLocalDate: "2026-10-14",
  routineId: "routine-id",
  routineName: "Upper body A",   // at snapshot time
  items: { /* §6.5 */ },
  status: "PLANNED",
  workoutSessionId: null,        // "p_<plannedSessionId>" once started
  createdAt, updatedAt
}
```

### 6.7 Workout session — `fitnessWorkoutSessions/{id}`

```js
{
  schemaVersion: 1,
  origin: "PLANNED",              // or "UNPLANNED"
  plannedSessionId: "planned-id", // null when UNPLANNED
  routineId: "routine-id",        // null when UNPLANNED without a routine
  routineName: "Upper body A",    // null when no routine
  localDate: "2026-10-14",        // local date the workout started
  status: "ACTIVE",
  startedAt: Timestamp,           // client time (§13.2)
  completedAt: null,              // client time; set only on COMPLETED
  abandonedAt: null,              // client time; set only on ABANDONED
  items: { /* §6.5 */ },
  // Written only at completion (and rewritten on correction):
  completedExerciseIds: ["exercise-id"],
  performanceSummary: { /* §10.2 */ },
  createdAt, updatedAt
}
```

- An unplanned workout either snapshots a chosen routine (`items` with `source: "PRESCRIBED"`) or starts empty, with exercises added live (`source: "ADDED"`). No artificial planned session is created.
- Adding an exercise during any workout is `updateDoc(sessionRef, { ["items." + occurrenceId]: item })`. Prescribed items are never edited after start.

### 6.8 Set — `fitnessWorkoutSessions/{wid}/sets/{setId}`

```js
{
  schemaVersion: 1,
  occurrenceId: "k3j9x2m1q8zt",
  exerciseId: "exercise-id",
  setNumber: 1,                 // positive integer, per occurrence (and per side)
  side: null,                   // null | "LEFT" | "RIGHT" (required when UNILATERAL)
  trackingType: "WEIGHT_AND_REPS",
  reps: 10,                     // integer ≥ 0
  weight: 60,                   // number ≥ 0 for WEIGHT_AND_REPS; null for REPS_ONLY
  weightUnit: "KG",             // null for REPS_ONLY
  loggedAt: Timestamp,          // client time of first entry
  correctedAt: null,            // client time of last correction after completion
  createdAt, updatedAt
}
```

- Sets are written with a full `setDoc` (no merge), which is idempotent for a given ID.
- Removing a set during a workout is `deleteDoc` on its deterministic ID.
- Unlogged prescribed sets have **no document**; "unfinished" is derived by comparing `targetSets` with the logged sets.

## 7. Lifecycles

### 7.1 Planned session

| From | To | Trigger | Write |
|---|---|---|---|
| (none) | PLANNED | apply template / create manual | `setDoc` |
| PLANNED | PLANNED | move (change `localDate`), refresh snapshot from routine, edit future targets, accept variation | `updateDoc` |
| PLANNED | STARTED | start workout | batch with workout creation (§9.3) |
| PLANNED | SKIPPED | user skips | `updateDoc` |
| PLANNED | CANCELLED | user cancels | `updateDoc` |
| STARTED | COMPLETED | workout completed | batch with workout completion |
| STARTED | ABANDONED | workout abandoned | batch with workout abandonment |

- SKIPPED, CANCELLED, COMPLETED, and ABANDONED are terminal in the MVP (§21, O4).
- A past date never changes status automatically. "Missed" is a derived display state (PLANNED and `localDate` < today).
- An abandoned planned workout cannot be restarted. The user may start an unplanned workout instead.

### 7.2 Workout session

| From | To | Trigger |
|---|---|---|
| (none) | ACTIVE | start |
| ACTIVE | COMPLETED | user confirms completion summary |
| ACTIVE | ABANDONED | user confirms abandonment |

COMPLETED and ABANDONED are terminal. `status` is authoritative. Interruption never changes status. Sets of ABANDONED sessions are retained but excluded from history, personal bests, and progression.

The engine exposes `canTransition(kind, from, to)` and `transition(kind, doc, to, now)`. The service refuses writes the engine rejects.

## 8. Weekly planning

### 8.1 Concepts

| Concept | Persisted? | Responsibility |
|---|---|---|
| Routine | Yes | Reusable prescription |
| Weekly template | Yes — `fitnessConfig/weeklyTemplate` | Reusable weekly intention: which routines on which weekdays |
| Planned session | Yes | Concrete dated intention with its own prescription snapshot |
| Week | No (derived) | 7 local dates starting Monday |
| Moved / missed / week membership | No (derived) | From `localDate`, `originalLocalDate`, status, today |

```js
// fitnessConfig/weeklyTemplate
{
  schemaVersion: 1,
  slots: [
    { slotId: "a1b2c3d4e5f6", weekday: 1, routineId: "routine-id", order: 0 }  // weekday: ISO 1=Mon … 7=Sun
  ],
  createdAt, updatedAt
}
```

A weekday may hold several slots. A routine may appear in several slots.

### 8.2 Applying the template to a week

1. The user chooses a week (`weekStart` = Monday) and applies the template (scope Workflow B).
2. For each slot, the engine computes `plannedSessionId = ${weekStart}_${slotId}` and `localDate = addDays(weekStart, weekday - 1)`.
3. The service reads each ID with `getDocFromServer`. Existing IDs are skipped whatever their status or date, so moved, skipped, or started sessions are never recreated or overwritten.
4. Missing sessions are created as PLANNED with `origin: "TEMPLATE"` and a snapshot of the routine **as it is now**. Slots whose routine is archived or missing are reported and skipped.
5. **Applying requires connectivity.** If the server read fails, the action is disabled with an explanation. A cache-only existence check could overwrite a session created or started on another device, because the ID is deterministic.

### 8.3 Edits and flexibility

- Editing the template affects only future applications. Existing planned sessions are never changed by template edits.
- Editing a routine does not change existing planned sessions. A PLANNED session offers an explicit "refresh from routine" action that replaces its snapshot (scope §10C; v1.0 §4.4).
- Move: PLANNED only; updates `localDate`; `originalLocalDate` is kept, so "moved" is derivable.
- Manual planned session: any date, any routine, `origin: "MANUAL"`.
- Unplanned workouts never require a planned session (§9.3).
- Week view query: `where("localDate", ">=", weekStart), where("localDate", "<=", weekEnd)` on a single field (automatic index). `YYYY-MM-DD` strings sort chronologically.

## 9. Live logging, offline durability, and recovery

### 9.1 Shared Firestore initialization (Task 3A)

The accepted decision requires Firestore's IndexedDB persistent cache with multi-tab support. There is exactly one Firestore instance and it is created in `public/js/firebase.js`. `initializeFirestore` cannot be applied after `getFirestore` has created the instance, and a second instance is forbidden (§4.4). The change must therefore be made in the shared file, as an isolated task:

```js
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
```

- Nothing else in `firebase.js` changes, and the export name `db` stays the same.
- If the persistent cache cannot start (IndexedDB unavailable, private browsing, storage blocked), SDK 10.12.2 logs an error and **falls back to the memory cache**. The application cannot reliably detect this, so the durability guarantee in §9.5 then does not hold.

Regression assessment for existing modules (manual, in Task 3A):

| Check | Why |
|---|---|
| Playlists list, daily plan, overrides load and update online | Snapshot listeners now emit cached data first (`fromCache: true`) then server data |
| `getOrCreateDailyPlan` does not create a duplicate or stale daily plan when the playlists snapshot first fires from cache | Its callback runs on every snapshot emission |
| Playlists behaviour offline (load module, mark block used) | `getDoc` may now resolve from cache instead of failing; writes queue instead of failing |
| Two tabs open simultaneously | Multi-tab manager shares one cache; neither tab should error |
| Side Quests stub still loads | No Firestore use, sanity check |

Any regression is reported before Fitness persistence work proceeds. Task 3A does not fix playlists code.

### 9.2 Write behaviour and UI write states

With the persistent cache, a Firestore write is applied to the local cache and queued in IndexedDB immediately. The returned promise resolves only when the server acknowledges it; offline, it stays pending indefinitely.

| UI state | Condition |
|---|---|
| Saving | Write issued; local snapshot does not yet contain it |
| Saved on device (pending sync) | Local snapshot contains the document with `metadata.hasPendingWrites === true` |
| Saved | Snapshot shows the document with `hasPendingWrites === false` |
| Failed | Write promise rejected (e.g. `permission-denied`, `invalid-argument`) |
| Offline notice | Query snapshot `metadata.fromCache === true` |

- The active workout subscribes to its `sets` subcollection with `{ includeMetadataChanges: true }`.
- The UI never awaits the write promise before updating. It clears or advances an input only once the set appears in the local snapshot (v1.0 §10 "do not clear an input before its write has been safely handled").
- On failure, the entered values stay in the form with a retry action. Because the set ID is deterministic, a retry is the same `setDoc` and cannot duplicate. Non-idempotent operations (unplanned-session creation, manual planned-session creation) are never retried automatically.

### 9.3 Starting a workout (no transaction)

Transactions require server connectivity. Starting a workout must work offline, so session start uses deterministic IDs plus a `writeBatch`, which is atomic and works offline.

**Planned workout**

1. Read the planned session (server, falling back to cache when offline).
2. If `status === "STARTED"`, resume `workoutSessionId`. Stop.
3. If `status !== "PLANNED"`, refuse with an explanation.
4. Compute `wid = "p_" + plannedSessionId`. If `getDoc(wid)` (server, falling back to cache) finds it, resume it.
5. Otherwise, one batch: `set(workout wid, { origin: "PLANNED", status: "ACTIVE", items: planned.items, … })` + `update(planned, { status: "STARTED", workoutSessionId: wid })`.

**Unplanned workout**

1. If the module knows of any ACTIVE workout (§9.4), require the user to resume, complete, or abandon it first.
2. Generate `wid` client-side, then `setDoc` the workout with `origin: "UNPLANNED"`, `plannedSessionId: null`, and items from a chosen routine or empty.

**Duplicate handling**

- Planned workouts cannot be duplicated: the same planned session always maps to the same workout ID.
- Unplanned duplicates are prevented locally. Two devices both offline can each create one. They are not merged automatically: recovery lists every ACTIVE session and the user completes or abandons each.
- Known limitation: if two devices are offline and both start the same planned session, both batches write workout `p_<id>`. The later synchronized `set` overwrites session-level fields. Sets are separate documents and are not lost. This is accepted for a single-user MVP.

**Completion and abandonment**

- Completion is one batch: workout `status: "COMPLETED"`, `completedAt`, `completedExerciseIds`, and `performanceSummary` (computed by the engine from the locally visible sets), plus planned session `status: "COMPLETED"` when `origin` is PLANNED.
- Abandonment is one batch: workout `ABANDONED`, `abandonedAt`, plus planned session `ABANDONED` when applicable.
- Both work offline. Completion presents the summary of completed, unfinished, and added work first (v1.0 §6.3) and warns if any sets are still pending sync.

### 9.4 Recovery and resumption

- `init()` subscribes to `query(fitnessWorkoutSessions, where("status", "==", "ACTIVE"))` (single-field index). With the persistent cache, this resolves from local data when offline.
- If one ACTIVE session exists, the module opens on a resume prompt. If several exist, it lists them with start date and routine name, each with Resume and Abandon (confirmation required).
- Resuming subscribes to the session document and its `sets`. The live view is rebuilt from `items` plus sets, and pending sets show their pending state.
- Recovery is discovered inside the module only. There is no Home banner and no routing change.

### 9.5 Guarantees and limits

**Firestore provides (with an active persistent cache):**
- A write applied locally is stored in the IndexedDB mutation queue.
- Queued writes survive tab close and reload in the same browser profile.
- Queued writes are sent the next time Firestore starts online.

**The application guarantees:**
- A set shown as "Saved on device" or "Saved" will be reloadable on the same browser profile and synced when the app next runs online.
- Retries cannot duplicate sets.
- Resuming never creates a second session for the same planned session.
- Nothing is marked abandoned or completed without user confirmation.

**Not guaranteed:**
- Writes still in "Saving" when the page is killed.
- Data on another device before sync.
- Sessions where persistence fell back to memory (§9.1).
- Browser storage eviction, or cleared site data.
- **Reopening the app while offline.** There is no service worker, and the app shell and Firebase SDK load from the network, so the app may not start offline. Pending writes then sync on the next online start.
- Concurrent offline edits to the same document on two devices (last write wins).

### 9.6 Offline and recovery verification (manual, Task 8)

1. Online: start, log 3 sets, close the tab, reopen, navigate to Fitness, then resume. All 3 sets are present and no duplicate session exists.
2. Mid-workout, set DevTools offline and log 2 sets. Expect "pending sync" states. Reconnect; states become "Saved", and the console shows the documents.
3. Offline: log a set, close the tab while still offline, go online, reopen. The set is visible and syncs.
4. Two tabs: logging in one tab appears in the other; starting the same planned session in both yields one workout ID.
5. Navigate Fitness → Playlists → Fitness five times. There are no duplicate listeners or handlers: a single log action writes once, and the console shows no repeated renders.
6. Private window: document whether persistence fell back to memory (console error) and confirm the UI still works online.
7. Complete a workout with unfinished sets. The unfinished sets have no documents, and the summary shows them as unfinished.

## 10. History, comparisons, and personal bests

### 10.1 Query strategy (decision)

Three approaches were evaluated:

| Approach | Rules change | Index | Reads | Verdict |
|---|---|---|---|---|
| Collection-group query on `sets` | **Yes**: needs `match /{path=**}/sets/{setId}` with a stored owner field checked against `request.auth.uid` | Collection-group single-field exemption or composite | Sets of matching sessions | Rejected: needs a security-model change, a deploy path for rules/indexes that CI lacks, and an owner field on every set |
| Read sessions, then each session's sets | No | No | 1 + N sessions | Rejected as the primary path: N+1 reads per view |
| **Per-session denormalized `performanceSummary` on the workout session** | **No** | **No (automatic single-field indexes only)** | One document per relevant session | **Selected** |

The sets subcollection remains the source of truth for an active workout and for corrections. `performanceSummary` is a derived copy computed by the engine (`buildPerformanceSummary(items, sets)`) and written:
- in the completion batch, and
- in the same batch as any set correction on a completed session.

It can be rebuilt from the sets at any time (repair path; no automatic rewrite).

### 10.2 Summary contract

```js
performanceSummary: {
  "exercise-id": {
    exerciseId: "exercise-id",
    exerciseName: "Bench press",
    trackingType: "WEIGHT_AND_REPS",
    laterality: "BILATERAL",
    weightUnit: "KG",
    occurrences: [
      {
        occurrenceId: "k3j9x2m1q8zt",
        source: "PRESCRIBED",
        prescribed: { targetSets: 3, repMin: 8, repMax: 12, targetWeight: 60 },  // null when ADDED
        sets: [ { setNumber: 1, side: null, reps: 12, weight: 60 } ]
      }
    ]
  }
}
```

Size is bounded by one workout, far below the 1 MiB document limit.

### 10.3 Query shapes (no rule or index changes)

| Purpose | Query | Notes |
|---|---|---|
| History list (paged) | `query(sessions, orderBy("completedAt", "desc"), limit(20))`, then `startAfter` | Automatic single-field index. Non-completed sessions have `completedAt: null`, which sorts last in descending order. Filter `status === "COMPLETED"` client-side; stop paging at the first `null`. |
| Previous performance / PBs / progression for one exercise | `query(sessions, where("completedExerciseIds", "array-contains", exerciseId))` | Automatic array index. Only completed sessions carry the field. Sort by `completedAt` client-side. Reads equal the number of completed sessions containing the exercise; accepted at personal scale. Adding `orderBy`+`limit` later requires a composite index and a manual index deploy. |
| Active sessions | `where("status", "==", "ACTIVE")` | Automatic index |
| Week plan | `localDate` range (§8.3) | Automatic index |

During a live workout, previous performance is loaded once per exercise when the session opens and cached in the module context.

*Task 3 must confirm in the browser that each query runs without a missing-index error.*

### 10.4 Comparison rules

- **Exercise identity** is `exerciseId`. Names, routines, and plans can change without breaking history; display uses the snapshot name with the current name as secondary text if different.
- **Comparable** entries must match the current exercise's `exerciseId`, `trackingType`, `laterality`, and `weightUnit`. Others are shown as "not comparable", never mixed into numbers.
- **Previous performance** is the most recent COMPLETED session (excluding the current one) containing the exercise. All occurrences and sets for that exercise are shown. When the current item is PRESCRIBED, the previous occurrence with the same `order` is highlighted where present; no further matching is attempted.
- **Included:** COMPLETED sessions, planned or unplanned. Unlogged prescribed sets count as unfinished, not zero.
- **Excluded:** ACTIVE and ABANDONED sessions, and invalid documents (§5.2).
- **Unilateral** values are compared per side.
- **Trends** are simple per-session series for comparable entries: heaviest completed weight with its reps, and total reps (REPS_ONLY: best set reps, total reps). Nothing predictive.

### 10.5 Personal bests

Only metrics that are well-defined from recorded data (scope §5.8):

| Tracking type | Personal best |
|---|---|
| WEIGHT_AND_REPS | **Heaviest weight** in a set with `reps ≥ 1` (ties: more reps, then earlier date) |
| WEIGHT_AND_REPS | **Most reps at a given weight** (exact weight match, same unit) |
| REPS_ONLY | **Most reps in a single set** |

- Computed per side for unilateral exercises.
- Computed client-side from summaries; **never persisted**.
- No e1RM, volume PBs, or cross-unit comparisons.

## 11. Progression engine

### 11.1 Principles

Suggestions are deterministic, explainable, computed on demand, and never applied without explicit approval. The engine returns a structured result and never changes a routine.

### 11.2 Initial rule (WEIGHT_AND_REPS only)

For a routine item (or PRESCRIBED snapshot item) of a `WEIGHT_AND_REPS` exercise:

1. Find the most recent comparable COMPLETED session containing a PRESCRIBED occurrence of the exercise (planned, or unplanned started from a routine).
2. Require logged sets ≥ `targetSets` (per side for unilateral).
3. Require every logged set to have `reps ≥ repMax`.
4. Require every logged set to have the same non-null weight. Otherwise the result is `NOT_ELIGIBLE` with reason "inconsistent load".
5. Propose `weight + progressionIncrementKg` as the new `targetWeight`.

One qualifying session is sufficient (v1.0 §8.2).

### 11.3 Result

```js
{
  status: "SUGGESTED",   // | "NOT_ELIGIBLE" | "INSUFFICIENT_HISTORY" | "UNSUPPORTED_TRACKING_TYPE"
  exerciseId, occurrenceId,
  evidenceSessionId,
  currentTarget: { targetWeight, repMin, repMax, targetSets },
  proposedTarget: { targetWeight },
  reason: "All 3 prescribed sets reached 12 reps at 60 kg."
}
```

- ADDED items (no prescription) yield `NOT_ELIGIBLE`.
- REPS_ONLY items yield `UNSUPPORTED_TRACKING_TYPE`.
- Where an accepted suggestion is written, and how dismissals behave, is open decision O2 (§21).
- Completed sessions are never modified by progression.

## 12. Guided variations

- Variations change only future PLANNED sessions or routines, never a started or completed workout.
- Any substitution must have the same `trackingType` and must come from a user-approved set of alternatives.
- The engine returns proposals with a rationale; the user accepts, edits, or rejects each one.
- The exact parameters, constraints, and trigger point are open decision O3 (§21). Task 11 does not start until O3 is decided.
- Schema additions required by O3 (for example an optional `allowedAlternatives` on routine items) are additive and keep `schemaVersion: 1`.

## 13. Dates and timestamps

### 13.1 Local calendar dates

- Schedule identity uses a local date string `YYYY-MM-DD` (`localDate`, `originalLocalDate`, `weekStart`).
- A local date is never produced by slicing `toISOString()`. The playlists `getTodayKey()` must not be used.
- Engine helpers (pure):
  - `todayLocal(now)`: reads `now.getFullYear()`, `getMonth()`, `getDate()`; the only function that interprets the device time zone.
  - `parseLocalDate`, `formatLocalDate`, `isValidLocalDate`.
  - `addDays(date, n)`, `compareLocalDates(a, b)`, `isoWeekday(date)`, `weekStartOf(date)` (Monday), `weekDates(weekStart)`.
- Calendar arithmetic is computed on date components through `Date.UTC(y, m - 1, d)` and `getUTC*` reads. It is therefore independent of the device time zone and DST.
- Weeks start on Monday (ISO 8601). This is a default and can be changed later by an additive profile field.

### 13.2 Timestamps

| Field | Source | Purpose |
|---|---|---|
| `startedAt`, `completedAt`, `abandonedAt`, `loggedAt`, `correctedAt` | Client time (`Timestamp.fromDate(now)`, with `now` passed through the engine) | Domain events. Correct when recorded offline; used for ordering history and sets |
| `createdAt`, `updatedAt` | `serverTimestamp()` | Audit only; never read by domain logic |

- Pending server timestamps read as `null` by default. The UI reads audit fields with `snapshot.data({ serverTimestamps: "estimate" })` if it displays them at all.
- Known limitation: client clocks on different devices may differ; history order follows the recording device's clock.
- A timestamp and a local date are different concepts. `localDate` on a workout is the local day it started, computed with `todayLocal(startedAt)` at start.

## 14. Security rules and indexes

- **No rule changes are required.** All paths are under `users/{uid}/…`, and no collection-group query is used (§10.1).
- **No index changes are required.** Every query in §8.3, §9.4, and §10.3 uses an equality, range, `array-contains`, or `orderBy` on a single field. This must be confirmed in Task 3 (§10.3).
- Isolation verification (Task 12, manual):
  1. Firebase console Rules Playground: user B `get` and `list` on `users/{A}/fitnessWorkoutSessions/...` and `.../sets/...` are denied; user A is allowed.
  2. Confirm the deployed rules match `firestore.rules`, since CI does not deploy rules.

  Emulator-based rules tests depend on open decision O1.
- If a later change introduces a collection-group query or a composite index, update `firestore.rules` and/or `firestore.indexes.json` in a dedicated, reviewed task, and deploy them manually (`firebase deploy --only firestore:rules,firestore:indexes`) before the dependent code ships.

## 15. User interface and accessibility

Core flow:

1. Configure the profile.
2. Create exercises.
3. Build routines.
4. Define the weekly template.
5. Apply it to a week and adjust it.
6. Start a planned workout or an unplanned one.
7. Log sets.
8. Resume after interruption.
9. Complete and review.
10. Review history, PBs, and suggestions.

Requirements:
- Mobile-first live logging (≤ 768px breakpoint): current exercise, target, previous performance, and large inputs on one screen. Minimal typing; numeric inputs use `inputmode="numeric"` or `"decimal"`.
- Previous values may be shown as hints or defaults. Defaults must be visibly distinguishable and are never saved without a user action. The exact interaction is decided in Task 7 (scope §10E).
- Clear empty states.
- Write states as defined in §9.2.
- Resume prompt on module entry.
- Confirmation for abandon, cancel, archive, refresh-from-routine, and applying a suggestion.
- Keyboard access, semantic labels, visible focus, and ARIA tabs following the `playlists.html` tab pattern.
- HTML safety per §4.7.
- No controls for unsupported tracking types, units, or actions.
- No rest timer.

## 16. Validation and error handling

Engine validation (examples, all unit-tested):
- Names not blank, trimmed, ≤ 100 characters.
- `targetSets`, `repMin`, `repMax`, and `setNumber` are positive integers, with `repMin ≤ repMax`.
- `reps` is an integer ≥ 0.
- `weight` is finite and ≥ 0, required for WEIGHT_AND_REPS and null for REPS_ONLY.
- `side` is required (LEFT or RIGHT) for UNILATERAL and null otherwise.
- `occurrenceId` and `slotId` match the ID format; `occurrenceId`s are unique within a routine or session.
- `weekday` is in 1–7; local dates are valid.
- Statuses and transitions follow §7.
- `schemaVersion === 1`.
- Referenced exercises exist, or a snapshot provides the needed fields.

Persistence errors:
- Map Firestore error codes to user messages: `permission-denied`, `unavailable`, `failed-precondition` (for example a missing index), `resource-exhausted`, unknown.
- Keep user input on failure. Never show a failed write as saved.
- Retry only idempotent writes.

## 17. Testing strategy

### 17.1 Pure engine (`node:test`)

- Location and naming: `tests/fitnessPlanner/<area>.test.mjs`, importing `../../public/modules/fitnessPlanner/fitnessPlanner.engine.js`.
- Command: `node --test "tests/fitnessPlanner/*.test.mjs"`.
- Time-zone runs:
  - `TZ=UTC node --test …`
  - `TZ=Pacific/Kiritimati node --test …`
  - `TZ=America/Los_Angeles node --test …`
- No `package.json` changes are required. Adding an `npm test` script or a CI test step is optional and needs separate authorization, because manifests and workflows are protected files.
- Coverage:
  - Validators for every contract in §6.
  - ID builders and the set-ID format.
  - Local-date helpers, including month, year, and DST boundaries.
  - Lifecycle transitions.
  - Snapshot independence from later routine edits.
  - Template application planning (which IDs to create; the server reads themselves happen in the service).
  - Performance summary building.
  - Comparability filtering.
  - Personal bests, including unilateral cases.
  - Progression outcomes (all four statuses, inconsistent load, unilateral).
  - `escapeHtml`.
  - Invalid and older-version document handling.

### 17.2 Persistence and rules

- The pure parts of mapping (domain ⇄ plain document shape) are engine functions covered by §17.1.
- Firestore behaviour (queries, batches, offline, multi-tab, rules) is verified with the manual checklists in §9.1, §9.6, and §14 unless open decision O1 adopts emulator tests.
- Every task report states which checks were executed and which were not.

### 17.3 Manual release verification

The §9.6 checklist, plus:
- Routine edits leave planned and completed snapshots unchanged.
- Re-applying the template to a week creates nothing new.
- A moved session is not recreated.
- A progression suggestion appears only when eligible; rejecting it leaves targets unchanged.
- History shows unplanned workouts.
- PBs are correct on a hand-checked dataset.
- The rules isolation check (§14) passes.

## 18. Repository verification gates

| Gate | State |
|---|---|
| Branch, working tree, overlapping module files | Verified (Task 1): no Fitness code exists; 24 files differ only by CRLF line endings |
| Runtime SDK and import mechanism | Verified: Firebase 10.12.2 via CDN, native ES modules |
| Firestore initialization and persistence | Verified: shared `getFirestore`, memory cache. Change specified in §9.1 (Task 3A) |
| Auth and user-data path conventions | Verified: `users/{uid}/<collection>` |
| Rules for proposed collections | Verified at source level: covered by the owner rule; not emulator-tested |
| Module loading, routing, CSS registration | Verified: §3. CSS approach in §4.7 (browser confirmation in Task 4) |
| Test runner, Node version | Verified: no runner; Node 24.18.1 with `node:test` |
| Required indexes | Design requires none; runtime confirmation in Task 3 |
| File names and collection paths | Reconciled (§4.1, §6.1) |
| Persistent-cache API in 10.12.2 | Exports verified in the CDN build; runtime behaviour verified in Task 3A |

## 19. Remaining unverified assumptions

1. `initializeFirestore` with `persistentMultipleTabManager` works in the target browsers with 10.12.2 (Task 3A).
2. Existing playlists behaviour is unaffected by the persistent cache (Task 3A checklist).
3. A `<link>` injected through `innerHTML` applies the module stylesheet (Task 4).
4. All §10.3 queries execute without index errors (Task 3).
5. Deployed Firestore rules equal `firestore.rules` (Task 12).
6. The CI Hosting deploy produces a working site, given that `config.js` is gitignored (O5).

## 20. Implementation plan

Estimates are approximate focused development time.

| # | Task | Prerequisites | Scope | Estimate |
|---|---|---|---|---:|
| 1 | Repository and integration verification | — | **Done** | — |
| 2A | Technical-design reconciliation | 1 | **Done** (this version) | — |
| 2 | Domain engine foundation | 2A | **Implemented** (`3c610ba`). Enums; validators for §6; ID builders; local dates; lifecycle transitions; snapshot builder; template-application planning; `escapeHtml`; `node:test` suites | 2–3 h |
| 3A | Shared persistent Firestore cache | 2A | **Implemented** (`f88db8c`, committed as "Task 3.1"); browser checks pending (§9.1 regression checklist; §19 items 1–2). §9.1 edit to `public/js/firebase.js` only; playlists regression checklist; report | 0.5–1 h |
| 3 | Persistence service | 2, 3A, **O1** | **Implemented** (`25a84f4`, committed as "Task 3.2"); browser checks pending (§10.3 index confirmation; §19 item 4; `context.md` manual list). `createFitnessService`; paths; mappers; batches for start, complete, and abandon; query shapes; subscription helpers; error mapping; confirm queries need no index; create `context.md` | 2–3 h |
| 4 | Module foundation + navigation entry | 3 | **Implemented** (`f9d3735`, committed as "Exercise library + navigation entry" but containing the foundation only); browser checks pending (§19 item 3 stylesheet link; repeated navigation). Sidebar button; module shell; lifecycle context (§4.6); CSS link check | 2–3 h |
| 4B | Exercise library | 4 | Exercise-library UI on the Task 4 shell using the existing service methods (`listExercises`, `getExercise`, `saveExercise`) and engine validation; no new persistence. Acceptance criteria in §20.1 | TBD |
| 5 | Routine management | 4B | Routines with stable occurrences and targets including `targetWeight` | 2–3 h |
| 6 | Weekly template and planning | 5 | Template editor; apply-to-week (online); week view; move, skip, cancel; manual planned sessions; refresh-from-routine | 2.5–3.5 h |
| 7 | Live logging and completion | 3, 5 (planned start also needs 6) | Planned and unplanned start; set logging with write states; add exercise; remove set; completion summary and batch; abandon | 3–4 h |
| 8 | Recovery and resumption | 7 | Active-session discovery and resume UI; §9.6 checklist | 1.5–2.5 h |
| 9 | History, corrections, comparisons, PBs | 7 | History paging; previous performance; comparisons; trends; PBs; corrections with summary rebuild | 2.5–3.5 h |
| 10 | Progression suggestions | 9, **O2** | §11 rule and approval flow | 1.5–2.5 h |
| 11 | Guided variations | 6, 9, **O3** | Per O3 | 1.5–2.5 h |
| 12 | Release verification | 4, 4B, 5–11, **O5** | §17.3; rules isolation; deploy procedure | 2–3 h |

**Estimated remaining total: approximately 23–34 hours.** (v1.1 estimate for Tasks 2–12; not recalculated after Tasks 2–4 or for Task 4B.)

Dependency notes:
- Task 2 is independent of Firebase and can start immediately.
- Task 3A can run in parallel with Task 2.
- Task 3 needs the engine contracts (2), the persistent cache (3A), and the persistence-test decision (O1).
- Live logging (7) and recovery (8) cannot start before the persistence contracts exist (3).
- Task 4B needs the Task 4 module shell and the Task 3 exercise methods. Task 5 needs 4B because every routine item references an `exerciseId` (§6.4) chosen from the exercise library (scope §5.2).
- Unplanned logging needs only 3 and 5, so Task 7 can deliver the unplanned path before Task 6 finishes.
- No rule or index changes are planned. If one becomes necessary, it is added as a dedicated task before the dependent task.
- Release (12) and any merge to `main` (which triggers a live Hosting deploy) depend on O5.
- There are no circular dependencies.

### 20.1 Task 4B — Exercise library

Task 4 delivered the module foundation only. The exercise CRUD/archive work originally listed under Task 4 is Task 4B. It implements scope §5.2 with the §6.3 contract.

Acceptance criteria:

1. List the user's exercises with `listExercises()`. Documents it returns under `invalid` are reported and never rewritten (`context.md`, service conventions).
2. Create an exercise with the §6.3 fields through `saveExercise()`, which validates with the engine's `validateExercise()`. New exercises have `schemaVersion: 1` and `isArchived: false`.
3. Edit an existing exercise. Saves spread the loaded document (`{ ...loaded, ...edits }`) so `createdAt` and unknown fields are kept.
4. Archive by saving the exercise with `isArchived: true`. There is no delete (§6.3).
5. Ask for confirmation before archiving (§15).
6. Mark archived exercises clearly and keep them apart from active ones, so they cannot be mistaken for active exercises.
7. Preserve the existing contract: only the `TrackingType` and `Laterality` values the engine defines are offered (§15); engine validation errors are shown to the user; changing `trackingType` or `laterality` remains allowed (§6.3); the user is the service's bound `uid` (§4.5); stored values are rendered per §4.7.
8. Show loading, empty, and error states, and the §9.2 write states (update without awaiting `write`; handle its rejection).
9. Module code does not reimplement exercise validation, mapping, or Firestore access; it uses `fitnessPlanner.service.js` and `fitnessPlanner.engine.js`.

Not in Task 4B: permanent deletion, bulk operations, search or filtering beyond separating active and archived exercises, restoring archived exercises, new collections, and new service methods.

Archived-exercise behaviour beyond "archived, never deleted" (§6.3) is not specified; see O6 (§21). Until O6 is decided, Task 4B uses its recommended default.

## 21. Open decisions

| ID | Question | Viable options | Recommendation | Blocks |
|---|---|---|---|---|
| O1 | How are persistence and rules behaviour tested? | (a) Manual checklists (§9.6, §14) plus pure mapper tests, no new dependencies; (b) Firestore emulator plus `@firebase/rules-unit-testing` (needs Java, a devDependency, and an `emulators` block in `firebase.json`, all protected changes) | (a) for the MVP | Task 3 acceptance criteria |
| O2 | Where does an accepted progression go, and do dismissed suggestions reappear? (scope §10A) | Destination: (a) routine item `targetWeight` only; (b) routine plus explicit opt-in update of future PLANNED sessions of that routine; (c) next planned session only. Dismissal: (i) recompute each time (it reappears until the evidence changes); (ii) persist a dismissal keyed by `evidenceSessionId` | (b) + (ii) | Task 10 |
| O3 | Which parameters may vary, under which constraints, and when are variations proposed? (scope §10B) | (a) Exercise substitution only, from user-approved alternatives per routine item, proposed when applying a week; (b) also reorder and target edits; (c) proposed while editing routines | (a), least-recently-performed alternative first | Task 11 |
| O4 | Can SKIPPED or CANCELLED sessions be restored, and what audit do corrections need? (scope §10C) | Restore: terminal (current default) or allow →PLANNED. Audit: `correctedAt` only (default) or keep previous values | Keep the defaults; adding a transition later is additive | Non-blocking; affects Tasks 6 and 9 if changed |
| O5 | How do production deploys get `public/js/config.js`, and how are rules confirmed? | Owner to confirm the CI outcome and deploy procedure | Resolve before merging Fitness work to `main` | Task 12; merges to `main` |
| O6 | How do archived exercises behave? §6.3 says only that exercises are archived, never deleted | Visibility: listed separately, or hidden. Editing: read-only, or editable. Restore: none, or unarchive. New routine items (Task 5): excluded, or allowed | Listed separately and labelled as archived; read-only; no restore; excluded when choosing exercises for new routine items. Restore can be added later without a data change | Non-blocking: Task 4B and Task 5 use the recommendation until decided |

## 22. Development-session instructions

Use the following instructions when delegating an implementation task to a coding assistant:

> Implement only the specified Fitness Planner task.
>
> Before editing, inspect the relevant source files, repository conventions, and existing tests. Treat the approved product scope, this technical design (v1.1), and the accepted decisions in §23 as constraints.
>
> If the task conflicts with the actual repository, an accepted decision, the Firebase SDK 10.12.2 runtime, persistence behaviour, or the data contracts in §6, stop before making speculative changes. Report the conflicting assumption, provide the relevant evidence, explain the impact, and propose the smallest viable alternatives.
>
> Do not silently broaden the task, introduce unrelated refactors, modify shared files outside the task's stated scope, duplicate existing infrastructure, or repeatedly retry a failing approach without new evidence.
>
> Add or update tests for the behaviour changed. Run the relevant test suite and report the commands executed, results, files changed, known limitations, and any remaining decisions.
>
> Do not claim that tests, persistence, or security checks passed unless they were actually executed and verified.
>
> The working tree contains CRLF-only modifications to unrelated files. Stage only the files changed by the task, by explicit path.

## 23. Definition of done and decisions

### 23.1 Definition of done

The MVP is ready for release when:

- The module integrates through the router, shared Firebase instance, and shared auth without duplicating infrastructure.
- Exercises, routines, the weekly template, and dated planned sessions can be created and managed. Moving and skipping do not corrupt history.
- Planned and unplanned workouts can be started. Sets are recorded independently with visible write state, and survive navigation and refresh within the limits of §9.5.
- An active workout can be resumed without creating a duplicate session.
- Completing a workout preserves unfinished work accurately.
- Routine, exercise, and template edits do not rewrite historical prescriptions.
- Previous performance, comparisons, trends, and the PBs in §10.5 are shown only for comparable data.
- Progression suggestions are deterministic, explainable, and user-approved. Variation suggestions are user-approved.
- Invalid inputs and persistence errors are handled clearly. User data is never inserted into HTML unescaped.
- Repeated navigation does not accumulate listeners.
- `node --test` engine suites pass in the time zones listed in §17.1.
- The manual checklists in §9.1, §9.6, §14, and §17.3 are completed and reported.
- `context.md` documents the implemented architecture and any deliberate deviations.

### 23.2 Accepted decisions (preserved)

- Strength-first MVP with flexible weekly planning, dated sessions, live logging, interruption recovery, constrained variation, and user-approved progression.
- Firestore IndexedDB-backed persistent cache with multi-tab support.
- Recovery through the module's initialization flow.
- One workout session document per workout, with sets in a subcollection.
- Deterministic set document IDs; each set saved promptly.
- Explicit session lifecycle status.
- `schemaVersion: 1` for all new documents.
- Pure domain engine with no Firebase, DOM, or browser-specific imports, tested with `node:test`.
- Vanilla-JS architecture and shared Firebase integration preserved. The only shared-infrastructure change is §9.1, which the persistent-cache decision requires.
- Firebase SDK 10.12.2 (CDN) is the runtime baseline. No SDK mixing or upgrade.
- No Home banner and no routing redesign in the MVP.
