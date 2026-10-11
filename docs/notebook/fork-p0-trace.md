# P0.0 — the single-tab fork: NOT REPRODUCED (2026-10-11)

**Verdict: not reproduced. No writer is named.** 140 runs, 0 forks. The plan's stop condition
applies: no fix, no rail. The reproducer stays committed (`tools/notebook_fork_repro.py`), and the
raw evidence was committed before this file was written (R-RAW, `f5d94ae46d`).

## What was run

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
