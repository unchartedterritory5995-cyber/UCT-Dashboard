# Capture queue — 2026-10-05, W19-H2 (host-lane builtins and windows)

Branch `pine/w19-h2-host-builtins` (base `integrate/wave18-2026-10-04`, `d488943c20`). What W19-H2
served and refused is in the triage doc, section W19-H2. This file holds (1) the manual text the
lane rests on, quoted from TradingView's own reference data, and (2) the captures that would grade
what it attached and settle what it left refused. Procedure: `docs/pine/VENDOR-HARNESS.md`
(visibility gate, **Create new ▸ Indicator**, "Add to chart" binding gate, `__uctVH.capture`),
inputs at defaults. Depth with **Go to date**, never the `All` button. A compile or runtime error
is a reading: record the message and the row.

## Manual — v4 `rsi(x, y)` (the only authority beyond the captures for Q-W19H2-c)

Extracted 2026-10-05 with the recipe in `docs/pine/pine-reference-extraction.md` (its script,
verbatim, `--version 4`; the final assembly step failed exactly as RT16 recorded — `t.t is not a
function` — so the strings were read straight out of the downloaded bundles and tied to `rsi`
through the structural chunk's entry). Nothing is paraphrased:

| version | entry | text | bundles (string id) |
|---|---|---|---|
| v4 | `rsi` desc | "Relative strength index. It is calculated based on rma's of upward and downward change of x." | `en.26771.d93d4d04181ebca94978.js` (514581), used in `13447.941cb30cbc7f08facdb1.js` |
| v4 | `rsi` remark 1 | "If x is a series and y is integer then x is a source series and y is a length." | `en.26771…` (15702) |
| v4 | `rsi` remark 2 | "If x is a series and y is a series then x and y are considered to be 2 calculated MAs for upward and downward changes." | `en.26771…` (647261) |
| v4 | `rsi` args | `y`: allowed types `"integer, series"` | `13447…` |
| v4 | `mfi` example | `f_mfi(src, length) =>` / `float upper = sum(volume * (change(src) <= 0.0 ? 0.0 : src), length)` / `float lower = sum(volume * (change(src) >= 0.0 ? 0.0 : src), length)` / `if na(lower)` → `na` / `else` → `rsi(upper, lower)`, under the comment "// the same on pine" beside `plot(mfi(close, 5))` | `13447…` |

⭐ What it licenses, and what W19-H2 served: the `mfi` example states that `rsi(upper, lower)` over
exactly those two sums IS `mfi(src, length)`. This engine's `mfiPine` is Pine's `ta.mfi(hlc3, n)`
measured to the last bit (`artemis-oscillator-pro-rddt-1d-2026-09-28`, `vendorHarness` rail
`mfiPine.vendor.test.js`), so camarilla's `rsi(upper_s, lower_s)` with `src = hlc3` is translated to
`mfiPine(high, low, close, volume, 14)`. ⛔ What it does NOT license: any other two-series call —
the remark says "considered to be 2 calculated MAs", and nothing measured says what TradingView
answers where `y` (or `x`, or both) is 0 or `na`. Those stay refused (`pine:window`) until
Q-W19H2-c is read.

## Captures owed

None needs market hours.

| id | probe / chart | what it settles | scripts it would move |
|---|---|---|---|
| Q-W19H2-a | `corpus/committed/smart-money-interest-index-algoalpha__effdd7852c.pine` and `corpus/committed/smart-money-volume-index-algoalpha__6663950b80.pine` as written on **NYSE:RDDT 1D from the listing** (`startsAtBar0`) and **AMEX:SPY 1D with FULL history** (Go to date 1993-01-29, `startsAtBar0`) | grades the two scripts W19-H2 attaches (host lane): the level is served only from the listing, so both charts are listing charts; on a 1,800-bar SPY chart the door withholds every level plot by name (`cum:volume-index`) — capture that too if convenient, as the withheld control | both (ungraded until captured) |
| Q-W19H2-b | `corpus/committed/camarilla__jw9faob08r.pine` as written on **NYSE:RDDT 1D from the listing** and **AMEX:SPY 1D** (1,800 bars is enough: its walls are not listing-dependent) | grades the camarilla attach (host lane; its `mfi = rsi(upper_s, lower_s)` translated through the v4 manual's `mfi` identity) | camarilla (ungraded until captured) |
| Q-W19H2-c | new probe `tools/visual_conformance/probes/vw-w19h2-rsi-two-series.pine` (v4) on **NYSE:RDDT 1D from the listing** and **AMEX:SPY 1D** | R03 = 0 confirms the served identity on the vendor itself; R06 says whether two-series `rsi` is `100 - 100 / (1 + x / y)` on Wilder's pair; R07–R10 what it answers where `y` / `x` / both are 0 or `na` — the rows a general two-series serve needs | every other two-series `rsi` (none in the corpus today besides camarilla) |
| Q-W19H2-d | new probe `tools/visual_conformance/probes/vw-w19h2-series-length.pine` (v5) on **NYSE:RDDT 1D from the listing** and **AMEX:SPY 1D** | `ta.highest` / `ta.lowest` with a length computed per bar (L01–L04), a length past the bars that exist (L05), and trend-levels' own counter shape (L06). RT12's probe asked the same in its L01 / L02 and never got an answer: its L04 (`na` length) stopped the study on bar 0 (CAP5 S1-7 / S2-5) — this probe has no zero or `na` length | trend-levels-chartprime (`h1 := ta.highest(bars)`, host lane), smarter-snr `ta.highest(high[Period], bar_pl1)` (with lane T), and R1's `runtime:history-dynamic-offset` family |
| Q-W19H2-e | new probe `tools/visual_conformance/probes/vw-w19h2-zero-length.pine` (v5) on **NYSE:RDDT 1D from the listing** — EXPECTED TO ERROR | whether `ta.highest(<var int = 0>)` stops the study on bar 0 as CAP5's `na` length did — trend-levels writes `var int bars = 0` and calls `ta.highest(bars)` before its first trend flip, so this decides whether TradingView draws that script at all before the flip | trend-levels-chartprime |
| Q-W19H2-f | `corpus/committed/trend-levels-chartprime__90a5bf4ab1.pine` as written on **NYSE:RDDT 1D from the listing** and **AMEX:SPY 1D** | the script itself, to grade once Q-W19H2-d / -e settle the window (a runtime error is a reading) | trend-levels-chartprime |
| Q-W19H2-g | `corpus/committed/atr-stop-loss-indicator__LOfv1FvRhL.pine` as written on **NYSE:RDDT 1D**, **AMEX:SPY 1D** and **NASDAQ:AAPL 1D** | grades atr-stop-loss once `syminfo.type` is ruled: ZenLibrary/9's `toWhole` / `toPips` read only `syminfo.type == "forex" / "crypto" / "cfd"` (plus `syminfo.mintick` and `syminfo.pointvalue`, both served per exchange). ⛔ NOT a capture question alone — see the owner decision in the triage section | atr-stop-loss-indicator |

## Not queued (already on disk)

- `ta.nvi` / `ta.pvi` levels: `tests/fixtures/vendor/vw-nvi-pvi-spy-1d-full-2026-09-27.json` (8472 bars
  from SPY's first bar) is what W19-H2 is graded on (`vendorHarness.w19h2VolumeIndex`). ⚠️ Its sibling
  `vw-nvi-pvi-spy-1d-truncated-2026-09-27.json` carries `history.startsAtBar0: true` with RDDT's `why`
  sentence while its own P00 control reads 7432 on its first bar: the flag is wrong. The harness
  already lets the control outrank the flag (F9, `barIndexControlContradicts`), so it grades as an
  off-listing chart (every level withheld, `cum:volume-index`). The fixture is left byte-identical
  (its receipt seals it); a re-capture would only need the flag corrected.
