# Chart Tier 1 Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add RSI sub-pane, MACD sub-pane, Bollinger Bands overlay, Session VWAP, Heikin Ashi candles, and log scale toggle to StockChart — wired into the existing settings/preferences system and deployed everywhere the chart is used.

**Architecture:** Pure computation functions extracted to a new `indicators.js` module. `chartDefaults.js` gains an `indicators` config section plus `heikinAshi` and `logScale` booleans. `StockChart.jsx` gets a module-level `computePaneMargins()` helper that dynamically allocates chart height across price/volume/RSI/MACD panes, new indicator series refs, and an extended `indicatorData` useMemo. `ChartSettingsPanel` in `ChartToolbar.jsx` gets a new Indicators section and a Display section.

**Tech Stack:** TradingView Lightweight Charts v5 (LineSeries, HistogramSeries, priceScaleId, scaleMargins), React useMemo/useRef/useCallback, existing chart settings + user preferences persistence (`usePreferences`).

---

## File Map

| File | Change |
|------|--------|
| `app/src/components/chart/indicators.js` | **Create** — pure computation: `toHeikinAshi`, `computeRSI`, `computeMACD`, `computeBB`, `computeVWAP` |
| `app/src/components/chart/chartDefaults.js` | **Modify** — add `indicators`, `heikinAshi`, `logScale` to `CHART_DEFAULTS` + extend `mergeChartSettings` |
| `app/src/components/StockChart.jsx` | **Modify** — `displayBars` useMemo, `indicatorData` useMemo, 7 new series refs, `computePaneMargins`, series management in `updateChart()`, crosshair extension, live-update guard |
| `app/src/components/chart/ChartToolbar.jsx` | **Modify** — `updateIndicator` callback, rename MA section, add Indicators + Display sections |
| `app/src/components/chart/ChartToolbar.module.css` | **Modify** — 3 new CSS classes |

---

### Task 1: Computation functions module

**Files:**
- Create: `app/src/components/chart/indicators.js`

- [ ] **Step 1: Create the file with toHeikinAshi**

```javascript
// app/src/components/chart/indicators.js

export function toHeikinAshi(bars) {
  if (!bars?.length) return bars
  const result = []
  let prevHaOpen  = (bars[0].o + bars[0].c) / 2
  let prevHaClose = (bars[0].o + bars[0].h + bars[0].l + bars[0].c) / 4
  for (const bar of bars) {
    const haClose = (bar.o + bar.h + bar.l + bar.c) / 4
    const haOpen  = (prevHaOpen + prevHaClose) / 2
    const haHigh  = Math.max(bar.h, haOpen, haClose)
    const haLow   = Math.min(bar.l, haOpen, haClose)
    result.push({ ...bar, o: haOpen, h: haHigh, l: haLow, c: haClose })
    prevHaOpen  = haOpen
    prevHaClose = haClose
  }
  return result
}
```

- [ ] **Step 2: Add computeRSI**

```javascript
export function computeRSI(bars, period = 14) {
  if (!bars || bars.length < period + 1) return []
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = bars[i].c - bars[i - 1].c
    if (diff > 0) avgGain += diff; else avgLoss -= diff
  }
  avgGain /= period
  avgLoss /= period
  const result = []
  for (let i = period; i < bars.length; i++) {
    if (i > period) {
      const diff = bars[i].c - bars[i - 1].c
      const gain = diff > 0 ? diff : 0
      const loss = diff < 0 ? -diff : 0
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    result.push({ time: bars[i].t, value: parseFloat((100 - 100 / (1 + rs)).toFixed(2)) })
  }
  return result
}
```

- [ ] **Step 3: Add _ema helper + computeMACD**

```javascript
function _ema(values, period) {
  if (values.length < period) return []
  const k = 2 / (period + 1)
  const out = [values.slice(0, period).reduce((s, v) => s + v, 0) / period]
  for (let i = period; i < values.length; i++) {
    out.push(out[out.length - 1] * (1 - k) + values[i] * k)
  }
  return out  // out[i] corresponds to values[period - 1 + i]
}

export function computeMACD(bars, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!bars || bars.length < slowPeriod + signalPeriod) return { macd: [], signal: [], histogram: [] }
  const closes  = bars.map(b => b.c)
  const fastEMA = _ema(closes, fastPeriod)  // fastEMA[i] → bars[fastPeriod-1+i]
  const slowEMA = _ema(closes, slowPeriod)  // slowEMA[i] → bars[slowPeriod-1+i]
  const offset  = slowPeriod - fastPeriod   // = 14 for default 12/26
  // MACD line: aligned to bars[slowPeriod-1+i]
  const macdValues = slowEMA.map((s, i) => fastEMA[i + offset] - s)
  const signalEMA  = _ema(macdValues, signalPeriod)
  const sigOffset  = signalPeriod - 1
  const macd = [], signal = [], histogram = []
  for (let i = 0; i < signalEMA.length; i++) {
    const barIdx = slowPeriod - 1 + sigOffset + i
    const t = bars[barIdx].t
    const m = macdValues[sigOffset + i]
    const s = signalEMA[i]
    macd.push({ time: t, value: parseFloat(m.toFixed(5)) })
    signal.push({ time: t, value: parseFloat(s.toFixed(5)) })
    histogram.push({
      time: t,
      value: parseFloat((m - s).toFixed(5)),
      color: m >= s ? 'rgba(76,175,80,0.75)' : 'rgba(244,67,54,0.75)',
    })
  }
  return { macd, signal, histogram }
}
```

- [ ] **Step 4: Add computeBB**

```javascript
export function computeBB(bars, period = 20, stdDev = 2) {
  if (!bars || bars.length < period) return { upper: [], middle: [], lower: [] }
  const upper = [], middle = [], lower = []
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].c
    const avg = sum / period
    let sqSum = 0
    for (let j = i - period + 1; j <= i; j++) sqSum += (bars[j].c - avg) ** 2
    const std = Math.sqrt(sqSum / period)
    const t = bars[i].t
    upper.push({ time: t, value: parseFloat((avg + stdDev * std).toFixed(4)) })
    middle.push({ time: t, value: parseFloat(avg.toFixed(4)) })
    lower.push({ time: t, value: parseFloat((avg - stdDev * std).toFixed(4)) })
  }
  return { upper, middle, lower }
}
```

- [ ] **Step 5: Add computeVWAP**

```javascript
export function computeVWAP(bars) {
  if (!bars?.length) return []
  const result = []
  let cumPV = 0, cumVol = 0, currentDay = null
  for (const bar of bars) {
    // Use UTC date to determine session boundaries (9:30 ET is always same UTC day)
    const d = new Date(bar.t * 1000)
    const dayKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
    if (dayKey !== currentDay) { cumPV = 0; cumVol = 0; currentDay = dayKey }
    const tp = (bar.h + bar.l + bar.c) / 3
    cumPV += tp * bar.v
    cumVol += bar.v
    if (cumVol > 0) result.push({ time: bar.t, value: parseFloat((cumPV / cumVol).toFixed(4)) })
  }
  return result
}
```

- [ ] **Step 6: Verify all 5 exports exist**

Open the file and confirm: `toHeikinAshi`, `computeRSI`, `computeMACD`, `computeBB`, `computeVWAP` are all exported. `_ema` is intentionally private (no `export`).

- [ ] **Step 7: Commit**

```bash
git add app/src/components/chart/indicators.js
git commit -m "feat: add chart indicator computation functions (RSI, MACD, BB, VWAP, Heikin Ashi)"
```

---

### Task 2: chartDefaults.js — indicators schema

**Files:**
- Modify: `app/src/components/chart/chartDefaults.js`

- [ ] **Step 1: Add indicators + heikinAshi + logScale to CHART_DEFAULTS**

In `CHART_DEFAULTS`, after the `drawingDefaults` line and before `preset: 'classic'`, add:

```javascript
  indicators: {
    rsi:  { enabled: false, period: 14, color: '#7b68ee' },
    macd: {
      enabled: false, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      macdColor: '#2196F3', signalColor: '#FF9800',
    },
    bb:   { enabled: false, period: 20, stdDev: 2, color: 'rgba(156,39,176,0.85)' },
    vwap: { enabled: false, color: '#26C6DA' },
  },
  heikinAshi: false,
  logScale:   false,
```

- [ ] **Step 2: Update mergeChartSettings to deep-merge the new fields**

In the `return {}` block of `mergeChartSettings`, after the `drawingDefaults` line, add:

```javascript
    indicators: {
      rsi:  { ...CHART_DEFAULTS.indicators.rsi,  ...(parsed.indicators?.rsi  || {}) },
      macd: { ...CHART_DEFAULTS.indicators.macd, ...(parsed.indicators?.macd || {}) },
      bb:   { ...CHART_DEFAULTS.indicators.bb,   ...(parsed.indicators?.bb   || {}) },
      vwap: { ...CHART_DEFAULTS.indicators.vwap, ...(parsed.indicators?.vwap || {}) },
    },
    heikinAshi: parsed.heikinAshi ?? CHART_DEFAULTS.heikinAshi,
    logScale:   parsed.logScale   ?? CHART_DEFAULTS.logScale,
```

- [ ] **Step 3: Verify the full mergeChartSettings return block looks like this**

```javascript
  return {
    chartType: parsed.chartType || CHART_DEFAULTS.chartType,
    candles: { ...CHART_DEFAULTS.candles, ...(parsed.candles || {}) },
    background: parsed.background || CHART_DEFAULTS.background,
    textColor: parsed.textColor || CHART_DEFAULTS.textColor,
    grid: { ...CHART_DEFAULTS.grid, ...(parsed.grid || {}) },
    crosshair: { ...CHART_DEFAULTS.crosshair, ...(parsed.crosshair || {}) },
    overlays: Array.isArray(parsed.overlays)
      ? parsed.overlays.map((o, i) => ({ ...CHART_DEFAULTS.overlays[i], ...o }))
      : CHART_DEFAULTS.overlays.map(o => ({ ...o })),
    volume: { ...CHART_DEFAULTS.volume, ...(parsed.volume || {}) },
    watermark: { ...CHART_DEFAULTS.watermark, ...(parsed.watermark || {}) },
    drawingDefaults: { ...CHART_DEFAULTS.drawingDefaults, ...(parsed.drawingDefaults || {}) },
    indicators: {
      rsi:  { ...CHART_DEFAULTS.indicators.rsi,  ...(parsed.indicators?.rsi  || {}) },
      macd: { ...CHART_DEFAULTS.indicators.macd, ...(parsed.indicators?.macd || {}) },
      bb:   { ...CHART_DEFAULTS.indicators.bb,   ...(parsed.indicators?.bb   || {}) },
      vwap: { ...CHART_DEFAULTS.indicators.vwap, ...(parsed.indicators?.vwap || {}) },
    },
    heikinAshi: parsed.heikinAshi ?? CHART_DEFAULTS.heikinAshi,
    logScale:   parsed.logScale   ?? CHART_DEFAULTS.logScale,
    preset: parsed.preset || 'classic',
  }
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/chart/chartDefaults.js
git commit -m "feat: add indicators/heikinAshi/logScale to chart settings schema"
```

---

### Task 3: Heikin Ashi + Log Scale in StockChart

**Files:**
- Modify: `app/src/components/StockChart.jsx`

Adds two display features with no new panes or series.

- [ ] **Step 1: Add import for toHeikinAshi**

Near the top of the file where other local imports are (after the `import styles` line), add:

```javascript
import { toHeikinAshi } from './chart/indicators'
```

- [ ] **Step 2: Add displayBars useMemo after the filteredBars useMemo (around line 405)**

The `filteredBars` useMemo ends with `}, [bars, isIntraday, showExtended, resolvedTf])`. After that closing bracket, add:

```javascript
  const displayBars = useMemo(() => {
    if (!filteredBars?.length) return filteredBars
    return cs.heikinAshi ? toHeikinAshi(filteredBars) : filteredBars
  }, [filteredBars, cs.heikinAshi])
```

- [ ] **Step 3: Switch ohlcData and closeData to use displayBars**

Change the `ohlcData` useMemo from:
```javascript
  const ohlcData = useMemo(
    () => filteredBars ? filteredBars.map(b => ({ time: adjustTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })) : [],
    [filteredBars, adjustTime]
  )
  const closeData = useMemo(
    () => filteredBars ? filteredBars.map(b => ({ time: adjustTime(b.t), value: b.c })) : [],
    [filteredBars, adjustTime]
  )
```

To:
```javascript
  const ohlcData = useMemo(
    () => displayBars ? displayBars.map(b => ({ time: adjustTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })) : [],
    [displayBars, adjustTime]
  )
  const closeData = useMemo(
    () => displayBars ? displayBars.map(b => ({ time: adjustTime(b.t), value: b.c })) : [],
    [displayBars, adjustTime]
  )
```

`volData`, `hvcSet`, and `overlayData` continue using `filteredBars` — volume uses raw OHLCV, MA overlays on raw closes. Only the displayed candle shape transforms.

- [ ] **Step 4: Guard live tick updates when HA is active**

In the real-time candle update effect (near line 452), immediately after:
```javascript
    const liveData = livePrices[sym]
    if (!liveData?.price) return
```

Add:
```javascript
    // HA bars depend on the full series history — skip tick-by-tick updates.
    // The chart still refreshes every 15s via SWR, which re-runs toHeikinAshi on
    // the full filteredBars array and calls setData() — accurate enough for HA.
    if (cs.heikinAshi) return
```

- [ ] **Step 5: Apply log scale in updateChart after chart creation**

In `updateChart()`, after the `if (!chart) { ... } else { chart.applyOptions(chartOpts) }` block (around line 603), add:

```javascript
    // Log scale: mode 0 = Normal, 1 = Logarithmic (Lightweight Charts v5)
    chart.priceScale('right').applyOptions({ mode: cs.logScale ? 1 : 0 })
```

- [ ] **Step 6: Verify Heikin Ashi visually**

Run `cd app && npm run dev`. Open any chart (e.g. AAPL Daily). Open the gear settings. The Heikin Ashi toggle doesn't exist yet (ChartToolbar changes come in Task 7) — test by temporarily hard-coding `cs.heikinAshi = true` in the `mergeChartSettings` call or passing `heikinAshi: true` in the component, then verify candles transform.

Alternatively, skip visual verification here and test together in Task 7 after the UI is wired.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/StockChart.jsx
git commit -m "feat: add Heikin Ashi candles and log scale toggle to StockChart"
```

---

### Task 4: Bollinger Bands + Session VWAP overlays

**Files:**
- Modify: `app/src/components/StockChart.jsx`

- [ ] **Step 1: Extend the indicators import**

Change:
```javascript
import { toHeikinAshi } from './chart/indicators'
```
To:
```javascript
import { toHeikinAshi, computeBB, computeVWAP } from './chart/indicators'
```

- [ ] **Step 2: Add a module-level constant for VWAP timeframes**

At module level, near the other constants at the top of the file, add:

```javascript
const VWAP_TFS = new Set(['1', '5', '15', '30', '60'])
```

- [ ] **Step 3: Add 4 new series refs near the existing overlay refs**

In the component body, near `volumeSeriesRef` and `overlaySeriesRefs`, add:

```javascript
  const bbUpperRef    = useRef(null)
  const bbMiddleRef   = useRef(null)
  const bbLowerRef    = useRef(null)
  const vwapSeriesRef = useRef(null)
```

- [ ] **Step 4: Add indicatorData useMemo after overlayData (around line 435)**

After the `overlayData` useMemo closing bracket, add:

```javascript
  const indicatorData = useMemo(() => {
    const ind = cs.indicators || {}
    // BB — on main price scale
    const bbRaw = ind.bb?.enabled
      ? computeBB(filteredBars, ind.bb.period, ind.bb.stdDev)
      : { upper: [], middle: [], lower: [] }
    // VWAP — intraday only
    const vwapRaw = (ind.vwap?.enabled && VWAP_TFS.has(resolvedTf))
      ? computeVWAP(filteredBars)
      : []
    return {
      bb: {
        upper:  bbRaw.upper.map(p  => ({ time: adjustTime(p.time), value: p.value })),
        middle: bbRaw.middle.map(p => ({ time: adjustTime(p.time), value: p.value })),
        lower:  bbRaw.lower.map(p  => ({ time: adjustTime(p.time), value: p.value })),
      },
      vwap: vwapRaw.map(p => ({ time: adjustTime(p.time), value: p.value })),
      rsi:  [],   // populated in Task 5
      macd: { macd: [], signal: [], histogram: [] },  // populated in Task 6
    }
  }, [filteredBars, cs.indicators, resolvedTf, adjustTime])
```

- [ ] **Step 5: Add BB + VWAP series management in updateChart, after the overlay lines section**

After the overlay lines `for` loop (around line 759), add:

```javascript
    // ── Bollinger Bands (3 LineSeries on main price scale) ──
    const bbColor = cs.indicators?.bb?.color || 'rgba(156,39,176,0.85)'
    const BB_BANDS = [
      { ref: bbUpperRef,  data: indicatorData.bb.upper,  style: 2 },  // lineStyle 2 = dashed
      { ref: bbMiddleRef, data: indicatorData.bb.middle, style: 0 },  // lineStyle 0 = solid
      { ref: bbLowerRef,  data: indicatorData.bb.lower,  style: 2 },
    ]
    for (const { ref, data, style } of BB_BANDS) {
      if (data.length) {
        if (!ref.current) {
          ref.current = chart.addSeries(LineSeries, {
            color: bbColor, lineWidth: 1, lineStyle: style,
            priceLineVisible: false, lastValueVisible: false,
            crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
          })
        } else {
          ref.current.applyOptions({ color: bbColor })
        }
        ref.current.setData(data)
      } else if (ref.current) {
        try { chart.removeSeries(ref.current) } catch {}
        ref.current = null
      }
    }

    // ── Session VWAP (intraday only) ──
    if (indicatorData.vwap.length) {
      const vwapColor = cs.indicators?.vwap?.color || '#26C6DA'
      if (!vwapSeriesRef.current) {
        vwapSeriesRef.current = chart.addSeries(LineSeries, {
          color: vwapColor, lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
        })
      } else {
        vwapSeriesRef.current.applyOptions({ color: vwapColor })
      }
      vwapSeriesRef.current.setData(indicatorData.vwap)
    } else if (vwapSeriesRef.current) {
      try { chart.removeSeries(vwapSeriesRef.current) } catch {}
      vwapSeriesRef.current = null
    }
```

- [ ] **Step 6: Add indicatorData to the updateChart useCallback deps array**

The deps array at the end of the `updateChart` useCallback currently ends with `resolvedTf])`. Change to:

```javascript
  }, [filteredBars, ohlcData, closeData, volData, overlayData, indicatorData, sym, showVolume, mergedMarkers, mergedPriceLines, watermark, cs, adjustTime, resolvedTf])
```

- [ ] **Step 7: Commit**

```bash
git add app/src/components/StockChart.jsx
git commit -m "feat: add Bollinger Bands and Session VWAP overlays to StockChart"
```

---

### Task 5: RSI sub-pane

**Files:**
- Modify: `app/src/components/StockChart.jsx`

- [ ] **Step 1: Extend the indicators import to include computeRSI**

```javascript
import { toHeikinAshi, computeBB, computeVWAP, computeRSI } from './chart/indicators'
```

- [ ] **Step 2: Add rsiSeriesRef near the BB/VWAP refs**

```javascript
  const rsiSeriesRef = useRef(null)
```

- [ ] **Step 3: Add computePaneMargins at module level**

Add this function near `computeSMA` and `computeEMA` at the top of the file, before the component:

```javascript
function computePaneMargins(cs, hasVolume) {
  const ind = cs.indicators || {}
  const hasRSI  = !!ind.rsi?.enabled
  const hasMACD = !!ind.macd?.enabled
  const VOL_H  = 0.18
  const RSI_H  = 0.18
  const MACD_H = 0.22
  let bottom = 0
  const out = {}
  // Stack from bottom: MACD → RSI → Volume → Price
  if (hasMACD)   { out.macd   = { top: +(1 - bottom - MACD_H).toFixed(2), bottom: +bottom.toFixed(2) }; bottom += MACD_H }
  if (hasRSI)    { out.rsi    = { top: +(1 - bottom - RSI_H).toFixed(2),  bottom: +bottom.toFixed(2) }; bottom += RSI_H  }
  if (hasVolume) { out.volume = { top: +(1 - bottom - VOL_H).toFixed(2),  bottom: +bottom.toFixed(2) }; bottom += VOL_H  }
  out.main = { top: 0.02, bottom: +bottom.toFixed(2) }
  return out
}
```

- [ ] **Step 4: Replace the hardcoded rightPriceScale.scaleMargins in chartOpts**

Currently (around line 578):
```javascript
      rightPriceScale: {
        borderColor: cs.grid.color,
        scaleMargins: (showVolume && volData.length) ? { top: 0.02, bottom: 0.20 } : { top: 0.02, bottom: 0.02 },
      },
```

Change to:
```javascript
      rightPriceScale: {
        borderColor: cs.grid.color,
        scaleMargins: computePaneMargins(cs, showVolume && volData.length > 0).main,
      },
```

- [ ] **Step 5: Compute paneMargins once inside updateChart and update volume margins dynamically**

Add this constant immediately before the volume series section (`// ── Volume series`, around line 714):

```javascript
    const paneMargins = computePaneMargins(cs, showVolume && volData.length > 0)
```

Then update the volume series creation block. Change:
```javascript
      if (!volumeSeriesRef.current) {
        const vs = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: '',
        })
        vs.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
        volumeSeriesRef.current = vs
      }
      volumeSeriesRef.current.setData(volData)
```

To:
```javascript
      if (!volumeSeriesRef.current) {
        const vs = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: '',
        })
        volumeSeriesRef.current = vs
      }
      const volMargins = paneMargins.volume || { top: 0.82, bottom: 0 }
      volumeSeriesRef.current.priceScale().applyOptions({ scaleMargins: volMargins })
      volumeSeriesRef.current.setData(volData)
```

- [ ] **Step 6: Extend indicatorData useMemo to include RSI**

In the `indicatorData` useMemo, change the `computeBB` import and add RSI computation:

```javascript
  const indicatorData = useMemo(() => {
    const ind = cs.indicators || {}
    // RSI
    const rsiRaw = ind.rsi?.enabled
      ? computeRSI(filteredBars, ind.rsi.period).map(p => ({ time: adjustTime(p.time), value: p.value }))
      : []
    // BB — on main price scale
    const bbRaw = ind.bb?.enabled
      ? computeBB(filteredBars, ind.bb.period, ind.bb.stdDev)
      : { upper: [], middle: [], lower: [] }
    // VWAP — intraday only
    const vwapRaw = (ind.vwap?.enabled && VWAP_TFS.has(resolvedTf))
      ? computeVWAP(filteredBars)
      : []
    return {
      rsi:  rsiRaw,
      bb: {
        upper:  bbRaw.upper.map(p  => ({ time: adjustTime(p.time), value: p.value })),
        middle: bbRaw.middle.map(p => ({ time: adjustTime(p.time), value: p.value })),
        lower:  bbRaw.lower.map(p  => ({ time: adjustTime(p.time), value: p.value })),
      },
      vwap: vwapRaw.map(p => ({ time: adjustTime(p.time), value: p.value })),
      macd: { macd: [], signal: [], histogram: [] },  // populated in Task 6
    }
  }, [filteredBars, cs.indicators, resolvedTf, adjustTime])
```

- [ ] **Step 7: Add RSI series management in updateChart, after the VWAP section**

```javascript
    // ── RSI sub-pane ──
    if (indicatorData.rsi.length) {
      const rsiColor = cs.indicators?.rsi?.color || '#7b68ee'
      if (!rsiSeriesRef.current) {
        rsiSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'rsi',
          color: rsiColor,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        chart.priceScale('rsi').applyOptions({
          borderVisible: false,
          scaleMargins: paneMargins.rsi || { top: 0.82, bottom: 0 },
          autoScale: false,
          minimum: 0,
          maximum: 100,
        })
        rsiSeriesRef.current.createPriceLine({ price: 70, color: 'rgba(123,104,238,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
        rsiSeriesRef.current.createPriceLine({ price: 50, color: 'rgba(123,104,238,0.2)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false })
        rsiSeriesRef.current.createPriceLine({ price: 30, color: 'rgba(123,104,238,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      } else {
        rsiSeriesRef.current.applyOptions({ color: rsiColor })
        chart.priceScale('rsi').applyOptions({ scaleMargins: paneMargins.rsi || { top: 0.82, bottom: 0 } })
      }
      rsiSeriesRef.current.setData(indicatorData.rsi)
    } else if (rsiSeriesRef.current) {
      try { chart.removeSeries(rsiSeriesRef.current) } catch {}
      rsiSeriesRef.current = null
    }
```

- [ ] **Step 8: Add RSI to the crosshair handler**

In the crosshair `handler` function, after the `ovValues` computation, add:

```javascript
      let rsiValue = null
      if (rsiSeriesRef.current) {
        const d = param.seriesData.get(rsiSeriesRef.current)
        rsiValue = d?.value ?? (indicatorData.rsi.at(-1)?.value ?? null)
      }
```

Add `rsiValue` to the `setCrosshairData` call:
```javascript
      setCrosshairData({
        time: param.time, open: o, high: h, low: l, close: c,
        volume: vol, change: change.toFixed(2), changePct: changePct.toFixed(2),
        overlays: ovValues,
        rsi: rsiValue,
      })
```

- [ ] **Step 9: Render RSI in the OHLCV legend**

In the chart legend JSX (after the `{crosshairData.overlays.map(...)}` block), add:

```jsx
            {crosshairData.rsi != null && (
              <span style={{ color: cs.indicators?.rsi?.color || '#7b68ee' }}>
                RSI({cs.indicators?.rsi?.period || 14}) {crosshairData.rsi.toFixed(1)}
              </span>
            )}
```

- [ ] **Step 10: Add indicatorData to the crosshair effect deps**

Change:
```javascript
  }, [updateChart, resolvedOverlays, overlayData, livePrices, sym])
```
To:
```javascript
  }, [updateChart, resolvedOverlays, overlayData, indicatorData, livePrices, sym])
```

- [ ] **Step 11: Commit**

```bash
git add app/src/components/StockChart.jsx
git commit -m "feat: add RSI sub-pane with dynamic pane margins to StockChart"
```

---

### Task 6: MACD sub-pane

**Files:**
- Modify: `app/src/components/StockChart.jsx`

- [ ] **Step 1: Extend the indicators import to include computeMACD**

```javascript
import { toHeikinAshi, computeBB, computeVWAP, computeRSI, computeMACD } from './chart/indicators'
```

- [ ] **Step 2: Add 3 MACD series refs near rsiSeriesRef**

```javascript
  const macdLineRef   = useRef(null)
  const macdSignalRef = useRef(null)
  const macdHistRef   = useRef(null)
```

- [ ] **Step 3: Extend indicatorData useMemo to include MACD**

Replace the `macd: { macd: [], signal: [], histogram: [] }` placeholder with:

```javascript
    const macdCfg = ind.macd
    const macdRaw = macdCfg?.enabled
      ? computeMACD(filteredBars, macdCfg.fastPeriod, macdCfg.slowPeriod, macdCfg.signalPeriod)
      : { macd: [], signal: [], histogram: [] }
    // ... (keep rsi, bb, vwap unchanged)
    return {
      rsi:  rsiRaw,
      bb: { ... },   // unchanged
      vwap: ...,     // unchanged
      macd: {
        macd:      macdRaw.macd.map(p      => ({ time: adjustTime(p.time), value: p.value })),
        signal:    macdRaw.signal.map(p    => ({ time: adjustTime(p.time), value: p.value })),
        histogram: macdRaw.histogram.map(p => ({ time: adjustTime(p.time), value: p.value, color: p.color })),
      },
    }
```

- [ ] **Step 4: Add MACD series management in updateChart, after the RSI section**

`paneMargins` is already in scope from Task 5 Step 5.

```javascript
    // ── MACD sub-pane ──
    const macdCfg = cs.indicators?.macd
    const macdD   = indicatorData.macd
    if (macdD.macd.length) {
      if (!macdLineRef.current) {
        macdLineRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'macd',
          color: macdCfg?.macdColor || '#2196F3',
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        macdSignalRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'macd',
          color: macdCfg?.signalColor || '#FF9800',
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        macdHistRef.current = chart.addSeries(HistogramSeries, {
          priceScaleId: 'macd',
          priceFormat: { type: 'price', precision: 5 },
          priceLineVisible: false, lastValueVisible: false,
        })
        chart.priceScale('macd').applyOptions({
          borderVisible: false,
          scaleMargins: paneMargins.macd || { top: 0.80, bottom: 0 },
          autoScale: true,
        })
        // Zero line for visual reference
        macdLineRef.current.createPriceLine({ price: 0, color: 'rgba(255,255,255,0.12)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false })
      } else {
        macdLineRef.current.applyOptions({ color: macdCfg?.macdColor || '#2196F3' })
        macdSignalRef.current.applyOptions({ color: macdCfg?.signalColor || '#FF9800' })
        chart.priceScale('macd').applyOptions({ scaleMargins: paneMargins.macd || { top: 0.80, bottom: 0 } })
      }
      macdLineRef.current.setData(macdD.macd)
      macdSignalRef.current.setData(macdD.signal)
      macdHistRef.current.setData(macdD.histogram)
    } else {
      for (const ref of [macdLineRef, macdSignalRef, macdHistRef]) {
        if (ref.current) { try { chart.removeSeries(ref.current) } catch {}; ref.current = null }
      }
    }
```

- [ ] **Step 5: Add MACD to the crosshair handler**

After the `rsiValue` block:
```javascript
      let macdValue = null, macdSignalValue = null
      if (macdLineRef.current) {
        const dm = param.seriesData.get(macdLineRef.current)
        const ds = macdSignalRef.current ? param.seriesData.get(macdSignalRef.current) : null
        macdValue       = dm?.value ?? (indicatorData.macd.macd.at(-1)?.value   ?? null)
        macdSignalValue = ds?.value ?? (indicatorData.macd.signal.at(-1)?.value ?? null)
      }
```

Add to `setCrosshairData`:
```javascript
        rsi: rsiValue, macd: macdValue, macdSig: macdSignalValue,
```

- [ ] **Step 6: Render MACD in the OHLCV legend**

After the RSI legend span:
```jsx
            {crosshairData.macd != null && (
              <span style={{ color: cs.indicators?.macd?.macdColor || '#2196F3' }}>
                MACD {crosshairData.macd.toFixed(4)}
              </span>
            )}
            {crosshairData.macdSig != null && (
              <span style={{ color: cs.indicators?.macd?.signalColor || '#FF9800' }}>
                SIG {crosshairData.macdSig.toFixed(4)}
              </span>
            )}
```

- [ ] **Step 7: Commit**

```bash
git add app/src/components/StockChart.jsx
git commit -m "feat: add MACD sub-pane to StockChart"
```

---

### Task 7: ChartSettingsPanel — Indicator UI

**Files:**
- Modify: `app/src/components/chart/ChartToolbar.jsx`
- Modify: `app/src/components/chart/ChartToolbar.module.css`

- [ ] **Step 1: Add updateIndicator helper in ChartSettingsPanel**

In `ChartSettingsPanel`, after the `updateOverlay` callback, add:

```javascript
  const updateIndicator = useCallback((key, field, value) => {
    const numFields = new Set(['period', 'fastPeriod', 'slowPeriod', 'signalPeriod', 'stdDev'])
    const next = { ...cs }
    next.indicators = {
      ...next.indicators,
      [key]: {
        ...next.indicators[key],
        [field]: numFields.has(field)
          ? (field === 'stdDev' ? (parseFloat(value) || next.indicators[key][field]) : (parseInt(value) || next.indicators[key][field]))
          : value,
      },
    }
    next.preset = 'custom'
    onUpdateSettings(next)
  }, [cs, onUpdateSettings])
```

- [ ] **Step 2: Rename the existing "Indicators" section label to "Moving Averages"**

The current label at line 182:
```jsx
        <span className={styles.sLabel}>Indicators</span>
```
Change to:
```jsx
        <span className={styles.sLabel}>Moving Averages</span>
```

- [ ] **Step 3: Add the Indicators section after the Volume section**

After the closing `</div>` of the Volume `sGroup` (after line 218), add:

```jsx
      {/* Technical Indicators */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Indicators</span>

        {/* RSI */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.rsi?.enabled ?? false}
            onChange={e => updateIndicator('rsi', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>RSI</span>
          <input type="number" className={styles.sPeriodInput}
            value={cs.indicators?.rsi?.period ?? 14} min={2} max={100}
            onChange={e => updateIndicator('rsi', 'period', e.target.value)} title="Period" />
          <ColorPicker value={cs.indicators?.rsi?.color ?? '#7b68ee'}
            onChange={v => updateIndicator('rsi', 'color', v)} />
        </div>

        {/* MACD */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.macd?.enabled ?? false}
            onChange={e => updateIndicator('macd', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>MACD</span>
          <div className={styles.sMiniPeriodGroup}>
            <input type="number" className={styles.sPeriodInput}
              value={cs.indicators?.macd?.fastPeriod ?? 12} min={1} max={100}
              onChange={e => updateIndicator('macd', 'fastPeriod', e.target.value)} title="Fast" />
            <input type="number" className={styles.sPeriodInput}
              value={cs.indicators?.macd?.slowPeriod ?? 26} min={1} max={200}
              onChange={e => updateIndicator('macd', 'slowPeriod', e.target.value)} title="Slow" />
            <input type="number" className={styles.sPeriodInput}
              value={cs.indicators?.macd?.signalPeriod ?? 9} min={1} max={50}
              onChange={e => updateIndicator('macd', 'signalPeriod', e.target.value)} title="Signal" />
          </div>
        </div>

        {/* Bollinger Bands */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.bb?.enabled ?? false}
            onChange={e => updateIndicator('bb', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>BB</span>
          <input type="number" className={styles.sPeriodInput}
            value={cs.indicators?.bb?.period ?? 20} min={2} max={200}
            onChange={e => updateIndicator('bb', 'period', e.target.value)} title="Period" />
          <input type="number" className={styles.sPeriodInput}
            value={cs.indicators?.bb?.stdDev ?? 2} min={0.5} max={5} step={0.5}
            onChange={e => updateIndicator('bb', 'stdDev', e.target.value)} title="Std Dev" />
          <ColorPicker value={cs.indicators?.bb?.color ?? 'rgba(156,39,176,0.85)'}
            onChange={v => updateIndicator('bb', 'color', v)} />
        </div>

        {/* VWAP */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.vwap?.enabled ?? false}
            onChange={e => updateIndicator('vwap', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>VWAP</span>
          <span className={styles.sIndicatorNote}>(intraday only)</span>
          <ColorPicker value={cs.indicators?.vwap?.color ?? '#26C6DA'}
            onChange={v => updateIndicator('vwap', 'color', v)} />
        </div>
      </div>

      {/* Display Options */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Display</span>
        <div className={styles.sRow}>
          <label className={styles.sCheck}>
            <input type="checkbox"
              checked={cs.heikinAshi ?? false}
              onChange={e => update('heikinAshi', e.target.checked)} />
            Heikin Ashi
          </label>
          <label className={styles.sCheck}>
            <input type="checkbox"
              checked={cs.logScale ?? false}
              onChange={e => update('logScale', e.target.checked)} />
            Log Scale
          </label>
        </div>
      </div>
```

- [ ] **Step 4: Add 3 new CSS classes to ChartToolbar.module.css**

Open the file. Find the `.sOverlayRow` styles. After them, add:

```css
.sIndicatorLabel {
  font-size: 10px;
  font-weight: 600;
  color: var(--text);
  min-width: 36px;
  flex-shrink: 0;
}

.sIndicatorNote {
  font-size: 9px;
  color: var(--text-muted);
  flex: 1;
}

.sMiniPeriodGroup {
  display: flex;
  gap: 3px;
  flex: 1;
}
```

- [ ] **Step 5: Verify all 6 features work end-to-end**

Run `cd app && npm run dev`. Open any stock chart and click the gear icon.

1. **Moving Averages** section shows 4 MA rows (renamed from "Indicators") — unchanged behavior ✓
2. **Indicators** section shows RSI, MACD, BB, VWAP rows
3. Toggle **RSI on** → purple sub-pane appears below volume with 30/50/70 reference lines
4. Toggle **MACD on** → stacks below RSI; blue MACD + orange signal + green/red histogram
5. Toggle **BB on** → 3 dashed purple lines overlay the candles
6. Switch to 5min, toggle **VWAP on** → cyan line resets each morning at 9:30 ET
7. Switch to Daily, enable VWAP → no VWAP line appears (intraday-only guard)
8. **Display** section: toggle **Heikin Ashi** → candles transform to HA shape
9. Toggle **Log Scale** → Y-axis switches to logarithmic

- [ ] **Step 6: Commit**

```bash
git add app/src/components/chart/ChartToolbar.jsx app/src/components/chart/ChartToolbar.module.css
git commit -m "feat: add RSI/MACD/BB/VWAP/HA/LogScale controls to ChartSettingsPanel"
```

---

### Task 8: Deploy to Railway

- [ ] **Step 1: Push**

```bash
git push origin master
```

- [ ] **Step 2: Verify production**

Visit `https://uctintelligence.com`. Open ThemeTracker or Watchlists (they embed StockChart). Open the gear icon. Enable RSI — sub-pane should appear. Enable MACD — stacks below RSI. Toggle VWAP on a 5min chart — cyan line resets at session open. Toggle Heikin Ashi — candles transform.
