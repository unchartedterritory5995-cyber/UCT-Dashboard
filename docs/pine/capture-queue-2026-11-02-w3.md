# Capture queue — 2026-11-02 W3 drawing objects, slice S1 (cell text, the reader's own gaps)

Branch `feat/pine-w3-drawings`. The W3 census (`docs/pine/census/w3-object-why-2026-11-02.json`,
195 drawing-walled sample scripts) counted 22 table cells dropped as `cell:text` with **no refusal
recorded** — the text reader gave up without saying on what. S1 read each cell's source line and
sorted them into the SHAPES below. Every shape is now refused **by name** (`cellTextWhy` carries
`pine:text-value` or `loop:per-pass` plus the spelled shape), and ONE shape is drawn: the
`{N,number,percent}` element of `str.format`, by TradingView's published rule
(`app/src/components/chart/engine/pineTextFormat.js::percentMessageNumber`, cited there). The rest
stay refused until the capture named in its row pins the characters. Same capture procedure as
`docs/pine/capture-queue-2026-09-28.md` (visibility gate, **Create new ▸ Indicator**, "Add to chart"
binding gate, `__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`). No probe file exists
yet for any row; each row holds the exact probe script.

The sample scripts are licence-held (read in the sample cache, never committed); the rows name
each cell by script key and line ONLY, and the shape column describes the general shape in this
branch's words, with no fragment of any script's code or text. The probe scripts below, and every
code span and literal in this doc, are this branch's own text (round 2 replaced every probe literal
that matched a sample script).

⛔ **ENGINE VERSION — the merge needs a bump.** This branch changes translator output (a
`{N,number,percent}` message cell now draws, and every S1 refusal carries a name) and does NOT bump
`SCRIPT_ENGINE_VERSION` (still 5, as on master at 52f76f9b4f). The coordinator must bump
`SCRIPT_ENGINE_VERSION` when this branch merges: by the coordinator's merge order (T4 takes 6,
T3 takes 7) W3 takes **8**. (The round-2 commit message 89ea8f6a16 said 6; the order changed
after it.)

## The 22 cells, by shape

| shape | cells (script key, line) | today |
|---|---|---|
| S1-A `str.format` with a `{N,date,…}` element | black-scholes-option-pricing-model-w-greeks-loxx 475, 476 | refused by name (`pine:text-value … {N,date,…}`), row Q-W3-1 (`vw-w3-format-date.pine` on AMEX:SPY 1D) |
| S1-B `str.format` with a bare `{N,number}` element (no pattern) | ict-killzones-pivots-tfo 998, 1014 | refused by name (`… {N,number} element with no pattern`), row Q-W3-2 (`vw-w3-format-number-bare.pine` on AMEX:SPY 1D) |
| S1-C `str.format` with `{N,number,percent}` | ict-killzones-pivots-tfo 989 | **refused by name** (`format:number-pattern:percent`; values `percent:uncaptured`), r3: the published rule names no sign, so NOTHING draws, positive or negative, until capture Q-W3-3 MATCHES (`pineTextFormat.js::PERCENT_CAPTURED`; the formatting code is kept behind it). Gate: Q-W3-3 (`vw-w3-format-percent.pine` on AMEX:SPY 1D) |
| S1-D a per-pass **element of a string list** picked by the counter: `array.get(list, i)` | mtf-dashboard-pro 487, 635; cobra039s-crypto-market-visualizer 400 | refused by name (`loop:per-pass … an element picked out of a list by the counter`), row Q-W3-4 (`vw-w3-loop-list-text.pine` on AMEX:SPY 1D) |
| S1-E a per-pass **helper call** returning text (a `?:` over its parameters, a fixed-decimals `str.tostring`, `+`) | mtf-dashboard-pro 525, 542, 557, 572, 589, 607, 653, 668 | refused by name (`loop:per-pass … a helper called over a per-pass value`), row Q-W3-5 (`vw-w3-loop-helper-text.pine` on AMEX:SPY 1D). ⚠️ every one of these also reads a `request.security` tuple part (`pine:request`), so the row settles the SHAPE, not these cells |
| S1-F a per-pass **`?:` text**: a test on a per-pass number or string, arms of literals / `str.tostring` | mtf-dashboard-pro 504; volume-footprint 989, 1034, 1037; cobra039s-crypto-market-visualizer 458 | refused by name (`loop:per-pass … a \`?:\` whose test or arm moves per pass`), rows Q-W3-6 / Q-W3-7 (`vw-w3-loop-ternary-text.pine`, `vw-w3-str-repeat-length.pine`, both on AMEX:SPY 1D) |
| S1-G a `{N,time,…}` element over `timenow`, reaching `table.cell` through a helper's **string parameter** | dynamic-support-and-resistance-with-trend-lines 1959 (the text reaches it from line 2128) | refused by name (`… {N,time,…} element`), row Q-W3-1 (`vw-w3-format-date.pine` on AMEX:SPY 1D). The parameter shape itself READS: a probe helper `f_cell(table _t, int _r, string _s) => table.cell(_t, 0, _r, _s)` called with a literal and with `"A " + str.tostring(close, "#.##")` carries both cells (measured 2026-11-02, before S1; a control rail in `textRefusalNames.test.js`) |

What the loop rows share: on the host lane a value that moves per pass is read only as the
counter's arithmetic, a literal, `+`, or `str.tostring` of such a number (`pine.js::loopTextOf`,
C32). Each row below is a capture that would pin the characters TradingView draws for one more
per-pass shape; the engine work (a per-pass `{t:'if'}` test, a per-pass helper frame, a string list
read by the counter) is the `guard:loop` slice's, not S1's, and nothing is drawn before the
capture lands.

## Owed

| id | probe (owed) | chart | what it settles | where the rule lives |
|---|---|---|---|---|
| Q-W3-1 | `vw-w3-format-date.pine` (below) | AMEX:SPY 1D | the `date` / `time` element: the pattern tokens TradingView renders (`MMMM`, `dd`, `yyyy`, `HH:mm:ss`, `Z`), UTC+0 per the docs, over a FIXED timestamp (never `timenow`, which no capture can match) | `pineTextFormat.js::compileMessagePattern` (`format:element:date`) |
| Q-W3-2 | `vw-w3-format-number-bare.pine` (below) | AMEX:SPY 1D | whether `{0,number}` prints exactly as `{0}` (the published default `#,###.###`): equal LENGTHS on 300 bars, as F12 pinned `#.##`; plus the first value at or above 1000 (grouping comma or not — also unpinned for `{0}`; since S1 a value that only ROUNDS to 1000, 999.9996, is withheld under `{0}` as well) | `compileMessagePattern` (`format:element:number`), `MESSAGE_NUMBER_LIMIT` |
| Q-W3-3 | `vw-w3-format-percent.pine` (below) | AMEX:SPY 1D | ⛔ **THE GATE for serving `percent` at all (r3).** Must show the NEGATIVES -0.126, -0.004 and -0.575 (sign character hyphen-minus vs U+2212, placement, "-0%") and the positives 0.5, 0.125, 0.135, 12.345, 0.575, 0.145 and `close / open - 1`; a MATCH lets `PERCENT_CAPTURED` flip. The corners `percentMessageNumber` withholds (each named by `percentWithheldWhy`): an exact tie at the whole percent (0.125 → "12%" or "13%", `percent:tie`), a DECIMAL half tie whose binary product is not x.5 (0.575 → 57.49999999999999: "57%" if TradingView rounds the double's product, "58%" if it rounds the decimal value; 0.145 → 14.499999999999998 likewise; `percent:decimal-tie`, added round 2), a ROUNDED percentage of 1000 and more ("1,234%" or "1234%"; 9.996 → 999.6 % rounds to 1000 and is withheld too), a value rounding to −0 ("-0%" or "0%", `percent:negative-zero`), `na`; and the `integer` / `currency` presets over the same values | `pineTextFormat.js::percentMessageNumber`, `MESSAGE_NUMBER_PRESETS` |
| Q-W3-4 | `vw-w3-loop-list-text.pine` (below) | AMEX:SPY 1D | a string list read by the loop counter into a cell: the cell texts, in table order, for a literal `array.from` list and for a `var` list | `pine.js::loopTextOf` (the `guard:loop` slice) |
| Q-W3-5 | `vw-w3-loop-helper-text.pine` (below) | AMEX:SPY 1D | a text helper called over a per-pass number: `?:` arms and a fixed-decimals `str.tostring` per pass | `loopTextOf` / `textNodeOf`'s inline frame |
| Q-W3-6 | `vw-w3-loop-ternary-text.pine` (below) | AMEX:SPY 1D | a `?:` whose test is a per-pass comparison, with `str.tostring(x, format.mintick)` and `str.tostring(x, "#.#")` per pass; `na(x) ? "n/a" : …` over a list element | `loopTextOf`, `objectRuntime.js::textOf` (`val` under a tick) |
| Q-W3-7 | `vw-w3-str-repeat-length.pine` (below) | AMEX:SPY 1D | `str.repeat(s, n)` and `str.length(s)` in a cell text, outside and inside a loop (volume-footprint's ghost run) | `pine.js` text reader (`pine:builtin` outside a loop today) |

## The probe scripts

Each keeps inputs at their defaults and draws one table on the last bar; the cell text IS the
measurement. Capture `tableCells` with `__uctVH.capture({...})` as for every drawing probe.

### Q-W3-1 `vw-w3-format-date.pine`

```pine
//@version=6
indicator("vw-w3-format-date", overlay = true)
// a FIXED instant: 2024-03-05 14:07:09 UTC
int fixed = timestamp("UTC", 2024, 3, 5, 14, 7, 9)
if barstate.islast
    var table t = table.new(position.top_right, 1, 6)
    table.cell(t, 0, 0, str.format("{0,date,dd MMMM yyyy, HH:mm:ss}", fixed))
    table.cell(t, 0, 1, str.format("{0,date,yyyy-MM-dd}", fixed))
    table.cell(t, 0, 2, str.format("{0,time,HH:mm:ssZ}", fixed))
    table.cell(t, 0, 3, str.format("{0,date,short}", fixed))
    table.cell(t, 0, 4, str.format("{0,date,yyyy-MM-dd}T{0,time,HH:mm:ssZ}", fixed))
    table.cell(t, 0, 5, str.format("{0,date,MMM d, yy}", time))
```

### Q-W3-2 `vw-w3-format-number-bare.pine`

```pine
//@version=6
indicator("vw-w3-format-number-bare", overlay = false)
plot(str.length(str.format("{0}", close)),        "N01_len_default")
plot(str.length(str.format("{0,number}", close)), "N02_len_number_bare")
plot(str.length(str.format("{0}", volume)),       "N03_len_default_volume")
plot(str.length(str.format("{0,number}", volume)),"N04_len_number_bare_volume")
if barstate.islast
    var table t = table.new(position.top_right, 1, 4)
    table.cell(t, 0, 0, str.format("{0}", 1234.5678))
    table.cell(t, 0, 1, str.format("{0,number}", 1234.5678))
    table.cell(t, 0, 2, str.format("{0}", 999.9995))
    table.cell(t, 0, 3, str.format("{0,number}", -0.0004))
```

### Q-W3-3 `vw-w3-format-percent.pine`

```pine
//@version=6
indicator("vw-w3-format-percent", overlay = true)
if barstate.islast
    var table t = table.new(position.top_right, 1, 15)
    table.cell(t, 0, 0,  str.format("{0,number,percent}", 0.5))
    table.cell(t, 0, 1,  str.format("{0,number,percent}", 0.125))
    table.cell(t, 0, 2,  str.format("{0,number,percent}", 0.135))
    table.cell(t, 0, 3,  str.format("{0,number,percent}", 12.345))
    table.cell(t, 0, 4,  str.format("{0,number,percent}", -0.004))
    table.cell(t, 0, 5,  str.format("{0,number,percent}", -0.126))
    table.cell(t, 0, 6,  str.format("{0,number,percent}", close / open - 1))
    table.cell(t, 0, 7,  str.format("{0,number,percent}", na))
    table.cell(t, 0, 8,  str.format("{0,number,integer}", 1.5))
    table.cell(t, 0, 9,  str.format("{0,number,integer}", 2.5))
    table.cell(t, 0, 10, str.format("{0,number,currency}", -1234.567))
    table.cell(t, 0, 11, str.format("{0,number,#.#}", 1.25))
    // round 2: decimal half ties whose binary product is not x.5
    table.cell(t, 0, 12, str.format("{0,number,percent}", 0.575))
    table.cell(t, 0, 13, str.format("{0,number,percent}", 0.145))
    table.cell(t, 0, 14, str.format("{0,number,percent}", -0.575))
```

### Q-W3-4 `vw-w3-loop-list-text.pine`

```pine
//@version=6
indicator("vw-w3-loop-list-text", overlay = true)
var string[] names = array.from("", "one", "two", "three")
if barstate.islast
    var table t = table.new(position.top_right, 5, 2)
    string[] heads = array.from("c0", "c1", "c2", "c3", "c4")
    for i = 0 to 4
        table.cell(t, i, 0, array.get(heads, i))
    for k = 1 to 3
        table.cell(t, k, 1, array.get(names, k))
```

### Q-W3-5 `vw-w3-loop-helper-text.pine`

```pine
//@version=6
indicator("vw-w3-loop-helper-text", overlay = true)
txtOf(float v) =>
    na(v) ? "n/a" : v > 50 ? str.tostring(v, "#.#") : str.tostring(v, "#.###") + " u"
dirOf(int d) =>
    d > 0 ? "up" : d < 0 ? "down" : "flat"
if barstate.islast
    var table t = table.new(position.top_right, 4, 2)
    float[] px = array.from(close, open, high, low)
    int[] sg = array.from(1, -1, 0, 1)
    for i = 0 to 3
        table.cell(t, i, 0, txtOf(array.get(px, i)))
        table.cell(t, i, 1, dirOf(array.get(sg, i)))
```

### Q-W3-6 `vw-w3-loop-ternary-text.pine`

```pine
//@version=6
indicator("vw-w3-loop-ternary-text", overlay = true)
if barstate.islast
    var table t = table.new(position.top_right, 2, 5)
    float[] rs = array.from(close, open, na, low, high)
    for k = 0 to 4
        bool onMark = k == 2
        float x = array.get(rs, k)
        string xTxt = na(x) ? "n/a" : str.tostring(x, "#.#")
        table.cell(t, 0, k, (onMark ? "> " : "") + str.tostring(close + k * syminfo.mintick, format.mintick))
        table.cell(t, 1, k, xTxt)
```

### Q-W3-7 `vw-w3-str-repeat-length.pine`

```pine
//@version=6
indicator("vw-w3-str-repeat-length", overlay = true)
if barstate.islast
    var table t = table.new(position.top_right, 2, 4)
    table.cell(t, 0, 0, str.repeat("x", str.length("abc")))
    table.cell(t, 1, 0, str.repeat("ab", 3))
    for k = 1 to 3
        string s = "+" + str.tostring(k * 1000000.0, format.volume)
        table.cell(t, 0, k, s)
        table.cell(t, 1, k, str.repeat("x", str.length(s)))
```

## Not captures, recorded so nobody files them as owed

- A `date` element over `timenow` (black-scholes 475) and a `time` element over an offset from
  `timenow` (dynamic-support-and-resistance 2128, the text behind its 1959 cell) can never match a capture:
  `timenow` moves every second. Only the FIXED-instant form (black-scholes 476, an input-derived
  expiry) is capturable; the engine keeps all of them refused by name, and a `timenow` text would
  stay withheld after Q-W3-1.
- S1-C's cell (ict-killzones 989) and tooltips read fields of a user-defined type (a ratio of
  two of its counters): `pine:type` stands after `percent` is read. The capability is
  general; that script needs the UDT work first.
- Every S1-E cell also reads a `request.security` tuple part; `pine:request` stands on them.
  Q-W3-5 pins the helper SHAPE on plain series so the shape can be built without that wall.
- vold-market-breadth is data-limited (`USI:UVOL`) and stays refused; it is not an S1 shape.

## Open item, not S1 (recorded round 2; pre-existing on master, not fixed on this branch)

| id | what | evidence | owed |
|---|---|---|---|
| Q-W3-8 | An `array.size`-derived cell text (a count of bars collected since the first bar) drew `NaN` where the count belongs for artemis-oscillator-pro RDDT 1D when the run skipped the capture's listing facts; TradingView drew the count, 100. The text is right only when the chart's history starts at the symbol's listing, and nothing withholds it otherwise. `objectRuntime.js::textOf` (`case 'num'`; the reviewer's anchor was line 827 at 5f7da680d0). | Seen by the W3 S1 builder (round 1) running `runOurSide` without the listing facts; with them, `w3CapturedCells.vendor.test.js` draws the vendor's text. Master behaves the same (reviewer, round 1: pre-existing, not a regression). | `vw-w3-array-size-history.pine` (below), on AMEX:SPY 1D and NYSE:RDDT 1D. (1) a separate task: run artemis through `runOurSide` with the listing facts removed, and withhold an `array.size`-derived cell text when history does not start at listing instead of drawing `NaN`; (2) the capture below, on a chart whose loaded history does NOT start at listing, pins what TradingView draws there. |

### Q-W3-8 `vw-w3-array-size-history.pine`

Capture on AMEX:SPY 1D (history far older than the loaded bars) AND on a recent listing (RDDT 1D),
so one capture starts at listing and one does not.

```pine
//@version=6
indicator("vw-w3-array-size-history", overlay = true)
var float[] seen = array.new_float()
array.push(seen, close)
if array.size(seen) > 100
    array.shift(seen)
if barstate.islast
    var table t = table.new(position.top_right, 1, 3)
    table.cell(t, 0, 0, "n=" + str.tostring(array.size(seen)))
    table.cell(t, 0, 1, str.tostring(bar_index))
    table.cell(t, 0, 2, str.tostring(array.size(seen) - 1 - bar_index))
```
