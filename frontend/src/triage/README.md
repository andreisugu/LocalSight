# Triage queue — core and integration plan

Status: **pure logic, tests and this plan only.** No view, provider or component imports the
module yet, so the Live screen is unchanged. Source of the requirement:
`docs/product/innovation-operator.md` §2.1 (queue), §2.2 (episodes), §4 (acceptance criteria).

- `frontend/src/utils/triage.js` — the whole read model. Pure, injected clock, no React.
- `frontend/src/utils/triage.test.mjs` — 33 Node tests, part of `npm run test:unit`.
- `frontend/src/triage/README.md` — this file.

## The rule, stated once

```
escalated → CRITICAL before WARNING → nearest deadline → oldest → event_id
```

Lexicographic, no score. Deadline = `detected_at + escalate_after_s * 1000`; a missing or
non-positive threshold, or an unreadable `detected_at`, means **unknown** (`termen necunoscut`)
and sorts last inside its severity. Every row carries `reason` — the first criterion that puts
it where it is, relative to the row above (`escaladat`, `critic`, `avertisment`,
`deadline 38 s`, `termen depășit`, `termen necunoscut`, `vechime`, `fără oră`, `ordine stabilă`).

## API

| Function | Purpose | Returns |
|---|---|---|
| `rankIncidents(events, now)` | the rule above | `{ eventId, event, reason, deadlineAt, remainingS }[]` |
| `deadlineFor(event)` / `remainingS(event, now)` | deadline math, null when unknown | epoch ms / seconds |
| `groupEpisodes(events, { windowS = 120 })` | one walk-through, one row | `{ id, count, maxSeverity, firstAt, lastAt, eventIds, title, where }[]` |
| `createTriageState(events, { operator })` | session-local record | `{ events, holds, focusedEventId, frozenOrder, operator }` |
| `holdWarning(state, eventId, reason, now)` | hold a WARNING, ≤ 15 min | `{ ok, code, message, state }` |
| `releaseHold(state, eventId)` | drop a hold | state (same object when absent) |
| `activeHolds(state, now)` | non-expired holds | `{ [eventId]: { reason, until, by } }` |
| `canHold(event)` | WARNING + open/escalated | boolean |
| `freezeWhileReading(state, focusedEventId, now)` | keep the order while reading; `null` releases | state |
| `releaseFreeze(state)` | alias for the release | state |
| `queueRows(state, now)` | the rendered rows: freeze applied, holds attached, reasons recomputed | ranked rows + `hold` |
| `nextAction(key, { event, held, typing })` | keyboard decision, no side effect | `{ type, eventId, allowed, hint }` |
| `QUEUE_KEYS` | `A`, `F`, `Enter`, `H`, `Esc` | frozen map |

`rankIncidents` returns **every** readable event it is given, whatever its status; it filters
nothing. The caller decides which subset the queue renders (open + escalated) and the Flux tab
keeps the full list.

### Ranking details that matter

- `now` is injected (`number` epoch ms or `Date`) so tests and re-renders are deterministic.
- Advancing the clock does not reorder rows: every pair's deadline difference is constant. Only
  a status change (the escalation tick), a new event or an operator action can move a row.
- A row with no deadline never outranks a row with one inside the same severity.
- Rows are references to the input events; the module never copies or mutates them.

### Episodes

- Key: `camera_id + zone_id + track_id`, or `camera_id + zone_id` when `track_id` is missing
  (`undefined`, `null`, `''` or `0` — the contract uses `0` for events without a person track).
  `type` is **not** part of the key: one walk-through may fire `NO_PPE` and `RESTRICTED_ZONE`,
  and that is one story. The doc's optional "same track across zones" merge is not implemented;
  grouping is scoped to one camera and zone.
- Window is anchored to the episode's first detection (`windowS`, default 120 s). Equal to the
  boundary still joins; a long walk eventually starts a new episode instead of one endless row.
- `maxSeverity` is the maximum, never a downgrade. An episode that starts WARNING and later has
  a CRITICAL is a CRITICAL row.
- Every raw event stays addressable through `eventIds`, in detection order. Newest episode first.
- An event with an unreadable `detected_at` becomes its own episode at the end rather than being
  merged into a story that may not be its own.

### Holds

- WARNING only. A CRITICAL is refused with `code: 'critical'` and the UI copy
  `Criticele nu pot fi amânate.` — the key does nothing.
- The reason is mandatory (trimmed, ≤ 140 chars); no hold is written without it.
- Cap is fixed at `HOLD_MAX_S = 900`. The caller cannot ask for longer. `until` is epoch ms.
- Re-holding refreshes the 15 minutes; it is an explicit operator action each time.
- At `until` the hold is expired (`until > now` is the test), whether or not anyone released it.
- A held row stays visible and in its ranked position — holding is a note, not a suppression.
  It is not a way to remove an event from the queue.
- Holds live only in `state.holds`; an event never gets a `hold` or `queue` field. Session-local:
  a reload starts a fresh shift.

### Freeze while reading

- `freezeWhileReading(state, id)` snapshots the current event ids. While the set is unchanged,
  `queueRows` keeps that sequence even if a status flips underneath the reader.
- If the set changes (new event, acked/removed event), the snapshot is ignored and the queue
  re-ranks. A fresh CRITICAL never waits behind a stale order.
- Releasing (`null` / `releaseFreeze`) and every action (hold, release) clear the freeze and
  re-rank immediately. `focusedEventId` survives the action so focus can be restored.
- Re-focusing the same row does not refresh the snapshot.
- The 5-second idle rule from the product doc is a UI policy on top of this: call
  `freezeWhileReading` on focus, and release when focus leaves or after an action. The module
  deliberately does not own a timer.

### Keyboard

`nextAction(key, { event, held, typing })` returns a decision; the caller still performs it
through the existing store path. `typing: true` (focus in search, notes or the FP dialog) makes
every key a no-op. The caller ignores modified keys (`ctrl/meta/alt`) and calls
`preventDefault()` only for handled actions.

| Key | Decision | Refusal |
|---|---|---|
| `A` | `ack` via the existing ack path | status not ackable (`canDo`) |
| `F` | `false-positive` with the fixed reason list | status not FP-able |
| `Enter` | `open` the detail | no focused event |
| `H` | `hold` a WARNING | CRITICAL (`Criticele nu pot fi amânate.`), already held, not a WARNING, closed |
| `Esc` | `release-hold` | nothing held |

## Integration plan for Live

File-level, no new route, no new global state.

1. **`src/context/useIncidentStore.jsx`** (or a sibling provider): derive
   `queueState = createTriageState(events, { operator })` and expose `queueRows(queueState, now)`
   next to `filteredEvents`. Do not put the queue in `localStorage`; it is session-only.
2. **`src/components/live/IncidentFeed.jsx`**: add a two-tab header — `Coadă` / `Flux` — inside
   the existing panel. `Coadă` is default when at least one open or escalated incident exists;
   `Flux` keeps today's filters, search and cards untouched. Both tabs read the same list, so
   nothing disappears.
3. **`src/components/live/TriageQueue.jsx`** (new): one row per ranked event (episode header
   optional, see below), severity token, reason line, countdown bar from `remainingS`, hold chip
   `ținut până la HH:MM (motiv)`, and the existing detail/ack actions. One `setInterval(1000)`
   only while the tab is visible feeds `now`; it changes the bar, not the order.
4. **`IncidentFeed.jsx` keyboard scope**: `onKeyDown` on the queue container, not on `window`.
   Resolve `nextAction`, then:
   - `ack` → the same handler the card uses, so the store, toast and KPI update stay identical;
   - `false-positive` → the existing dialog and reason list;
   - `hold` → `holdWarning`, replace the state, show `result.message` on refusal;
   - `release-hold` → `releaseHold`;
   - `open` → `onOpenIncident`.
   After an ack/FP, move focus to the first remaining row (ref + `focus()`), and let the set
   change re-rank. `freezeWhileReading(state, focusedId, now)` on focus; release on blur.
5. **Episode rows**: render an episode as the row of its highest-ranked event, with
   `count`, `maxSeverity` and the range in the title attribute, expandable to the raw rows. Every
   raw row keeps its own ack through the existing per-event path; "confirmă toate" would be a
   later, explicit secondary action that acks each id one by one. Never collapse a CRITICAL inside
   a WARNING-looking row: `maxSeverity` and the worst countdown are mandatory.
6. **`src/components/views/IncidentDetailView.jsx`** (later, separate diff): a `poziția 1 din 4`
   chip and the same `reason` line, read from `queueRows`, so context does not disappear.

### Data it needs

| Field | Where it comes from | Used for |
|---|---|---|
| `event_id`, `severity`, `status` | contract event | ordering, action gating |
| `detected_at` | contract event | age, deadline base |
| `escalate_after_s` | zone, copied onto the event by `mergeEngineEvents` (`src/utils/engineEventFeed.js`) | deadline |
| `camera_id`, `zone_id`, `track_id`, `type` | contract event | row context, grouping key |
| `report.what` / `report.where` | contract event | episode title, row context |
| `acked_by`, `escalated_at` | local record / contract | ownership, read-only context |

No new contract field. `escalate_after_s` is already carried on engine events in this branch; the
queue must print `termen necunoscut` when it is null instead of inventing a timer.

## What must not change

- **Ack double-click guard.** `shouldAcceptAck` and the `pressRef` in `IncidentFeed` remain the
  only gate for pointer acks. Keyboard ack goes through the same store handler, never straight to
  `acknowledgeLocally`, and must not bypass the guard for a click that follows a key press.
- **Local / demo chips.** `DemoDataChip` in the panel header and the per-event `local` chip stay.
  A queue row is still an event row; it must not lose the label that says where it came from.
- **Flux stays one click away.** The queue filters nothing silently; every event the feed had is
  still reachable. The queue is a reading order, not a record.
- **KPI.** Reuse `activeCounts` (`src/utils/kpi.js`); do not recount with a second rule.
- **No auto-ack, no suppression, no auto-dispatch.** A hold is WARNING-only, capped, reasoned and
  visible. Acking stays a human decision.
- **No contract change, no dependency.** Romanian UI copy, existing tokens and panels.

## Non-goals

Persistence, notifications, the filmstrip, handover, drill mode and the kiosk wall are separate
builds. This module is the read model they will reuse; it is not a screen.

## Verification

```bash
cd frontend
npm run test:unit
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build
```

The queue is honest about its limit, in the product's words: *ordonează atenția, nu decide* —
the order is an explicit rule, not a risk model, and the full list stays one click away.
