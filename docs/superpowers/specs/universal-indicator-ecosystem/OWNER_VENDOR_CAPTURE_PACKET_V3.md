# Owner Vendor Capture Packet V3 — TradingView, ambiguity-first, both candidates always visible

**Supersedes `OWNER_VENDOR_CAPTURE_PACKET_V2.md` (and V1). Do not run V2's
script.** V2's candidate formulas had two real gaps external review caught:
`ta.median`'s candidates depended on another disputed TradingView built-in as a
stand-in reference instead of plain arithmetic, and `ta.percentrank`'s second
candidate was only described in prose ("expect ~80"), never plotted as its own
line. **V3 fixes both**: every one of the four ambiguities now plots its
TradingView built-in AND both candidate readings, side by side, computed by
ordinary arithmetic only — you never have to mentally infer what a number
"should" be.

**Before this packet was written, every candidate pair was verified locally**
(see the very last section) to actually produce two different numbers at the
probe row — an experiment that can't distinguish its own two hypotheses would
be worthless to run, so that was checked first, off TradingView entirely, with
a script anyone can re-run.

**Time: ~5-15 minutes** if export works; ~15-20 minutes on the Data Window
fallback.

---

## Why these four functions, first (unchanged from V2 — still true)

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
indicator("uct-oracle-ambiguity-v2", overlay=false)

// A 25-bar repeating pattern. `phase` (0..24, forever) is the row locator --
// "find phase == 24" works identically regardless of how much history your
// account loaded. No dependency on where history starts.
phase = bar_index % 25
raw = phase == 24 ? 6.0 :
      phase == 23 ? 3.0 :
      phase == 22 ? 5.0 :
      phase == 21 ? 1.0 :
      phase == 20 ? 9.0 :
      10.0 + phase

// ==== ta.rising(raw,3): candidate A (running-maximum, v5/v6 RETURNS clause)
// vs candidate B (strict monotone over length+1 samples, v3/v4 DESCRIPTION) ====
// At phase 24: current=6, 1-back=3, 2-back=5, 3-back=1.
// A: 6 > max(3,5,1)=5 -> TRUE.  B: needs 1<5<3<6 (every step up) -> 1<5 holds,
// 5<3 fails -> FALSE. Verified locally these differ (see the bottom section).
risingBuiltin           = ta.rising(raw, 3)
risingCandA_runningMax  = raw > math.max(raw[1], raw[2], raw[3])
risingCandB_monotone    = raw[3] < raw[2] and raw[2] < raw[1] and raw[1] < raw

// ==== ta.median(raw,4), even length: candidate lower-middle vs candidate
// mean-of-two-middles -- both by EXPLICIT ARITHMETIC (min/max/sum only),
// never by comparing against another disputed vendor built-in ====
// Window at phase 24 = {6,3,5,1}. Verified locally: lower-middle=3,
// mean-of-middles=4.
medianBuiltin    = ta.median(raw, 4)
medianCandLower  = math.max(math.min(raw, raw[1]), math.min(raw[2], raw[3]))
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
`math.max`, `math.min`, 2- and 3-argument forms) is either taken directly from
this codebase's own prior-researcher's already-considered Pine snippets or is
standard, widely-documented syntax — but this script has not been run through
an actual Pine compiler before reaching you. That is an honest gap, not a
guess dressed up as certainty, stated plainly rather than hidden.

---

## What exactly to expect at the probe row (`phase == 24`)

So you can sanity-check what comes back, here is every value this script
should show at any `phase == 24` bar, computed independently in plain Python
(full output in the self-check section at the end):

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
finding.

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

## Tranche 1B — core function parity (optional, separate, do only if 1A is done)

Unchanged from V2/V1 — reused verbatim as an explicitly optional follow-on:

```pine
//@version=5
indicator("uct-oracle-realdata-v1", overlay=false)
atr14                        = ta.atr(14)
tr1                          = ta.tr(true)
rsi14                        = ta.rsi(close, 14)
stochK14                     = ta.stoch(close, high, low, 14)
[aroonUp14, aroonDown14]     = ta.aroon(14)
hma55                        = ta.hma(close, 55)
modSign                      = (close - open) % 3
plot(atr14, "atr14")
plot(tr1, "tr1")
plot(rsi14, "rsi14")
plot(stochK14, "stochK14")
plot(aroonUp14, "aroonUp14")
plot(aroonDown14, "aroonDown14")
plot(hma55, "hma55")
plot(modSign, "modSign")
```

Export the same way, or fall back to the manual reads described in V1/V2 —
this paragraph stays terse because 1B is optional and unchanged.

---

## Observation record-keeping (for reference — nothing you need to do)

Every value you send back goes into this repo's existing Vendor Oracle store
(`tests/fixtures/vendor/observations/*.json`), extended by the minimal,
tested schema addition covered in `VENDOR_OBSERVATION_SCHEMA_EXTENSION.md`
(a separate, small proposal — not folded silently into this packet). For
`ta.rising`/`ta.bbw`/`ta.percentrank`/`ta.median` specifically, the eventual
ruling lands in `closedTable.json::_functions_excluded`'s own prose per name
(pre-implementation research), not in `tests/fixtures/vendor/divergences.json`
(which tracks already-shipped functions against ongoing vendor-parity risk —
these four haven't shipped).

---

## thinkorswim — smallest next step, not built yet

Unchanged from V2: no thinkorswim workflow is being built until this
TradingView packet is finalized and actually run. When that time comes, the
smallest next step is ATR/RSI's thinkScript paths (currently self-consistency-
tested only, never checked against a real thinkorswim screen), sized down from
this packet's technique since thinkScript has no confirmed equivalent of
`bar_index`-driven synthetic construction.

---

## Local self-check — proof this experiment discriminates, run before you ever open TradingView

This does **not** tell us anything about TradingView. It proves, in plain
Python, independent of any vendor, that the two candidate formulas plotted
for each of the four ambiguities actually produce different numbers at the
probe row — i.e., that running this on TradingView is capable of settling
something, rather than showing two numbers that were always going to agree.

The script is committed at
`docs/superpowers/specs/universal-indicator-ecosystem/verify_oracle_ambiguity_v3.py`.
Its full output, from an actual run:

```
probe bar i=24, phase=24
raw[i-4..i] = [9.0, 1.0, 5.0, 3.0, 6.0]

current=6.0 b1(1-back)=3.0 b2=5.0 b3=1.0 b4=9.0

=== ta.rising(raw,3) candidates ===
Candidate A (running-max: cur > max(b1,b2,b3)=5.0): True
Candidate B (monotone: b3<b2<b1<cur, i.e. 1.0<5.0<3.0<6.0): False
DISCRIMINATES: True

=== ta.median(raw,4) candidates (explicit min/max arithmetic, no vendor-builtin reference) ===
window sorted (reference only): [1.0, 3.0, 5.0, 6.0]
Candidate lower-middle = max(min(6.0,3.0),min(5.0,1.0)) = 3.0
Candidate mean-of-middles = (15.0-6.0-1.0)/2 = 4.0
Cross-check vs sorted-list reference: lower=True mean=True
DISCRIMINATES: True

=== ta.percentrank(raw,4) candidates ===
priors (close[1..4] equivalent) = [3.0, 5.0, 1.0, 9.0]
count of priors <= current(6.0): 3
Candidate A (/L=4, current bar NOT in the sample): 100*3/4 = 75.0
Candidate B (/(L+1)=5, current bar IN the sample, count+1=4): 100*4/5 = 80.0
DISCRIMINATES: True
(sanity only, NOT candidate B: same numerator over L+1 = 100*3/5 = 60.0)

=== ta.bbw(raw,20,2) candidates ===
window20 = [15.0, 16.0, 17.0, 18.0, 19.0, 20.0, 21.0, 22.0, 23.0, 24.0, 25.0, 26.0, 27.0, 28.0, 29.0, 9.0, 1.0, 5.0, 3.0, 6.0]
sma(20)=17.7  population stdev(20)=8.444524853418338
Candidate ratio: (2*2.0*8.444524853418338)/17.7 = 1.908367198512619
Candidate percent (x100): 190.8367198512619
DISCRIMINATES (order of magnitude): ratio=1.908367 vs percent=190.836720

ALL FOUR ORACLE PROBES CONFIRMED DISCRIMINATING at phase==24. See module docstring for what this does and does not prove.
```

The script's own assertions additionally pin the exact expected values (`True`/
`False` for rising, `3.0`/`4.0` for median, `75.0`/`80.0` for percentrank, the
~100x ratio/percent gap for bbw) so a future accidental edit to the planted
window would fail loudly rather than silently drift.
