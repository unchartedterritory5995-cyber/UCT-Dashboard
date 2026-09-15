# Q1 autonomous run — checkpoint

⛔ **Resume from THIS FILE, not from memory.** If the session was compacted or
restarted, read this file and proceed from the last row. When you notice you are
re-reading a file you already know, re-read this instead.

**Run opened 2026-09-15 08:00 CT.** Governing lesson, from the previous session's
own failure:

> Every hypothesis killed by **reading the code** survived. Every one killed by
> **reasoning from a fix** had to be re-opened. A hypothesis dies by reading or by
> measurement, never by inference. If you catch yourself writing *"so fix N must
> have…"* — stop and measure.

---

## Reserved — never done without the owner's word

- Flipping `NOTEBOOK_OFFLINE` (the kill switch). Recommend in the report; do not set.
- Pushing fix 6 to master. Design, rail, prove, stage it — the push is the owner's.

---

## Checkpoints

| task | what was measured or landed | commit | next |
|---|---|---|---|
| **0.1** | ⛔ **The rig was NOT down.** `SingletonLock` absent but **9 chrome processes carried the rig marker** (created 04:12, 04:41, 05:07 — orphans of the 1802s 2.8b timeout), and leveldb `LOCK` was permission-denied with writes at 08:20, so a live browser held the store. The opt-out key was **not on disk (0 hits across every leveldb file)**. Confirmed nothing legitimate was using the rig first: no observer process, no Q1 python, and the guard named a *different* task (`UCT Wave Q1 Window Check`) at 09:00. Tore down **by marker only**: rig-marker **9 → 0**, owner's Chrome **18 → 18 untouched**, lock released. Re-set the opt-out through `window_check.opt_out(page)` — its own function, never a second copy — which forces the flush. **Verified on disk with the browser dead:** `uct.j2.offline.enabled\x02\x010`, 0 rig processes. Profile **SIGNED IN** (`/api/auth/me` 200) and never recreated. | (no code change) | 0.2 |
| **0.2** | The 04:03 window evidence committed before interpretation: 2.8b **INCONCLUSIVE** on `HTTP 502` at 541.4s (requeued), then **exit 124, TIMED OUT at 1802.1s**. Not a pass, not a fail — **nothing was measured**. Zero ANOMALY rows. | `2ca885a32` | 0.3 |
| **0.3** | Investigation doc: the 2.8b double failure with timestamps, the deploy-churn explanation marked **UNCONFIRMED**, Q4 (the 1802s hang) opened, the hypothesis table and the killed-by-reading lesson. | *(this commit)* | 0.4 |
| **0.4** | This file created. | *(this commit)* | Phase 1 |

| **2.2 (read half only)** | AST-resolved every durable-record writer call site under `journal-2-0/`, aliases followed per §10.36: **31 sites, 0 aliased.** ⭐ The narrowing for Q1: `putNoteWithIntent` — the function that actually writes the record — has **11 call sites, and NINE of them are inside `outboxDrain.js` itself** (`:75, :98, :101, :119, :205, :247`) plus two in `useDurableNote.js` (`:328, :444`). `settleLandedSave` has 3 sites, all in `NoteEditorPage.jsx`. `settleNoteWrite` has 16 sites but only RECORDS a revision. ⛔ **Not concluded — this is the candidate list, not the answer.** The writer must be named from a trace, per 2.5's STOP condition. | *(this commit)* | Phase 1 / 2.1 |

---

## Standing state at the checkpoint

- **Branch** `feat/notebook-kill-switch`, ahead of `origin/master`, **66+ behind**.
- **No push until after 16:05 ET** (pre-push clock guard refuses 09:25–16:05 ET on
  a trading day). A push needs: both diff forms → merge master in → `grep -c
  broker_sync api/main.py >= 7` → gate → push.
- **Rig**: browser down, 0 marker processes, opted OUT on disk, profile intact and
  signed in. Next window: ask the guard, never the clock.
- **Fix 4 and fix 5 are live and correct. Neither closed the five RED cells.**
- **R-1a's flip stays HELD.**

## The open questions — to be measured, never inferred

- **Q1.** What reconciles the durable record clean, while an entry is queued, on the
  append route? Not `settleLandedSave` (fix 4 covers it), not the supersede path
  (fix 5 covers it). The trail says it happens: `record went CLEAN while queued: True`.
- **Q2.** If an entry survives queued, why does the sentence never reach the server?
  Either the entry's `patch` no longer holds it, or the drain never sends it. **The
  trail does not distinguish these.** That distinction is the next measurement.
- **Q3.** Is the rig probe honest? Three instruments in this programme have
  manufactured findings. Confirm the probe reads the entry's `patch` **after** the
  record is cleaned, from IndexedDB, not memory.
- **Q4.** Why did 2.8b attempt 2 hang for 1802s instead of refusing cleanly? A clean
  refusal at 541s and a 30-minute hang are not the same failure.
