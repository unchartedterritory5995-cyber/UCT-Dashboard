# Capture queue: markers in a pane's scale, and lines across `na` (2026-11-17, #1550)

Backlog rows 41 and 42; evidence `docs/pine/evidence/2026-11-17-markers-na-breaks/EVIDENCE.md`.
Capture from the listing (NYSE:RDDT 1D and AMEX:SPY 1D), with a screenshot of the pane: the
questions below are about where a shape is DRAWN and how the pane is scaled, which the plotted
values alone do not show.

Coordinator ruling on #1550: for a Pine import TradingView's semantics win. A Pine `plotshape` /
`plotchar` at `location.absolute` keeps its value as the y on both lanes (a yes/no included), as
before #1550; the "an inBar glyph on a yes/no output rides the host" rule applies to authored
(house / member) definitions only. This row is the reading that settles the Pine side.

| row | probe | what it settles |
|---|---|---|
| Q-MK1 | `vw-mk1-bool-absolute.pine` | what TradingView draws for a BOOL series at `location.absolute` (a shape at y = 1 on true bars and a pane scaled to include it, a shape at 0 on false bars, or nothing), against a number at absolute (M02) and a bool at `location.top` (M03) as controls |
| abovebar / belowbar in a separate pane | no probe: engine gap, a documented deviation (see below) | on TradingView an above / below shape in a separate pane brings the bar's PRICE into the pane's scale; this renderer does not |
| plot.style_steplinebr | no probe: kept not carried and disclosed (see below) | its na handling (break or bridge) |

## Not capture questions (queue dispositions)

Read by `tools/vendor_harness/evidence_engine.py queue`: each row named here leaves `rowsNeedingProbe` and is listed, with this reason, in `rowsNotCaptureQuestions` (dispositions: `DISPOSITIONS` in the engine).

| not a capture | disposition | reason |
|---|---|---|
| abovebar / belowbar in a separate pane | engine-gap | the User Manual states it ("the default location.abovebar will put the price into play in the script's scale, which will often interfere with other plots"): on TradingView an above / below shape in a separate pane brings the bar's PRICE into that pane's scale. This renderer brings nothing in (since #1550 the glyph rides the pane's own line and its 0/1 series leaves the autoscale walk; before, the 0/1 itself entered the scale, which was not TradingView's either). A documented deviation for Pine imports, not fixed now: what closes it is a build that puts the bar's high / low into the pane's autoscale for such a glyph, not a TradingView reading |
| plot.style_steplinebr | ruling | kept NOT carried and disclosed (`styleUncarried`, the import says "its style `plot.style_steplinebr` is not carried"; drawn as a joined line): the reference gives its name ("Step line with Breaks") and nothing of its na handling, and a plotted-value capture cannot show a join, so serving it as breaking would be a reading we do not have (presentation spec U8) |
