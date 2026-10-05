# Capture queue — 2026-10-05 W19-R2, runtime collections, records and drawings

Branch `pine/w19-r2-collections-drawings` (from `integrate/wave18-2026-10-04` `d488943c20`). For the capture lane to
run on the live TradingView rig with `tools/vendor_harness/tv_capture.js` (procedure as
`docs/pine/capture-queue-2026-09-28.md`). ⚠️ The probes are not compiled on TradingView yet: if a row does not
compile, the error names the line — split it out. A runtime error is itself a reading: record its text and bar.

The rules are in `docs/pine/vendor-harness/objects-triage-2026-09-28.md` § W19-R2.

## Manual — the text `array.fill` / `array.insert` rest on (W19-R2's only authority beyond the captures)

TradingView Pine Script user manual, *Arrays* page (`https://www.tradingview.com/pine-script-docs/language/arrays/`),
read 2026-10-04 (the page as served; the v6 reference pages are script-rendered and could not be read):

- "The `array.fill()` function points all array elements, or the elements within the `index_from` to `index_to`
  range, to a specified `value`." Its example `a.fill(close, 1, 3)` fills indices 1 and 2: "the `array.fill()`
  function's last parameter, `index_to`, must have a value one greater than the last index the function will fill."
- "`array.insert()` inserts a new element at the specified `index` and increases the index of existing elements at
  or after the `index` by one."
- "The `array.get()`, `array.set()`, `array.insert()`, and `array.remove()` functions support *negative indexing*,
  which references elements starting from the end of the array." "An index of `-1` refers to the last element in
  the array, an index of `-2` refers to the second to last element, and so on."

What is served from it (`runtime/collections.js` `W19R2_MEMBERS`): `fill(a, v)`, `fill(a, v, from)`,
`fill(a, v, from, to)` with `0 <= from <= to <= size` (`to` exclusive, `na` = the end); `insert(a, i, v)` with
`0 <= i < size`. Everything else stops the run by name (`Q-W19R2a`). The page holds no binary-search text, so the
three binary searches stay refused (`Q-W19R2b`).

## Q-W19R2a — `array.insert` / `array.fill` at the indices the manual does not settle

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| Q-W19R2a | `tools/visual_conformance/probes/vw-w19r2-collections.pine` rows I01-I03, F01-F02 | NYSE:RDDT 1D from the listing | `insert` at `size` (an append, or the out-of-range stop?), `insert` at 0 into an EMPTY array, v6 `insert(a, -1, x)` (before the last element, or after it?), a `fill` range past the end, a negative `fill` start | each stops the run by name (`array.insert: index … — … Q-W19R2a`). Reached by: `auto-trendlines-tradingfinder-…` (`insert(…, 0, …)` into arrays that start empty), `bollinger-band-width-percentile` (inserts at the upper bound, which can equal `size`) |

## Q-W19R2b — the three binary searches

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| Q-W19R2b | same probe, rows B01-B05, L01-L05, R01-R05, E01-E03 | NYSE:RDDT 1D | over `(1, 3, 3, 3, 7)`: a value present three times (3), below all (0), between (5), above all (9), the last (7); and an EMPTY array | refused at build, `runtime:array` (`array.binary_search_rightmost`). `bollinger-band-width-percentile`'s next R2 wall after it is served: its comment reads the result as "the total count of values <= current" (an upper bound), while the same call also removes a value it found — the two readings disagree exactly on a found value, so only a capture can say which |

## Q-W19R2c — the gradient `fill` beyond what CAP5 showed

CAP5 (`vw-rt15-gradient-fill-rddt-1d-2026-10-04`, Q-RT15d) settled the values (the fill's data plots, argument
order), the per-bar top colour (the fill's colorer) and the shading (linear in price, top colour at `top_value`,
bottom colour at `bottom_value`, clipped to the two plots); W19-R2 serves that on the runtime lane and grades it
(`vendorHarness.w19r2GradientFill.test.js`).

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| Q-W19R2c | `tools/visual_conformance/probes/vw-w19r2-gradient-edges.pine` rows X01-X04 + screenshots at 200 px/bar | NYSE:RDDT 1D | X01 which bar's colours shade the step between two bars at a colour flip; X02 values outside the two plots (clip, and the colour AT a plot); X03 `top_value == bottom_value`; X04 what is recorded for a per-bar BOTTOM colour | the step from bar i-1 to bar i is shaded with bar i's values and colours; outside the values a canvas gradient pads with its end colours; equal values shade nothing (`fillPrimitive.js::gradientSteps`). Stated as the unmeasured part, not claimed |

## Scripts whose walls moved (ungraded; the GT allowlist needs a MATCH)

No script newly attaches on this branch alone (census below). Each of these needs its own capture once its other
lane lands:

| script | R2 wall served here | what still stands |
|---|---|---|
| `range-filter-dw` | `array.fill` (whole array) | lane T: v4 text `input(options)` (`f_type`, `mov_src`, `rng_scale`) — with those folded it ATTACHES (scratch substitution probe) |
| `smoothed-gaussian-trend-filter-algoalpha` | gradient `fill` (runtime lane) | `lower-tf:store-unmeasured` (`request.security` at `'5'` for its table) — owner decision (R-LTF) |
| `bollinger-band-width-percentile` | `array.insert` | `array.binary_search_rightmost` (Q-W19R2b); lane T (`input.string(txt5point, …)` default through a `var string`); `ta.hma` over runtime state (`runtime:call-windowed-state`, R1) |
| `smart-money-concept-tradingfinder-…` | `array.insert` (literal indices) | `runtime:history-expression` (RT12's note) |
