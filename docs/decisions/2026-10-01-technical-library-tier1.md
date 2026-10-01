# Technical library — Tier 1 (2026-10-01)

**Status:** implemented on `feat/technical-library-t1`, locally accepted, not deployed.

Chart Settings → Indicators → Add Indicator → Technical grows from **21 rows to 54**, and the one
Moving Average from **2 types to 9**. Every new study is an ordinary native definition in
`engine/nativeRegistry.js` over pure maths in `technicalStudies.js` / `movingAverages.js`. No engine,
pane, identity, MTF, persistence or alert architecture changed.

## 1. Duplicate reconciliation (the gate run before any code)

| Proposed | Class | Decision |
|---|---|---|
| WMA, VWMA, HMA, SMMA, DEMA, TEMA, LSMA | B — family extension | Types of the existing Moving Average (`maType`), not rows |
| Bollinger %B, BandWidth | B — Bollinger family | New rows; read the shipped `computeBB` bands exactly |
| ATR % | B — ATR family | New row; reads the shipped Wilder ATR |
| VWAP σ bands | B — Session VWAP | An option (`bands`) on the existing Session VWAP, off by default — **not a row** |
| **Moving VWAP** | **C — duplicate** | **Dropped.** Σ(hlc3·v)/Σv **is** the Moving Average with type VWMA on source HLC3; reachable by the search aliases `moving vwap` / `rolling vwap` |
| Keltner | A | Distinct from ATR Bands (EMA basis, not the close) |
| SuperTrend | A | Distinct from Parabolic SAR and ATR Bands (ATR ratchet + flip) |
| 52-Week High/Low | A (D resolved) | Donchian(252) already draws the high/low **lines**; this study is the **distance** (%) on a calendar window — not a duplicate |
| Up/Down Volume Ratio | A (D resolved) | This symbol's own bars, explicitly not the Breadth tab's market-wide up/down volume |
| All other Tier 1 | A — net new | — |

Result: **33 new rows + 7 MA types + 1 VWAP option**. One proposed row dropped (Moving VWAP).

## 2. Categories

Seven, in this fixed order (`technicalCategories.js`), every Technical row in exactly one:
Trend & Moving Averages (8) · Momentum & Oscillators (16) · Volatility & Bands (12) ·
Volume & Money Flow (12) · VWAP (2) · Relative Strength (3) · Levels & Statistics (1).

Levels & Statistics holds Standard Deviation today; pivots, regression slope and R² arrive in Tier 2.

## 3. Shared conventions

- **Gaps.** A non-finite input inside a window makes that window's output a gap; it never poisons
  later windows. No output is ever ±Infinity.
- **EMA/SMMA seed.** The first full SMA window (TradingView `ta.ema`/`ta.rma`, TA-Lib).
- **ATR.** Wilder, `computeATR`: TR from bar 1, seeded with the mean of TR[1..n] (TA-Lib `ATR`).
- **σ.** Population (÷n) everywhere it is a band or dispersion (Bollinger, %B, BBW, Std Dev,
  Squeeze, VWAP bands). **Sample** (÷(n−1)) only for Historical Volatility (finance convention).
- **Zero denominators.** "No movement" ratios (CMO, TSI, Vortex, Choppiness, %B, Ultimate, U/D
  ratio, RVOL, CMF) are **gaps**. Where a study defines a neutral value it is used: Balance of Power
  0 on a no-range bar, Stochastic RSI 50 on a flat RSI range (the shipped Stochastic's rule), A/D
  adds 0 for a no-range bar.

## 4. Per-study semantics and defaults

| Study | Definition (UCT) | Defaults | First valid bar |
|---|---|---|---|
| MA types | WMA linear 1..n · VWMA Σ(x·v)/Σv over the bar volume (bar-field or instance sources only) · HMA wma(2·wma(n/2)−wma(n), round(√n)) · SMMA Wilder · DEMA 2e1−e2 · TEMA 3e1−3e2+e3 · LSMA least-squares endpoint | inherited from MA | n−1 (DEMA 2n−2, TEMA 3n−3, HMA n+round(√n)−2) |
| SuperTrend | hl2 ± m·ATR; lower band only rises, upper only falls while price stays its side; flips on a close through the active band; first bar starts on the upper band (TradingView); no join at a flip | ATR 10, ×3 | 10 |
| Aroon | window = period+1 bars; most recent extreme on a tie (TA-Lib) | 14 | 14 |
| Vortex | Σ|h−l₋₁| / ΣTR and Σ|l−h₋₁| / ΣTR | 14 | 14 |
| Choppiness | 100·log10(ΣTR / (HH−LL)) / log10(n) | 14; guides 61.8/38.2 | 14 |
| Stochastic RSI | Wilder RSI → position in its n-bar range → %K SMA → %D SMA; source selectable | 14, 14, 3, 3 | 29 |
| PPO | 100·(EMAf−EMAs)/EMAs, signal EMA, histogram | 12, 26, 9 | 25 |
| ROC | 100·(x−x[n])/x[n] | **12** (TC2000/StockCharts; TradingView uses 9) | 12 |
| Momentum | x − x[n] | 10 | 10 |
| TSI | 100·EMA(EMA(Δ,long),short) / EMA(EMA(|Δ|,long),short), signal EMA | 25, 13, 13 | 37 |
| CMO | Chande's **sums**: 100·(ΣUp−ΣDn)/(ΣUp+ΣDn) (TradingView; TA-Lib's Wilder-smoothed variant is **not** used) | **14** | 14 |
| TRIX | ×100 one-bar change of a triple EMA (TA-Lib/StockCharts; not TradingView's log ×10000) | **15**, signal 9 | 43 |
| Awesome Oscillator | SMA(hl2,5) − SMA(hl2,34), coloured rising/falling | 5, 34 | 33 |
| Ultimate Oscillator | Williams: BP = c−min(l,c₋₁), TR = max(h,c₋₁)−min(l,c₋₁); (4A₇+2A₁₄+A₂₈)/7 ×100 | 7, 14, 28 | 28 |
| Balance of Power | (c−o)/(h−l), then SMA (1 = raw) | **14** smoothing | 13 |
| Bull/Bear Power | Elder-ray: h − EMA(c), l − EMA(c), two histograms | 13 | 12 |
| Keltner | EMA(c,20) ± 2·ATR(10) (Raschke / StockCharts / TradingView default) | 20, 2, 10 | 19 |
| MA Envelope | MA(type,n) × (1 ± p/100); follows its source's pane | SMA 20, **2.5%** | 19 |
| Bollinger %B | (c − lower)/(upper − lower) on the shipped bands | 20, 2 | 19 |
| Bollinger BandWidth | 100·(upper − lower)/basis (the formula engine's `bbw`) | 20, 2 | 19 |
| ATR % | 100·ATR/close (TA-Lib NATR) | 14 | 14 |
| ADR % | 100·(SMA(high/low) − 1) — the growth-trader ADR%; per bar of the chart's timeframe | 20 | 19 |
| Historical Volatility | sample σ of ln(c/c₋₁) × √(periods/yr) × 100; periods/yr from the bars' **median spacing** (252 / 52 / 12); D/W/M only | 20 | 20 |
| Squeeze | on = BB(SMA20, 2σ) inside KC(SMA20 ± 1.5·ATR20); histogram = least-squares value of c − ((HH+LL)/2 + SMA)/2. A public BB/KC formulation, named "Squeeze" — no branded variant cloned | 20, 2, 1.5 | 20 (histogram 38) |
| Relative Volume | v / mean volume of the **previous** n bars (current bar excluded) | 50 | 50 |
| Accumulation/Distribution | cumulative CLV·v from the first loaded bar (like OBV) | — | 0 |
| Chaikin Money Flow | ΣCLV·v / Σv | 20 | 19 |
| Chaikin Oscillator | EMA3(A/D) − EMA10(A/D), SMA-seeded (TA-Lib seeds on the first value — converges) | 3, 10 | 9 |
| Elder Force Index | EMA13((c−c₋₁)·v) | 13 | 13 |
| Price Volume Trend | cumulative ((c−c₋₁)/c₋₁)·v, 0 at bar 0 | — | 0 |
| Up/Down Volume Ratio | Σv(up bars) / Σv(down bars); unchanged bars in neither; this symbol only | 50 | 50 |
| % From MA | 100·(x/MA − 1); MA type selectable | SMA 50 | 49 |
| 52-Week High/Low | 100·(c/HH − 1) and 100·(c/LL − 1) over the last **364 calendar days**; answers only once a full 52 weeks is loaded; D/W/M | — | first bar ≥ 364 days in |
| Standard Deviation | rolling population σ of the source | 20 | 19 |
| VWAP σ bands | vwap ± k·√(Σv·tp²/Σv − vwap²) per ET session; Off/±1σ/±2σ/±3σ | Off | as VWAP |

**Slow Stochastic.** `stoch` gains `smoothK` with declared default **1** (= the shipped fast
stochastic), so every saved instance keeps its meaning and the inspector shows it truthfully.
`meta.createInputs: { smoothK: 3 }` is written onto every **new** instance by both add doors
(library + toolbar toggle): new Stochastics are the mainstream slow 14/3/3.

## 5. Architecture notes (no redesign)

- **Fixed scale made real.** `placement.scale` now also travels as `autoscaleRange`; `pool` turns
  it into a memoised `fixedRangeProvider(min, max)` autoscale provider (widens, never clips), and
  a fixed-range pane now **autoscales** (`autoScale: true`) through it. The old `autoScale: false`
  froze the first range a scale computed, and pooled panes kept a previous tenant's frozen range —
  measured in the pane harness (a Stochastic RSI pane framed −100..103 after a CMO was added).
  RSI frames 0–100 on a real lightweight-charts instance (`autoscaleOnARealScale.test.js`) and in
  the browser. A manual drag of such a pane's scale is reset on the next bind, the same behaviour
  MACD's auto-ranged pane already has.
- **Source ⇒ pane only when the units are preserved.** `sourceRef.derivedTargetFor` now requires
  `domainBehavior: 'inherit'` (Moving Average, Data Series, MA Envelope). ROC(close) stays in its
  own pane instead of landing on the candles' $ axis.
- **MTF.** Every Tier 1 study takes a calculation timeframe through the existing machinery.
  `calcTimeframeCapability` now refuses only **session** studies (a timeframe list naming an
  intraday frame); D/W/M-only studies may compute on a higher frame.
- **Right-click quick menu.** Tier 1 studies declare `meta.quickMenu: false`: they appear in the
  chart's right-click Indicators toggles only while on. The library is their door.
- **Volume Profile "+ Add"** was a silent no-op (reproduced) — a carved-out row now routes to its own
  `toggledRow` writer. It stays a canvas overlay.
- **Live tick.** Only SMA/EMA averages are stepped per tick; other MA types wait for the next
  recompute rather than being stepped with SMA arithmetic.
- **`legend.sparse` (polish pass).** A plot blank by design on some bars (SuperTrend's up/down
  halves) gets the binder's per-bar `valueAt`, and the legend omits its valueless chip (one chip
  per instance always kept). SuperTrend shows one `SuperTrend(10, 3)` chip for the active side.

## 6. Alerts / server parity

Chart-only, deliberately — like `dollarVolume`, `movingAverage` and `atrBands` before them. No
Python twin, no `SERIES_FUNCS` row. A separate project.

**Stochastic alert semantics (traced 2026-10-01, polish pass — DEFERRED to the alert-parity
backlog).**

- The server's `stoch` / `stoch.d` addresses take exactly `{k_period: 14, d_period: 3}`
  (`alert_series.SERIES_FUNCS`, `address_inputs`), honour them when present, and compute
  **fast** %K (no smoothing parameter exists). Proven by calling `alert_series.series_for`.
- The alert popover seeds an alert's `params` from that **served catalogue** (14/3), never from the
  chart instance it was armed from; `instance_id` records only which instance it was armed from.
  So a chart's slow 14/3/3 Stochastic arms a 14/3 **fast** alert unless the member edits it, and a
  chart RSI(9) arms an RSI(14) alert the same way — this is the alert contract for every indicator,
  not a Stochastic defect.
- `applyAlertTemplate` (no product caller) would copy instance inputs verbatim (`kPeriod`…), which
  the server ignores.
- Not surgical: parity needs the popover to carry instance settings (a per-indicator name mapping),
  a `smooth_k` server parameter (changes the served catalogue and existing alerts' labels), the
  shared JS/Python Stochastic oracle, and an `api/**` deploy. Existing alerts are unaffected.
- Truthful guards shipped instead (copy only): the popover says *"These alert settings are separate
  from the chart indicator's settings"* when opened from an instance, and *"Alerts aren't available
  for this indicator yet"* when opened from a chart-only study's chip (it used to fall silently to
  the first catalogue indicator).

## 7. Validation

`tests/fixtures/technical_library/_oracle.py` — NumPy reference implementations written from the
definitions above, cross-checked against TA-Lib 0.8.1 where conventions coincide (21 studies,
worst relative disagreement 2.2e-12). `technicalStudies.oracle.test.js` compares UCT bar by bar:
identical gaps (first valid bar), values within 1e-9. The fixture carries a flat run, zero volume
and a gap. `technicalStudies.edge.test.js` covers short/empty/flat/zero-volume/null/extreme input.
