# Decision: Flip C — the oscillator bands become real LWC panes

**Decision id:** `FLIP_C_PANE_GEOMETRY`
**Status:** 🟡 **OPEN — MEASURED 2026-08-05, AWAITING THE OWNER.** `PANE_MODE` stays `'bands'`; nothing here is applied.
**Owner of the read:** `app/src/components/chart/engine/paneLayout.js` → `PANE_MODE` / `paneMode()`,
and `computePaneMargins` in `app/src/components/chart/paneMargins.js` (consumed, not modified).
**Adjudication row:** `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §11.
**Raised by:** Phase B5's plan, as the ONE task of thirteen that may move a pixel.
**Measured by:** B5 Task 11, 2026-08-05. **Applied by:** Task 12, in its own commit, after the owner answers.
**Pinned by:** `app/src/components/chart/engine/__tests__/flipCRecord.test.js` — it reads this file and
fails if a live parity case is unpriced, if an unfilled placeholder survives (the test spells the
token out; this line deliberately does not, so the rail cannot be satisfied by its own description),
if fewer than two build identities are named, if any of §2's three rows is unpriced, or if this
Status line stops saying OPEN.

> ⛔ **THREE SUB-CHOICES, THREE ANSWERS.** §2 is a table and not a paragraph because
> an owner can accept any subset. A single "looks good" over the whole change is
> exactly the shape this record exists to refuse.
>
> 🔴 **READ §6 FIRST.** Measuring the cutover found that it **does not render at
> all** in its Task-10 form. Every number below was measured against a build
> carrying the minimal correction in §6, and that correction is Task 12's to land
> — it is not in the tree and this task applied nothing.

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

### What it actually moves, measured rather than predicted

The plan expected three things to move (a separator row, a price axis, the pane
heights) and expected pane 0 to hold still. **Two of those four expectations are
wrong on the chart this app actually ships**, and the reason is one number:

> `firstPaneIndex` — the LWC pane index the oscillator stack starts at. It is
> `1 + (separate volume pane ? 1 : 0) + (Model Book index pane ? 1 : 0)`.
> **It is 2, not 1, on every chart a user looks at** — and the §A6 identity that
> makes the price pane hold still was proved for 1.

⚠️ **`CHART_DEFAULTS.volume.separatePane` is `false`, and that is not the answer.**
`volInSeparatePane = volumeSeparatePane || cs.volume?.separatePane`, and the
`volumeSeparatePane` **prop** is passed unconditionally by every surface that
draws a chart: `charts/widgets/ChartWidget.jsx`, `charts/grid/GridChartCell.jsx`,
`IntradayDayPopover.jsx`, `modelbook/BottomsView.jsx` — and `pages/ChartRender.jsx`,
which is the parity route itself. So **`firstPaneIndex === 1` is not a
configuration this app renders**, and it is not one the parity gate can reach: the
harness cannot turn the prop off through `?indicators=`, so no parity case has ever
exercised the case the identity was proved for. (Confirmed by measurement:
overriding `volume.separatePane` to `false` on both sides changes nothing — the
pane counts stay 2 and 3 and the diff stays at the same 144,285 px.)

With `firstPaneIndex = 2` the cutover **reorders the chart**. Today an oscillator
band lives at the bottom of pane 0, i.e. **above** the volume pane; after the flip
it is a pane **below** volume. Nothing in the plan says so, and the pane manifest
says it in one line — `rsi_only`, the two builds side by side:

| | pane 0 | pane 1 | pane 2 |
|---|---|---|---|
| **bands (today)** | 414 px — candles **+ the RSI band** | 117 px — volume | — |
| **panes (the cutover)** | 353 px — candles | 99 px — volume | 78 px — **RSI** |

So three things move that the plan did not name: the oscillator and the volume
pane **swap places**, the volume pane **shrinks** (117 → 99 px, because
`paneStretchPlan` re-splits a smaller budget in the same 78/22 proportion), and
the candles are re-fitted into a shorter pane 0.

⚠️ **This is arguably the cutover doing the RIGHT thing.** In band mode with
volume as a *band* (`separatePane: false`), `computePaneMargins` already puts
volume directly under the price area with the oscillators below it. The shipped
separate-pane path is the odd one out, and Flip C makes the two agree. But it is a
visible reordering of every chart a user has open, and it is not what "the bands
become panes" sounds like.

### ⛔ The price pane does NOT read absolute 0

Pane 0 — candles, MAs, all five price overlays, volume, the right axis — was
designed to be untouched, by arithmetic rather than allowance: pane 0's margins
re-expressed as fractions of pane 0's own height, and the separator budget taken
from the OSCILLATORS. **The region gate says it does not hold.** `price_plot` is
non-zero on every case that grows a pane, and the mechanism is in §6 (D3): the
re-expression divides by the price-pane **budget** (pane 0 *plus* the volume pane
*plus* any index pane) and is then applied to pane 0's own scale, whose height is
only pane 0's share of that budget. The two are the same number **only when
`firstPaneIndex === 1`**.

### And it moves the TIME AXIS, which nobody predicted either

The first measurement put **35,471 changed pixels into `rest`** on `rsi_only`
alone — every one of them in `y[532,572)` across the full width, i.e. the time
axis. `rest` is every changed pixel outside every declared rectangle, computed by
mask subtraction and never declarable, and its expectation is 0: **a pixel nobody
named is exactly what it exists to catch.** So it was found, and it is named.

The chain is: the cutover re-fits the candles into a shorter pane 0 → the visible
price range changes → the price axis' tick labels change width → the plot area's
left edge moves → **every time-axis label moves with it**. That is also why the
whole-canvas numbers in §3 are large: the diff's bounding box on `rsi_only` is
`(0, 66) → (1200, 572)`, i.e. essentially the entire chart, because a horizontal
shift of the plot area moves every bar.

Each case therefore declares **three** rectangles which TILE the export —
`price_plot`, `osc_strip`, `time_axis` — and `rest` reads **0 on every case**,
with nowhere left to hide a pixel. That is the shape `rsi_only` already shipped
with before Task 11 touched it.

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
*A = the cutover with LWC's default separator — build **1438fd9d001f**; B = the chart's own separator token — build **f923bc3b160c**; 8 run(s) per case; served == disk verified on both.*

| case | changed px | % | price_plot | osc_strip | time_axis | rest | distribution |
|---|---:|---:|---:|---:|---:|---:|---|
| `bb_only` | 1,200 | 0.16129 | 1,200 | — | 0 | 0 | 8/8 |
| `rsi_only` | 2,400 | 0.322581 | 1,200 | 1,200 | 0 | 0 | 8/8 |
| `macd_only` | 2,400 | 0.322581 | 1,200 | 1,200 | 0 | 0 | 8/8 |
| `bb_rsi_macd` | 3,600 | 0.483871 | 1,200 | 2,400 | 0 | 0 | 8/8 |
| `atr_only` | 2,400 | 0.322581 | 1,200 | 1,200 | 0 | 0 | 8/8 |
| `engine_three_bands_stacked` | 4,800 | 0.645161 | 1,200 | 3,600 | 0 | 0 | 8/8 |
<!-- END:sub-2.1 -->

**What the number is.** One 1,200-px row per separator, and nothing else on the
canvas moves: `price_plot` and `osc_strip` each take exactly 1,200 on a three-pane
case because one separator falls in each. `rest` is 0. The cost scales with pane
count and nothing else, and it is perfectly reversible.

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
*A = the cutover's overlay scale (no axis labels) — build **1438fd9d001f**; B = a visible per-pane right axis — build **3e1f3e3b903b**; 8 run(s) per case; served == disk verified on both.*

| case | changed px | % | price_plot | osc_strip | time_axis | rest | distribution |
|---|---:|---:|---:|---:|---:|---:|---|
| `bb_only` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 |
| `rsi_only` | 372 | 0.05 | 0 | 191 | 181 | 0 | 8/8 |
| `macd_only` | 280 | 0.037634 | 0 | 136 | 144 | 0 | 8/8 |
| `bb_rsi_macd` | 759 | 0.102016 | 0 | 613 | 146 | 0 | 8/8 |
| `atr_only` | 229 | 0.03078 | 0 | 113 | 116 | 0 | 8/8 |
| `engine_three_bands_stacked` | 1,465 | 0.196909 | 0 | 1,264 | 201 | 0 | 8/8 |
<!-- END:sub-2.2 -->

**What the number is.** Small, and the size is misleading in both directions. It
is small because the axis GUTTER already exists — the price axis is there, pinned
to a stable minimum width, and the oscillator's numbers are drawn into the column
that is already reserved. So the cost is ink, not layout: no candle moves,
`price_plot` reads **0** on every case. It is not small in what it means — every
oscillator pane gains a live numeric ladder a user will read values off, and
`manifest_geometry` records the `scaleId` moving from the definition's own overlay
scale to `right` on every migrated series.

**Recommendation: THE OWNER'S CALL, WITH THE NUMBER IN FRONT OF THEM.** TradingView
shows it and spec §6's "pane grammar" implies it; against that, an RSI whose scale
is pinned 0–100 gains little from a ladder that always reads the same three
numbers, while an ATR or an OBV — which autoscale — gain a lot. A third option
exists and is cheap to add later: **axis only on panes whose scale is not fixed**.
It is not priced here because it is not implemented; if the owner wants it, it is a
one-line change to `placement.js`'s `'panes'` branch and its own measurement.

### 2.3 — the pane heights · **191,584 px on `rsi_only` — 25.8 % of the canvas**

<!-- BEGIN:sub-2.3 -->
*A = today's band heights, preserved — build **1438fd9d001f**; B = LWC's own stretch defaults (equal panes) — build **d27ba52c432a**; 8 run(s) per case; served == disk verified on both.*

| case | changed px | % | price_plot | osc_strip | time_axis | rest | distribution |
|---|---:|---:|---:|---:|---:|---:|---|
| `bb_only` | 131,766 | 17.710484 | 130,515 | — | 1,251 | 0 | 8/8 |
| `rsi_only` | 191,584 | 25.750538 | 147,216 | 40,444 | 3,924 | 0 | 8/8 |
| `macd_only` | 195,078 | 26.220161 | 145,467 | 45,698 | 3,913 | 0 | 8/8 |
| `bb_rsi_macd` | 184,849 | 24.845296 | 120,689 | 60,230 | 3,930 | 0 | 8/8 |
| `atr_only` | 192,719 | 25.903091 | 149,777 | 38,956 | 3,986 | 0 | 8/8 |
| `engine_three_bands_stacked` | 156,900 | 21.08871 | 86,822 | 66,315 | 3,763 | 0 | 8/8 |
<!-- END:sub-2.3 -->

**What the number is.** LWC's default stretch factor is `1`
(`lightweight-charts.standalone.development.js:5225`), so a chart that never calls
`setStretchFactor` has **equal panes**: on `rsi_only` the candles fall from 353 px
to about a third of the stack and the RSI grows from 78 px to the same. A quarter
of the canvas changes, `price_plot` takes the overwhelming majority of it
(147,216 of 191,584), and the pane manifest moves on six lines.

**Recommendation: PRESERVE THE HEIGHTS.** This is the only one of the three where
the alternative is plainly worse: a returning user's layout stops being
recognisable, a single RSI takes a third of the chart, and the `baseH` values
encode a deliberate look (`macd` 0.17 > `rsi` 0.15 > `atr`/`obv` 0.13) that equal
panes throws away. The heights are already preserved by `computePaneLayout` and
the code to do it already exists; adopting LWC's defaults would be a deletion that
costs 25 % of the picture.

## 3. The measurement

<!-- BEGIN:cutover-table -->
*A = `PANE_MODE = 'bands'` (HEAD) — build **cc1f66936413**; B = the cutover — build **1438fd9d001f**; 8 run(s) per case; served == disk verified on both.*

| case | changed px | % | price_plot | osc_strip | time_axis | rest | distribution | manifest geometry |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| `bb_only` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `rsi_only` | 141,243 | 18.984274 | 49,429 | 56,343 | 35,471 | 0 | 8/8 | 6 line(s) |
| `macd_only` | 150,283 | 20.199328 | 50,369 | 64,499 | 35,415 | 0 | 8/8 | 8 line(s) |
| `macd_headmask` | 150,283 | 20.199328 | 50,369 | 64,499 | 35,415 | 0 | 8/8 | 8 line(s) |
| `bb_rsi_macd` | 159,921 | 21.494758 | 40,140 | 84,354 | 35,427 | 0 | 8/8 | 13 line(s) |
| `engine_rsi_vs_legacy` | 141,243 | 18.984274 | 49,429 | 56,343 | 35,471 | 0 | 8/8 | 6 line(s) |
| `engine_rsi_toggle_off` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 0 line(s) |
| `engine_bb_vs_legacy` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `engine_bb_over_overlays` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `engine_bb_rsi_vs_legacy` | 151,169 | 20.318414 | 58,519 | 57,179 | 35,471 | 0 | 8/8 | 7 line(s) |
| `engine_macd_vs_legacy` | 150,283 | 20.199328 | 50,369 | 64,499 | 35,415 | 0 | 8/8 | 8 line(s) |
| `engine_bb_rsi_macd_vs_legacy` | 159,921 | 21.494758 | 40,140 | 84,354 | 35,427 | 0 | 8/8 | 13 line(s) |
| `flipb_rsi_only` | 141,243 | 18.984274 | 49,429 | 56,343 | 35,471 | 0 | 8/8 | 6 line(s) |
| `flipb_bb_only` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `flipb_bb_rsi_macd` | 159,921 | 21.494758 | 40,140 | 84,354 | 35,427 | 0 | 8/8 | 13 line(s) |
| `flipb_macd_only` | 150,283 | 20.199328 | 50,369 | 64,499 | 35,415 | 0 | 8/8 | 8 line(s) |
| `flipb_vwap_only` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `flipb_vwap_dimmed` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `flipb_all_four` | 158,810 | 21.34543 | 48,848 | 91,753 | 18,209 | 0 | 8/8 | 15 line(s) |
| `intraday_bars_only` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 0 line(s) |
| `vwap_only` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `engine_vwap_vs_legacy` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `engine_vwap_dimmed_vs_legacy` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `engine_vwap_dashed_vs_legacy` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `engine_stoch_vs_legacy` | 140,912 | 18.939785 | 50,251 | 55,602 | 35,059 | 0 | 8/8 | 7 line(s) |
| `engine_atr_vs_legacy` | 130,131 | 17.490726 | 48,047 | 46,616 | 35,468 | 0 | 8/8 | 6 line(s) |
| `stoch_only` | 143,945 | 19.347446 | 52,448 | 56,438 | 35,059 | 0 | 8/8 | 7 line(s) |
| `atr_only` | 130,131 | 17.490726 | 48,047 | 46,616 | 35,468 | 0 | 8/8 | 6 line(s) |
| `engine_sar_vs_legacy` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `engine_ichimoku_vs_legacy` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `engine_price_overlay_zorder` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `sar_only` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `ichimoku_only` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `mfi_only` | 140,673 | 18.907661 | 49,249 | 55,909 | 35,515 | 0 | 8/8 | 6 line(s) |
| `cci_only` | 141,428 | 19.00914 | 49,498 | 56,162 | 35,768 | 0 | 8/8 | 6 line(s) |
| `williams_r_only` | 140,684 | 18.90914 | 49,420 | 55,892 | 35,372 | 0 | 8/8 | 6 line(s) |
| `engine_mfi_vs_legacy` | 140,673 | 18.907661 | 49,249 | 55,909 | 35,515 | 0 | 8/8 | 6 line(s) |
| `engine_cci_vs_legacy` | 141,428 | 19.00914 | 49,498 | 56,162 | 35,768 | 0 | 8/8 | 6 line(s) |
| `engine_williams_r_vs_legacy` | 140,684 | 18.90914 | 49,420 | 55,892 | 35,372 | 0 | 8/8 | 6 line(s) |
| `engine_three_bands_stacked` | 156,085 | 20.979167 | 27,786 | 92,927 | 35,372 | 0 | 8/8 | 10 line(s) |
| `adx_only` | 146,590 | 19.702957 | 53,492×2 · 53,506×6 | 56,990 | 36,094 | 0 | 146576×2 · 146590×6 | 8 line(s) |
| `obv_only` | 132,874 | 17.859409 | 50,233 | 47,186 | 35,455 | 0 | 8/8 | 6 line(s) |
| `donchian_only` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| `engine_adx_vs_legacy` | 146,590 | 19.702957 | 53,492×1 · 53,506×7 | 56,990 | 36,094 | 0 | 146576×1 · 146590×7 | 8 line(s) |
| `engine_obv_vs_legacy` | 129,787 | 17.444489 | 48,031 | 46,301 | 35,455 | 0 | 8/8 | 6 line(s) |
| `engine_donchian_vs_legacy` | 0 | 0.0 | 0 | — | 0 | 0 | 8/8 | 2 line(s) |
| **46 cases, summed** | **3,624,038** | | | | | | | |

⚠️ **NOT A SINGLE VALUE, and therefore NOT MEASURED:** `adx_only`, `engine_adx_vs_legacy`
<!-- END:cutover-table -->

### 🔑 What the table says in one line

**19 of 46 cases read 0** — every case that creates no oscillator pane (`bb`,
`vwap`, `sar`, `ichimoku`, `donchian`, the price-overlay z-order case, the
intraday bars case, and `engine_rsi_toggle_off`, whose RSI is off). **The cutover
is exactly, provably free on a chart with no oscillator.** The other 25 measured
cases run **129,787 – 159,921 px**, i.e. 17.4 – 21.5 % of the export, and the
44 single-valued cases sum to **3,624,038 px**.

⚠️ **AND IT MOVES THE MANIFEST EVEN WHERE IT MOVES NO PIXELS.** Every zero-pixel
case still reports **2 lines of manifest geometry**, because pane 0's
`stretchFactor` changes from `78` — a PERCENTAGE, which is what
`StockChart`'s volume-pane block writes — to `414`, a PIXEL COUNT, which is what
`paneStretchPlan` writes. The picture is identical; the units the layout is
expressed in are not. That is not cosmetic: it is precisely why the height
contract is brittle (§6 D2), and it is why the harness's own
"manifest moved, pixels did not" rule fires on 19 cases that are otherwise
perfect. Task 12 has to decide whether those 19 declare
`expectManifestChange` or whether the units are reconciled.

### How the rectangles were derived

⛔ **Not by eye.** `tools/gen_parity_regions.py` regenerates every box in
`tools/chart_parity_cases.json` from the **pane manifest of both builds** —
`window.__paneManifest`, which `paneLayout.paneManifest` builds by reading the
renderer back — and each case records its derivation inline in `_regionsFrom`
(both build ids, the pane-stack height, the separator height, both sides' per-pane
pixel heights). The boundary is `Σ heights of the panes that existed BEFORE the
cutover + their separators`; the panes the cutover adds are appended after them,
so "the panes side B has that side A does not" *is* the oscillator stack.

* `price_plot` — everything above the stack: candles, MA and price overlays, the
  volume pane, the price axis. **The rectangle the design claims reads 0.**
* `osc_strip` — the oscillator stack the cutover creates. Absent on a case whose
  two sides have the same pane count; a zero-area box is refused by
  `validate_regions`, because it reads exactly like one holding the line.
* `time_axis` — everything below the pane stack: the time axis and the export
  footer. **Added because the measurement demanded it** (§1) — not planned.
* `rest` — **not declared, computed by mask subtraction**. The three rectangles
  tile the export, so it reads 0 on every case and has nowhere to hide a pixel.

**The rectangles discriminate, in both directions**, re-proved on the panes build
where the split is the one that matters: `candles.upColor` moved one hex digit →
`{price_plot: 1,910, osc_strip: 0, rest: 0}`; `indicators.rsi.color` moved one hex
digit → `{price_plot: 0, osc_strip: 657, rest: 348}`. A per-region 0 means nothing
without that. *(The 348 is the export FOOTER's own legend ink — a colour change
lands below the pane stack as well as inside it. `rest` is 0 for a geometry change
and need not be for a colour one.)*

### ⚠️ The 24-pixel artefact, and why 13 cases carry `?priceline=0`

The first full 8-run pass produced **13 of 46 cases with a two-valued
distribution** — the same number six times and a number 14 lower twice, say. A
case that is not a single value is not measured, so it was diagnosed rather than
averaged, and the diagnosis is unambiguous and identical on all 13:

* **side A hashed IDENTICAL on all 8 runs** in every one of the 13. The
  instability is entirely on the cutover side.
* side B rasterised into exactly **two** states, and the whole difference between
  them is **24 changed pixels on ONE scanline**, spanning the plot width
  (`x ∈ [13, 982]`) — `y = 244` on a `0.15`-height oscillator pane, `y = 247` on a
  `0.13`-height one (`atr`, `obv`).

That is byte-for-byte the artefact `pages/ChartRender.jsx` already documents and
already suppresses on `engine_rsi_toggle_off`: **the dashed last-price line**,
which Chromium rasterises two ways at ~12 dash boundaries at one specific
geometry. The line is drawn by the CANDLE series, so it belongs to no indicator
migration and no case measures it. **The cutover did not create the artefact — it
moved pane 0's height, which moved that line onto the unstable row**, and 13
cases went bistable at once.

The remedy is the one already in the repo: `"priceLine": false` ⇒ `?priceline=0`,
applied to **exactly the 13 cases where the bistability was OBSERVED**, each with
its own `_priceLineReason` recording the measurement. ⛔ **It is not a tolerance:
those cases must still read a SINGLE value on every run, and 0 under `'bands'`.**
Cases with the same pane geometry that did not flake in those 8 runs are
**latently at risk and were deliberately left alone** — a suppression applied
where it was not measured to be needed is an unearned allowance.

🔴 **And the latency is not theoretical: the `--same-build` determinism run on the
cutover dist then surfaced two more** — `stoch_only` and `engine_adx_vs_legacy`,
each at **exactly 24 px**, same signature, on a run where *nothing* differs
between the two captures but the render itself. They are **named here and NOT
suppressed**, because their A-vs-B numbers in §3 were measured without the
suppression and adding it would change them. **Task 12 must extend the list to at
least these two**, and should assume the whole single-oscillator-pane geometry
class is affected rather than chase the observed members one run at a time. Fifteen
cases have now been observed bistable under `'panes'`; **zero have ever been
observed bistable under `'bands'`.**

### The builds

| | what it is | build id | `index-*.js` | renders? |
|---|---|---|---|---|
| **A** | HEAD (`5ef4f4c6`), `PANE_MODE = 'bands'` — **what ships** | **`cc1f66936413`** | `index-HoxzvFJo.js` | yes |
| **B0** | A + `PANE_MODE = 'panes'`, **nothing else** | **`4c01f5ad3350`** | `index-CDBTL4ix.js` | 🔴 **no — see §6 D1** |
| **B1** | B0 + the D1 correction | **`8ecc6f2e3fd1`** | `index-CXcGSRV3.js` | ⚠️ **~20 % of cold loads blank — §6 D2** |
| **B** | B1 + the height assertion downgraded — **the build every number above was measured against** | **`1438fd9d001f`** | *(see `.parity-dist-bn`)* | yes |
| **C** | B + the chart's own separator token (2.1) | **`c82a5f8e232d`** | `index-BpSOVBJN.js` | yes |
| **D** | B + `scaleId: 'right'` (2.2) | **`3e1f3e3b903b`** | `index-BsAGn0mk.js` | yes |
| **E** | B + LWC's default stretch factors (2.3) | **`d27ba52c432a`** | `index-BhK30cwc.js` | yes |

Every variant is one named edit list in `tools/flipc_variant_patch.py`, applied to
a scratch tree, built, and reverted with a line-ending-normalised sha256 check.
**Nothing in that file is committed into `app/src`.**

### Trust in the numbers

<!-- BEGIN:trust -->
| run | cases | runs/case | every capture `shots=2/2` | every capture `stable` | cases at a single value | 95% flake bound |
|---|---:|---:|---|---|---:|---:|
| the cutover | 46 | 8 | yes | yes | 44/46 | 31.2% |
| sub-choice 2.1 | 6 | 8 | yes | yes | 6/6 | 31.2% |
| sub-choice 2.2 | 6 | 8 | yes | yes | 6/6 | 31.2% |
| sub-choice 2.3 | 6 | 8 | yes | yes | 6/6 | 31.2% |
| determinism: the BANDS dist vs itself | 46 | 3 | yes | yes | 46/46 | 63.2% |
| determinism: the PANES dist vs itself | 46 | 3 | yes | yes | 44/46 | 63.2% |
<!-- END:trust -->

## 4. What goes red when it is applied

| test / gate | why it moves |
|---|---|
| **162 tests across 13 files** (4,376 still pass) | measured at Task 10 by flipping the constant tree-wide. **Most are the DOUBLES, not the product** — the suites' chart stubs answer `panes()` with one fixed-height pane, so the binder's height check throws BY NAME exactly as designed. The remedy is the opt-in `H.paneModel` pattern `stockChartWiring.test.jsx` already uses |
| the parity gate's per-case **exact** expectations | `expect` replaces `<=`, so every case that moves must have its new number written down — and a regression SMALLER than the old allowance fails too. §3's table is that list |
| `rsi_only`'s three region `expect: 0`s | the only case whose regions are GATED today. Task 11 replaced its three band-era rectangles with the two derived ones and kept the 0; Task 12 replaces the 0s with §3's numbers |
| the **pane manifest** JSON diff | pane count and per-series pane index change by definition. ⭐ A change that moves pixels but not the manifest, or the manifest but not the pixels, is a regression BY DEFINITION: one of the two is lying |
| the **region gate**'s `price_plot` row | it does **not** read 0 — §6 D3. Task 12 either lands the D3 fix or writes `price_plot`'s measured number down and signs it off |
| `paneMargins`-derived suites | `PANE_MODE` selects a different projection |
| `test_a_case_that_declares_NOTHING_still_collapses_on_its_tolerance` | asserts ≥ 24 cases declare nothing at all. It is the backwards-compatibility rail for "zero survives twelve of thirteen tasks", and Task 12's per-case `expect`s are what finally retire it. **Task 11 deliberately did not** — that is why only `rsi_only` carries a region `expect` |

### The screenshots

`docs/decisions/assets/2026-08-04-flip-c/` — twelve stacked A-above-B PNGs,
captured through `chart_parity.capture` (the same settle the measured frames got)
by `tools/flipc_screenshots.py`, each labelled with its side and its build id:

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

*(EMPTY — Task 11 brings §2's three rows to the owner with §3's numbers and the
screenshots in `docs/decisions/assets/2026-08-04-flip-c/`, and records the answer
here, PER SUB-CHOICE. "Looks great" is not an answer to three questions.)*

| sub-choice | answer | date |
|---|---|---|
| 2.1 separator colour | *(pending)* | |
| 2.2 per-pane price axis | *(pending)* | |
| 2.3 pane heights | *(pending)* | |

## 6. 🔴 What measuring it found: the cutover does not render

Three defects, in the order they surface. **None is fixed in the tree. All three
are Task 12's to land, in its own commit, before any of §3's numbers can be a
gate rather than a price.**

### D1 — the separator budget ignores the panes above the stack · **deterministic blank chart**

`PANE_MODE = 'panes'` on its own throws

```
paneLayout: panes 0-1 total is 451px, expected 452px
```

into StockChart's ErrorBoundary. `__chartReady` never becomes true and the parity
harness times out at 60 s on **every one of the 46 cases**.

`computePaneLayout` treats `chartHeight` — the pane stack *including* its
separators, which is what `paneStackHeightPx` returns — as the pane-height budget,
and then removes only `oscCount × separatorPx` from it. Available height is
`chartHeight − (firstPaneIndex − 1 + oscCount) × separatorPx`, so the layout
over-allocates by exactly **`firstPaneIndex − 1`** pixels. That is 0 when the stack
starts at pane 1 — the case Task 3's 1,966,080-layout totality proof covers — and
1 on every chart with a separate volume pane — which, per §1, is every chart this
app draws. `pane0Only` (a chart with **no** oscillator at all) has the same
arithmetic with no oscillator to shave it off, so a price-overlay-only chart
throws too. **There is no configuration in which Flip C, as it stands, renders.**

The minimal correction, verbatim, is `tools/flipc_variant_patch.py`'s `FIX_STACK`
and `FIX_PANE0_ONLY`: charge the pre-existing separators to the oscillator stack's
own shave, and to the price-pane budget when there is no stack. Both are no-ops at
`firstPaneIndex === 1`, so **Task 3's proof is untouched**.

### D2 — the height assertion throws on a transient · **~20 % of cold loads blank, non-deterministically**

With D1 corrected, build B1 still reaches the ErrorBoundary with

```
paneLayout: pane 2 is 77px, expected 78px
```

on **3 of 14** cold loads, then **1 of 8** on a re-measure. No page error, no
pattern — `__chartReady` simply never fires and the capture times out.

**It is the assertion, not the geometry.** Same build with the throw removed:
**15 of 15 cold loads produced the identical manifest, `[chartHeight 532; panes
353, 99, 78]`, and 0 unready.** `paneHeightMismatch` verifies the PREVIOUS pass's
layout at the top of the next sync — which is correct about rAF staleness, and
still lands mid-flight when something else re-lays the chart out between the two
(the price-axis width ratchet re-measures, the time axis re-optimises, and
`totalPaneHeight` moves by a pixel). LWC is free to make that re-layout; the code
treats an exact pixel identity as an invariant across it, and pays for a
disagreement with the whole chart.

⚠️ **This is the third rAF-blindness incident on this branch**, after Task 3's
separator pin and Task 10's options-effect ordering. The fix is a design question
Task 12 owns, not a number: converge (re-apply and re-check) rather than throw, or
report through `chart_health_alerts` instead of the ErrorBoundary. **A blank chart
is a worse failure than a one-pixel drift.**

### D3 — the §A6 pane-0 identity holds only at `firstPaneIndex === 1` · **`price_plot` ≠ 0**

`computePaneLayout` returns `pane0.mainMargins` as fractions of `pane0.heightPx`,
and `pane0.heightPx` is the **price-pane BUDGET** — everything above the
oscillator stack, i.e. pane 0 *plus* the volume pane *plus* any index pane. Those
margins are then applied to the candles' own price scale, which lives in pane 0
alone. With `firstPaneIndex === 1` the two are the same number and the identity is
exact. With the shipped preset they differ by the volume pane's whole height, so
the candle rectangle is re-fitted and `price_plot` is non-zero by construction.

This one is **not corrected in any measured build**, deliberately: correcting it
would change what the cutover looks like, and that is a decision, not a fix. The
`price_plot` column in §3 is therefore the honest price of the cutover *as
designed*, and Task 12's choice is to land a D3 fix and re-measure, or to write
`price_plot`'s number down and have it signed off.

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

* **every open chart is reordered** — the oscillators move below the volume pane
  and the volume pane shrinks. §3's `price_plot` column is what that costs.
* **the price pane is no longer pixel-identical** (D3), so "nothing about the
  candles changed" stops being true until D3 is fixed.
* **the height contract is brittle** (D2): the cutover asserts an exact pixel
  identity against a renderer that is free to re-lay-out, and pays for a
  disagreement with a blank chart.
* **`paneMargins.js`'s nine-row `PANES` table is retired**, and with it the one
  place a reader could see the whole stack at once. That is the last B5 row in the
  enumeration ledger and it is assigned to Task 12.

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

## 8. Reproducing this

```bash
python tools/flipc_variant_patch.py --apply panes_fixed_nocheck
cd app && npm run build && cp -r dist ../.parity-dist-bn && cd ..
python tools/flipc_variant_patch.py --revert          # sha256-verified against HEAD

python tools/spa_server.py .parity-dist-a  5941       # A: PANE_MODE = 'bands'
python tools/spa_server.py .parity-dist-bn 5947       # B: the cutover

python tools/gen_parity_regions.py --bands http://127.0.0.1:5941 \
                                   --panes http://127.0.0.1:5947 --write
python tools/chart_parity.py --base-a http://127.0.0.1:5941 --base-b http://127.0.0.1:5947 \
    --dist-a .parity-dist-a --dist-b .parity-dist-bn \
    --instances-side none --repeat 20 --out tools/chart_parity_out_main
python tools/flipc_record_tables.py --cutover tools/chart_parity_out_main/report.json \
    --sub 2.1=... --sub 2.2=... --sub 2.3=... --write
```

⚠️ **Fresh ports, every time** — a stale `spa_server` listener produced a clean,
plausible, fictional `0 px, 20/20, exit 0` on this branch once already, and
`--dist-a`/`--dist-b` (served == disk, byte-verified) is what closes it.
