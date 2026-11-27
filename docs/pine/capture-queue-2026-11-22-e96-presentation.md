# Capture queue: e96, the presentation gaps (2026-11-22)

Same procedure as `docs/pine/capture-queue-2026-09-28.md`: capture from the listing, keep the plotted values as full
float64 text, record each capture's own `capturedAtUTC`, and record `study.bands` / `bandDefaults` / `bandState`
(`tools/vendor_harness/tv_capture.js` has recorded them since 2026-11-19). Our probes are licence `probe`. A
licence-held script is named here by its rank only: its position by boosts (`agreeCount`, highest first) in
`docs/pine/census-full/population.json`, whose committed rows carry identifiers only.

Schedule: after the e94 re-trace chain, in one rig session with U-DAILY's Q-DAILY-1 (coordinator, 2026-11-22).

## Why

- e96 draws a Pine `hline` as the level it is, on both doors (`app/src/components/chart/engine/hlineLevels.js`), and
  grades it as a band (`tools/vendor_harness/compare.mjs::compareBands`). The evidence rule needs two MATCH captures
  from two scripts, one of them a community script. `vw-hline-written-rddt-1d-2026-11-20` (ours) is the first; Q-HLINE-1
  is the second.
- A style field whose TradingView default is not captured is drawn in the chart's neutral ink and named (coordinator
  ruling R2). Witnessed today: the v6 defaults (`vw-hline-written` H5) and, for v1-v3, a written colour kept opaque with
  a dashed, width-1 line (`transparency-defaults-by-version-rddt-1d-2026-11-14`). Q-HLINE-3 witnesses the rest. Each
  answer is one field of `HLINE_DEFAULTS`, with no code change.
- `plotarrow` stays withheld by name until its arrow geometry is witnessed (coordinator ruling Q4): Q-ARROW-1.
- The one candle rule (coordinator ruling R1) withholds a candle whose colour rules have no capture. Q-CANDLE-1 files
  the witness for each such clause (below); the default-wick/border one is W4-P1, already queued.

| id | probe or script | chart | question | live | phase |
|---|---|---|---|---|---|
| Q-HLINE-1 | the community script ranked 612 in the population (v6, five styled `hline`s, a `fill` between two of them; the host lane serves it) | NYSE:RDDT 1D, AMEX:SPY 1D | every band's level, colour, line style and width; the fill between the two hlines (`filledAreas` / `filledAreaState`) | no |  |
| Q-HLINE-2 | `vw-hline-autoscale.pine` | NYSE:RDDT 1D | does TradingView's autoscale include an hline outside the plots' range (H1 at 1000, H2 at -500 over an RSI)? Record the pane's price-scale range and a screenshot. If yes, the guides get an autoscale provider. | no |  |
| Q-HLINE-3 | `vw-hline-defaults-v3.pine`, `vw-hline-defaults-v4.pine`, `vw-hline-defaults-v5.pine` | NYSE:RDDT 1D | D0-D4 of each: TradingView's default colour, line style and width for an `hline`, one field left unwritten per row, and whether a palette colour is kept opaque | no |  |
| Q-ARROW-1 | `vw-plotarrow-length.pine` | NYSE:RDDT 1D | each arrow's pixel length and its tip and tail prices for a known staircase (+1, +2, +4, +8, -1 ... -8), at about 40 and about 200 bars shown: the length rule between `minheight` and `maxheight`, and where an arrow sits | no |  |
| Q-CANDLE-1 | a v1, a v3 and a v4 `plotcandle` and `plotbar` with `color`, `wickcolor` and `bordercolor` written (to be written beside these probes) | NYSE:RDDT 1D | the colour rules of a v1-v4 candle (a transparency default, as v1-v3 plots take 35?), so a legacy candle can be drawn, not withheld | no |  |

**What each answer moves.**
- Q-HLINE-1 MATCH, beside `vw-hline-written`, is the band evidence for the `hline` draw (two scripts, one community).
  A DIVERGE applies the REACH kill rule by source hash.
- Q-HLINE-2 decides whether a guide needs an autoscale provider. A line drawn off-screen is not a wrong value, so it
  does not hold the draw back (coordinator ruling Q1).
- Q-HLINE-3 fills `HLINE_DEFAULTS[3|4|5]`. Until then a v4/v5 hline that leaves a field to TradingView, and a v1-v3 one
  that names no colour, is drawn at its exact level in the neutral ink, and that is said by name.
- Q-ARROW-1 is what a `plotarrow` renderer would be built on. Until then it is not drawn, on either lane, by name.
- Q-CANDLE-1 and W4-P1 (`docs/pine/capture-queue-2026-11-04-w4-t13.md`) turn the candles the rule withholds today into
  candles drawn: by the e87 census, 6 member-served scripts on the host lane fail only the legacy-version clause (v1 or
  v4) and 6 fail only an unwritten `wickcolor` / `bordercolor`.
