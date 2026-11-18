# Markers in a pane's scale, and lines across `na` (backlog rows 41 and 42)

Seen on production 2026-11-17 by the Studio session (house indicators on AGL daily):

- **41.** A relative strength line of about 0.15 sat flat at the bottom of a pane scaled 0 to 1:
  the definition's third output, a yes/no "new high" flag drawn as a circle at `inBar`, took
  part in the pane's autoscale with its 0/1 values.
- **42.** `gapLow = valuewhen(gap, low, 20)`, a dashed step line, ran one old level across the
  whole chart: the bars where it has no value were joined.

## What the reference states

Pine User Manual, `plot()` parameter `style`:

- `plot.style_line`: "It does not plot any na values, but does draw a line through them by
  joining the most recent non-na value to the next non-na value."
- `plot.style_linebr`: "Allows the plotting of discontinuous lines by not plotting on na values,
  and not joining such gaps."
- `plot.style_stepline`: "Can also be used to achieve an effect similar to that of
  plot.style_linebr, but only if care is taken to plot no color on na values." (so it bridges)
- `plot.style_areabr`: "This is similar to plot.style_area but it doesn't bridge over na values."

Pine reference, `location.*` (quoted in `docs/pine/pine-presentation-spec.md` 4.1.8):

- `location.absolute`: "Shape is plotted on chart using indicator value as a price coordinate."
- `location.top`: "Shape is plotted near the top chart border."
- `plotshape` `series`: "treated as a series of boolean values for all location values except
  location.absolute".

User Manual, Text and shapes, `plotchar()`: "We use location.top because the default
location.abovebar will put the price into play in the script's scale, which will often interfere
with other plots." So an above / below shape brings the PRICE into the scale, never its own
0/1 value; only `location.absolute` reads the value as a y.

## What each Pine plot style does now

| Pine style | maps to | na before this unit | na now | TradingView |
|---|---|---|---|---|
| `plot.style_line` | line | bridges | bridges | bridges |
| `plot.style_linebr` | line + `sparse` | **bridged** | breaks | breaks |
| `plot.style_stepline` | stepline | bridges | bridges | bridges |
| `plot.style_area` | area | bridges | bridges | bridges |
| `plot.style_areabr` | area + `sparse` | **bridged** | breaks | breaks |
| `plot.style_steplinebr` | not carried (disclosed, drawn as a line) | bridges | unchanged | not stated beyond its name (spec U8) |
| `plot.style_circles` | markers (dots) | discrete | discrete | discrete |
| `plot.style_histogram` / `columns` | histogram | per bar | per bar | per bar |

`sparse: true` is the document's existing "blank by design" field: the binder draws one render
series per valued run (`gapRuns.js`), because lightweight-charts 5.2 joins whitespace points.

## Markers and the scale (renderer only)

`pool.markerIsEvent`: a glyph at `aboveBar` / `belowBar` (Pine abovebar, belowbar, top, bottom)
has no y of its own, and neither has a glyph at `inBar` on an AUTHORED (house / member) yes/no
output (its 1 is "true"). Coordinator ruling on #1550: a Pine import is never "authored" here
(`binder.isConditionOutput` answers false for every `isPineImport` document), because at
`location.absolute` TradingView reads the value as the y; a Pine bool at absolute keeps value-as-y
on both lanes until queue row Q-MK1 (`vw-mk1-bool-absolute.pine`) shows TradingView's own picture.
Such a glyph rides a host on its scale (`binder.eventGlyphHosts`: the price series on pane 0, as
an above / below glyph already did; the first visible line of the same instance on the same pane
and scale elsewhere) and its own 0/1 series leaves the autoscale walk. An `inBar` glyph on a
number (Pine `location.absolute` with a value) keeps its value as y and its place in the walk. A
pane of markers only keeps today's walk (nothing else frames it).

Not TradingView's picture, stated: in a separate pane TradingView puts the bar's PRICE into the
scale for an above / below shape (the manual sentence above); this renderer puts nothing in and
draws the glyph above / below the pane's own line. The 0/1 value it put in before was not
TradingView's either. Queued as an engine gap for Pine imports (documented deviation, not fixed
now): `docs/pine/capture-queue-2026-11-17-markers-na-breaks.md`, "abovebar / belowbar in a separate
pane". `plot.style_steplinebr` stays not carried and disclosed (same doc, a ruling).

## Authored definitions

`set_style.breaks` (patch schema) writes `plots[].sparse`; the readback says "breaks where it has
no value". The default for a new output stays joined (no field): an interior `na` can come from
data (another symbol's missing bar under `sym()`), where a break reads as a broken chart, and every
saved document keeps drawing as it does today.

## Rails

`app/src/components/chart/engine/__tests__/markerScaleAndNaBreaks.test.js` (real
lightweight-charts chart through the binder for row 41; the style table, the member door and the
binder split for row 42; the authoring op). Mutants: `ci/mutants/chart-markers-na-breaks.json`.
