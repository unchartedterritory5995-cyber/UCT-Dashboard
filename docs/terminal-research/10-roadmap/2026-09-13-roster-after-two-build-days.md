---
id: ROSTER-2026-09-13
title: The 32-system roster after two build days
role: the state-of-the-programme table the owner asked for at the end of day 2, and the throughput measurement beside it
status: measurement, not a plan. Every "SHIPPED" cites a merge SHA; every "not built" is a measured absence.
date: 2026-09-13
measured_against: origin/master @ 76c62c494
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
| **S7** Alerts | **4 of 8 types live**; four more at CP1–CP2 **in flight** | packets signed CP1–CP2; four parallel builds running at time of writing |
| **S8** Provenance & Freshness | SHIPPED; full `<Cited>` still D2-gated | consumer of D2 CP2 |
| **S9** Entitlements | not built | ⛔ untouched — owner-bound, OI-03 |
| **S10** Presentation Primitives | **SHIPPED `3c539d011`** · F-S10-2 `e909279e1` · **CP2 `6576f044e`** | F-S10-1 resolved: a price has TWO right renderings, both named |
| **S11** Session / Clock | SHIPPED | dependency only |
| **S12** Rollout | **1st migration `56df6803f`** · **2nd `78ba40fe8`** | in-pod verified: cohort 6, projected **12**, unchanged |

## 2. Data-platform systems (D-series)

| system | state | changed this weekend |
|---|---|---|
| **D1** Provider Abstraction | SHIPPED, census GREEN | dependency only |
| **D2** Canonical Data Model | **CP1 `b9783d509`** · **CP2 `ffa8102c7`** — 142 metrics, two stores | ⛔ **CP3 HELD.** Sample count measured today: **0**, and the gate as written is unreachable — see §5 |
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
| **A9** Screening | live surface; **GATE-ONLY** on S7 `scan-membership-change` | ⭐ the single unblocking dependency is in flight today |
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

| | Saturday (day 1) | Sunday (day 2, to this point) |
|---|---|---|
| **code merges** | **5** | **3** (H14, S4 CP1, + 4 in flight) |
| **doc commits** | 8 | 5 |
| **gate packets written** | 9 | 1 (H14) |
| **approval lines signed** | 4 | 6 |
| **mutation cycles run** | **22** | **7** |
| **in-pod read-only probes** | 2 | 2 |
| **findings recorded** | 8 (F-D2-1/2/3, F-I1-5/6, Δ2, Δ3, the D5 register gap) | 3 (the fourth and fifth placeholder detectors; the AMD row; the CP3 gate) |

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
7. ⛔ **D2 CP3's gate is unreachable as written.** The dual-compute ledger is in-process and resets
   on every deploy; web redeployed six times on Saturday. A 200-sample threshold cannot be reached
   by a counter that dies on each push. The intent is right; the mechanism needs a durable counter,
   a scheduled reader, or a different reader. **Not chosen here — it is a ruling.**
