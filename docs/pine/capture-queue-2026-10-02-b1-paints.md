# Capture queue - 2026-10-02 B1, `bgcolor` / `barcolor`

Branch `pine/b1-bgcolor-barcolor`. Two probes under `tools/visual_conformance/probes/`, for the parent
session to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js` - same procedure as
`docs/pine/capture-queue-2026-09-28.md`. Inputs at defaults on both. The mechanism and the refusals these
rows settle are in `docs/pine/vendor-harness/objects-triage-2026-09-28.md` § B1.

## What is already witnessed, and served

Eight committed captures record their paints as `bg_colorer` / `bar_colorer` plots with the bar's colour per
row; the member door's paints agree with them on every graded bar
(`app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.b1Paints.test.js`):
atr-support-and-resistance, atr-trailing-stoploss, btc-charlie, elliott-wave-3-finder, ema-ribbon,
fibonacci-pivot-points, artemis, mcclellan (static, two-colour, chain, `na`-gated, palette-less colours,
`transp =` on v4 and v5, `display = display.none`).

## The probes

| probe | capture id | symbol | rows | what the door does today | what the capture changes |
|---|---|---|---|---|---|
| `vw-bgcolor-barcolor.pine` | `vw-bgcolor-barcolor-spy-1d-<date>` | AMEX:SPY 1D | O1-O4, S1, D1, P1/P2 | `offset` (non-zero or `na`), `show_last`, a `display` other than `all` / `none`: the paint is withheld by name (`paint:offset`, `paint:show-last`, `paint:display`). Two visible `barcolor`s that colour one bar differently: that bar keeps its own colour (counted as `conflicts`). | O1-O4 + a screenshot: the shift direction of a paint `offset` and what `offset = na` means (serve them through the plot `offset` machinery if it matches). S1: the last-N rule. D1: whether a data-window paint draws. P1/P2 + a screenshot: which of two disagreeing `barcolor`s TradingView paints (the later call, or the earlier). |
| `vw-bgcolor-v4-default.pine` | `vw-bgcolor-v4-default-spy-1d-<date>` | AMEX:SPY 1D | T1-T3 | A v3/v4 `bgcolor` with no `transp` is withheld (`paint:v4-default-transp`). | `styleState.transparency` of T1 / T3 is the default; serve it as the paint's opacity (unblocks volume-profile-v054beta's background). |

## What is not a capture question

- **Where a paint is drawn** (the script's pane for `bgcolor`, the chart's own bars for `barcolor`) is Pine's
  documented placement and is built by construction; a capture records study data, never pixels. The
  screenshots asked for above are the first visual reading of it.
- **A colour this door cannot carry** (heat-map-seasons' choice between two `color.from_gradient`s,
  ict-killzone-index's `color.new(input.color, input.int)` under a `time()` session test) is a translator
  gap, not a capture question.
