# Owner Vendor Capture Packet V2 — TradingView, ambiguity-first

**🔴 SUPERSEDED 2026-09-05 — use `OWNER_VENDOR_CAPTURE_PACKET_V3.md`. Do not run
this V2 script.** External review found the candidate formulas below did not
give the owner enough to verify locally: `ta.median`'s candidates leaned on
another disputed vendor built-in (`ta.percentile_nearest_rank`) as a reference
instead of plain arithmetic, and `ta.percentrank`'s second candidate was only
described in prose, never plotted as its own line, leaving the exact expected
number implicit. V3 plots both candidates explicitly for all four ambiguities,
computed by arithmetic alone, and ships with a companion local self-check
(`verify_oracle_ambiguity_v3.py`) proving every candidate pair actually differs
— run and its output committed — before being sent to the owner. Kept below,
unedited, as the historical record V1→V2's own convention already established.

**Supersedes `OWNER_VENDOR_CAPTURE_PACKET.md` (V1). Do not use V1 — its steps
depended on "the 5th bar from the start of history," which is not reproducible
across accounts/history lengths. Do not perform V1's steps.**

**What changed:** V1 asked for 8 scattered reads across "the first bars of
history." V2 asks for **ONE deterministic, self-locating oracle script** that
settles the four highest-leverage open questions in this codebase's Pine
translator — questions that are provably blocking real member scripts today, not
hypothetical ones — and, if TradingView's chart-data export is available to your
account, needs **one export, not dozens of manual reads.**

**Time: ~5-15 minutes** if export works; ~15-20 minutes if you fall back to
reading four specific rows from the Data Window.

---

## Why these four functions, first (not RSI, not ATR)

`ta.rising`, `ta.bbw`, `ta.percentrank`, and `ta.median` (even-length) are
**already refused by name** in this codebase's translator — a member who pastes
a script using any of them gets a specific, honest refusal instead of a wrong
answer, because prior research (this repo's own commits `968209bfe` and
`0950cff9f`, both 2026-09-03) found TradingView's own documentation is
internally ambiguous or self-contradictory for all four. That prior research
also measured, against a corpus of 48 real Pine scripts blind to this engine,
that `ta.rising` was **the single most-requested undeclared function name**, and
`ta.bbw` was one of three names (alongside `ta.rising` and an unrelated
translation gap) responsible for a script failing to translate at all. **These
four are not a random top-of-mind list — they are the measured, current leading
edge of what's blocking real coverage**, and every one of the four already has a
prior researcher's exact, considered oracle experiment written into this
engine's own manifest (`closedTable.json::_functions_excluded`) — this packet's
script is those four experiments, combined into one.

RSI/ATR/EMA/etc. ("Tranche 1B") are real, valuable, and **explicitly secondary**
— see the very end of this document. Do not do 1B before 1A; it would spend your
time on lower-leverage functions the engine already implements reasonably well,
ahead of four that are currently refused outright.

---

## Before you start

- **Platform:** TradingView, web, tradingview.com — no app needed.
- **Log in** with your own account, your own way. Nothing here needs or asks for
  your password.
- Open **any chart, any symbol, Daily timeframe.** The script below does not
  read real price data for three of its four checks — it builds its own
  deterministic numbers — so which chart you open does not affect the result.
  AAPL Daily is a fine, boring default if you have no preference.

---

## The one script

1. At the **bottom of the chart**, click **"Pine Editor"** (or the `</>` icon in
   the bottom toolbar if you don't see the tab).
2. Click **"Open" → "New blank indicator"**, select all, delete.
3. Paste this exactly:

```pine
//@version=5
indicator("uct-oracle-ambiguity-v1", overlay=false)

// A 25-bar repeating pattern. `phase` is the row locator: it counts 0..24 and
// repeats FOREVER, so "find phase == 24" works identically whether your chart
// loaded 200 bars or 20,000 — there is no dependency on where history starts.
phase = bar_index % 25
raw = phase == 24 ? 6.0 :
      phase == 23 ? 3.0 :
      phase == 22 ? 5.0 :
      phase == 21 ? 1.0 :
      phase == 20 ? 9.0 :
      10.0 + phase

// ---- ta.rising: running-maximum vs strict-monotone-every-bar ----
// At phase 24 the trailing 4 values (oldest->newest) are 9,1,5,3,6 (4-back
// through current). Running-max: is 6 > max(1,5,3)=5? YES. Monotone (needs
// 1<5<3<6, i.e. every step up): 1<5 holds, 5<3 does NOT -> chain breaks. The
// two readings disagree at this exact row by construction.
risingBuiltin  = ta.rising(raw, 3)
risingRunMax   = raw > math.max(raw[1], raw[2], raw[3])
risingMonotone = raw[3] < raw[2] and raw[2] < raw[1] and raw[1] < raw

// ---- ta.median (even length=4): mean-of-two-middles vs lower-middle ----
// Window at phase 24 = {6,3,5,1}. Sorted: 1,3,5,6. Two middles: 3 and 5 --
// clearly different, so a tie can't hide the answer. Mean=4, lower-middle=3.
// ta.percentile_nearest_rank always returns an ACTUAL observed value (never an
// average), so at p50/n4 it IS the lower-middle reading, by definition -- it's
// the reference, not a guess.
medianBuiltin  = ta.median(raw, 4)
medianLowerMidRef = ta.percentile_nearest_rank(raw, 4, 50)

// ---- ta.percentrank (length=4): divide by L or by L+1 ----
// Window at phase 24 = current 6, plus close[1..4] = 3,5,1,9. Three of those
// four are <= 6 (3,5,1); one (9) is not. /L=4 and /(L+1)=5 give DIFFERENT
// percentages for a 3-out-of-4 count, so this row discriminates.
percentrankBuiltin = ta.percentrank(raw, 4)
percentrankOverL   = 25.0 * ((raw[1] <= raw ? 1 : 0) + (raw[2] <= raw ? 1 : 0) + (raw[3] <= raw ? 1 : 0) + (raw[4] <= raw ? 1 : 0))

// ---- ta.bbw (length=20, mult=2): ratio vs ratio-times-100 ----
// Uses the same synthetic series (20-bar window ending at phase 24 has real,
// non-degenerate variance from the 10.0+phase ramp) -- a real-market-data
// dependency was avoidable here too, so it was avoided.
bbwBuiltin  = ta.bbw(raw, 20, 2)
bbwRatioForm = 2.0 * 2.0 * ta.stdev(raw, 20) / ta.sma(raw, 20)

plot(phase, "phase")
plot(raw, "raw")
plot(risingBuiltin ? 1 : 0, "rising_builtin")
plot(risingRunMax ? 1 : 0, "rising_runmax")
plot(risingMonotone ? 1 : 0, "rising_monotone")
plot(medianBuiltin, "median_builtin")
plot(medianLowerMidRef, "median_lowermid_ref")
plot(percentrankBuiltin, "percentrank_builtin")
plot(percentrankOverL, "percentrank_over_L")
plot(bbwBuiltin, "bbw_builtin")
plot(bbwRatioForm, "bbw_ratio_form")
```

4. Click **"Add to Chart."** A pane with 11 lines appears below the price chart.

**If TradingView reports an error on any single line**, don't try to fix it
yourself — copy the exact error message and send it back. Every function name
above (`ta.rising`, `ta.median`, `ta.percentile_nearest_rank`, `ta.percentrank`,
`ta.bbw`, `ta.stdev`, `ta.sma`, `math.max`) and the multi-argument forms used are
taken directly from this codebase's own prior researcher's already-considered
Pine snippets or standard documented syntax, but this script has not been run
through an actual Pine compiler before reaching you — an honest gap, not a
guess dressed up as certainty.

---

## Getting the numbers out: try export first

5. Look for a small **camera/download icon** near the chart, or **right-click
   the chart → "Export chart data..."**. If TradingView offers this without
   asking you to pay for anything:
   - Export the **full available history** (or at least ~200 bars) as CSV.
   - **Send that one CSV file.** It will contain a `phase` column and all 10
     other plotted values, for every bar — I can find every `phase == 24` row
     myself and cross-check them against each other for consistency, which is
     MORE rigorous than reading one row by hand.
   - **You're done with Tranche 1A.** Skip to Tranche 1B below, or stop here.

6. **If export isn't available or wants payment, skip it** — say so, and use the
   Data Window fallback instead:
   - Open the **Data Window** (the table-like icon on the chart's right-hand
     toolbar).
   - Click on the chart, then **slowly drag the crosshair** left or right.
     Watch the **`phase`** row in the Data Window — it will count up 0, 1, 2,
     ..., 24, then jump back to 0 and repeat. **Stop at any bar where `phase`
     reads exactly 24** — it doesn't matter which occurrence; every one is
     identical by construction.
   - **Send back** every value the Data Window shows at that one bar: `raw`,
     `rising_builtin`, `rising_runmax`, `rising_monotone`, `median_builtin`,
     `median_lowermid_ref`, `percentrank_builtin`, `percentrank_over_L`,
     `bbw_builtin`, `bbw_ratio_form`. A screenshot of the whole Data Window
     panel at that bar is just as good as typing out ten numbers, and is
     probably faster.

That's the entire required capture.

---

## What NOT to do

- Don't click "Publish Script" — "Add to Chart" is enough.
- Don't buy or upgrade anything, including for the CSV export — skip it and use
  the Data Window fallback instead if it's gated.
- Don't share your TradingView login, and nothing here will ask you to.
- Don't try to interpret the numbers yourself or "fix" a value that looks
  wrong — send exactly what the screen or export shows. Working out what a
  mismatch means is my job, not yours.

---

## Tranche 1B — core function parity (optional, separate, do this only if 1A is done and you have time left)

This is the **already-reviewed V1 packet's second script**, unchanged, reused
here as an explicitly optional follow-on so it never competes with 1A for your
time. It covers RSI, ATR/true-range alignment, Stochastic %K, Aroon Up/Down,
HMA, and a mod-sign check — real, high-use functions this engine already
implements, where a real vendor read would upgrade existing DEFINITION-TESTED
confidence to actual VENDOR-OBSERVED confidence, but nothing here is currently
refused or blocking a member the way the four Tranche-1A functions are.

If you want to do this too, in the same session: open AAPL, Daily, and paste
this SEPARATE script (a new Pine Editor tab, or replace the ambiguity script —
either is fine, this one doesn't need to coexist with it):

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

Export the same way (chart data export, ~100 bars), or — if reading manually —
find the first bar `atr14` shows a value (scroll to the start of history for
this one specific read, since the question IS about where history starts) and
read `tr1` on that bar and the one before it, then pick any one recent bar and
read all eight values, then find a red candle nearby and read `modSign` there.
Full detail unchanged from the original packet if you want it — this paragraph
is deliberately terse because 1B is optional.

---

## Observation record-keeping (for reference — nothing you need to do)

Every value you send back gets folded into this repo's existing Vendor Oracle
store (`tests/fixtures/vendor/observations/*.json` — the same system, not a new
one), which already has the exact provenance fields this kind of capture needs:
platform, platform/Pine version, capture date, the exact script, the exact
bars/inputs, the vendor's own displayed values, and — once compared —a
classified result. Two small, optional additions this capture will need that the
existing schema doesn't quite have a field for yet (proposed, not yet built,
since Track F implementation hasn't started): a `syntheticInput` object
alongside the usual `market.bars` (since three of these four checks compute over
`raw`, not real price, the schema's existing "vendor's own bars" field still gets
populated for chart provenance, but the actual input values driving the result
need their own field), and a hash of the script text (catches an accidental
mid-session edit between when a script was designed and when it was run). For
`ta.rising`/`ta.bbw`/`ta.percentrank`/`ta.median` specifically — none of which
are implemented in the engine yet — the eventual RULING lands in
`closedTable.json::_functions_excluded`'s own prose for each name (updating "the
constant is not settled" to "settled: X, confirmed 2026-XX-XX"), not in
`tests/fixtures/vendor/divergences.json` (that file tracks functions this engine
has already SHIPPED against ongoing vendor-parity risk — these four haven't
shipped, so a divergences.json row would be the wrong home for them and would
misuse a file whose whole point is post-implementation tracking).

---

## thinkorswim — smallest next step, not built yet

Per instruction, no thinkorswim capture workflow is being built until this
TradingView packet is finalized and run. The smallest next step, when that time
comes: prioritize thinkScript claims that currently rest on this engine's own
self-consistency tests alone (the JS/Python lanes agreeing with EACH OTHER) with
no real thinkorswim screen ever read — ATR and RSI's thinkScript paths are the
most-used candidates, mirroring exactly the TradingView Tranche-1B list above,
since the same "we've never actually looked" gap applies to both dialects
independently. A thinkorswim-specific version of this SAME synthetic-driver
technique is very likely NOT available — thinkScript does not have the exact
equivalent of `bar_index`-driven synthetic construction confirmed working the
way Pine's does here, so a first thinkorswim packet should expect to lean more
on real chart data and a shorter, narrower ask than this one, sized down once
TradingView's capture actually confirms the technique end-to-end. This is
intentionally not designed further right now.
