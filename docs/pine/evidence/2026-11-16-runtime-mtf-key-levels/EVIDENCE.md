# Evidence: 2026-11-16, the per-bar lane's mtf-key-levels defects (Q-ROB5, Q-ROB6, Q-ROB7)

Branch `fix/pine-runtime-mtf-key-levels`, on top of #1448 (engine 63, door robustness). Engine number
NOT bumped: two `NUMBER PENDING` lines in `scriptEngineVersion.js`.

The member door (since #1448) offers `mtf-key-levels-support-and-resistance` to the per-bar lane after
its host install is refused by the series-reference budget. The runtime-on harness therefore grades the
two committed captures `mtf-key-levels-support-and-resistance-{rddt,spy}-1d-2026-11-14` for the first
time, and three items diverged. This unit finds each cause. The script is still NOT admitted for the
pane (`capability_admitted`: missing `obj:table`, `request-other`), so no member sees this drawing
either way; the fixes are general and reach every script with the same shapes.

## Q-ROB5: D-VWAP 0.01 low on 6 bars. FIXED

Cause: on a daily chart every bar is its own session, and `interpret.js::dailySessionVwap` returned
the bar's price (`hlc3` for the bare form). TradingView computes the session's own arithmetic,
`(price * volume) / volume`, which differs from the price in the last binary digit on some bars. The
script rounds UP to the tick (`math.ceil(vwap * 100) / 100`), so a value one unit in the last place
below a whole cent becomes the cent below: 57.29 where TradingView reads 57.3.

Witnesses (both committed):
- `h3-vwap-source-spy-1d-2026-10-02` (AMEX:SPY 1D): the quotient equals TradingView bit for bit on
  1800 of 1800 bars for each of S01..S07 (the bare form and each source); the bare price matches on
  1626-1674 of them.
- `mtf-key-levels-support-and-resistance-{rddt,spy}-1d-2026-11-14`: the script's D-VWAP, recomputed
  from our column with the script's own `ceil`, equals TradingView's on every bar of both captures
  (with the price it misses 5 on RDDT, the harness's 5 value mismatches; the 6th diverging bar there
  was the colour).

Rail: `__tests__/vendorHarness/vwapDailyQuotient.test.js` (both witnesses plus a control proving the
bare price is distinguishable). Mutant M10 (return the price) turns its three witness tests red.

The Python twin already computes `cum_pv / cum_vol` over a one-bar session (the same quotient), and
its daily store key is refused there anyway (`computeVWAP`'s rule), so the two lanes do not split.

## Q-ROB6: labels, TradingView 27, the per-bar lane 3. CAUSE FIXED, 25 of 27

Cause: the drawing lane's string-var reader (`pine.js::stringVarTextOf`, #1448) recognised only a
declared `var string X = ...`. Pine infers the type of an UNTYPED `var X = "<literal>"` from its
literal, and mtf-key-levels builds every label text from such vars (`var DNoSpaces = " "`,
`DailySpaces = DNoSpaces`, `DailySpaces := exnone ? DNoSpaces : DSpaces`,
`text = DailySpaces + "pdOpen"`). `markStringVarSeed` now also marks an untyped var whose seed is a
string literal (and only that: an untyped seed that is not a literal stays unmarked).

Witness: the same two captures. With the fix the per-bar lane draws 25 of TradingView's 27 labels,
with TradingView's texts.

Still refused by name (the remaining 2):
- the yearly-open label: its price is `security(syminfo.tickerid, "12M", open, lookahead = ...)`,
  refused `pine:request` (a 12M request is not served).
- the W-VWAP label: its condition `if wvw` reads a v4 self-referencing weekly sum
  (`wsumSrc := wstart ? wsumSrc : wsumSrc + wsumSrc[1]` over `time("W")`) that the host object pass
  cannot compute; it is withheld as `objects:not-computable` (666 of 666 bars withheld in a probe),
  never drawn wrong.

Rails: `__tests__/doorRobustness.test.js`, two Q-ROB6 tests (an untyped var written on every bar; the
mtf-key-levels shape). Mutant M11 (drop the untyped-literal branch) turns both red. The first form
of the untyped rail had no write, folded to its literal without the reader, and SURVIVED M11; it was
rewritten to write on every bar, and M11 was re-run red.

## Q-ROB7: lines 23 vs 22, and a line's y1. CAUSE NAMED, no fix in this unit

- the missing line is the yearly open's: the same `"12M"` request refusal as above.
- the y1 mismatch is a pairing shift, not a wrong price: with one line missing, the grader pairs the
  remaining lines by creation order, so every line after the gap is compared with its neighbour.

## Verdict moves expected on the runtime-on lane

- `mtf-key-levels-support-and-resistance-{rddt,spy}-1d-2026-11-14` D-VWAP: DIVERGE -> MATCH.
- the same captures' objects: labels 3 -> 25 of 27; the object verdict stays DIVERGE (yearly-open
  label and line, W-VWAP label). The capture verdict stays DIVERGE.
- no MATCH -> DIVERGE expected anywhere; pine-heavy's harness legs are the measure.

## Coverage

The untyped-var fix is a general translator change. Sample scripts with an untyped `var X = "..."`:
12, all committed (so pine-heavy's coverage ratchet measures every one). None of their recorded walls
(engine 60 census, both lanes) is a string-var text refusal; expected new transfers: 0.

## Side finding, not fixed here

TradingView's `hlcc4` is `(h + l + 2 * c) / 4` bit for bit (1800 of 1800 on h3 S08); ours sums
`h + l + c + c` (`pine.js` maps `hlcc4` to `['high','low','close','close']`), which can differ in the
last binary digit.
