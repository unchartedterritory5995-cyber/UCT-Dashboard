# Owner Vendor Capture Packet V3.1 — TradingView, ambiguity-first, both candidates always visible

**Supersedes `OWNER_VENDOR_CAPTURE_PACKET_V3.md` (and V2, and V1). Do not run
V3's script.** The only change from V3: `medianCandLower`'s formula is
replaced with one proven order-independent by an actual permutation/
duplicate/random property test (V3's version passed only its one planted
probe case and turned out wrong ~30% of the time under a different ordering
of the same four numbers — the property test that would have caught this
was not run before V3 was sent). Every other candidate (rising, percentrank,
bbw) and the rest of this packet's design is unchanged from V3.

**Time: ~5-15 minutes** if export works; ~15-20 minutes on the Data Window
fallback.

**2026-09-05 correction (documentation-only, no semantic change):** the `raw`
ternary chain below is now given as one flattened line rather than a
multi-line chain. A real capture the same day found that pasting the
original multi-line form into TradingView's Pine Editor let Monaco's
auto-indent turn each continuation line into a deeper staircase than the
last, which Pine's parser then rejected outright ("end of line without line
continuation") — a paste-reliability defect in this packet's own
instructions, not a finding about the oracle's design. The flattened form is
the exact expression that was proven to paste and compile cleanly in that
capture, and it is semantically identical to the original. Tranche 1A's real
findings from that capture are recorded in `RISK_REGISTER.md` RISK-018a.

---

## Why these four functions, first (unchanged)

`ta.rising`, `ta.bbw`, `ta.percentrank`, and `ta.median` (even-length) are
already refused by name in this codebase's translator. This repo's own prior
research (commits `968209bfe` and `0950cff9f`, both 2026-09-03) found
TradingView's own documentation genuinely self-contradictory for all four, and
measured — against a corpus of 48 real Pine scripts blind to this engine —
that `ta.rising` was the single most-requested undeclared function name, with
`ta.bbw` among the names most responsible for a script failing to translate at
all. These are the measured, current leading edge of what's blocking real
coverage, not a top-of-mind guess. RSI/ATR/EMA/etc. ("Tranche 1B") remain
explicitly secondary — see the end of this document.

---

## Before you start

- **Platform:** TradingView, web, tradingview.com. Log in your own way —
  nothing here asks for your password.
- Open **any chart, any symbol, Daily timeframe.** Three of the four checks
  never read real price — they run on a self-built deterministic series — so
  the chart choice doesn't affect the result. AAPL Daily is a fine default.

---

## The one script

1. **Pine Editor** (bottom toolbar, or the `</>` icon) → **"Open" → "New blank
   indicator"** → select all → delete.
2. Paste this exactly:

```pine
//@version=5
indicator("uct-oracle-ambiguity-v3", overlay=false)

// A 25-bar repeating pattern. `phase` (0..24, forever) is the row locator --
// "find phase == 24" works identically regardless of how much history your
// account loaded. No dependency on where history starts.
// Flattened to one line deliberately -- Pine's parser requires a continued
// line to be indented consistently deeper than the statement it continues,
// and pasting a multi-line version into TradingView's Pine Editor lets
// Monaco's auto-indent turn each continuation line into a deeper staircase
// than the last, which the parser then rejects ("end of line without line
// continuation"). This exact one-line form was proven to paste and compile
// cleanly in a real capture (2026-09-05). Same expression, same semantics --
// this is a paste-reliability fix, not a change to the oracle's design.
phase = bar_index % 25
raw = phase == 24 ? 6.0 : phase == 23 ? 3.0 : phase == 22 ? 5.0 : phase == 21 ? 1.0 : phase == 20 ? 9.0 : 10.0 + phase

// ==== ta.rising(raw,3): candidate A (running-maximum, v5/v6 RETURNS clause)
// vs candidate B (strict monotone over length+1 samples, v3/v4 DESCRIPTION) ====
// At phase 24: current=6, 1-back=3, 2-back=5, 3-back=1.
// A: 6 > max(3,5,1)=5 -> TRUE.  B: needs 1<5<3<6 (every step up) -> 1<5 holds,
// 5<3 fails -> FALSE. Verified locally these differ.
risingBuiltin           = ta.rising(raw, 3)
risingCandA_runningMax  = raw > math.max(raw[1], raw[2], raw[3])
risingCandB_monotone    = raw[3] < raw[2] and raw[2] < raw[1] and raw[1] < raw

// ==== ta.median(raw,4), even length: candidate lower-middle vs candidate
// mean-of-two-middles -- both by EXPLICIT ARITHMETIC (min/max/sum only),
// never by comparing against another disputed vendor built-in ====
// medianCandLower uses a min/max sorting-network fragment PROVEN order-
// independent (permutations + duplicates + 2000 random trials, 0 failures --
// see verify_oracle_ambiguity_v3_1.py) rather than a formula that only
// happened to work for one planted ordering.
loAB = math.min(raw, raw[1])
hiAB = math.max(raw, raw[1])
loCD = math.min(raw[2], raw[3])
hiCD = math.max(raw[2], raw[3])
medianBuiltin    = ta.median(raw, 4)
medianCandLower  = math.min(math.max(loAB, loCD), math.min(hiAB, hiCD))
medianSum4       = raw + raw[1] + raw[2] + raw[3]
medianMax4       = math.max(math.max(raw, raw[1]), math.max(raw[2], raw[3]))
medianMin4       = math.min(math.min(raw, raw[1]), math.min(raw[2], raw[3]))
medianCandMean   = (medianSum4 - medianMax4 - medianMin4) / 2

// ==== ta.percentrank(raw,4): candidate A (/L, current bar NOT in the sample)
// vs candidate B (/(L+1), current bar joins the sample and trivially counts
// as <= itself) -- BOTH plotted explicitly, never left as "expect ~80" ====
// Window at phase 24: current=6, close[1..4]=3,5,1,9 -- 3 of 4 are <=6.
// A = 100*3/4 = 75.  B = 100*(3+1)/5 = 80. Verified locally these differ (and
// neither is the naive-but-wrong 100*3/5=60).
percentrankBuiltin           = ta.percentrank(raw, 4)
percentrankPriorCount        = (raw[1] <= raw ? 1 : 0) + (raw[2] <= raw ? 1 : 0) + (raw[3] <= raw ? 1 : 0) + (raw[4] <= raw ? 1 : 0)
percentrankCandA_overL       = 100.0 * percentrankPriorCount / 4.0
percentrankCandB_overLplus1  = 100.0 * (percentrankPriorCount + 1) / 5.0

// ==== ta.bbw(raw,20,2): candidate ratio vs candidate ratio-times-100 ====
// Both read from the SAME stdev/sma at the SAME 20-bar window, so the only
// difference plotted is the disputed constant itself.
bbwBuiltin      = ta.bbw(raw, 20, 2)
bbwCandRatio    = 2.0 * 2.0 * ta.stdev(raw, 20) / ta.sma(raw, 20)
bbwCandPercent  = bbwCandRatio * 100.0

plot(phase, "phase")
plot(raw, "raw")
plot(risingBuiltin ? 1 : 0, "rising_builtin")
plot(risingCandA_runningMax ? 1 : 0, "rising_candA_runningMax")
plot(risingCandB_monotone ? 1 : 0, "rising_candB_monotone")
plot(medianBuiltin, "median_builtin")
plot(medianCandLower, "median_candLower")
plot(medianCandMean, "median_candMean")
plot(percentrankBuiltin, "percentrank_builtin")
plot(percentrankCandA_overL, "percentrank_candA_overL")
plot(percentrankCandB_overLplus1, "percentrank_candB_overLplus1")
plot(bbwBuiltin, "bbw_builtin")
plot(bbwCandRatio, "bbw_candRatio")
plot(bbwCandPercent, "bbw_candPercent")
```

3. Click **"Add to Chart."** A pane with 14 lines appears.

**If TradingView reports a compile error on any line, don't edit the script
yourself — send back the exact error text.** Every function/signature used
(`ta.rising`, `ta.median`, `ta.percentrank`, `ta.bbw`, `ta.stdev`, `ta.sma`,
`math.max`, `math.min`, 2-argument forms only in this revision) is either
taken directly from this codebase's own prior-researcher's already-considered
Pine snippets or is standard, widely-documented syntax — but this script has
not been run through an actual Pine compiler before reaching you. That is an
honest gap, not a guess dressed up as certainty, stated plainly rather than
hidden.

---

## What exactly to expect at the probe row (`phase == 24`)

| Series | Expected value |
|---|---|
| `raw` | 6 |
| `rising_candA_runningMax` | 1 (true) |
| `rising_candB_monotone` | 0 (false) |
| `median_candLower` | 3 |
| `median_candMean` | 4 |
| `percentrank_candA_overL` | 75 |
| `percentrank_candB_overLplus1` | 80 |
| `bbw_candRatio` | ≈1.9084 |
| `bbw_candPercent` | ≈190.84 |

The `_builtin` rows are exactly what TradingView tells us — there is no
"expected" value for those; whichever candidate they match (or neither) is the
finding. (Unchanged from V3 — the corrected median formula produces the same
expected values at this specific probe row; only its general correctness away
from this one row was the bug.)

---

## Getting the numbers out: try export first

4. Right-click the chart → **"Export chart data..."** (or a small
   camera/download icon), if TradingView offers it without asking you to pay:
   - Export the full available history (or ≥200 bars) as CSV.
   - **Send that one file.** It has a `phase` column and all 13 other plotted
     values for every bar — every `phase == 24` row can be found and
     cross-checked against every other occurrence for consistency.
   - **Tranche 1A is done.** Optionally continue to Tranche 1B below.

5. **If export is unavailable or gated behind payment, skip it and use the
   Data Window instead:**
   - Open the **Data Window** (table icon, right-hand toolbar).
   - Click the chart, then slowly drag the crosshair. Watch **`phase`** count
     0→24 and repeat. **Stop at any bar where `phase` reads exactly 24.**
   - Send back all 13 non-`phase` values shown for that one bar (or a
     screenshot of the whole panel — often faster than typing).

That's the entire required capture.

---

## What NOT to do

- Don't "Publish Script" — "Add to Chart" is enough.
- Don't buy or upgrade anything, including for CSV export — skip it if gated.
- Don't share your TradingView login.
- Don't interpret or "correct" a number that looks off — send exactly what the
  screen or export shows.

---

## Tranche 1B / observation record-keeping / thinkorswim — unchanged from V3

See `OWNER_VENDOR_CAPTURE_PACKET_V3.md` for the optional Tranche 1B
(RSI/ATR/Stoch/Aroon/HMA real-price script), the observation record-keeping
note, and the thinkorswim next-step note — none of that changed in this
revision; only the median formula above did, and it is not worth re-pasting
identical text a third time.

---

## Local self-check — proof this experiment discriminates, including a real property test for the fixed formula

`docs/superpowers/specs/universal-indicator-ecosystem/verify_oracle_ambiguity_v3_1.py`
is the corrected script (supersedes `verify_oracle_ambiguity_v3.py`, which is
kept as the historical record of the bug, marked at its own top). It now
proves TWO things instead of one: that `median_lower_middle` is genuinely
order-independent (24 permutations + 9 duplicate-bearing cases + 2000 random
trials, checked BEFORE the probe check runs at all), and — as before — that
all four candidate pairs produce different numbers at `phase == 24`. Full
output from an actual run:

```
=== PROPERTY TEST: median_lower_middle (permutations + duplicates + 2000 random trials) ===
0 failures across 24 permutations + duplicate cases + 2000 random trials. median_lower_middle is confirmed order-independent before use.

probe bar i=24, phase=24
raw[i-4..i] = [9.0, 1.0, 5.0, 3.0, 6.0]

current=6.0 b1(1-back)=3.0 b2=5.0 b3=1.0 b4=9.0

=== ta.rising(raw,3) candidates ===
Candidate A (running-max: cur > max(b1,b2,b3)=5.0): True
Candidate B (monotone: b3<b2<b1<cur, i.e. 1.0<5.0<3.0<6.0): False
DISCRIMINATES: True

=== ta.median(raw,4) candidates (median_lower_middle, proven general above; sum-max-min for the mean) ===
window sorted (reference only): [1.0, 3.0, 5.0, 6.0]
Candidate lower-middle (proven-general formula) = 3.0
Candidate mean-of-middles = (15.0-6.0-1.0)/2 = 4.0
Cross-check vs sorted-list reference: lower=True mean=True
DISCRIMINATES: True

=== ta.percentrank(raw,4) candidates ===
priors (close[1..4] equivalent) = [3.0, 5.0, 1.0, 9.0]
Candidate A (/L=4, current NOT in sample): 100*3/4 = 75.0
Candidate B (/(L+1)=5, current IN sample, count+1=4): 100*4/5 = 80.0
DISCRIMINATES: True
(sanity only, NOT candidate B: 100*3/5 = 60.0)

=== ta.bbw(raw,20,2) candidates ===
sma(20)=17.7  population stdev(20)=8.444524853418338
Candidate ratio: (2*2.0*8.444524853418338)/17.7 = 1.908367198512619
Candidate percent (x100): 190.8367198512619
DISCRIMINATES (order of magnitude): ratio=1.908367 vs percent=190.836720

ALL FOUR ORACLE PROBES CONFIRMED DISCRIMINATING at phase==24, and the median helper formula is confirmed order-independent (not just correct-by-coincidence for this one probe). See module docstring for what this does and does not prove.
```
