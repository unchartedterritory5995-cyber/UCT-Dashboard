# Decision: Flip C — the oscillator bands become real LWC panes

**Decision id:** `FLIP_C_PANE_GEOMETRY`
**Status:** ✅ **ACCEPTED 2026-08-05 — SHIPPED BY B5 TASK 12.** The owner answered
two of the three sub-choices (§5) and Task 12 applied exactly that: `PANE_MODE =
'panes'`, the chart's own separator token (2.1), the per-pane price axis (2.2),
and today's pane heights PRESERVED (2.3 rejected). Landed in its own commit, per
the `MACD_HEAD_MASK` / `VWAP_SESSION_ANCHOR` precedent. §9 records what the
APPLIED build actually measured against what §3 predicted.
**Owner of the read:** `app/src/components/chart/engine/paneLayout.js` → `PANE_MODE` / `paneMode()`,
and `computePaneMargins` in `app/src/components/chart/paneMargins.js` (consumed, not modified).
**Adjudication row:** `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §11.
**Raised by:** Phase B5's plan, as the ONE task of thirteen that may move a pixel.
**Measured by:** B5 Task 11, 2026-08-05 — **and its numbers were withdrawn**: they were taken
against a patched build, because the cutover did not render. **Re-measured by Task 11b**, same
day, after the three defects were fixed at root (commit `bd388aa2`).
**Applied by:** B5 Task 12, 2026-08-05, in its own commit — build **6d3ccce34548**
against the shipped **1c74866baccb**. See §9.
**Pinned by:** `app/src/components/chart/engine/__tests__/flipCRecord.test.js` — it reads this file and
fails if a live parity case is unpriced, if an unfilled placeholder survives (the test spells the
token out; this line deliberately does not, so the rail cannot be satisfied by its own description),
if fewer than two build identities are named, if any of §2's three rows is unpriced, if this Status
line stops saying ACCEPTED, or if §5 still holds an unanswered sub-choice.

> ⛔ **THREE SUB-CHOICES, THREE ANSWERS.** §2 is a table and not a paragraph because
> an owner can accept any subset. A single "looks good" over the whole change is
> exactly the shape this record exists to refuse. **The owner took 2.1 and 2.2 and
> REFUSED 2.3** — which is the subset a single verdict could not have expressed.
>
> ✅ **THE CUTOVER NOW RENDERS ON ONE EDIT.** Task 11 measured that it did not —
> `PANE_MODE = 'panes'` threw into StockChart's ErrorBoundary on all 46 cases —
> and priced it against a build carrying three patches. §6 records the three
> defects, the ONE cause behind them, and the fix. **Every number below is
> measured against the shipped tree with `PANE_MODE` flipped and nothing else.**

---

## 1. What changes, and why it cannot be zero

Every oscillator today is drawn into **pane 0** inside a reserved *band* —
`paneMargins.js`'s `PANES` table hands each enabled oscillator a stacked slice of
one pane, and `computePaneMargins` turns that into top/bottom margins on a price
scale. There is no divider, no second price axis, and no way for a user to resize
one oscillator without resizing the chart.

Flip C makes each oscillator a **real Lightweight-Charts pane**: its own pane
index, its own price scale, a draggable separator between it and its neighbour.

**It cannot be a zero-pixel change, and that is the whole reason it is separated
from the twelve tasks around it.** The other twelve — all ten migrations, both
settings deletions, and the entire real-pane implementation — land under
`PANE_MODE = 'bands'` and are therefore measurable at the OLD zero. Flip C is one
constant flipping to `'panes'`.

### The number that decides the shape of it

> `firstPaneIndex` — the LWC pane index the oscillator stack starts at. It is
> `1 + (separate volume pane ? 1 : 0) + (Model Book index pane ? 1 : 0)`.
> **It is 2, not 1, on every chart a user looks at.**

⚠️ **`CHART_DEFAULTS.volume.separatePane` is `false`, and that is not the answer.**
`volInSeparatePane = volumeSeparatePane || cs.volume?.separatePane`, and the
`volumeSeparatePane` **prop** is passed unconditionally by every surface that
draws a chart: `charts/widgets/ChartWidget.jsx`, `charts/grid/GridChartCell.jsx`,
`IntradayDayPopover.jsx`, `modelbook/BottomsView.jsx` — and `pages/ChartRender.jsx`,
which is the parity route itself. So **`firstPaneIndex === 1` is not a
configuration this app renders**, and it is not one the parity gate can reach: the
harness cannot turn the prop off through `?indicators=`. **That is where all three
of §6's defects lived**, and it is why Task 10's real-renderer tests — every one of
them at `firstPaneIndex === 1` — were green while the first thing a browser did
with `'panes'` was throw.

### What actually moves, measured rather than predicted

`rsi_only`, the two builds side by side, read off the pane manifest:

| | pane 0 | pane 1 | pane 2 |
|---|---|---|---|
| **bands (today)** | 414 px — candles **+ the RSI band** | 117 px — volume | — |
| **panes (the cutover)** | 352 px — candles | 117 px — volume | 61 px — **RSI** |

Three things to read off that row:

* **the oscillator and the volume pane SWAP PLACES.** Today an oscillator band
  lives at the bottom of pane 0, i.e. **above** the volume pane; after the flip it
  is a pane **below** volume. Nothing in the plan says so, and it is the single
  biggest visible change.
* **the volume pane keeps its height** (117 → 117) and **the candle rectangle
  keeps its pixels** — 352 is exactly where the candles' bottom edge already is,
  and the RSI pane's 61 px is the RSI band's 62 px minus the separator the
  cutover adds. The bands become panes; the pixels do not move to make room. ⚠️
  Neither of those was true before §6's fix: the volume pane shrank 117 → 99 and
  the candles were re-fitted.
* it follows that the price range does not change, so **the price axis' labels do
  not change width and the plot area's left edge does not move.**

⚠️ **The reordering is arguably the cutover doing the RIGHT thing.** In band mode
with volume as a *band* (`separatePane: false`), `computePaneMargins` already puts
volume directly under the price area with the oscillators below it. The shipped
separate-pane path is the odd one out, and Flip C makes the two agree. But it is a
visible reordering of every chart a user has open, and it is not what "the bands
become panes" sounds like.

### ⛔ The price pane still does not read absolute 0 — and the floor is ONE GRID LINE

Pane 0 was designed to be untouched by arithmetic rather than by allowance. **It
is very nearly untouched and it is not exactly untouched.** On the
single-oscillator cases `price_plot` reads **2,919 – 3,495 px** — under 0.5 % of
the export and under 0.8 % of the candle pane's own 1200 × 352 rectangle — and
§3's `price_plot` column is what it costs on each case.

**What the residue IS, measured on `rsi_only`'s diff mask rather than reasoned
about.** Of its 2,926 changed pixels:

* **2,248 are two rows** — y 98 and y 99, 1,124 columns each, the full plot width.
  Side A holds `rgb(22,23,19)` there and side B holds the canvas background
  `rgb(14,15,13)`: it is **a horizontal GRID LINE that side B does not draw**.
  Lightweight-charts picks its price-tick spacing from the pane's height, and a
  352-px pane fits one tick fewer than a 414-px one.
* **678 are spread over the other 70 rows**, at a median of **3 px per row** —
  re-antialiased candle and overlay edges.

So the candles do not move: the price range, the axis labels, the plot's left edge
and the entire time axis are **byte-identical** (`time_axis` reads 0 on every one
of the 46 cases, and so does `export_header`).

**The real floor is one grid line per tick the shorter pane can no longer fit —
about 1,124 px each.** `price_plot` cannot reach absolute 0 while the candle
pane's height changes at all, and it must change, because the oscillator pane has
to come from somewhere. The plan's "reads absolute 0 by arithmetic" is not
achievable and never was; what IS achievable, and is now achieved, is that the
candles themselves are untouched.

⚠️ **Task 11's `price_plot` numbers (49,429 px on `rsi_only`) are not comparable
to these**, and not only because of the D3 fix: its rectangle ran from the top of
the canvas to the top of the oscillator stack, so it also contained the volume
pane, and it was offset 40 px by an export header it did not know about. See §3's
"How the rectangles were derived".

## 2. The three sub-choices, priced separately

They are three different kinds of change and an owner can accept any subset. A
single before/after screenshot of "the new panes" hides that, which is why this
section is a table and not a paragraph.

| # | sub-choice | the options | why it is its own decision |
|---|---|---|---|
| **2.1** | **Separator visibility / colour** | LWC's default `#2B2B43` (what the cutover gives today) · the chart's own separator token | pure chrome; costs the fewest pixels and is the easiest to revert. It is also the only one of the three that can be tuned per PRESET. |
| **2.2** | ⭐ **Per-pane price axis** | an overlay scale named after the definition — **no labels**, today's default · the pane's visible `right` scale, with the oscillator's own numbers | **THE BIG ONE — it changes what a user READS**, not just what they see. An RSI pane that grows a `0 / 50 / 100` ladder is new information on every chart. |
| **2.3** | **Pane heights** | preserve today's `PANES.baseH` proportions to the pixel · adopt LWC's default stretch factors (`DEFAULT_STRETCH_FACTOR = 1` ⇒ equal panes) | this is where "the price pane the same rectangle TO THE PIXEL" is won or lost. |

### 2.1 — the separator colour · **2,400 px on `rsi_only`, and it is exactly two rows of 1,200**

<!-- BEGIN:sub-2.1 -->
*A = the cutover with LWC's default separator — build **1667183abbe0**; B = the chart's own separator token — build **d361f1585243**; 5 run(s) per case; served == disk verified on both.*

| case | changed px | % | header | price_plot | mid_panes | osc_strip | time_axis | rest | distribution |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `bb_only` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 5/5 |
| `rsi_only` | 2,400 | 0.322581 | 0 | 0 | 2,400 | 0 | 0 | 0 | 5/5 |
| `macd_only` | 2,400 | 0.322581 | 0 | 0 | 2,400 | 0 | 0 | 0 | 5/5 |
| `bb_rsi_macd` | 3,600 | 0.483871 | 0 | 0 | 2,400 | 1,200 | 0 | 0 | 5/5 |
| `atr_only` | 2,400 | 0.322581 | 0 | 0 | 2,400 | 0 | 0 | 0 | 5/5 |
| `engine_three_bands_stacked` | 4,800 | 0.645161 | 0 | 0 | 2,400 | 2,400 | 0 | 0 | 5/5 |
<!-- END:sub-2.1 -->

**What the number is.** One 1,200-px row per separator, and nothing else on the
canvas moves. The cost scales with pane count and nothing else, and it is
perfectly reversible.

⚠️ **It restyles a separator that already exists.** The price/volume divider is on
LWC's default colour today; the token change moves it too. That is a pixel the
cutover did not have to touch, and it is why this row is its own decision.

**Recommendation: TAKE THE TOKEN.** `separatorColors` is already derived from the
canvas at the separator's own height (light canvas ⇒ `rgba(0,0,0,0.22)`, dark ⇒
`rgba(255,255,255,0.18)`) and is already what the Model Book and bold-candle
surfaces use. Leaving LWC's `#2B2B43` in place means the app's one remaining
hard-coded chrome colour sits between every pair of panes, and it is invisible
against a dark canvas and wrong against a light one — the exact defect
`separatorColors` was written to fix.

### 2.2 — the per-pane price axis · **372 px on `rsi_only`, and it is the one that changes what a user READS**

<!-- BEGIN:sub-2.2 -->
*A = the cutover's overlay scale (no axis labels) — build **1667183abbe0**; B = a visible per-pane right axis — build **0aeab4391711**; 5 run(s) per case; served == disk verified on both.*

| case | changed px | % | header | price_plot | mid_panes | osc_strip | time_axis | rest | distribution |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `bb_only` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 |
| `rsi_only` | 372 | 0.05 | 0 | 0 | 0 | 372 | 0 | 0 | 5/5 |
| `macd_only` | 140 | 0.018817 | 0 | 0 | 0 | 140 | 0 | 0 | 5/5 |
| `bb_rsi_macd` | 512 | 0.068817 | 0 | 0 | 0 | 512 | 0 | 0 | 5/5 |
| `atr_only` | 229 | 0.03078 | 0 | 0 | 0 | 229 | 0 | 0 | 5/5 |
| `engine_three_bands_stacked` | 516 | 0.069355 | 0 | 0 | 0 | 516 | 0 | 0 | 5/5 |
<!-- END:sub-2.2 -->

**What the number is.** Small, and the size is misleading in both directions. It
is small because the axis GUTTER already exists — the price axis is there, pinned
to a stable minimum width, and the oscillator's numbers are drawn into the column
that is already reserved. So the cost is ink, not layout: **every one of its
pixels is inside `osc_strip`, and `price_plot`, `mid_panes`, `time_axis` and
`export_header` all read 0** on all six cases. No candle moves. It is
not small in what it means — every oscillator pane gains a live numeric ladder a
user will read values off, and `manifest_geometry` records the `scaleId` moving
from the definition's own overlay scale to `right` on every migrated series.

🔴 **AND THE "EVERY PIXEL INSIDE `osc_strip`" CLAIM IS FALSE ON `obv` — MEASURED
BY B5 TASK 12, AFTER THE ANSWER.** The six cases above do not include one, and
OBV is the only shipped indicator whose values run to hundreds of millions.
lightweight-charts aligns every pane to ONE shared axis column, so OBV's labels —
the widest on the chart — widen it, the plot narrows, and the candles, the volume
pane and the time axis all move. On `obv_only` the two sub-choices together cost
**82,498 px** with `price_plot` **17,109** and `time_axis` **1,668**, against
2,540 – 5,316 on every other case. §9 has the isolation and the remedy.

**Recommendation: THE OWNER'S CALL, WITH THE NUMBER IN FRONT OF THEM.** TradingView
shows it and spec §6's "pane grammar" implies it; against that, an RSI whose scale
is pinned 0–100 gains little from a ladder that always reads the same three
numbers, while an ATR or an OBV — which autoscale — gain a lot. A third option
exists and is cheap to add later: **axis only on panes whose scale is not fixed**.
It is not priced here because it is not implemented; if the owner wants it, it is a
one-line change to `placement.js`'s `'panes'` branch and its own measurement.

### 2.3 — the pane heights · **195,658 px on `rsi_only` — 26.3 % of the canvas**

<!-- BEGIN:sub-2.3 -->
*A = today's band heights, preserved — build **1667183abbe0**; B = LWC's own stretch defaults (equal panes) — build **3dcdffd52fd3**; 5 run(s) per case; served == disk verified on both.*

| case | changed px | % | header | price_plot | mid_panes | osc_strip | time_axis | rest | distribution |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `bb_only` | 131,766 | 17.710484 | 0 | 86,989 | 44,777 | — | 0 | 0 | 5/5 |
| `rsi_only` | 195,658 | 26.298118 | 0 | 115,163 | 74,597 | 5,898 | 0 | 0 | 5/5 |
| `macd_only` | 202,570 | 27.227151 | 0 | 110,652 | 81,999 | 9,919 | 0 | 0 | 5/5 |
| `bb_rsi_macd` | 200,789 | 26.987769 | 0 | 101,905 | 73,869 | 25,015 | 0 | 0 | 5/5 |
| `atr_only` | 196,908 | 26.466129 | 0 | 118,784 | 71,909 | 6,215 | 0 | 0 | 5/5 |
| `engine_three_bands_stacked` | 177,027 | 23.793952 | 0 | 75,127 | 74,022 | 27,878 | 0 | 0 | 5/5 |
<!-- END:sub-2.3 -->

**What the number is.** LWC's default stretch factor is `1`
(`lightweight-charts.standalone.development.js:5225`), so a chart that never calls
`setStretchFactor` has **equal panes**: on `rsi_only` the candles fall from 352 px
to about a third of the stack and the RSI grows from 61 px to the same. A large
fraction of the canvas changes and `price_plot` takes the overwhelming majority of
it.

**Recommendation: PRESERVE THE HEIGHTS.** This is the only one of the three where
the alternative is plainly worse: a returning user's layout stops being
recognisable, a single RSI takes a third of the chart, and the `baseH` values
encode a deliberate look (`macd` 0.17 > `rsi` 0.15 > `atr`/`obv` 0.13) that equal
panes throws away. The heights are already preserved by `computePaneLayout` and
the code to do it already exists; adopting LWC's defaults would be a deletion that
costs a quarter of the picture.

## 3. The measurement

<!-- BEGIN:cutover-table -->
*A = `PANE_MODE = 'bands'` — what ships — build **1c74866baccb**; B = the cutover, ONE edit — build **1667183abbe0**; 5 run(s) per case; served == disk verified on both.*

| case | changed px | % | header | price_plot | mid_panes | osc_strip | time_axis | rest | distribution | manifest geometry |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| `bb_only` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `rsi_only` | 117,577 | 15.80336 | 0 | 2,926 | 64,307 | 50,344 | 0 | 0 | 5/5 | 5 line(s) |
| `macd_only` | 131,455 | 17.668683 | 0 | 4,129 | 71,767 | 55,559 | 0 | 0 | 5/5 | 7 line(s) |
| `macd_headmask` | 131,455 | 17.668683 | 0 | 4,129 | 71,767 | 55,559 | 0 | 0 | 5/5 | 7 line(s) |
| `bb_rsi_macd` | 164,490 | 22.108871 | 0 | 12,933 | 76,667 | 74,890 | 0 | 0 | 5/5 | 12 line(s) |
| `engine_rsi_vs_legacy` | 117,577 | 15.80336 | 0 | 2,926 | 64,307 | 50,344 | 0 | 0 | 5/5 | 5 line(s) |
| `engine_rsi_toggle_off` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 0 line(s) |
| `engine_bb_vs_legacy` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `engine_bb_over_overlays` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `engine_bb_rsi_vs_legacy` | 124,698 | 16.760484 | 0 | 8,022 | 66,332 | 50,344 | 0 | 0 | 5/5 | 6 line(s) |
| `engine_macd_vs_legacy` | 131,455 | 17.668683 | 0 | 4,129 | 71,767 | 55,559 | 0 | 0 | 5/5 | 7 line(s) |
| `engine_bb_rsi_macd_vs_legacy` | 164,490 | 22.108871 | 0 | 12,933 | 76,667 | 74,890 | 0 | 0 | 5/5 | 12 line(s) |
| `flipb_rsi_only` | 117,577 | 15.80336 | 0 | 2,926 | 64,307 | 50,344 | 0 | 0 | 5/5 | 5 line(s) |
| `flipb_bb_only` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `flipb_bb_rsi_macd` | 164,490 | 22.108871 | 0 | 12,933 | 76,667 | 74,890 | 0 | 0 | 5/5 | 12 line(s) |
| `flipb_macd_only` | 131,455 | 17.668683 | 0 | 4,129 | 71,767 | 55,559 | 0 | 0 | 5/5 | 7 line(s) |
| `flipb_vwap_only` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `flipb_vwap_dimmed` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `flipb_all_four` | 159,426 | 21.428226 | 0 | 15,370 | 96,549 | 47,507 | 0 | 0 | 5/5 | 14 line(s) |
| `intraday_bars_only` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 0 line(s) |
| `vwap_only` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `engine_vwap_vs_legacy` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `engine_vwap_dimmed_vs_legacy` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `engine_vwap_dashed_vs_legacy` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `engine_stoch_vs_legacy` | 118,339 | 15.90578 | 0 | 2,919 | 65,000 | 50,420 | 0 | 0 | 5/5 | 6 line(s) |
| `engine_atr_vs_legacy` | 108,284 | 14.554301 | 0 | 3,023 | 59,911 | 45,350 | 0 | 0 | 5/5 | 5 line(s) |
| `stoch_only` | 120,278 | 16.166398 | 0 | 2,919 | 66,939 | 50,420 | 0 | 0 | 5/5 | 6 line(s) |
| `atr_only` | 108,284 | 14.554301 | 0 | 3,023 | 59,911 | 45,350 | 0 | 0 | 5/5 | 5 line(s) |
| `engine_sar_vs_legacy` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `engine_ichimoku_vs_legacy` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `engine_price_overlay_zorder` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `sar_only` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `ichimoku_only` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `mfi_only` | 116,659 | 15.679973 | 0 | 3,495 | 63,522 | 49,642 | 0 | 0 | 5/5 | 5 line(s) |
| `cci_only` | 117,160 | 15.747312 | 0 | 2,920 | 64,391 | 49,849 | 0 | 0 | 5/5 | 5 line(s) |
| `williams_r_only` | 117,180 | 15.75 | 0 | 2,919 | 64,184 | 50,077 | 0 | 0 | 5/5 | 5 line(s) |
| `engine_mfi_vs_legacy` | 116,659 | 15.679973 | 0 | 3,495 | 63,522 | 49,642 | 0 | 0 | 5/5 | 5 line(s) |
| `engine_cci_vs_legacy` | 117,160 | 15.747312 | 0 | 2,920 | 64,391 | 49,849 | 0 | 0 | 5/5 | 5 line(s) |
| `engine_williams_r_vs_legacy` | 117,180 | 15.75 | 0 | 2,919 | 64,184 | 50,077 | 0 | 0 | 5/5 | 5 line(s) |
| `engine_three_bands_stacked` | 163,300 | 21.948925 | 0 | 3,364 | 74,688 | 85,248 | 0 | 0 | 5/5 | 9 line(s) |
| `adx_only` | 122,104 | 16.411828 | 0 | 2,945 | 68,422 | 50,737 | 0 | 0 | 5/5 | 7 line(s) |
| `obv_only` | 110,233 | 14.816263 | 0 | 3,023 | 61,858 | 45,352 | 0 | 0 | 5/5 | 5 line(s) |
| `donchian_only` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| `engine_adx_vs_legacy` | 122,104 | 16.411828 | 0 | 2,945 | 68,422 | 50,737 | 0 | 0 | 5/5 | 7 line(s) |
| `engine_obv_vs_legacy` | 108,376 | 14.566667 | 0 | 3,023 | 60,001 | 45,352 | 0 | 0 | 5/5 | 5 line(s) |
| `engine_donchian_vs_legacy` | 0 | 0.0 | 0 | 0 | 0 | — | 0 | 0 | 5/5 | 2 line(s) |
| **46 cases, summed** | **3,439,445** | | | | | | | | | |
<!-- END:cutover-table -->

### 🔑 What the table says in one line

**19 of 46 cases read 0** — every case that creates no oscillator pane (`bb`,
`vwap`, `sar`, `ichimoku`, `donchian`, the price-overlay z-order case, the
intraday bars case, and `engine_rsi_toggle_off`, whose RSI is off). **The cutover
is exactly, provably free on a chart with no oscillator.** ⚠️ **TRUE OF THE
CUTOVER ALONE AND NOT OF WHAT SHIPPED** — the owner took the separator token, and
those nineteen cases each read **1,200 px** in the applied build. See §9. The other 27 run
**108,284 – 164,490 px**, i.e. 14.6 – 22.1 % of the export, and all 46 sum to
**3,439,445 px**. ⭐ **Every one of the 46 read a SINGLE value on all 5 runs** —
Task 11 had two cases it could not measure at all.

Where those pixels are, on a single-oscillator case (`rsi_only`, 117,577):

| region | px | what it is |
|---|---:|---|
| `mid_panes` | 64,307 | **the volume pane, RELOCATED.** The oscillator becomes a pane BELOW it, so a 117-px pane moves 62 px up the canvas. This is the reordering, and it is the largest slice on every case |
| `osc_strip` | 50,344 | the oscillator stack the cutover creates — a band redrawn as a pane, with its own separator and scale |
| `price_plot` | 2,926 | one grid line the shorter pane no longer fits, plus 678 px of re-antialiasing (§1) |
| `export_header` · `time_axis` · `rest` | 0 · 0 · 0 | **the candles do not move, so nothing downstream of them does** |

⚠️ **AND IT MOVES THE MANIFEST EVEN WHERE IT MOVES NO PIXELS.** Every zero-pixel
case still reports **2 lines of manifest geometry**, because pane 0's
`stretchFactor` changes from `78` — a PERCENTAGE, which is what `StockChart`'s
volume-pane block writes — to `414`, a PIXEL COUNT, which is what
`paneStretchPlan` writes. The picture is identical; the units the layout is
expressed in are not. Task 12 has to decide whether those 19 declare
`expectManifestChange` or whether the units are reconciled.

### How the rectangles were derived

⛔ **Not by eye.** `tools/gen_parity_regions.py` regenerates every box in
`tools/chart_parity_cases.json` from the **pane manifest of both builds** —
`window.__paneManifest`, which `paneLayout.paneManifest` builds by reading the
renderer back — plus **the row the pane stack starts on inside `#chart-export`,
read off the page**. Each case records its derivation inline in `_regionsFrom`
(both build ids, the stack's top offset, the pane-stack height, the separator
height, both sides' per-pane pixel heights).

* `export_header` — the band above the chart. 🔴 **40 px, and Task 11's boxes did
  not know it was there**: every rectangle it derived was 40 px too high, so its
  `time_axis` box began 40 px INSIDE the volume pane. The 35,471 px it reported as
  "the time axis, because the price-axis labels moved" were the bottom of the
  **volume pane** moving. The offset is now measured per case, not assumed.
* `price_plot` — **the CANDLE pane**: candles, MA and price overlays, the price
  axis. **The rectangle the design claims reads 0**, and now the only one that is
  asking that question. Task 11's `price_plot` ran from the top of the canvas to
  the top of the stack, so it also contained the volume pane — one number
  answering two questions, and the volume pane MOVES by construction.
* `mid_panes` — the panes between the candles and the stack: the separate volume
  pane, and Model Book's index pane. **This is where the reordering is priced.**
* `osc_strip` — the oscillator stack the cutover creates. Absent on a case whose
  two sides have the same pane count; a zero-area box is refused by
  `validate_regions`, because it reads exactly like one holding the line.
* `rest` — **not declared, computed by mask subtraction**. The five rectangles
  tile the export, so it reads 0 on every case and has nowhere to hide a pixel.

**The rectangles discriminate, in both directions**, re-proved on the panes build
where the split is the one that matters: `candles.upColor` moved one hex digit →
the change lands in `price_plot` and nowhere else; `indicators.rsi.color` moved one
hex digit → it lands in `osc_strip` (plus the export footer's own legend ink,
which is a colour change and not a geometry one). A per-region 0 means nothing
without that.

### ⚠️ The 24-pixel artefact — and what the fix did to it

Task 11 measured **15 of 46 cases going bistable** under `'panes'`: side A hashed
identical on every run, side B rasterised into exactly two states, and the whole
difference was **24 changed pixels on ONE scanline** spanning the plot width. That
is byte-for-byte the artefact `pages/ChartRender.jsx` already documents and already
suppresses on `engine_rsi_toggle_off`: **the dashed last-price line**, which
Chromium rasterises two ways at ~12 dash boundaries at one specific geometry. The
cutover did not create it — it moved pane 0's height, which moved that line onto
the unstable row.

Task 11 suppressed 13 of them with `?priceline=0` and **named `stoch_only` and
`engine_adx_vs_legacy` as unresolved**. Both are resolved:

* **`stoch_only` and `engine_adx_vs_legacy` are single-valued on every run of this
  measurement, unsuppressed.** So is `adx_only`, which Task 11 reported as NOT
  MEASURED for the same reason. The fix changed pane 0's height (353 → 352 on the
  single-oscillator geometry), which moved the last-price line back off the
  unstable row. **Three cases resolved by the geometry, not by an allowance.**
* ⚠️ **`obv_only` flaked ONCE, in a discarded run, and did not flake in this one.**
  A first pass of this measurement at 6 runs/case read `110,257 ×1 · 110,233 ×5` —
  a 24-px difference with the same signature, on a case Task 11 never saw flake.
  The measurement below re-ran it 5 more times at `110,233` on every one. It is
  reported at that value and it is **latently at risk**, exactly as Task 11 said
  the whole single-oscillator-pane geometry class is.
* the 15 inherited suppressions are still in the case file and are still applied.
  ⚠️ **They are no longer known to be earned** — they were measured on a geometry
  that no longer exists. §4 assigns re-earning them to Task 12: run the panes dist
  against itself with every `priceLine` flag removed and keep only the cases that
  actually flake.

⛔ **A suppression is not a tolerance**: a suppressed case must still read a SINGLE
value on every run, and 0 under `'bands'`.

### The builds

| | what it is | build id | renders? |
|---|---|---|---|
| **A0** | `a2c82310` (Task 11's HEAD), `PANE_MODE = 'bands'` | **`cc1f66936413`** | yes |
| **A** | `bd388aa2` (the fix), `PANE_MODE = 'bands'` — **what ships** | **`1c74866baccb`** | yes · **0 changed pixels vs A0 on all 46 cases** |
| **B** | A + `PANE_MODE = 'panes'`, **nothing else** | **`1667183abbe0`** | ✅ **yes** — it did not at Task 11 (§6) |
| **C** | B + the chart's own separator token (2.1) | **`d361f1585243`** | yes |
| **D** | B + `scaleId: 'right'` (2.2) | **`0aeab4391711`** | yes |
| **E** | B + LWC's default stretch factors (2.3) | **`3dcdffd52fd3`** | yes |

Every variant is one named edit list in `tools/flipc_variant_patch.py`, applied to
a scratch tree, built, and reverted with a line-ending-normalised sha256 check.
**Nothing in that file is committed into `app/src`.** ⚠️ Task 11's file carried
three extra patches (`FIX_STACK`, `FIX_PANE0_ONLY`, `NO_HEIGHT_THROW`) purely to
get a frame to photograph; all three are **deleted**, because the defects they
worked around are fixed in the tree.

### Trust in the numbers

<!-- BEGIN:trust -->
| run | cases | runs/case | every capture `shots=2/2` | every capture `stable` | cases at a single value | 95% flake bound |
|---|---:|---:|---|---|---:|---:|
| the cutover | 46 | 5 | yes | yes | 46/46 | 45.1% |
| sub-choice 2.1 | 6 | 5 | yes | yes | 6/6 | 45.1% |
| sub-choice 2.2 | 6 | 5 | yes | yes | 6/6 | 45.1% |
| sub-choice 2.3 | 6 | 5 | yes | yes | 6/6 | 45.1% |
| the bands gate: HEAD's dist vs the fix's dist | 46 | 3 | yes | yes | 46/46 | 63.2% |
<!-- END:trust -->

## 4. What goes red when it is applied

| test / gate | why it moves |
|---|---|
| **162 tests across 13 files** (measured at Task 10 by flipping the constant tree-wide) | **Most are the DOUBLES, not the product** — the suites' chart stubs answer `panes()` with one fixed-height pane. ⚠️ The binder no longer THROWS on a height disagreement (§6 D2), so this count is now an over-estimate and Task 12 must re-measure it rather than quote it |
| the parity gate's per-case **exact** expectations | `expect` replaces `<=`, so every case that moves must have its new number written down — and a regression SMALLER than the old allowance fails too. §3's table is that list |
| `rsi_only`'s five region `expect: 0`s | the only case whose regions are GATED today. Task 12 replaces the 0s with §3's numbers |
| the **pane manifest** JSON diff | pane count and per-series pane index change by definition. ⭐ A change that moves pixels but not the manifest, or the manifest but not the pixels, is a regression BY DEFINITION: one of the two is lying |
| the **region gate**'s `price_plot` row | it does **not** read 0 — §1. Task 12 either accepts the sub-pixel floor and writes the number down, or the identity is signed off as "within a pixel" |
| the 15 inherited `priceLine: false` suppressions | measured on a geometry that no longer exists. Task 12 must re-earn them case by case, and drop the ones that no longer flake |
| `paneMargins`-derived suites | `PANE_MODE` selects a different projection |
| `test_a_case_that_declares_NOTHING_still_collapses_on_its_tolerance` | asserts ≥ 24 cases declare nothing at all. It is the backwards-compatibility rail for "zero survives twelve of thirteen tasks", and Task 12's per-case `expect`s are what finally retire it |

### The screenshots

`docs/decisions/assets/2026-08-04-flip-c/` — stacked A-above-B PNGs, captured
through `chart_parity.capture` (the same settle the measured frames got) by
`tools/flipc_screenshots.py`, each labelled with its side and its build id:

| file prefix | shows |
|---|---|
| `cutover__*` | `'bands'` (what ships) above `'panes'` (the cutover) |
| `sub-2.1__*` | LWC's default separator above the chart's own token |
| `sub-2.2__*` | the overlay scale above a visible per-pane right axis |
| `sub-2.3__*` | today's heights above LWC's equal-pane defaults |

each for `rsi_only` (one oscillator), `bb_rsi_macd` (a price overlay plus two)
and `engine_three_bands_stacked` (three). **Start with
`cutover__rsi_only.png`** — the RSI moving from a band above the volume pane to a
pane below it is the whole decision in one image.

## 5. The owner's answer

**ANSWERED 2026-08-05.** §2's three rows went to the owner with §3's numbers and
the screenshots in `docs/decisions/assets/2026-08-04-flip-c/`. Two answers came
back, and they do not agree with each other about direction — which is exactly why
this section is a table:

| sub-choice | answer | date |
|---|---|---|
| 2.1 separator colour | ✅ **TAKE THE TOKEN.** The chart's own `separatorColors`, not LWC's `#2B2B43`. 2,400 px on `rsi_only` — one 1,200-px row per separator, and it restyles the price/volume divider too. | 2026-08-05 |
| 2.2 per-pane price axis | ✅ **YES.** Every oscillator pane grows its own visible `right` scale with the indicator's numbers on it. 372 px on `rsi_only`, every pixel inside `osc_strip`. **The one sub-choice that changes what a user READS.** | 2026-08-05 |
| 2.3 pane heights | ⛔ **REJECTED — PRESERVE TODAY'S.** LWC's equal-pane defaults would have added 195,658 px on `rsi_only` (26.3 % of the canvas) and changed every chart's proportions rather than just the oscillator ordering. | 2026-08-05 |

**What the owner bought, in one line:** the cutover's own 108,284 – 164,490 px on
the 27 cases that create an oscillator pane, **0 px on the other 19**, plus the
separator token and the axis. A returning user's chart is recognisable — same
candle rectangle, same relative band sizes — and the oscillators have moved BELOW
the volume pane, which is §7's stated loss and the largest slice of every diff.

## 6. 🔴 What measuring it found: three defects, ONE cause — and the fix

Task 11 measured that `PANE_MODE = 'panes'` **did not render at all** and named
three defects. They have one cause, and it is a frame of reference:

> `computePaneLayout` used `chartHeight` — the WHOLE pane stack — everywhere the
> band arithmetic it reproduces means **the CANDLE PANE's own height**. The two
> are the same number exactly when `firstPaneIndex === 1`, which is the case Task
> 3's totality proof covers and, per §1, **not a configuration this app renders**.

| | defect | how it showed | status |
|---|---|---|---|
| **D1** | the separator budget removed `oscCount` separators from a height that **already contained** the `firstPaneIndex − 1` separators of the panes above the stack, so the layout over-allocated by exactly `firstPaneIndex − 1` px | `paneLayout: panes 0-1 total is 451px, expected 452px` into StockChart's ErrorBoundary — a **deterministic blank chart** on all 46 cases, and on a chart with no oscillator at all | ✅ **fixed by the frame.** The pre-existing separators are taken out of the budget *before* it is split, so the stack pays for exactly the separators it ADDS. No correction term |
| **D2** | `paneHeightMismatch` **threw**, and one deferred frame is not a settle | `paneLayout: pane 2 is 77px, expected 78px` on **3 of 14** then **1 of 8** COLD loads; the same build with the throw removed gave **15/15 identical manifests**. The geometry was right every time | ✅ **fixed as a ruling, not a number** — see below |
| **D3** | `pane0.mainMargins` were fractions of the price-pane **BUDGET** and were applied to the candles' **own** scale | the candle rectangle was re-fitted on every chart the app draws; `price_plot` 49,429 px on `rsi_only` | ✅ **fixed by the same frame.** `pane0.heightPx` now means the candle pane's own height and nothing else; the other panes above the stack are in `layout.above`. `price_plot` 49,429 → **2,791** |

⚠️ **Fixing D3's divisor ALONE would have been a second blank chart.** The bands
rectangle's bottom edge is 452 px and the candle pane is 353 px tall, so
`1 − 452/353` is a **negative** bottom margin, which lightweight-charts refuses
outright. The numerators had to move into the same frame as the divisor, which is
why this is one substitution and not two patches.

### D2 — the ruling, and why

**The assertion should not exist as an assertion.** It asserts an exact pixel
identity across a re-layout the renderer is free to make, on the paint path, and
pays for a disagreement with the whole chart. Three reasons it is now a report:

1. **A blank chart is a worse failure than a one-pixel drift.** That is the whole
   trade, and Task 11's measurement settles which side of it we were on.
2. **The first sync of EVERY chart disagrees, by construction.** `paneStackHeightPx`
   is itself rAF-stale: a real 400 px chart reads **401** before the renderer has
   sized its panes, so the very first layout is computed against a height that is a
   pixel out. MEASURED in `flipCGeometry.test.jsx`. That is a **fourth** face of
   the same rAF blindness (after Task 3's separator pin, Task 10's options-effect
   ordering and D2 itself), and it is unavoidable without blocking a frame inside
   the paint.
3. **A transient is exactly what a re-apply fixes.** So the binder **converges**:
   on a disagreement it re-applies the layout once and re-arms. Only a drift that
   survives its own correction is reported — a `console.warn`, once per distinct
   message, plus a counter (`paneHeightAlerts()`) a test can assert on.

⛔ **"Do not throw" must not become "do not notice"**, and the first draft of the
fix made exactly that mistake: it reset the consecutive-mismatch counter every time
a layout was applied, which happens every sync, so a layout the renderer can NEVER
honour was converged forever in silence. `flipCGeometry.test.jsx`'s
surviving-drift case is the rail, and it went red saying so.

### What the fix is NOT

* it is **not** a change to `paneMargins.js`, which stays consumed and untouched;
* it is **not** a change to the band arithmetic — the proportional squeeze, the
  integer-hundredths quantisation and the tallest-first shave are byte-identical.
  Only what they are fractions OF moved;
* at `firstPaneIndex === 1` every line is the arithmetic that shipped, so **Task
  3's 1,966,080-layout totality proof is untouched rather than re-argued**, and
  `paneLayout.test.js`'s whole sweep passed unmodified.

### The coverage that was missing

Task 10 reported "the panes path is genuinely exercised". It was — on a real
lightweight-charts 5.2.0 chart, reading the renderer back — **at
`firstPaneIndex === 1`, which is a chart this app never draws.** A real renderer
driven in a configuration nobody ships is not coverage, and that is why three
defects reached a measurement task. `flipCGeometry.test.jsx` now builds its chart
**with a separate volume pane** and asserts, against the renderer: the layout
totals exactly (D1), a chart with no oscillator totals exactly (D1's other half),
the bands-mode reference equals what LWC actually gives a 78/22 chart, the volume
pane keeps its height, the candle rectangle keeps its absolute pixels (D3), a
three-pane-above chart totals exactly, and the remainder lands on the candle pane
on a split that does not divide evenly.

## 7. What a user gains, and what a user loses

**Gains, and none of them is available today at any price:**

* **draggable dividers** — every oscillator can be resized against its neighbour.
  `layout.panes.enableResize` is already declared under `'panes'`; the divider is
  driven and asserted in `flipCGeometry.test.jsx` against a real LWC 5.2.0 chart.
* **a real price scale per oscillator** — which is what makes 2.2 available at all.
  In band mode there is one scale per definition inside pane 0 and no room for an
  axis.
* **geometry that can express what the library natively supports** — per-instance
  panes (two ATRs that do not have to share one autoscale), reordering by dragging,
  a pane that can be collapsed. Today's stack ORDER is a nine-row constant.
* **one behaviour instead of two** — today the oscillators sit *above* the volume
  pane when volume is separate and *below* it when volume is a band. After the
  flip there is one answer.

**Losses, stated plainly:**

* **every open chart is reordered** — the oscillators move below the volume pane.
  §3's `mid_panes` column is what that costs, and it is the largest single slice of
  the diff on most cases.
* 🔴 **AND THE OSCILLATORS ARE REORDERED AMONG THEMSELVES — FOUND BY B5 TASK 12,
  AFTER THE OWNER ANSWERED, AND IT IS THE ONE THING ON THIS PAGE THE OWNER WAS NOT
  SHOWN.** Under `'bands'` the stack order is `paneMargins.PANES` — a constant.
  Under `'panes'` it is the INSTANCE LIST's order, and the v1→v2 fold seeds that
  list in **REGISTRY** order, not in the shipped stack order. Those two disagree:
  today, top-to-bottom, `rsi · stoch · mfi · williamsR · cci · macd · adx · atr ·
  obv`; after the cutover, `rsi · macd · stoch · atr · mfi · cci · williamsR · adx
  · obv`. On a chart with RSI + MACD + Stochastics, MACD and Stochastics **swap**.
  * **It is inside the measured numbers.** Build **1667183abbe0** carried exactly
    this behaviour, so §3's 108,284 – 164,490 px already pay for it — nothing
    re-measured, nothing under-declared. What is missing is this paragraph.
  * **Why it was not fixed in the apply.** The obvious fix — seed the fold in
    `SHIPPED_STACK_ORDER` — was tried at B5 Task 9 and **the pixel gate refused
    it**: the instance list is also the binder's `addSeries` order and insertion
    order is z-order, so `engine_three_bands_stacked` reported a manifest GEOMETRY
    diff (`series[2].scaleId 'cci' → 'williamsR'`) at **0 changed pixels**, 5/5
    runs. Sorting PANES by `stackRank` inside `computePaneLayout` is the other
    half of that fix and it is a geometry change with its own gate — i.e. a
    decision, priced separately, not something to slip into the commit that
    applies a different one.
  * **What is written down instead.** `instances.js` and `paneLayout.js` both
    claimed the order WAS applied at Flip C; both docstrings are corrected, and
    `settingsBlobMigration.test.js` pins the measured order so the claim cannot
    drift back into prose. **This is an owner call and it is open.**
* **the price pane is no longer pixel-identical** — but the residue is now
  sub-pixel rounding rather than a re-fit (§1), 2,791 px instead of 49,429.
* **a height disagreement is now silent-ish** — a `console.warn` and a counter
  instead of a throw. That is the right trade against a blank chart, and it does
  mean a real drift can ship unnoticed if nobody reads the counter. Task 12 should
  decide whether it also belongs on `chart_health_alerts`.
* **`paneMargins.js`'s nine-row `PANES` table is retired**, and with it the one
  place a reader could see the whole stack at once. That is the last B5 row in the
  enumeration ledger and it is assigned to Task 12.
* **a volume-divider drag is snapped back.** The above-stack heights come from
  settings (`cs.volume.paneHeightPct`) rather than from the factors on the chart,
  because reading those back cannot survive its own output — this function writes
  pixel counts into them. Today's bands mode preserves such a drag; under `'panes'`
  it would be re-applied on the next sync. ⚠️ Draggable dividers being the point of
  Flip C, "remember the drag" is real follow-up work and it is not in this change.

**What keeping the bands costs — the standing price of doing nothing.** The bands
are **fake panes**: stacked `scaleMargins` inside pane 0. A user gets no draggable
divider, no per-pane axis and no way to resize one oscillator without resizing the
chart; two instances of the same indicator share one band and one scale because
`computePaneMargins` is keyed by definition id; the stack ORDER is a constant in a
source file rather than user data; and the geometry cannot express what
Lightweight Charts natively supports, so every future pane feature is blocked
behind this same flip. It is also **two behaviours pretending to be one** — the
volume-band and separate-volume-pane paths already disagree about where an
oscillator goes, and only one of them can be right.

## 9. 🎯 WHAT THE APPLIED BUILD ACTUALLY MEASURED — B5 Task 12, 2026-08-05

*A = `PANE_MODE = 'bands'` — what shipped — build **1c74866baccb**; B = the
CUTOVER AS THE OWNER ANSWERED IT (panes + the separator token + the per-pane
axis) — build **6d3ccce34548**; 2 run(s) per case; `served == disk` verified on
both; **all 46 cases single-valued on every run**.*

Every number below is now a per-case `expect` in `tools/chart_parity_cases.json`,
and every REGION carries one too. The gate's verdict is an EQUALITY, not a budget:
a regression smaller than the old allowance fails, and so does a build that
suddenly draws nothing.

| case | changed px | % | header | price_plot | mid_panes | osc_strip | time_axis | rest | distribution |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `bb_only` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `rsi_only` | 119,868 | 16.11129 | 0 | 2,926 | 66,245 | 50,697 | 0 | 0 | 2/2 |
| `macd_only` | 131,592 | 17.687097 | 0 | 4,129 | 71,767 | 55,696 | 0 | 0 | 2/2 |
| `macd_headmask` | 131,592 | 17.687097 | 0 | 4,129 | 71,767 | 55,696 | 0 | 0 | 2/2 |
| `bb_rsi_macd` | 164,892 | 22.162903 | 0 | 12,933 | 76,667 | 75,292 | 0 | 0 | 2/2 |
| `engine_rsi_vs_legacy` | 119,868 | 16.11129 | 0 | 2,926 | 66,245 | 50,697 | 0 | 0 | 2/2 |
| `engine_rsi_toggle_off` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `engine_bb_vs_legacy` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `engine_bb_over_overlays` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `engine_bb_rsi_vs_legacy` | 125,051 | 16.80793 | 0 | 8,022 | 66,332 | 50,697 | 0 | 0 | 2/2 |
| `engine_macd_vs_legacy` | 131,592 | 17.687097 | 0 | 4,129 | 71,767 | 55,696 | 0 | 0 | 2/2 |
| `engine_bb_rsi_macd_vs_legacy` | 164,892 | 22.162903 | 0 | 12,933 | 76,667 | 75,292 | 0 | 0 | 2/2 |
| `flipb_rsi_only` | 119,868 | 16.11129 | 0 | 2,926 | 66,245 | 50,697 | 0 | 0 | 2/2 |
| `flipb_bb_only` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `flipb_bb_rsi_macd` | 164,892 | 22.162903 | 0 | 12,933 | 76,667 | 75,292 | 0 | 0 | 2/2 |
| `flipb_macd_only` | 131,592 | 17.687097 | 0 | 4,129 | 71,767 | 55,696 | 0 | 0 | 2/2 |
| `flipb_vwap_only` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `flipb_vwap_dimmed` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `flipb_all_four` | 159,003 | 21.371371 | 0 | 15,370 | 96,549 | 47,084 | 0 | 0 | 2/2 |
| `intraday_bars_only` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `vwap_only` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `engine_vwap_vs_legacy` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `engine_vwap_dimmed_vs_legacy` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `engine_vwap_dashed_vs_legacy` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `engine_stoch_vs_legacy` | 120,406 | 16.183602 | 0 | 2,919 | 66,939 | 50,548 | 0 | 0 | 2/2 |
| `engine_atr_vs_legacy` | 110,356 | 14.832796 | 0 | 3,023 | 61,754 | 45,579 | 0 | 0 | 2/2 |
| `stoch_only` | 120,406 | 16.183602 | 0 | 2,919 | 66,939 | 50,548 | 0 | 0 | 2/2 |
| `atr_only` | 110,356 | 14.832796 | 0 | 3,023 | 61,754 | 45,579 | 0 | 0 | 2/2 |
| `engine_sar_vs_legacy` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `engine_ichimoku_vs_legacy` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `engine_price_overlay_zorder` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `sar_only` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `ichimoku_only` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `mfi_only` | 118,742 | 15.959946 | 0 | 3,495 | 65,456 | 49,791 | 0 | 0 | 2/2 |
| `cci_only` | 119,201 | 16.02164 | 0 | 2,920 | 66,322 | 49,959 | 0 | 0 | 2/2 |
| `williams_r_only` | 119,264 | 16.030108 | 0 | 2,919 | 66,124 | 50,221 | 0 | 0 | 2/2 |
| `engine_mfi_vs_legacy` | 118,742 | 15.959946 | 0 | 3,495 | 65,456 | 49,791 | 0 | 0 | 2/2 |
| `engine_cci_vs_legacy` | 119,201 | 16.02164 | 0 | 2,920 | 66,322 | 49,959 | 0 | 0 | 2/2 |
| `engine_williams_r_vs_legacy` | 119,264 | 16.030108 | 0 | 2,919 | 66,124 | 50,221 | 0 | 0 | 2/2 |
| `engine_three_bands_stacked` | 163,656 | 21.996774 | 0 | 3,364 | 74,688 | 85,604 | 0 | 0 | 2/2 |
| `adx_only` | 122,296 | 16.437634 | 0 | 2,945 | 68,422 | 50,929 | 0 | 0 | 2/2 |
| `obv_only` | 137,052 | 18.420968 | 0 | 19,405 | 70,192 | 45,787 | 1,668 | 0 | 2/2 |
| `donchian_only` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| `engine_adx_vs_legacy` | 122,296 | 16.437634 | 0 | 2,945 | 68,422 | 50,929 | 0 | 0 | 2/2 |
| `engine_obv_vs_legacy` | 137,052 | 18.420968 | 0 | 19,405 | 70,192 | 45,787 | 1,668 | 0 | 2/2 |
| `engine_donchian_vs_legacy` | 1,200 | 0.16129 | 0 | 0 | 1,200 | — | 0 | 0 | 2/2 |
| **46 cases, summed** | **3,545,792** | | | | | | | | |

### 🔴 TWO THINGS ARE NOT WHAT §3 PREDICTED, AND BOTH ARE THE SUB-CHOICES

§3 measured the CUTOVER ALONE. The owner then took two sub-choices, and §2.1/§2.2
priced each of them against §3's build on six cases. **The applied build is all
three together, and two of its numbers do not follow from adding them up.** Both
were isolated by a THIRD build — the cutover with BOTH sub-choices reverted,
build **f5f9219fcece** — measured against the applied build:

| case | the two sub-choices, isolated | price_plot | mid_panes | osc_strip | time_axis |
|---|---:|---:|---:|---:|---:|
| `bb_only` | 1,200 | 0 | 1,200 | — | 0 |
| `rsi_only` | 2,772 | 0 | 2,400 | 372 | 0 |
| `macd_only` | 2,540 | 0 | 2,400 | 140 | 0 |
| `bb_rsi_macd` | 4,112 | 0 | 2,400 | 1,712 | 0 |
| `atr_only` | 2,629 | 0 | 2,400 | 229 | 0 |
| `adx_only` | 2,592 | 0 | 2,400 | 192 | 0 |
| `engine_three_bands_stacked` | 5,316 | 0 | 2,400 | 2,916 | 0 |
| ⚠️ `obv_only` | **82,498** | **17,109** | **58,707** | 5,014 | **1,668** |

**(1) ⛔ THE CUTOVER IS NO LONGER FREE ON A CHART WITH NO OSCILLATOR.** §3's
headline was *"19 of 46 cases read 0 — the cutover is exactly, provably free on a
chart with no oscillator."* **Those nineteen now read 1,200 px each.** Nothing
about the panes changed: the SEPARATOR TOKEN restyles the divider between the
price pane and the volume pane, and every chart has one of those. §2.1 said so in
as many words — *"it restyles a separator that already exists… that is a pixel the
cutover did not have to touch, and it is why this row is its own decision"* — and
its own `bb_only` row is exactly 1,200. So the number was priced and accepted; the
sentence that has to be withdrawn is §3's "provably free", not the decision.

**(2) 🔴 §2.2's "EVERY PIXEL INSIDE `osc_strip`" IS FALSE ON `obv`, AND `obv` IS
THE ONE INDICATOR THAT COULD FALSIFY IT.** §2.2 measured the per-pane axis on six
cases — `bb`, `rsi`, `macd`, `bb_rsi_macd`, `atr`, `three_bands` — and every one
of them put 100 % of the cost inside `osc_strip`. **None of the six was OBV.**
On-balance volume is the only shipped indicator whose values run to hundreds of
millions, and lightweight-charts 5.2.0 aligns EVERY pane to ONE shared price-axis
column. Give the OBV pane a visible axis and its labels — the widest on the chart
— widen that shared column, the plot area narrows, and the candles, the volume
pane and the time axis all re-fit:

* `obv_only` costs **137,052 px** against §3's prediction of 110,233;
* **`time_axis` reads 1,668**, and §3's headline claim was that `time_axis` and
  `export_header` read 0 on every one of the 46 cases. That is still true for 45.
* the two sub-choices alone cost **82,498 px on `obv_only`** against 2,540 – 5,316
  on every other case measured — a factor of 30.

⚠️ **IT IS SHIPPED AS THE OWNER ANSWERED IT, AND IT IS FLAGGED HERE RATHER THAN
DECIDED AGAIN.** The answer to 2.2 was YES; what the owner was shown was "372 px,
every pixel inside `osc_strip`", which is true of the six cases it was measured on
and not of OBV. The remedy is cheap and is NOT §2.2's "axis only on unfixed
scales" (OBV autoscales, so it would still get one): it is a per-pane axis
`minimumWidth`, or an abbreviated formatter on the OBV definition so its labels
are no wider than the price's. Neither is in this change.

## 8. Reproducing this

```bash
# A — what ships (PANE_MODE = 'bands'), built from the committed tree
cd app && npm run build && cd .. && cp -r app/dist .parity-dist-mb

# B — the cutover, ONE edit
python tools/flipc_variant_patch.py --apply panes
cd app && npm run build && cd .. && cp -r app/dist .parity-dist-p
python tools/flipc_variant_patch.py --revert          # git checkout + sha256

python tools/spa_server.py .parity-dist-mb 5952
python tools/spa_server.py .parity-dist-p  5953

python tools/gen_parity_regions.py --bands http://127.0.0.1:5952 \
                                   --panes http://127.0.0.1:5953 --write
python tools/chart_parity.py --base-a http://127.0.0.1:5952 --base-b http://127.0.0.1:5953 \
    --dist-a .parity-dist-mb --dist-b .parity-dist-p \
    --instances-side none --repeat 5 --out tools/chart_parity_out_cut
python tools/flipc_record_tables.py --cutover tools/chart_parity_out_cut/report.json \
    --sub 2.1=... --sub 2.2=... --sub 2.3=... --write
```

⚠️ **Fresh ports, every time** — a stale `spa_server` listener produced a clean,
plausible, fictional `0 px, 20/20, exit 0` on this branch once already, and
`--dist-a`/`--dist-b` (served == disk, byte-verified) is what closes it.
