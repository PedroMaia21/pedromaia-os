# Fitness Planner – Module Context

Last updated: 2026-11-08 (after Task 5)

Records the conventions as implemented and deliberate deviations. The design
(`technical_design_and_implementation_plan.md`, v1.1) is not repeated here.

---

## Implemented files

| File | Role |
|---|---|
| `fitnessPlanner.engine.js` | Pure domain engine (Task 2). No Firebase/DOM imports. |
| `fitnessPlanner.service.js` | Firestore boundary (Task 3). `createFitnessService({ db, uid })`. |
| `fitnessPlanner.html` | Module shell (Task 4), exercise library (Task 4B), and routines (Task 5) markup: stylesheet link first, `#fitness-planner.fp` root. |
| `fitnessPlanner.js` | UI controller: `init()`, module context, delegated events (Task 4); exercise library (Task 4B); routines (Task 5). |
| `fitnessPlanner.css` | Module styles, every selector under `.fp`. |
| `tests/fitnessPlanner/*.test.mjs` | `node:test` suites. `module-harness.mjs` stubs the browser imports and builds a minimal DOM from the real HTML; `module-foundation.test.mjs`, `exercise-library.test.mjs`, and `routines.test.mjs` cover the controller; the rest cover the engine. |

Navigation: one sidebar button `data-route="fitnessPlanner"` in `public/index.html`. The router is unchanged.

## Module lifecycle conventions

- **Context:** `let current = null` is the only module-level state. `init()` calls `current?.dispose()` and then creates a context `{ root, service, abort, unsubscribers, disposed, alive(), track(), dispose() }`.
- **Listeners:** one delegated `click` and one `submit` listener on `ctx.root`, registered with `{ signal: ctx.abort.signal }`. Controls use `data-fp-action="<name>"`; handlers live in the `actions` map (own properties only). Never `data-route` inside module markup.
- **Subscriptions:** pass every unsubscribe through `ctx.track(fn)`. `dispose()` calls each one once (one failing does not stop the rest). `track()` on an already disposed context releases the subscription immediately.
- **Async guard:** after every `await` and at the start of every snapshot callback, `if (!ctx.alive()) { ctx.dispose(); return; }`.
- **Identity:** `init()` resolves `uid` once (`auth.currentUser`, else `getCurrentUser()`). No user means an error state and no service. Initialization errors render the error state instead of rejecting, because the router does not await `init()`.
- **Markup check:** before any rendering or service call, `init()` checks that every hook in `SHELL_PARTS`, `LIBRARY_PARTS`, `ROUTINE_PARTS`, and the form fields exists. Outdated markup (e.g. a cached older `fitnessPlanner.html` arriving with newer JS) shows a reload message instead of throwing. Add new hooks to these lists. `firebase.json` serves `/modules/**` and `/js/**` with `Cache-Control: no-cache` so HTML and JS revalidate together.
- **Rendering:** static markup lives in the HTML; JS fills dynamic text with `textContent` and toggles the shared `.hidden` class. Shell regions are found with `root.querySelector("[data-fp-<name>]")`, not global IDs.

## Exercise library conventions (Task 4B)

- **O6 accepted (2026-10-18, Task 4B brief):** active exercises are listed in the library; archived ones in a separate read-only Archived section with no edit, restore, archive, or delete action; archiving needs a confirmation that names the exercise and says it cannot be undone. **Task 5 must not offer archived exercises for new routine items.** Design §21 still lists O6 as open.
- **State:** `ctx.library` holds the exercises by ID, invalid records, and the open form or confirmation. Only one form, confirmation, or `getExercise` read is open at a time; list actions and Add are disabled meanwhile.
- **Reads:** `listExercises()` on entry and after any failed write; invalid documents are listed by ID and reason, never rendered as exercises or rewritten. Edit and archive start with a fresh `getExercise()` so the save carries `createdAt` and unknown fields; a fresh read showing `isArchived: true` refuses the action.
- **Writes:** create = `exerciseFromForm(values)` (`schemaVersion: 1`, `isArchived: false`, no `id`; the service assigns it). Edit = `{ ...loaded, ...fields }`. Archive = `{ ...loaded, isArchived: true }`. The UI updates when `saveExercise` returns; validation errors are shown next to the field named by `ValidationError.field`.
- **Labels:** enum labels live in the controller (`TRACKING_TYPE_LABELS`, `LATERALITY_LABELS`); options are built from the engine enums.

## Routine conventions (Task 5)

- **State:** `ctx.routines` holds routines by ID, invalid records, the open editor (`{ loaded, draft, errors }`), and write states. One editor or editor read at a time; Add routine and Edit are disabled meanwhile. `init()` loads exercises and routines in parallel.
- **Reads:** `listRoutines()` on entry and after a failed write; invalid documents are listed by ID and reason, never rendered or rewritten. Opening the editor reloads the exercise library (`loadExercises`) and, for an edit, reads a fresh `getRoutine()`; it refuses to open if exercises cannot be loaded, the routine is gone, or it is invalid.
- **Occurrence IDs:** a new item gets `createLocalId(randomLocalId)` (engine builder; the controller only supplies a `crypto.getRandomValues` source over `[a-z0-9]`) and is regenerated only if it collides within the routine. IDs never change afterwards and never derive from positions.
- **Order:** the editor shows items sorted by `order`. Move up/down swaps the two items' positions *and* `order` values; removing leaves every other `order` as stored; adding uses `max(order) + 1`. Unmoved items keep their stored `order` exactly. The engine's duplicate-order check stays authoritative.
- **Writes:** create = `{ schemaVersion: 1, name, isArchived: false, items }` (no `id`). Edit = `{ ...loaded, name, items }` and each existing item = `{ ...loadedItem, targets }`, so `id`, `createdAt`, `isArchived`, and unknown fields survive. `saveRoutine(routine, exercisesById)` receives every valid exercise, archived included. Validation errors are placed on the name, the occurrence named by `items[i]`, or the form. Write states and rejection handling mirror exercises (rejected write → notice, reopen editor with the draft if none is open, reload).
- **Targets:** inputs for `targetSets`, `repMin`, `repMax`, `targetWeight` (kg), `restSeconds`, `notes`; blank numbers become `null` and the engine decides. New items start blank (no invented defaults). REPS_ONLY items show no weight input; a stored non-null weight on a REPS_ONLY item is shown with a note so it can be cleared (the engine rejects it otherwise).
- **O6 (Task 5 side):** the picker lists active exercises only; `addOccurrence` re-checks `isArchived`; a save is refused locally when an item added in the current edit references an exercise archived since. Existing items whose exercise was archived later are kept, labelled "Archived exercise", and stay editable/movable/removable — `validateRoutine` and `buildSnapshotItems` accept archived exercises, and O6 restricts only new items. An item's exercise cannot be swapped (remove and add instead).
- **Unresolved references:** items whose exercise is missing or unreadable are labelled ("Missing"/"Unreadable") and kept; the engine refuses the save (`Exercise not found`) until the user removes them. Nothing is removed automatically.
- **Routine `isArchived`:** no archive action exists in Task 5. A stored archived routine is badged and its flag is preserved on edit.

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
4. **Task 4 delivered the module foundation, not the exercise library.** The Task 4 brief excluded exercise management. Exercise CRUD/archive is now Task 4B in design §20 (criteria in §20.1) and must be completed before Task 5. Commit `f9d3735` carries the original title "Exercise library + navigation entry" but contains only the foundation.
5. **Template application race:** server reads narrow but do not close the window between the existence check and the batch; a session created elsewhere in between would be overwritten.
6. **Exercise write states come from the `write` promise, not snapshot metadata.** The service has no exercise subscription, so "saved on this device, syncing…" means `saveExercise` returned and `write` is pending; "saved" means it resolved; a rejection shows the error, reopens a create/edit form with the entered values, and reloads the list (Firestore reverts the rejected local write). There is no offline notice (`fromCache`) on this screen.

## Next task

Task 6 — Weekly template and planning (design §20). Task 5 is implemented; its browser checks are listed below. Template slots need `slotId`s from `createLocalId`; reuse the controller's `randomLocalId` source. The technical design is the source of truth for scope and architecture; this file records implementation status and conventions only.

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
- **Module foundation (Task 4):** Fitness Planner opens with no console errors; `fitnessPlanner.css` applies (assumption §19.3, `<link>` injected through `innerHTML`); navigate away and back several times without errors or duplicate handling; the other modules still load.
- **Exercise library (Task 4B):** active exercises load; create, edit, and archive one (confirmation names it); it moves to Archived with no actions; reload and confirm the changes persisted; navigate away and back several times and confirm no duplicate writes (Firebase console) or doubled handling; offline create shows "syncing" and completes on reconnect.
- **Routines (Task 5):** create a routine (empty, then with exercises); confirm archived exercises are not in the picker; add the same exercise twice; set targets including weight; reorder and remove; save, reload the page, and confirm order, targets, and occurrence IDs (Firebase console) are unchanged; edit again and confirm `createdAt` is unchanged; archive an exercise used by a routine and confirm the routine still shows and saves it; navigate away and back several times and confirm one write per save.
- **Regression (shared cache, Task 3A):** playlists load and write; daily plan behaviour observed (cache-then-server snapshot race); Side Quests loads.
