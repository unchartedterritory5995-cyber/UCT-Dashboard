---
id: ROSTER-2026-09-13
title: The 32-system roster after two build days
role: the state-of-the-programme table the owner asked for at the end of day 2, and the throughput measurement beside it
status: measurement, not a plan. Every "SHIPPED" cites a merge SHA; every "not built" is a measured absence.
date: 2026-09-13
measured_against: origin/master @ ccbab9bcd (was 76c62c494 when first written; re-measured after the S7 chain merged)
---

# The roster after two build days

⛔ **EVERY ROW CITES A SHA OR SAYS IT CANNOT.** A roster whose states come from a previous roster
is the defect this programme keeps paying for — `PROGRAM_STATUS.md`'s table was stale on four rows
when the build-day plan reconciled it against the LEDGER on Saturday morning.

## 1. Platform systems (S-series)

| system | state | changed this weekend |
|---|---|---|
| **S1** Terminal Shell | PROVISIONAL-SHIPPED, narrow slice | ⛔ untouched — owner-bound, OI-06 |
| **S2** Command / Search | PROVISIONAL-SHIPPED | ⛔ untouched — owner-bound, OI-06 |
| **S3** Entity Master | **SHIPPED** (CP1–8, `ed6b1f041`) | dependency only. ⭐ D5's pass found `schema.py:107` declares `source='d5'` and **no code path passes it** — S3 finished a contract D5 has never written to |
| **S4** Context Bus | **CP1 MERGED `76c62c494`** — spec + gate + the divergence detector | ⭐ reframed: an ADOPTION gap, not a capability gap. The bus shipped in August; two files joined it |
| **S5** Persistence & User State | spec + gate written, **approval EMPTY** | docs only |
| **S6** Personalization | PRD + spec written | docs only, no gate by instruction |
| **S7** Alerts | **8 of 8 named types registered.** 4 live; 4 merged at CP1–CP2 today, all DARK | `position-risk` `2b0547949` · `scan-membership-change` `0c6caf25b` · `regime-change` `0392c78bf` · `indicator-condition` `ccbab9bcd`. Built in parallel, merged **serially** on the `_EXPECTED` line; `_EXPECTED` is now seven |
| **S8** Provenance & Freshness | SHIPPED; full `<Cited>` still D2-gated | consumer of D2 CP2 |
| **S9** Entitlements | not built | ⛔ untouched — owner-bound, OI-03 |
| **S10** Presentation Primitives | **SHIPPED `3c539d011`** · F-S10-2 `e909279e1` · **CP2 `6576f044e`** | F-S10-1 resolved: a price has TWO right renderings, both named |
| **S11** Session / Clock | SHIPPED | dependency only |
| **S12** Rollout | **1st migration `56df6803f`** · **2nd `78ba40fe8`** | in-pod verified: cohort 6, projected **12**, unchanged |

## 2. Data-platform systems (D-series)

| system | state | changed this weekend |
|---|---|---|
| **D1** Provider Abstraction | SHIPPED, census GREEN | dependency only |
| **D2** Canonical Data Model | **CP1 `b9783d509`** · **CP2 `ffa8102c7`** — 142 metrics, two stores | ⛔ **CP3 HELD.** Day-2 sample count: **NOT MEASURED** (the in-pod read was blocked; see §5), and the gate as written stays unreachable for a reason git can prove |
| **D3** Realtime Streaming | spec + gate written, **approval EMPTY** | docs only |
| **D4** Caching & Serving | spec + gate written, **approval EMPTY** | docs only |
| **D5** Reference & Corp-Actions | PRD + spec + gate · **CP1 MERGED `9458ea641`** | the corporate-actions census; CP2–CP7 unsigned |
| **D8** (Portfolio/risk deferral) | deferred in its own block | owner-bound |

## 3. Application systems (A-series) and the intelligence layer

| system | state | changed this weekend |
|---|---|---|
| **A3/A4, A5, A6/A7, A8** | SHIPPED | — |
| **A1** Markets | live surface; **GATE-ONLY** on D2 | bucket-sorted, not built |
| **A2** Charts & Analytics | live surface; **BLOCKED** on S1 + S2 | bucket-sorted, stopped |
| **A9** Screening | live surface; **GATE-ONLY** on S7 `scan-membership-change` | ✅ **the dependency LANDED** (`0c6caf25b`) — but at CP1–CP2, which registers and compares and fires nothing. A9 unblocks at that type's **CP3**, not at this merge. ⚠️ And the absorption is of a path that is COMPLETE, WIRED AND LIVE (05:10 ET job, three paid endpoints, in-app+email+Discord), so A9's flip is member-visible |
| **A10** Options & Flow | live surface, mostly partner-owned; **GATE-ONLY** on D3 + D4 | bucket-sorted, not built |
| **A11** Breadth & Regime | live surface; **GATE-ONLY** on the one-regime ruling + S7 + D2 | bucket-sorted, not built |
| **A12** Watchlists | **half-live**; **GATE-ONLY** on S5 + S6 | bucket-sorted, not built |
| **A13** Journal & Track Record | live surface (528 files); **GATE-ONLY** on D2 + S5 | bucket-sorted, not built |
| **A14** Portfolio & Risk | **no member door at all**; **BLOCKED** on D8 + S9 | bucket-sorted, stopped |
| **E1** | outside the named roster | not assessed |
| **I1** Intelligence Layer | SHIPPED, **3 slices** — slice 3 `1c426c199` | the tool-registry contract became six rails |

⛔ **BUILDABLE = 0 of 8 for the A-series, and that is the finding.** Six are GATE-ONLY *because the
surface already exists and works*; a "CP1" over a live page is a second authority, which is the
rewrite-proposal failure this programme rejects. **A9 is the one that moves** the day
`scan-membership-change` merges.

---

## 4. ⭐ THROUGHPUT — what a day actually holds

| | Saturday (day 1) | Sunday (day 2, FINAL) |
|---|---|---|
| **code merges** | **5** | **6** — H14 `94209e962`, S4 CP1 `76c62c494`, and the four S7 types |
| **doc commits** | 8 | 8 |
| **gate packets written** | 9 | 5 (H14 + the four S7, all in two commits) |
| **approval lines signed** | 4 | 6 |
| **mutation cycles run** | **22** | **~48** — **13 mine** on the S7 chain alone (2 · 2 · 3 · 2) plus S4 CP1's 4 and H14's, against **35+** run by the four build agents inside their worktrees |
| **in-pod read-only probes** | 2 | 2 (H14's 17-position re-check; the regime-change env read). ⛔ A third — the D2 CP3 sample count — was **BLOCKED by the tool sandbox**, see §5 |
| **findings recorded** | 8 (F-D2-1/2/3, F-I1-5/6, Δ2, Δ3, the D5 register gap) | **11** — the 4th/5th placeholder detectors, the AMD row, the CP3 gate, F-S7-RC-1/2/3/4, F-S7-IC-1, the seventh alert-state table, `scan_store.prune`'s zero callers |

⭐⭐ **THE HONEST DAY-2 NUMBER IS SIX MERGES, AND FOUR OF THEM COULD NOT BE PARALLELISED AT THE
MERGE.** They were *built* in four parallel worktrees — that part scaled perfectly — but all four
edit `_EXPECTED` in one file, so the merge phase was strictly serial: rebase, re-run parity, re-run
the control, mutate, push, four times. **The build is parallel and the merge is a queue**, and the
queue is what a day's ceiling is actually made of.

### ⛔ THE NUMBER THAT ACTUALLY BOUNDS THE DAY IS NOT MERGES — IT IS TEST MINUTES

Measured across both days: a single **named-file** backend pytest run on this box costs **8 s to
130 s**, and a checkpoint needs one baseline plus one run per mutation plus one final sweep —
typically **five to eight runs**. Three of Sunday's runs each took **~110 s**, so one D5-style
checkpoint spent roughly **12 minutes purely waiting on pytest**, before a line of code was
written.

⭐ **So the honest unit is not "a merge" but "a mutation cycle", and this box does about
2–5 of them per checkpoint at 1–2 minutes each.** Saturday's 22 cycles are ~35 minutes of pure test
execution; the reading, writing and verification around them is the rest of the day.

⚠️ **And the frontend is worse per run, not better:** a single `vitest` invocation over three
directories cost **75 s** (28 s of it environment setup), and the S10 CP2 sweep over 14 files cost
**26 s**. A vitest mutation cycle is therefore cheaper than a pytest one, which is why S10 CP2 and
S4 CP1 each fitted four mutations comfortably and D5 CP1 fitted two.

**Against the original ask of ~18 merges: 8 merged across two days, at the stated rigor.** The
build-day plan predicted this on Saturday morning and named what would give first — mutation
cycles, then non-vacuity controls, then the legacy read. ⭐ **None of them gave.** What the two days
actually bought instead of merge count is in §5.

---

## 5. What the two days bought that a merge count does not show

Every item below was found by an instrument, not by review, and none of them was on the plan:

1. **A live member-facing defect corrected** — `metrics_registry` was putting `444 × shares` of
   fabricated risk into a member's average risk-per-trade and attributing it to a stop they never
   set (H14, and only visible because a rail matched the *arithmetic* rather than a function name).
2. **Five placeholder-stop detectors** where every prior write-up said three.
3. **Two ungoverned evidence contracts** in I1 (F-I1-5), and a parametrize that turned a mutation
   into a **silent collection error** (F-I1-6).
4. **A census that was two rows short ten minutes after the measurement that built it** (D5 CP1).
5. **Three of this programme's own counts corrected** — Δ2, Δ3 (wrong by 3.5×) and the D5 register.
6. **A stale reachability claim retired** in `HubContext.jsx` — a note written to stop somebody
   trusting a stale reachability claim had become one.
7. ⛔ **D2 CP3's gate is unreachable as written, and Day 2 made the case decisively stronger.**
   The dual-compute ledger is in-process and resets on every deploy.

   ⚠️ **THE END-OF-DAY RE-READ WAS BLOCKED, AND THE GAP IS REPORTED AS A GAP.** The last
   MEASURED value is **0 samples**, taken in-pod earlier today (fraction 100 %, the book resolving
   `ohlcv.c` to position 4). The owner asked for the count *at end of day*; that second read
   (`railway ssh --service web`, read-only, the same probe) was **refused by the session's own tool
   sandbox** as a production read. ⭐ Carrying the earlier 0 forward as though it were the
   end-of-day number would have been the easy thing and it would have been wrong: **the whole
   point of an end-of-day count is that the day happened in between**, and 167 commits — hence
   many web rebuilds — happened in between. A stale measurement re-presented with a fresh
   timestamp is the defect this programme keeps naming.

   ⛔ And 0 never meant *"no disagreements"* — it means the reader has not been called.

   ⭐⭐ **BUT THE STRUCTURAL ARGUMENT IS NOW MEASURABLE FROM GIT ALONE, WHICH NEEDS NO POD.**
   Saturday's write-up said *"web redeployed six times."* Re-measured against `origin/master`:
   **167 commits landed on master on 2026-09-12**, across every workstream — this programme,
   the joystick/glass closure, notebook, fundamentals, ops. Every master push rebuilds web
   (docs-only pushes included — this repo's own recorded rule). **A 200-sample threshold cannot be
   reached by a counter that resets on each of them**, and the reset rate is set by *other people's
   cadence*, which this programme does not control.

   ⛔ So the hold is correct and the gate needs re-specifying, not re-running: a durable counter, a
   scheduled reader, or a different reader. **Not chosen here — it is a ruling.** ⚠️ And whoever
   takes it should note the reader itself is cold by design: `ticker_returns._close` is reached
   only through the Desk's since-mention returns, on no scheduler and no hot path.
