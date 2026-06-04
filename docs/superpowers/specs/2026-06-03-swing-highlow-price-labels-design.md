# Swing High / Low Price Labels — Design

**Date:** 2026-06-03
**Status:** Approved, building
**Surface:** All `StockChart` instances (chart setting, like every other chart toggle)

## Goal

A toggleable chart feature that prints the **price at each notable swing high (above
the bar) and swing low (below the bar)** — visually identical to MarketSurge /
MarketSmith. No connecting zig-zag line; just clean price text at the pivot tips.
Pure client-side off the OHLC already loaded — **no backend work**.

## Decisions (locked)

- **Detection:** Hybrid N-bar pivot + % floor.
- **Sensitivity control:** Low / Med / High segmented control + smart timeframe-aware default (Med), off by default.
- **Scope:** All StockChart surfaces (a `chartDefaults` setting).
- **Price format:** fixed **2 decimals** for all instruments.
- **Legibility halo:** yes — each label gets a background-colored text outline so it stays readable over candles/gridlines.
- **Up/down color tint:** included as an off-by-default toggle (swing-high label tinted up-color, swing-low tinted down-color). Default = single neutral color.
- **ZigZag connecting line:** intentionally omitted (matches reference). Pivot data exists, so it's an easy future add.

## Detection — `app/src/components/chart/swingPivots.js` (new, pure)

`detectSwingPivots(ohlc, { leftRight, pctFloor })` → `[{ time, price, type: 'high'|'low' }]`

1. **Fractal pass.** Bar `i` (for `L ≤ i < n-R`, `L=R=leftRight`) is a raw swing high
   if no bar in `[i-L, i+R]` has a strictly greater `high`; a raw swing low if no bar
   has a strictly lower `low`. Strict `>`/`<` disqualifiers let flat plateaus through
   as ties, which the ZigZag pass dedups. Right-edge bars (within `R` of the end) are
   never evaluated → forming bars never produce flickering labels.
2. **ZigZag filter.** Walk raw pivots chronologically:
   - First pivot seeds the output.
   - Same type as last kept pivot → keep the more extreme (higher high / lower low).
   - Opposite type → confirm only if `|price - lastPrice| / lastPrice * 100 ≥ pctFloor`,
     else skip. This enforces alternation and kills noise → MarketSurge's
     "~12 labels per year of daily bars" density.

`sensitivityToParams(level, tf)` → `{ leftRight, pctFloor }`, timeframe-aware (intraday
swings are smaller %, weekly larger). Starting table:

| TF group | Low (rare/big) | Med (default) | High (dense) |
|---|---|---|---|
| Intraday (1/5/15/30/60) | L/R=8, 4% | L/R=6, 2.5% | L/R=4, 1.2% |
| Daily (D) | L/R=8, 10% | L/R=6, 6% | L/R=4, 3.5% |
| Weekly/Monthly (W/M) | L/R=6, 18% | L/R=5, 12% | L/R=3, 7% |

All tunable; these are sane defaults.

## Rendering — `app/src/components/chart/swingLabelsPrimitive.js` (new)

`createSwingLabelsPrimitive(initial)` → `{ primitive, setPoints, setOptions }`. Follows
the `watermarkPrimitive.js` factory pattern but is attached to the **candle series**
(via `series.attachPrimitive`) so `attached({ chart, series, requestUpdate })` gives the
series for `priceToCoordinate`.

`draw()` (zOrder `'top'`, media coordinate space): for each point
`x = chart.timeScale().timeToCoordinate(time)`, `y = series.priceToCoordinate(price)`;
skip if either is null/off-screen. Swing highs: `textBaseline='bottom'`, drawn ~4px
above `y`; swing lows: `textBaseline='top'`, ~4px below. `textAlign='center'` at `x`.
Label = `price.toFixed(2)`. Legibility halo = `strokeText` in the chart background color
(lineWidth ~3) under `fillText`. Light de-collision: track drawn rects, skip a label
whose rect intersects an already-drawn one. Color = neutral default, or up/down tint
when `tintByType`.

Options: `{ enabled, points, color, tintByType, upColor, downColor, bg, fontPx }`.

## Wiring — `app/src/components/StockChart.jsx`

- Refs `swingCtrlRef` / `swingAttachedRef`. Lazily create the controller; attach to
  `candleSeriesRef.current` when not yet attached.
- In the chart-type series-swap block (where `markersControllerRef` is reset), also set
  `swingAttachedRef.current = false` so the primitive re-attaches to the new series.
- `swingPoints = useMemo(() => (enabled ? detectSwingPivots(ohlcData, sensitivityToParams(level, resolvedTf)) : []), [ohlcData, level, resolvedTf, enabled])`
  — recompute only on real data/sensitivity/TF change, not per render or live tick.
- Effect pushes `enabled`, points, colors, and `cs.background` into the primitive.

## Settings — `app/src/components/chart/chartDefaults.js`

```js
swingLabels: { enabled: false, sensitivity: 'medium', color: '#d4d0c4',
               tintByType: false, upColor: '#4ade80', downColor: '#f87171' },
```
Plus a merge block in `mergeChartSettings`.

## UI toggles

- **Gear panel (`ChartToolbar.jsx`):** new "Swing labels" group — on/off checkbox,
  Low/Med/High `sMiniSelect`, `ColorPicker`, "Tint by type" checkbox (+ up/down pickers
  when on). Uses the existing `update('swingLabels.…', v)` path.
- **Right-click price-area menu (`StockChart.jsx` ~937):** a "Swing price labels" toggle
  item, mirroring the "Extended-hours shading" item.

## Tests

- `swingPivots.test.js` — too-short input → `[]`; clean synthetic zigzag detects the
  known highs/lows; % floor rejects a sub-threshold bounce; consecutive same-type keeps
  the more extreme; right-edge bars excluded; output strictly alternates.
- A `mergeChartSettings` case for the new `swingLabels` key.

## Files

**New:** `swingPivots.js`, `swingPivots.test.js`, `swingLabelsPrimitive.js` (all under `app/src/components/chart/`)
**Edit:** `StockChart.jsx`, `chartDefaults.js`, `ChartToolbar.jsx`
