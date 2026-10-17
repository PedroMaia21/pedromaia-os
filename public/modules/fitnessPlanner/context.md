# Fitness Planner – Module Context

Last updated: 2026-10-17 (after Task 3)

Records the conventions as implemented and deliberate deviations. The design
(`technical_design_and_implementation_plan.md`, v1.1) is not repeated here.

---

## Implemented files

| File | Role |
|---|---|
| `fitnessPlanner.engine.js` | Pure domain engine (Task 2). No Firebase/DOM imports. |
| `fitnessPlanner.service.js` | Firestore boundary (Task 3). `createFitnessService({ db, uid })`. |
| `tests/fitnessPlanner/*.test.mjs` | `node:test` suites for the engine only. |

UI, CSS, and module lifecycle do not exist yet (Task 4+).

## Service conventions

- **Identity:** `uid` is bound once in the factory. Every path is built from it; caller-supplied IDs are checked with the engine's `isValidDocumentId` (no `/`), so no method can address another user's data.
- **Mapping:** reads convert `Timestamp` → `Date`, add `id`, then run `checkDocument`. Invalid or unknown-version documents come back as `{ id, invalid: true, reason }` and are never rewritten. List methods return `{ docs, invalid }`.
- **Writes:** validated by the engine first. `id` is not stored as a field. Full writes carry forward a previously read `createdAt` (else `serverTimestamp()`), and always set `updatedAt: serverTimestamp()`. Domain timestamps (`startedAt`, `completedAt`, `abandonedAt`, `loggedAt`, `correctedAt`) are client `Timestamp.fromDate(now)`. Callers pass domain objects that already carry `schemaVersion: 1`; the service does not add or change it.
- **Saves:** callers must spread the document they read (`{ ...loaded, ...edits }`) so `createdAt` and unknown fields are kept.
- **Write promises:** write methods return `{ ..., write }` once the write is applied locally; `write` settles on server acknowledgement. The UI must not await it before updating (§9.2) and must attach a rejection handler.
- **Errors:** engine `ValidationError` (`code: "VALIDATION"`), `FitnessServiceError` (`NOT_FOUND`, `INVALID_DOCUMENT`, `INVALID_STATE`), and Firestore errors all propagate. `classifyError(error)` maps them to an `ErrorCategory`; user-facing messages belong to the UI.

## Offline behaviour

| Operation | Offline? |
|---|---|
| CRUD saves, set save/delete, add item, unplanned start | Yes (queued by the persistent cache) |
| Planned start, complete, abandon | Yes, when the documents they read are in the local cache |
| Collection reads and queries | Yes (served from cache, possibly incomplete) |
| Single-document reads | Yes when cached; a never-cached document rejects with `unavailable` (SDK behaviour) |
| `applyWeeklyTemplate` | **No** – server reads by design (§8.2) |

Batches: planned start (workout set + planned update), complete, abandon, apply template. No transactions.

## Deviations and interpretations

1. **§9.3 step 4 cache miss.** With SDK 10.12.2, `getDoc` offline rejects with `unavailable` for a document the cache has never seen. The `p_<plannedSessionId>` existence check treats that as "not known locally" and proceeds; otherwise an offline planned start could never succeed. A concurrent start on another device that this cache has not seen is the known limitation already accepted in §9.3.
2. **Small persistence guards not in the engine:** set save/delete and add-item require an `ACTIVE` workout (corrections on completed sessions must rebuild the summary, Task 9); `updatePlannedSession` requires `PLANNED` and allows only `localDate`, `routineId`, `routineName`, `items`; `addWorkoutItem` accepts only new `ADDED` items. These could move into the engine later.
3. **Not enforced by the service:** "no unplanned start while another session is ACTIVE" (§9.3 step 1) is left to the module, which owns the active-session subscription.
4. **Template application race:** server reads narrow but do not close the window between the existence check and the batch; a session created elsewhere in between would be overwritten.

## Manual verification still required

Nothing below has been run in a browser.

- **Indexes (§10.3):** in the browser console, run each query (`listPlannedSessions`, `listActiveWorkoutSessions`, `listCompletedWorkouts`, `listCompletedWorkoutsForExercise`) online and confirm there is no `failed-precondition` missing-index error.
- **Basic persistence:** create/read profile, exercise, routine, weekly template, manual planned session; apply the template to a week twice (second run creates nothing); move a session and re-apply (not recreated).
- **Offline:** start an unplanned workout online → DevTools offline → log sets (pending) → reload if the app still loads → reconnect → documents appear in the Firebase console.
- **Planned offline start:** load a week online, go offline, start a planned session, log a set, reconnect; one `p_<id>` workout exists and the planned session is `STARTED`.
- **Recovery:** start a workout, close the tab, reopen; `listActiveWorkoutSessions` returns it with its sets.
- **Multi-tab:** two tabs open, no initialization error; a set saved in one appears in the other's subscription; starting the same planned session in both yields one workout ID.
- **Fallback:** private window – note the "Falling back to memory cache" warning and confirm online use still works.
- **User isolation (Rules Playground):** user B `get`/`list`/`write` on `users/{A}/fitness*/…` and `…/sets/…` denied; user A allowed. Confirm deployed rules equal `firestore.rules`.
- **Regression (shared cache, Task 3A):** playlists load and write; daily plan behaviour observed (cache-then-server snapshot race); Side Quests loads.
