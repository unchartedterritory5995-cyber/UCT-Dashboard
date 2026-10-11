# P0.0 — the single-tab fork: NOT REPRODUCED (2026-10-11)

**Verdict: not reproduced. No writer is named.** 170 runs that could fork, 0 forks. The plan's stop
condition stands: no fix, no rail.

Round 1 (140 runs) was read once, 8 s after the navigation. Fix round 1 (30 runs) was read at +8 s
and again at +90 s. A **positive control proves the detector sees a real fork: 10 of 10 controls
forked**, by both signals, at both read times.

The reproducer stays committed (`tools/notebook_fork_repro.py`). Raw evidence was committed before
each interpretation (R-RAW): `f5d94ae46d` for round 1, `0cb7bcff16` for fix round 1.

## Fix round 1 — the control, the late read, and a quiet server

### The positive control (`--control`) — the detector works

The control produces a real second writer, through the product.

1. The editor holds unsent typing: its 800 ms autosave has not fired yet.
2. The same account PUTs a different body (`A second writer rewrote this paragraph.`) through the
   notes route, on the revision the editor opened on.
3. The editor's autosave then goes out on that stale base and gets a 409.
4. `reconcileConflict` → `ownerReconcilePlan` classifies the server copy as BODY_REWRITE and forks.

`docs/notebook/evidence/fork-repro-20261011T073321Z/run-00.json`:

| step | what the wire shows |
|---|---|
| `control_write` | 200 on base `07:34:05.200272` → `07:34:08.534952` |
| pair 22 | the editor's PUT on base `07:34:05.200272` → **409** |
| pair 24 | `POST /api/j2/notes` with title `My trading rules (conflicted copy)` → 200 |
| both account reads | the copy present, tags `['sync-conflict']` |

**10 of 10 control runs forked**, by title AND by tag, at +8 s AND at +90 s. The detector can see a
fork. Round 1's "0 forks" is therefore a measurement, not a blind spot.

**Detection now uses two signals, reported separately.** Both product fork doors set both marks
(read from the code, not inferred):

- the title `<title> (conflicted copy)`;
- the tag `sync-conflict`.

The doors are `NoteEditorPage.jsx`'s `reconcileConflict`, which calls `createNoteViaApi` with
`tags: ['sync-conflict']`, and `useOutboxDrain.js`'s `forkConflictedCopy` (same title and tag).

### Two reads, sequential, nothing else on the server

These ran on a fresh c2 sandbox (data root `…\Temp\nb-p0-fork2`, tip `eec73eede5`), strictly one
after another, 07:33:22 → 08:39:38 UTC. Nothing else ran on that server during the batch. One
1-run control shake-out (scratch, not evidence) ran at 07:32 and finished before the batch began.

Sandbox snapshot rail: CLEAN at every checkpoint, 62 db files. The stop was "graceful to the
shutdown checkpoint, then forced exit".

Each run read the account at +8 s. It then sampled the IndexedDB outbox every ≤5 s until +90 s, and
read the account again at +90 s.

| evidence dir | shape | runs | fork @ +8 s (title / tag) | fork @ +90 s (title / tag) | outbox | PUT statuses |
|---|---|---|---|---|---|---|
| `fork-repro-20261011T073321Z` | **control** | 10 | 10 / 10 | 10 / 10 | empty at first sample (≈8 s) | `[409]` |
| `fork-repro-20261011T074956Z` | brief, nav 300 ms | 10 | 0 / 0 | 0 / 0 | empty at first sample, still 0 at +90 s | `[200]` |
| `fork-repro-20261011T080535Z` | brief, nav 1500 ms | 10 | 0 / 0 | 0 / 0 | empty at first sample, still 0 at +90 s | `[200]` |
| `fork-repro-20261011T082126Z` | unmount in flight (as 070344Z: 850 ms pause, no type delay, +600 ms latency, click at 300 ms) | 10 | 0 / 0 | 0 / 0 | empty at first sample, still 0 at +90 s | `[200, 409, 200]` ×10 |

In the three non-control shapes the member's words (`Never move a stop down`) were on the server at
+90 s in 30 of 30 runs.

The unmount-in-flight shape again gave a 409 in 10 of 10 runs and 0 forks, now confirmed past one
full drain retry interval (`RETRY_INTERVAL_MS` = 60 s).

### Disclosure — round 1 runs overlapped on one sandbox (an uncontrolled variable)

Round 1 shared one sandbox, and the aged invocation `fork-repro-20261011T062907Z` was not alone on
it. Windows below are from the run files' own timestamps, UTC.

| aged invocation phase | when | what else was running then |
|---|---|---|
| created its member and 30 notes | from 06:29:07 | `062725Z` was live (06:27:25 → 06:32:09) |
| slept, holding 30 idle browser contexts with no pages | until ~07:09:30 | `063209Z` … `070344Z` |
| opened and typed its 30 notes | 07:09:30 → 07:15:35 | `070831Z` (07:08:32 → 07:12:08) and `071237Z` (07:12:37 → 07:23:23) |

The active editing phases overlap only those two: `070831Z` and `071237Z`. `070344Z` ran while the
aged process existed but was asleep.

None of this was disclosed in round 1. Concurrent members on one server are an uncontrolled
variable for timing. The fix-round batch above was run sequentially to remove it.

⚰️ **Correction.** The round-1 evidence commit `f5d94ae46d` (immutable) says "130 runs" and "seven
exploratory variants". The truth is **140 runs** and **eight** exploratory variants (12 invocations:
4 in the plan's budget, 8 exploratory).

## Round 1 — what was run (one read, at +8 s)

A c2 sandbox booted from this tree (tip `eec73eede5`) by `tools/notebook_fin_walk.py --serve-only`,
port 8132. Snapshot rail CLEAN at every checkpoint, 62 db files hashed, graceful stop. Each run used a
fresh paid member, or for the aged runs one member and a fresh browser context per run. A
`My trading rules` note was made through `POST /api/j2/notes`. The run opened it in one tab, put the
caret after `Rule one.`, typed `/checklist`, pressed Enter, typed `Never move a stop down`, waited,
then went back to the list. Every `/api/j2/notes*` request is recorded when it is sent, then
completed by its response or its failure.

The way back to the list is the one a member sees. The brief guessed a link named
"All notes|Back to notes" and there is no such link:

- **click** at 1280 px is the folder panel's All notes row (`[data-all-notes-row]`). At 390 px it is
  the phone's Back to notes button (`[data-nb-phone-back]`). The page stays loaded and the editor
  unmounts.
- **goto** is a full page load of `/journal/notebook`. The old page is torn down.

| evidence dir (`docs/notebook/evidence/…`) | shape | runs | forks | PUTs | 409s | aborted PUTs |
|---|---|---|---|---|---|---|
| `fork-repro-20261011T062725Z` | brief, nav 300 ms | 10 | 0 | 10 | 0 | 0 |
| `fork-repro-20261011T063209Z` | brief, nav 1500 ms | 10 | 0 | 10 | 0 | 0 |
| `fork-repro-20261011T063705Z` | brief, nav 3000 ms | 10 | 0 | 10 | 0 | 0 |
| `fork-repro-20261011T062907Z` | brief, nav 1500 ms, **aged 2400 s** | 30 | 0 | 30 | 0 | 0 |
| `fork-repro-20261011T064209Z` | click, 1000 ms pause after `/checklist`, no type delay, nav 300 | 10 | 0 | 20 | 0 | 0 |
| `fork-repro-20261011T064604Z` | same, **goto** | 10 | 0 | 20 | 0 | 0 |
| `fork-repro-20261011T065041Z` | same as 064209Z, +150 ms latency | 10 | 0 | 20 | 0 | 0 |
| `fork-repro-20261011T065431Z` | brief typing, goto at 850 ms, +150 ms latency | 10 | 0 | 10 | 0 | 0 |
| `fork-repro-20261011T065907Z` | 850 ms pause, goto at 300 ms, **+600 ms latency** | 10 | 0 | 24 | 0 | 17 |
| `fork-repro-20261011T070344Z` | same, **click** | 10 | 0 | 30 | **10** | 0 |
| `fork-repro-20261011T070831Z` | brief, **390 px**, nav 1500 | 10 | 0 | 10 | 0 | 0 |
| `fork-repro-20261011T071237Z` | as 065907Z, 45 s settle, IndexedDB read after | 10 | 0 | 22 | 0 | 10 |

The plan's own budget was the first four rows, 60 runs: the short shape at three delays and the
aged shape. The other eight rows are exploratory variants that tried to force overlap. ⚰️ The
evidence commit message says "130 runs". The directories hold **140**: 4 + 8 invocations, 10 runs
each, except 30 in the aged one.

## Step 4: the three questions

No run forked, so there is no forked run to read. Questions 1–3 ("which request got the 409, was
its base one this tab landed, which door sent it") **have no answer from this evidence**.
The writer is not named.

## What the wire did show

These are observations with citations. They are not causes of the audit's fork.

1. **One editor can send two PUTs on the same base.** In `fork-repro-20261011T070344Z/run-00.json`:
   - Pair 21: a PUT on base `07:03:45.093190`, answered 200 → `07:04:03.720010`.
   - Pair 23: sent 43 ms after the navigation click, while 21 was still on the wire, on the **same**
     base. Answered **409**.
   - Pair 25: a GET of the note.
   - Pair 26: a PUT on base `07:04:03.720010`, answered 200.

   All 10 runs in that directory show the same 409. All 10 settled without a fork. By reading the
   code, the likely sender of pair 23 is the unmount effect ("Save on unmount if dirty"). It calls
   `commitSave`, and `commitSave` does not check `saveInFlightRef` before it sends. That is
   inferred from timing and code, not instrumented.

   The editor's reconcile (`reconcileConflict` → `ownerReconcilePlan`) read `lastSavedRef` after
   pair 21 had landed. So the server copy matched the base, and the editor retried rather than
   forked. Two orderings would have given a different answer. Neither was observed:
   - the 409 and the reconcile's GET resolve before pair 21's 200 is processed;
   - the second PUT reaches the server first.

   **Census candidate only (1 shape, 0 forks in 10).** This is NOT a finding about the audit.
2. **A slow network delays the drain but loses no words.** In `fork-repro-20261011T065907Z`
   (goto during an in-flight PUT, +600 ms latency), the words typed after the pause were not on the
   server 8 s after the navigation, in 10 of 10 runs. The same shape with a 45 s settle
   (`fork-repro-20261011T071237Z`) had the words on the server in 10 of 10 runs, an empty outbox
   in 10 of 10, and 0 forks. The drain had not finished yet. The work was not lost.

## Why this may differ from the audit, which no one can settle from here

- The audit's script was never committed. Its typing delays, any wait for the slash menu, and its
  exact "navigated to the list" step are unknown.
- The audit ran beside other members' walks, so its server latency was higher.
- Member 4 had already done other things in that browser context before this note, so the
  IndexedDB working copy and outbox may already have held entries for it.

## For the 2026-09-27 attribution (Step 8, owner-approved query, not run here)

Compare the 9/27 note against these two shapes:

- **Editor door.** Two overlapping PUTs from one open editor: the observation above. The fork would
  come from `NoteEditorPage`'s `reconcileConflict`. Its sibling title is
  `<title> (conflicted copy)`, made with `createNoteViaApi`. Telemetry `conflict_forked` would carry
  `door: 'editor'`.
- **Outbox door.** The sweep's `forkConflictedCopy` in `useOutboxDrain.js`. Telemetry `door: 'outbox'`.
- Both doors produce the same title shape and the same `['sync-conflict']` tag. The note row alone
  cannot tell them apart; only the telemetry `door` field can. In all 10 runs of `070344Z` the PUT
  statuses were `[200, 409, 200]`, and the first two PUTs carried one base.

The spec says the 9/27 fork came through the outbox door. If so, it is **not** the editor-overlap
shape above.
