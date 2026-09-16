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

| **2.1(a)** | `PRECONDITION_BUDGET_SECONDS = 120`, checked after each setup step and refusing with the STEP NAME and elapsed seconds; a new AUTH precondition first (`/api/auth/me` must be 200+JSON); the setup `goto` bounded at 45s (it had none). **Proved in anger the same hour**: the next run refused every cell in seconds instead of hanging, and the opt-out reached disk. | `1f0c54bab` | 2.1(a) fix |
| **2.1(a) fix** | ⛔ My own refusal said *"the rig is not signed in"* for EVERY non-200 — including the 502 it actually hit. Two different facts as one sentence: the ambiguity class this programme has been closing, committed by the check written to close it. Now classifies 401/403 (signed out — and do NOT make a new profile) vs 5xx (production swap, requeue) vs unreachable vs unexpected, each ending *"INSTRUMENT fact, NOT a product finding"*. ⚠️ **Only presence-checked, not railed** — the check I ran re-implemented the branch logic and grepped, which is R-05. Stated in the commit rather than implied. | `fee65e565` | 2.8b re-run |
| **2.8b #4** | Ran with the new bound. **INCONCLUSIVE on every cell in seconds** — `/api/auth/me` answered **502**. No hang (contrast: 1802s). Opt-out reached disk: *"the rig IS opted out"*. ⭐ The bound did exactly what it was built for. | (evidence in run) | 2.8b #5 |
| **502 CONFIRMED as a deploy swap** | Not inferred this time: web deploys at 16:02:04Z, 16:02:27Z, 16:24:09Z, 16:58:50Z bracket the run, and `/api/health` then answered 200 ×3 with **uptime 46s** on a fresh boot. Unauth `/api/auth/me` correctly 401. **Production is healthy.** | — | 2.8b #5 |
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

## D1–D5 — status at 2026-09-15 21:30 CT, and the three answers that were owed

⛔ **Every row cites its artifact (R-CITE). A row with no citation says "not measured".**

### The three answers, stated plainly because they were owed for three reports

1. **The flip writer is NOT NAMED.** It is a census of **three** candidates —
   `useDurableNote.js:286` (`settleLandedSave`), `useDurableNote.js:402`
   (`persist`), `outboxDrain.js:75` (`settleSent`). The prior claim that it was
   named is **retracted**; see §0.3 of `q1-red-cells-investigation.md` for the
   quote and for the mechanism (a hedge lost across a summary boundary).
2. **2.1(b) probe honesty: NEVER RUN.** Zero mentions in the run log. Every RED
   reading is labelled **probe unverified** until it passes (R-HON).
3. **The raw ring did NOT survive — none was ever written.** No probe log, no
   matrix artifact, no page dump. `sentence_lost_writes` **has never been read
   from a real run**; the only rings on record are `--self-check`'s planted pair.
   The sentence-loss TIMING that is real comes from the **store trail**
   (`tools/q1_write_trace.py`, `summarise()` docstring), a different instrument.

### D1–D5

| | status | citation |
|---|---|---|
| **D1** door guard live on production | **BUILT, RAILED, MUTATION-PROVED — NOT SHIPPED.** Gate sound; landing blocked on the push queue, not on the code. | `noteHasUnsentWork.js`, `sendToJournal.js:93`, rail `doorDefersWhileUnsent.test.js` (10 passed) |
| **D2** writer named + fix 6 staged | **BLOCKED — writer not named (3 candidates), no fix 6.** Needs a rig window under R-RAW/R-HON. ⛔ No third inference-based fix. | §0.3 above |
| **D3** five cells GREEN on production | **NOT STARTED** — depends on D2. | — |
| **D4** Phase 3 complete (3.1–3.7) | **3.0 ONLY.** The checkpoint carries no 3.1–3.7 rows; they are not done. | this file, §Checkpoints |
| **D5** docs current, rescinded rules struck | **THIS COMMIT.** RTH struck by master's R18 (`101ecc2c5`) + the hook correction; the retraction, the census, 2.1(b), the absent ring and the three new rules are now recorded. | §0.3; `tools/pre_push_guard.hook` |

### Gate + landing state

- **Gate SOUND** on the door-guard tree: `2026-09-15T21:12:02`, tree `c602f700d`
  start→end (no drift), 1388 files **RECONCILES**, 20,411 passed / 9 failed,
  `VERDICT=NO_NEW_FAILURES exit=0 new=0`. Read by hand **and** via
  `verdict_exit_code(manifest)`; both said 0. Manifest committed as evidence.
- ⛔ The preceding gate (`20:50:10`) returned **2 NEW failures** caused by a
  partial `vi.mock('./captureTargets')` that omitted `freshLastNote` — a second
  authority over that module's export surface, fixed by spreading
  `importOriginal()`. Product code unchanged; guard re-proved standing up.
- **Carry-over adjudicated, not assumed:** `gate_read_identical` over the 32
  `GATE_READ_PATHS` returned **IDENTICAL** from the gated tree to the landing
  tree, and its **non-vacuity control returned DIFFERS**, so IDENTICAL means
  something.
- **Landing direction verified master-first** (`land_master_first.py --no-push`):
  `^1` = old master, `^2` = branch, **34 files in front of the deploy gate, all
  ours**. Branch-first would have put master's 93 in front of it instead.
- ⛔ **PUSH REFUSED BY THE GUARD, CORRECTLY — burst clause.** 4 distinct `web`
  deploys inside 60 min against `BURST_MIN_DEPLOYS = 3`; recency was fine
  (1712 s settled). Another workstream is landing on master at ~4/hour. **Waiting
  for the window, not overriding it:** `UCT_SKIP_PREPUSH_GUARD` and the R19
  attestation both exist and neither is mine to use — the refusal text says this
  needs a human who can see every workstream.
