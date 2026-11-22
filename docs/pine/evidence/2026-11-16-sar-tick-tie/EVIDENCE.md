# SAR tick tie: `math.round_to_mintick` on a half tick, and `tf_merge` in the two window masks (evidence)

Branch `fix/pine-sar-label-and-tfmerge-masks`, cut from master `890b6d165c` (engine 60) and merged with master
`6ee6fb2d0e` (engine 61). No engine number is taken here: `SCRIPT_ENGINE_VERSION` stays master's 61, and the
history sentence is a `NUMBER PENDING` line the coordinator numbers at merge. Two items.

## Fix 1: parabolic-sar's label printed one decimal short

### The defect

`parabolic-sar` (`corpus/committed/parabolic-sar__xoeoPMOWGJ.pine`, //@version=4) was on the committed runtime
kill list since s28: "a label prints its price one decimal short of TradingView (654.4 vs 654.41, s28 SPY)".
Its labels are `label.new(bar_index, sar, text = tostring(round_to_mintick(sar)), …)`.

Re-graded FIRST on master (engine 60, CBC-FMT and the `ta.rma` summation already in), mini-harness over the
three parabolic-sar captures:

| capture | runtime-on (master) | production (master) |
|---|---|---|
| parabolic-sar-rddt-1d-2026-11-15 | MATCH (52 labels, every text) | INCONCLUSIVE (`pine:timeout`, `nextsar` nested past 400 levels) |
| parabolic-sar-spy-1d-2026-11-15 | **DIVERGE**: labels text onlyVendor `["654.41"]`, onlyOurs `["654.4"]` | INCONCLUSIVE (same refusal) |
| parabolic-sar-rddt-1d-2026-10-03 | MATCH | INCONCLUSIVE (same refusal) |

So CBC-FMT did not settle it. The label is on 2025-09-30 (`x` 20, `y` 654.405, the bar whose low is 654.405).
The text is not the formatter's: `str.tostring` prints what `round_to_mintick` hands it, and both lanes wrote
`round_to_mintick(x)` as `math.round(x / syminfo.mintick) * syminfo.mintick`. In binary:

- `654.405` is 654.404999999999972715…;
- `654.405 / 0.01` is **65440.49999999999** (below the half: rounds to 65440, prints "654.4");
- `654.405 * 100` is **65440.5** exactly (the half: rounds up to 65441, prints "654.41").

CBC-FMT's own evidence had named it as open ("`math.round_to_mintick(127.705)` reads 127.7 … a numeric change,
out of this scope"; 127.705 / 0.01 is in fact 12770.5 on this V8, so that example was not the live one).

### The reference

`tools/pine_survey/pine_reference_extract.js --version 4|5|6`, read 2026-11-16; one sentence in all three
versions (v4 `round_to_mintick`, v5 and v6 `math.round_to_mintick`):

> Returns the value rounded to the symbol's mintick, i.e. the nearest value that can be divided by
> syminfo.mintick, without the remainder, with ties rounding up.

v5 and v6 add, under Returns: "The `number` rounded to tick precision."

The reference says ties round UP. It does not say whether a "tie" is the DECIMAL value the script wrote
(654.405 is a half tick at 0.01) or the BINARY double it holds (a hair under the half). That is the question,
and there is one witness.

### The change

ONE helper, `app/src/components/chart/engine/ast/tickRound.js::roundToMintickTree`, writes

    math.round(x * (1 / syminfo.mintick)) * syminfo.mintick

and both lanes resolve it: the host lane (`pine.js::resolveTableCall`) and the runtime lane (the RT5 desugar
in `pineRuntimeFrontend.js`, which also serves v4's bare `round_to_mintick`). Before, each lane wrote its own
copy of the quotient form. The Python twin does not format label text and does not lower `round_to_mintick`;
the broker's fill rounding (`runtime/broker.js::roundToTick`, B-ROUND) is a separate, witnessed rule and is
untouched.

### Why this reading, and what it does not settle

Three readings print 654.41 for this witness:

| reading | 654.405 | 1.005 | 163.265 | 127.705 |
|---|---|---|---|---|
| `div` = round(x / tick) (before) | 654.40 | 1.00 | 163.26 | 127.71 |
| **`mul` = round(x * (1 / tick)) (served)** | **654.41** | **1.00** | **163.26** | **127.71** |
| `eps` = floor(x / tick + 0.5 + 1e-6) (B-ROUND's tolerance) | 654.41 | 1.01 | 163.27 | 127.71 |
| `dec` = shortest decimal, a tie up | 654.41 | 1.01 | 163.27 | 127.71 |

`mul` is the reading consistent with the capture that moves NO other committed answer: it moves a decimal tie
only where `x * scale` lands on the half (always up), and it keeps 1.005 at 1.00, which is what TradingView's
own `format.mintick` prints for 1.005 (`vw-fmt-tie-readings` T08). `eps` and `dec` give 1.01 there. They part
on values as plain as 1.005 and 163.265 at a 0.01 tick, so a capture can falsify the choice:
`tools/visual_conformance/probes/vw-round-to-mintick-ties.pine` (NYSE:RDDT 1D and AMEX:SPY 1D), rows K01-K24,
queued in `docs/pine/capture-queue-2026-11-16-tick-tie-and-htf-windows.md`. K02 (1.005) and K03 (163.265)
printing 1.01 / 163.27 would say `mul` is wrong; K06-K08 settle a negative tie (this engine's `math.round` is
half away from zero, the reference says "up"; no capture holds a negative tie).

### Is `1 / mintick` exact?

`1 / tick` is the vendor's `pricescale / minmov`. Measured in IEEE doubles:

| tick | 1 / tick | exact |
|---|---|---|
| 0.01 | 100 | yes |
| 0.05 | 20 | yes |
| 0.25 | 4 | yes |
| 0.001, 0.0001, 1e-6, 1e-8 | 1000, 10000, 1e6, 1e8 | yes |
| 1, 0.5, 1/32 | 1, 2, 32 | yes |
| **0.00001** | **99999.99999999999** | **no** |

The ticks the committed captures hold: 0.01 (714 captures plus 18 with no `minmov`), 0.0001 (NASDAQ:DFLIW,
NASDAQ:GRRRW, OTC:AITX), 0.00001 (FX:EURUSD, 5), 1 (BITSTAMP:BTCUSD, 3) and 0.25 (1). Only 0.00001 is inexact,
and it moves TIES only, never a value off a tie: over 2,842,858 six-decimal values, `x * (1 / 1e-5)` and
`x * 1e5` differ on 236,783 ties and 0 others; over 1,000,000 random doubles the product differs from the
exact real-number rounding on 0. And the product only ever meets the tick this engine SERVES: `syminfo.mintick`
is served for NASDAQ, NYSE and NYSE Arca (0.01, `symbolScope.json::tick_size`) and refused by name everywhere
else. `vendorHarness.sarTickTie.test.js` holds every served tick's reciprocal exact, so a served 0.00001 turns it
red before it can reach a member. No decimal-tie correction is needed today.

### The re-grade (both lanes, every committed capture whose script calls `round_to_mintick`)

26 captures (`atr-bands` x2, `fibonacci-dolphintradebot` x3, `ict-killzones-pivots-tfo` x2, `mgi-levels-suite`
x2, `moving-averages-as-support-resistance-mtf` x3, `multicator-table` x2, `parabolic-sar` x3, `s1-broker-core`,
`smart-money-breakouts-chartprime`, four `w9-*` strategy captures, `zigzag-multi-time-frame-…` x3), graded on
this tree on both lanes and each row compared with master's committed snapshot row, twice: before the
engine-61 merge (against engine 60's snapshots) and again on the merged tree `a18ce2640c` (against engine 61's).
Both times **51 of 52 rows are byte-equal; one moves**, `parabolic-sar-spy-1d-2026-11-15` runtime-on DIVERGE -> **MATCH** (labels 50 / 50, every
text, colours on 100 paired slots, objects v2 MATCH with x 50 graded / 50 agree). Production is INCONCLUSIVE on
all three parabolic-sar captures before and after (the door's `pine:timeout`, unchanged).

| capture | runtime-on before -> after | production before -> after |
|---|---|---|
| parabolic-sar-rddt-1d-2026-11-15 | MATCH -> MATCH (row unchanged; x 52 / 52) | INCONCLUSIVE -> INCONCLUSIVE (unchanged) |
| parabolic-sar-spy-1d-2026-11-15 | DIVERGE ("654.4" vs "654.41") -> MATCH ("654.41") | INCONCLUSIVE -> INCONCLUSIVE (unchanged) |

### The kill is lifted

The entry's `liftWhen` ("… then a runtime-on re-grade to MATCH on RDDT and SPY") is met, so
`api/data/pine_runtime_killlist.json` is empty. Every capability the script uses is admitted, so from this change
parabolic-sar is admitted by capability; the REACH run (`docs/pine/evidence/2026-11-15-cond-ta/runs/report.json`)
is regenerated on the merged tree and gains exactly its captures. The verdict snapshots are master's (engine 61)
with the parabolic-sar-spy runtime-on row replaced in place by the merged tree's own re-grade (749 rows per lane). The by-name rails (RT1 refusal at every door, A8, the measurement
tool, the preview route) used parabolic-sar's real kill; with an empty list they kill the same REAL source through
a SYNTHETIC entry in a tmp kill list (`synthetic_kill` in `tests/test_pine_capability_admission.py`), so they
still prove "a killed script is refused by name at every door" without a real kill existing. A new rail holds the
lift to the two committed MATCH rows.

## Fix 2: `tf_merge` in `builtinWitnessMask` / `windowHoleMask`, LEFT AS IT IS

Engine 59's open note: neither mask lists `tf_merge` (Pine's look-ahead-off `request.security(…, "W", …)`)
among the reads whose child is analysed on its own bars, so the ROOT asks a window site inside a weekly request
about the chart's daily bars too. Measured on master over NYSE:RDDT 1D (666 bars, from the listing):

| shape | root `builtinWitnessMask` | root `windowHoleMask` | the weekly read alone (`tf_live` re-type) |
|---|---|---|---|
| weekly `ta.stoch(close, y, y, 5)` with the F5 flat run | **36 bars withheld (64..99)**, `stoch:flat-window` | null | draws all 36 |
| weekly `ta.stoch(close, high, low, 5)` | null | null | (nothing extra) |
| weekly `ta.highest(x, 10)`, `x` holed every 50 bars, off the listing | null | null | (nothing extra) |
| weekly `ta.highest(x, 10)`, `x` na on its first 40 bars, off the listing | null | 85 bars (9..93), `window-extreme:left-edge` | leaves all 85 `na` too: **0 over-withheld** |

So the missing `tf_merge` costs 36 daily bars in `builtinWitnessMask` on the flat-run shape and none measured in
`windowHoleMask` (whose root flags land where the weekly read is `na` anyway; that is why mutant F2b survives).
It only over-withholds; it never serves a wrong value. Serving those bars would draw a weekly window call
on daily bars that no committed capture plots: the one committed script with such a site (`smarter-snr`,
`request.security(…, tf, ta.sma(ta.stoch(…)))`) is refused at the door (`str.length`). So per the honesty rule
the bars stay withheld and the masks are unchanged. Rails pin the current state on one fixture in both languages
(`app/src/components/chart/engine/ast/tfMergeNestedMasks.test.js`, `tests/test_pine_tfmerge_nested_masks.py`,
`tests/fixtures/pine_tfmerge_nested_masks.json`, whose tree the JS rail holds to the Pine door's own output), so
listing `tf_merge` is a decision taken with a capture in hand. The probe that would witness them:
`tools/visual_conformance/probes/vw-htf-window-sites.pine` (NYSE:RDDT 1D and AMEX:SPY 1D), rows H01-H06.

## Rails and mutants

New rails: `app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.sarTickTie.test.js` (the capture
is what it says; every served tick's reciprocal is exact; runtime-on MATCH on both symbols and "654.41" printed;
the host lane prints "654.41" for `round_to_mintick(low[k])` on the tie bar, with a control that the quotient form
written out still prints "654.4"; off a tie nothing moves and 1.005 stays 1.00; the helper's tree and that both
lanes build it), `app/src/components/chart/engine/ast/tfMergeNestedMasks.test.js`,
`tests/test_pine_tfmerge_nested_masks.py`. Updated: `tests/test_pine_capability_admission.py` (RT1 evidence rule
with a control, RT1 refusal at every door on a synthetic subject with an admitted control, the parabolic-sar lift,
A8 on a synthetic kill), `tests/test_pine_capability_admission_tool_kill.py`, `tests/test_runtime_definitions.py`.

Mutants (copy aside, mutate, the focused rail, restore from the copy, `git hash-object` equal to the copy; for a
file this branch does not touch, equal to the HEAD blob). All on `fix/pine-sar-label-and-tfmerge-masks` at
`890b6d165c` plus this branch's uncommitted work:

| id | mutation | rail | result |
|---|---|---|---|
| F1a | `tickRound.js` count back to `x / tick` | sarTickTie | KILLED, 4 of 11 red |
| F1b | host lane writes its own quotient (`pine.js`) | sarTickTie | KILLED, 2 of 11 red |
| F1c | runtime lane writes its own quotient (`pineRuntimeFrontend.js`) | sarTickTie | KILLED, 3 of 11 red |
| F2a | JS `builtinWitnessMask` lists `tf_merge` as nested | tfMergeNestedMasks | KILLED, 2 of 4 red |
| F2b | JS `windowHoleMask` lists `tf_merge` as nested | tfMergeNestedMasks | SURVIVED (4 of 4 green): see the window-hole row above |
| F2c | Python `builtin_witness_mask` lists `tf_merge` | test_pine_tfmerge_nested_masks | KILLED, 1 of 2 red |
| K1 | the old parabolic-sar entry back in the committed kill list | kill rails (3 files) | KILLED, 4 red |
| K2 | `kill_list()` stops serving the committed list | kill rails (3 files) | KILLED, 3 red |
