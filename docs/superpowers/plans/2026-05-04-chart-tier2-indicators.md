# Chart Tier 2 Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stochastic oscillator sub-pane, ATR sub-pane, and earnings/split date markers on the chart — all wired into the existing Tier 1 StockChart + ChartSettingsPanel indicator system.

**Architecture:** Pure computation functions added to `indicators.js`; schema additions to `chartDefaults.js`; `computePaneMargins` refactored to a data-driven approach that scales heights automatically when many panes are active; `indicatorData` useMemo extended for Stoch+ATR; a new FastAPI endpoint `/api/chart/markers/{ticker}` fetches Finnhub earnings history and splits; StockChart fetches markers via SWR when toggled on and merges them into the existing `createSeriesMarkers` pipeline; ChartToolbar gains two new UI rows.

**Tech Stack:** TradingView Lightweight Charts v5 (LineSeries, priceScaleId, scaleMargins), React useMemo/useRef/useSWR, FastAPI + Finnhub REST API, existing `indicators.js` / `chartDefaults.js` / `StockChart.jsx` / `ChartToolbar.jsx` patterns from Tier 1.

---

## File Map

| File | Change |
|------|--------|
| `app/src/components/chart/indicators.js` | **Modify** — add `computeStochastic`, `computeATR` |
| `app/src/components/chart/chartDefaults.js` | **Modify** — add `stoch`, `atr` to `indicators`; add top-level `markers` object; extend `mergeChartSettings` |
| `api/services/earnings_estimates.py` | **Modify** — add `get_chart_markers(ticker)` function |
| `api/routers/earnings.py` | **Modify** — add `GET /api/chart/markers/{ticker}` route |
| `app/src/components/StockChart.jsx` | **Modify** — refactor `computePaneMargins`; extend `indicatorData`; add Stoch+ATR refs+series; add markers SWR fetch; extend crosshair/legend |
| `app/src/components/chart/ChartToolbar.jsx` | **Modify** — add Stochastic/ATR rows to Indicators section; add Markers section |

---

### Task 1: Computation functions — Stochastic + ATR

**Files:**
- Modify: `app/src/components/chart/indicators.js`

- [ ] **Step 1: Add computeStochastic after computeVWAP**

```javascript
export function computeStochastic(bars, kPeriod = 14, dPeriod = 3) {
  if (!bars || bars.length < kPeriod) return { k: [], d: [] }
  // Fast %K
  const kValues = []
  for (let i = kPeriod - 1; i < bars.length; i++) {
    let lowestLow = Infinity, highestHigh = -Infinity
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (bars[j].l < lowestLow) lowestLow = bars[j].l
      if (bars[j].h > highestHigh) highestHigh = bars[j].h
    }
    const range = highestHigh - lowestLow
    const k = range === 0 ? 50 : ((bars[i].c - lowestLow) / range) * 100
    kValues.push({ time: bars[i].t, value: parseFloat(k.toFixed(2)) })
  }
  // %D = SMA(dPeriod) of %K
  const dValues = []
  for (let i = dPeriod - 1; i < kValues.length; i++) {
    let sum = 0
    for (let j = i - dPeriod + 1; j <= i; j++) sum += kValues[j].value
    dValues.push({ time: kValues[i].time, value: parseFloat((sum / dPeriod).toFixed(2)) })
  }
  return { k: kValues, d: dValues }
}
```

- [ ] **Step 2: Add computeATR after computeStochastic**

```javascript
export function computeATR(bars, period = 14) {
  if (!bars || bars.length < period + 1) return []
  // True Range for each bar starting at index 1 (needs previous close)
  const trs = []
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c)
    )
    trs.push({ t: bars[i].t, tr })
  }
  // Seed with simple average of first `period` TRs, then Wilder's smoothing
  let atr = trs.slice(0, period).reduce((s, x) => s + x.tr, 0) / period
  const result = [{ time: trs[period - 1].t, value: parseFloat(atr.toFixed(4)) }]
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i].tr) / period
    result.push({ time: trs[i].t, value: parseFloat(atr.toFixed(4)) })
  }
  return result
}
```

- [ ] **Step 3: Verify exports**

Confirm both are exported. The full export list should now be:
`toHeikinAshi`, `computeRSI`, `computeMACD`, `computeBB`, `computeVWAP`, `computeStochastic`, `computeATR`
`_ema` remains private (no export keyword).

- [ ] **Step 4: Commit**

```bash
git add app/src/components/chart/indicators.js
git commit -m "feat: add Stochastic and ATR computation functions to indicators.js"
```

---

### Task 2: chartDefaults.js — schema extension

**Files:**
- Modify: `app/src/components/chart/chartDefaults.js`

- [ ] **Step 1: Add stoch and atr to CHART_DEFAULTS.indicators**

Find the existing indicators block:
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
```

Replace with:
```javascript
  indicators: {
    rsi:  { enabled: false, period: 14, color: '#7b68ee' },
    macd: {
      enabled: false, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      macdColor: '#2196F3', signalColor: '#FF9800',
    },
    bb:   { enabled: false, period: 20, stdDev: 2, color: 'rgba(156,39,176,0.85)' },
    vwap: { enabled: false, color: '#26C6DA' },
    stoch: { enabled: false, kPeriod: 14, dPeriod: 3, kColor: '#FF6B6B', dColor: '#4ECDC4' },
    atr:   { enabled: false, period: 14, color: '#FFA726' },
  },
```

- [ ] **Step 2: Add top-level markers object after logScale**

Find:
```javascript
  heikinAshi: false,
  logScale:   false,

  preset: 'classic',
```

Replace with:
```javascript
  heikinAshi: false,
  logScale:   false,
  markers: { earnings: false, splits: false },

  preset: 'classic',
```

- [ ] **Step 3: Extend mergeChartSettings return block**

Find:
```javascript
    indicators: {
      rsi:  { ...CHART_DEFAULTS.indicators.rsi,  ...(parsed.indicators?.rsi  || {}) },
      macd: { ...CHART_DEFAULTS.indicators.macd, ...(parsed.indicators?.macd || {}) },
      bb:   { ...CHART_DEFAULTS.indicators.bb,   ...(parsed.indicators?.bb   || {}) },
      vwap: { ...CHART_DEFAULTS.indicators.vwap, ...(parsed.indicators?.vwap || {}) },
    },
    heikinAshi: parsed.heikinAshi ?? CHART_DEFAULTS.heikinAshi,
    logScale:   parsed.logScale   ?? CHART_DEFAULTS.logScale,
    preset: parsed.preset || 'classic',
```

Replace with:
```javascript
    indicators: {
      rsi:  { ...CHART_DEFAULTS.indicators.rsi,  ...(parsed.indicators?.rsi  || {}) },
      macd: { ...CHART_DEFAULTS.indicators.macd, ...(parsed.indicators?.macd || {}) },
      bb:   { ...CHART_DEFAULTS.indicators.bb,   ...(parsed.indicators?.bb   || {}) },
      vwap: { ...CHART_DEFAULTS.indicators.vwap, ...(parsed.indicators?.vwap || {}) },
      stoch: { ...CHART_DEFAULTS.indicators.stoch, ...(parsed.indicators?.stoch || {}) },
      atr:   { ...CHART_DEFAULTS.indicators.atr,   ...(parsed.indicators?.atr   || {}) },
    },
    heikinAshi: parsed.heikinAshi ?? CHART_DEFAULTS.heikinAshi,
    logScale:   parsed.logScale   ?? CHART_DEFAULTS.logScale,
    markers: { ...CHART_DEFAULTS.markers, ...(parsed.markers || {}) },
    preset: parsed.preset || 'classic',
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/chart/chartDefaults.js
git commit -m "feat: add stoch/atr/markers to chart settings schema"
```

---

### Task 3: Backend — chart markers API endpoint

**Files:**
- Modify: `api/services/earnings_estimates.py`
- Modify: `api/routers/earnings.py`

- [ ] **Step 1: Add get_chart_markers function to earnings_estimates.py**

At the end of `api/services/earnings_estimates.py`, add:

```python
def get_chart_markers(ticker: str) -> dict:
    """Return earnings beat/miss history and stock splits for chart annotation.

    Returns:
        {
          "earnings": [{"date": "2024-11-01", "beat": true, "surprise": 3.2}, ...],
          "splits":   [{"date": "2020-08-28", "ratio": "4:1"}, ...]
        }
    Keys with no data return empty lists. Never raises.
    """
    ticker = ticker.upper()
    cache_key = f"chart_markers_{ticker}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    result = {"earnings": [], "splits": []}

    # ── Earnings history (last 16 quarters ≈ 4 years) ─────────────────────
    eps_raw = _fh_get("/stock/earnings", {"symbol": ticker, "limit": 16})
    if isinstance(eps_raw, list):
        for q in eps_raw:
            date_str = q.get("period") or q.get("date") or q.get("reportDate")
            if not date_str:
                continue
            actual   = q.get("actual")
            estimate = q.get("estimate")
            beat = bool(actual >= estimate) if (actual is not None and estimate is not None) else None
            result["earnings"].append({
                "date": str(date_str)[:10],
                "beat": beat,
                "surprise": q.get("surprisePercent"),
            })

    # ── Stock splits (last 5 years) ───────────────────────────────────────
    from datetime import date, timedelta
    today = date.today()
    from_date = (today - timedelta(days=365 * 5)).strftime("%Y-%m-%d")
    to_date   = today.strftime("%Y-%m-%d")
    splits_raw = _fh_get("/stock/split", {"symbol": ticker, "from": from_date, "to": to_date})
    if isinstance(splits_raw, list):
        for s in splits_raw:
            date_str = s.get("date")
            from_f   = s.get("fromFactor", 1)
            to_f     = s.get("toFactor", 1)
            if date_str:
                result["splits"].append({
                    "date": str(date_str)[:10],
                    "ratio": f"{from_f}:{to_f}",
                })

    cache.set(cache_key, result, ttl=_CACHE_TTL)
    return result
```

- [ ] **Step 2: Add route to earnings.py**

At the end of `api/routers/earnings.py`, before the file ends, add:

```python
@router.get("/api/chart/markers/{ticker}")
def chart_markers_endpoint(ticker: str):
    """Earnings beat/miss history + stock splits for chart annotation."""
    from api.services.earnings_estimates import get_chart_markers
    return get_chart_markers(ticker.upper())
```

- [ ] **Step 3: Test the endpoint**

Run the backend locally:
```bash
uvicorn api.main:app --reload --port 8000
```

Then:
```bash
curl "http://localhost:8000/api/chart/markers/AAPL"
```

Expected: JSON with `earnings` array (up to 16 items with `date`, `beat`, `surprise`) and `splits` array. The endpoint should return 200 with valid JSON even if Finnhub fails (returns empty arrays).

- [ ] **Step 4: Commit**

```bash
git add api/services/earnings_estimates.py api/routers/earnings.py
git commit -m "feat: add /api/chart/markers/{ticker} endpoint for earnings + split markers"
```

---

### Task 4: StockChart — refactor computePaneMargins + extend indicatorData

**Files:**
- Modify: `app/src/components/StockChart.jsx`

This task refactors `computePaneMargins` to a data-driven approach that automatically scales pane heights when many panes are active, and extends `indicatorData` to compute Stochastic and ATR.

- [ ] **Step 1: Add computeStochastic and computeATR to the import**

Find:
```javascript
import { toHeikinAshi, computeBB, computeVWAP, computeRSI, computeMACD } from './chart/indicators'
```
Replace with:
```javascript
import { toHeikinAshi, computeBB, computeVWAP, computeRSI, computeMACD, computeStochastic, computeATR } from './chart/indicators'
```

- [ ] **Step 2: Replace computePaneMargins at module level**

Find the entire `computePaneMargins` function (it starts with `function computePaneMargins(cs, hasVolume) {` and ends with the closing `}`).

Replace the entire function with:

```javascript
function computePaneMargins(cs, hasVolume) {
  const ind = cs.indicators || {}
  // Define all possible sub-panes in stacking order (bottom of chart → top)
  // Each entry: key (used in returned object), enabled flag, base height fraction
  const PANES = [
    { key: 'atr',    enabled: !!ind.atr?.enabled,   baseH: 0.13 },
    { key: 'macd',   enabled: !!ind.macd?.enabled,  baseH: 0.17 },
    { key: 'stoch',  enabled: !!ind.stoch?.enabled, baseH: 0.15 },
    { key: 'rsi',    enabled: !!ind.rsi?.enabled,   baseH: 0.15 },
    { key: 'volume', enabled: hasVolume,             baseH: 0.15 },
  ]
  const active = PANES.filter(p => p.enabled)
  const totalBase = active.reduce((s, p) => s + p.baseH, 0)
  // Cap sub-panes at 72% so price area always gets ≥28%
  const scale = totalBase > 0.72 ? 0.72 / totalBase : 1
  let bottom = 0
  const out = {}
  for (const { key, baseH } of active) {
    const h = +((baseH * scale).toFixed(2))
    out[key] = { top: +((1 - bottom - h).toFixed(2)), bottom: +bottom.toFixed(2) }
    bottom = +(bottom + h).toFixed(2)
  }
  out.main = { top: 0.02, bottom: bottom }
  return out
}
```

- [ ] **Step 3: Extend indicatorData useMemo to compute Stochastic and ATR**

Find the entire `indicatorData` useMemo (starts with `const indicatorData = useMemo(() => {`). Replace it with:

```javascript
  const indicatorData = useMemo(() => {
    const ind = cs.indicators || {}
    const rsiRaw = ind.rsi?.enabled
      ? computeRSI(filteredBars, ind.rsi.period).map(p => ({ time: adjustTime(p.time), value: p.value }))
      : []
    const bbRaw = ind.bb?.enabled
      ? computeBB(filteredBars, ind.bb.period, ind.bb.stdDev)
      : { upper: [], middle: [], lower: [] }
    const vwapRaw = (ind.vwap?.enabled && VWAP_TFS.has(resolvedTf))
      ? computeVWAP(filteredBars)
      : []
    const stochRaw = ind.stoch?.enabled
      ? computeStochastic(filteredBars, ind.stoch.kPeriod, ind.stoch.dPeriod)
      : { k: [], d: [] }
    const atrRaw = ind.atr?.enabled
      ? computeATR(filteredBars, ind.atr.period)
      : []
    return {
      rsi: rsiRaw,
      bb: {
        upper:  bbRaw.upper.map(p  => ({ time: adjustTime(p.time), value: p.value })),
        middle: bbRaw.middle.map(p => ({ time: adjustTime(p.time), value: p.value })),
        lower:  bbRaw.lower.map(p  => ({ time: adjustTime(p.time), value: p.value })),
      },
      vwap: vwapRaw.map(p => ({ time: adjustTime(p.time), value: p.value })),
      macd: (() => {
        const macdCfg = ind.macd
        if (!macdCfg?.enabled) return { macd: [], signal: [], histogram: [] }
        const raw = computeMACD(filteredBars, macdCfg.fastPeriod, macdCfg.slowPeriod, macdCfg.signalPeriod)
        return {
          macd:      raw.macd.map(p      => ({ time: adjustTime(p.time), value: p.value })),
          signal:    raw.signal.map(p    => ({ time: adjustTime(p.time), value: p.value })),
          histogram: raw.histogram.map(p => ({ time: adjustTime(p.time), value: p.value, color: p.color })),
        }
      })(),
      stoch: {
        k: stochRaw.k.map(p => ({ time: adjustTime(p.time), value: p.value })),
        d: stochRaw.d.map(p => ({ time: adjustTime(p.time), value: p.value })),
      },
      atr: atrRaw.map(p => ({ time: adjustTime(p.time), value: p.value })),
    }
  }, [filteredBars, cs.indicators, resolvedTf, adjustTime])
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/StockChart.jsx
git commit -m "feat: refactor computePaneMargins + extend indicatorData for Stoch/ATR"
```

---

### Task 5: StockChart — Stochastic sub-pane

**Files:**
- Modify: `app/src/components/StockChart.jsx`

- [ ] **Step 1: Add stochKRef and stochDRef near rsiSeriesRef**

Find:
```javascript
  const rsiSeriesRef  = useRef(null)
```
Replace with:
```javascript
  const rsiSeriesRef  = useRef(null)
  const stochKRef     = useRef(null)
  const stochDRef     = useRef(null)
```

- [ ] **Step 2: Add Stochastic series management in updateChart, after the RSI section**

The RSI section ends with:
```javascript
    } else if (rsiSeriesRef.current) {
      try { chart.removeSeries(rsiSeriesRef.current) } catch {}
      rsiSeriesRef.current = null
    }

    // ── MACD sub-pane ──
```

Insert BEFORE `// ── MACD sub-pane ──`:

```javascript
    // ── Stochastic sub-pane ──
    const stochCfg = cs.indicators?.stoch
    const stochD   = indicatorData.stoch
    if (stochD.k.length) {
      if (!stochKRef.current) {
        stochKRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'stoch',
          color: stochCfg?.kColor || '#FF6B6B',
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        stochDRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'stoch',
          color: stochCfg?.dColor || '#4ECDC4',
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        chart.priceScale('stoch').applyOptions({
          borderVisible: false,
          scaleMargins: paneMargins.stoch || { top: 0.82, bottom: 0 },
          autoScale: false,
          minimum: 0,
          maximum: 100,
        })
        stochKRef.current.createPriceLine({ price: 80, color: 'rgba(255,107,107,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
        stochKRef.current.createPriceLine({ price: 20, color: 'rgba(78,205,196,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      } else {
        stochKRef.current.applyOptions({ color: stochCfg?.kColor || '#FF6B6B' })
        stochDRef.current.applyOptions({ color: stochCfg?.dColor || '#4ECDC4' })
        chart.priceScale('stoch').applyOptions({ scaleMargins: paneMargins.stoch || { top: 0.82, bottom: 0 } })
      }
      stochKRef.current.setData(stochD.k)
      stochDRef.current.setData(stochD.d)
    } else {
      for (const ref of [stochKRef, stochDRef]) {
        if (ref.current) { try { chart.removeSeries(ref.current) } catch {}; ref.current = null }
      }
    }

    // ── MACD sub-pane ──
```

- [ ] **Step 3: Add Stochastic values to crosshair handler**

Find in the crosshair handler:
```javascript
      let rsiValue = null
      if (rsiSeriesRef.current) {
        const d = param.seriesData.get(rsiSeriesRef.current)
        rsiValue = d?.value ?? (indicatorData.rsi.at(-1)?.value ?? null)
      }
```

After those lines, add:
```javascript
      let stochKValue = null, stochDValue = null
      if (stochKRef.current) {
        const dk = param.seriesData.get(stochKRef.current)
        const dd = stochDRef.current ? param.seriesData.get(stochDRef.current) : null
        stochKValue = dk?.value ?? (indicatorData.stoch.k.at(-1)?.value ?? null)
        stochDValue = dd?.value ?? (indicatorData.stoch.d.at(-1)?.value ?? null)
      }
```

Then add `stochK: stochKValue, stochD: stochDValue` to the `setCrosshairData` call. Find:
```javascript
        rsi: rsiValue, macd: macdValue, macdSig: macdSignalValue,
```
Replace with:
```javascript
        rsi: rsiValue, macd: macdValue, macdSig: macdSignalValue,
        stochK: stochKValue, stochD: stochDValue,
```

- [ ] **Step 4: Render Stochastic in legend JSX**

Find the MACD legend lines ending with:
```jsx
          {crosshairData.macdSig != null && (
            <span style={{ color: cs.indicators?.macd?.signalColor || '#FF9800' }}>
              SIG {crosshairData.macdSig.toFixed(4)}
            </span>
          )}
        </div>
```

Replace with:
```jsx
          {crosshairData.macdSig != null && (
            <span style={{ color: cs.indicators?.macd?.signalColor || '#FF9800' }}>
              SIG {crosshairData.macdSig.toFixed(4)}
            </span>
          )}
          {crosshairData.stochK != null && (
            <span style={{ color: cs.indicators?.stoch?.kColor || '#FF6B6B' }}>
              %K {crosshairData.stochK.toFixed(1)}
            </span>
          )}
          {crosshairData.stochD != null && (
            <span style={{ color: cs.indicators?.stoch?.dColor || '#4ECDC4' }}>
              %D {crosshairData.stochD.toFixed(1)}
            </span>
          )}
        </div>
```

- [ ] **Step 5: Commit**

```bash
git add app/src/components/StockChart.jsx
git commit -m "feat: add Stochastic sub-pane to StockChart"
```

---

### Task 6: StockChart — ATR sub-pane

**Files:**
- Modify: `app/src/components/StockChart.jsx`

- [ ] **Step 1: Add atrSeriesRef near stochDRef**

Find:
```javascript
  const stochKRef     = useRef(null)
  const stochDRef     = useRef(null)
```
Replace with:
```javascript
  const stochKRef     = useRef(null)
  const stochDRef     = useRef(null)
  const atrSeriesRef  = useRef(null)
```

- [ ] **Step 2: Add ATR series management in updateChart, after MACD section**

The MACD cleanup section ends with:
```javascript
    } else {
      for (const ref of [macdLineRef, macdSignalRef, macdHistRef]) {
        if (ref.current) { try { chart.removeSeries(ref.current) } catch {}; ref.current = null }
      }
    }

    // ── Price lines — remove old, add new ──
```

Insert BEFORE `// ── Price lines`:
```javascript
    // ── ATR sub-pane ──
    if (indicatorData.atr.length) {
      const atrColor = cs.indicators?.atr?.color || '#FFA726'
      if (!atrSeriesRef.current) {
        atrSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'atr',
          color: atrColor,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        chart.priceScale('atr').applyOptions({
          borderVisible: false,
          scaleMargins: paneMargins.atr || { top: 0.86, bottom: 0 },
          autoScale: true,
        })
      } else {
        atrSeriesRef.current.applyOptions({ color: atrColor })
        chart.priceScale('atr').applyOptions({ scaleMargins: paneMargins.atr || { top: 0.86, bottom: 0 } })
      }
      atrSeriesRef.current.setData(indicatorData.atr)
    } else if (atrSeriesRef.current) {
      try { chart.removeSeries(atrSeriesRef.current) } catch {}
      atrSeriesRef.current = null
    }

    // ── Price lines — remove old, add new ──
```

- [ ] **Step 3: Add ATR to crosshair handler**

Find:
```javascript
      let stochKValue = null, stochDValue = null
```

After the stoch block, add:
```javascript
      let atrValue = null
      if (atrSeriesRef.current) {
        const da = param.seriesData.get(atrSeriesRef.current)
        atrValue = da?.value ?? (indicatorData.atr.at(-1)?.value ?? null)
      }
```

Add `atr: atrValue` to `setCrosshairData`. Find:
```javascript
        stochK: stochKValue, stochD: stochDValue,
```
Replace with:
```javascript
        stochK: stochKValue, stochD: stochDValue,
        atr: atrValue,
```

- [ ] **Step 4: Render ATR in legend JSX**

Find:
```jsx
          {crosshairData.stochD != null && (
            <span style={{ color: cs.indicators?.stoch?.dColor || '#4ECDC4' }}>
              %D {crosshairData.stochD.toFixed(1)}
            </span>
          )}
        </div>
```

Replace with:
```jsx
          {crosshairData.stochD != null && (
            <span style={{ color: cs.indicators?.stoch?.dColor || '#4ECDC4' }}>
              %D {crosshairData.stochD.toFixed(1)}
            </span>
          )}
          {crosshairData.atr != null && (
            <span style={{ color: cs.indicators?.atr?.color || '#FFA726' }}>
              ATR({cs.indicators?.atr?.period || 14}) {crosshairData.atr.toFixed(4)}
            </span>
          )}
        </div>
```

- [ ] **Step 5: Commit**

```bash
git add app/src/components/StockChart.jsx
git commit -m "feat: add ATR sub-pane to StockChart"
```

---

### Task 7: StockChart — earnings + split markers

**Files:**
- Modify: `app/src/components/StockChart.jsx`

Earnings and split markers are fetched via SWR and merged into the existing `createSeriesMarkers` pipeline. They only render on Daily/Weekly charts (intraday doesn't have enough granularity to show per-quarter earnings).

- [ ] **Step 1: Add a SWR fetch for chart markers**

Find the existing SWR fetcher line near the top of the component:
```javascript
  const { prefs, setPref } = usePreferences()
```

After the SWR data fetch for bars (the line containing `useSWR(swrUrl, fetcher, ...)`), add a new SWR hook for markers. Find the bars SWR hook — it looks like:
```javascript
  const { data, error } = useSWR(swrUrl, fetcher, { dedupingInterval: dedupMs })
```

After that line, add:
```javascript
  const markersEnabled = cs.markers?.earnings || cs.markers?.splits
  const { data: markersData } = useSWR(
    markersEnabled && sym ? `/api/chart/markers/${encodeURIComponent(sym)}` : null,
    fetcher,
    { dedupingInterval: 21_600_000 }  // 6 hours — markers don't change often
  )
```

- [ ] **Step 2: Build chartEventMarkers from markersData**

In the useMemo section (after `indicatorData` useMemo), add:

```javascript
  const chartEventMarkers = useMemo(() => {
    // Only show event markers on daily/weekly — intraday bars don't line up with quarter dates
    const isDailyWeekly = !['1', '5', '15', '30', '60'].includes(resolvedTf)
    if (!markersData || !isDailyWeekly) return []
    const markers = []
    if (cs.markers?.earnings && Array.isArray(markersData.earnings)) {
      for (const e of markersData.earnings) {
        if (!e.date) continue
        markers.push({
          time: e.date,
          position: 'belowBar',
          color: e.beat === true ? '#4ade80' : e.beat === false ? '#f87171' : '#94a3b8',
          shape: e.beat === true ? 'arrowUp' : 'arrowDown',
          text: 'E',
          size: 1,
        })
      }
    }
    if (cs.markers?.splits && Array.isArray(markersData.splits)) {
      for (const s of markersData.splits) {
        if (!s.date) continue
        markers.push({
          time: s.date,
          position: 'aboveBar',
          color: '#60a5fa',
          shape: 'square',
          text: s.ratio || 'S',
          size: 1,
        })
      }
    }
    return markers
  }, [markersData, cs.markers, resolvedTf])
```

- [ ] **Step 3: Merge chartEventMarkers into mergedMarkers**

Find:
```javascript
  const mergedMarkers = useMemo(
    () => [...(markers || []), ...(j2.markers || [])],
    [markers, j2.markers],
  )
```

Replace with:
```javascript
  const mergedMarkers = useMemo(
    () => [...(markers || []), ...(j2.markers || []), ...chartEventMarkers],
    [markers, j2.markers, chartEventMarkers],
  )
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/StockChart.jsx
git commit -m "feat: add earnings and split date markers to StockChart"
```

---

### Task 8: ChartToolbar — Stochastic/ATR/Markers UI

**Files:**
- Modify: `app/src/components/chart/ChartToolbar.jsx`

- [ ] **Step 1: Add Stochastic and ATR rows to the Indicators section**

Find the VWAP row in the Indicators section:
```jsx
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
```

Replace with:
```jsx
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

        {/* Stochastic */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.stoch?.enabled ?? false}
            onChange={e => updateIndicator('stoch', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>Stoch</span>
          <div className={styles.sMiniPeriodGroup}>
            <input type="number" className={styles.sPeriodInput}
              value={cs.indicators?.stoch?.kPeriod ?? 14} min={1} max={100}
              onChange={e => updateIndicator('stoch', 'kPeriod', e.target.value)} title="%K Period" />
            <input type="number" className={styles.sPeriodInput}
              value={cs.indicators?.stoch?.dPeriod ?? 3} min={1} max={20}
              onChange={e => updateIndicator('stoch', 'dPeriod', e.target.value)} title="%D Period" />
          </div>
          <ColorPicker value={cs.indicators?.stoch?.kColor ?? '#FF6B6B'}
            onChange={v => updateIndicator('stoch', 'kColor', v)} />
        </div>

        {/* ATR */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.atr?.enabled ?? false}
            onChange={e => updateIndicator('atr', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>ATR</span>
          <input type="number" className={styles.sPeriodInput}
            value={cs.indicators?.atr?.period ?? 14} min={1} max={100}
            onChange={e => updateIndicator('atr', 'period', e.target.value)} title="Period" />
          <ColorPicker value={cs.indicators?.atr?.color ?? '#FFA726'}
            onChange={v => updateIndicator('atr', 'color', v)} />
        </div>
      </div>
```

- [ ] **Step 2: Add Markers section after the Display section**

The Display section ends with:
```jsx
      </div>

      {/* Crosshair */}
```

Insert BEFORE `{/* Crosshair */}`:
```jsx
      {/* Chart Markers */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Markers</span>
        <div className={styles.sRow}>
          <label className={styles.sCheck}>
            <input type="checkbox"
              checked={cs.markers?.earnings ?? false}
              onChange={e => {
                const next = { ...cs, markers: { ...cs.markers, earnings: e.target.checked }, preset: 'custom' }
                onUpdateSettings(next)
              }} />
            Earnings
          </label>
          <label className={styles.sCheck}>
            <input type="checkbox"
              checked={cs.markers?.splits ?? false}
              onChange={e => {
                const next = { ...cs, markers: { ...cs.markers, splits: e.target.checked }, preset: 'custom' }
                onUpdateSettings(next)
              }} />
            Splits
          </label>
        </div>
      </div>

      {/* Crosshair */}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/chart/ChartToolbar.jsx
git commit -m "feat: add Stoch/ATR/Markers controls to ChartSettingsPanel"
```

---

### Task 9: Deploy to Railway

**Files:** None — deployment only.

- [ ] **Step 1: Push to Railway**

```bash
git push origin master
```

Expected output: `master -> master` with no errors.

- [ ] **Step 2: Verify in production**

Visit `https://uctintelligence.com`. Open any chart, click the gear icon.

1. **Indicators section** now shows: RSI, MACD, BB, VWAP, Stoch, ATR rows
2. Toggle **Stochastic on** → red/teal sub-pane with 80/20 reference lines
3. Toggle **ATR on** → orange sub-pane showing volatility in dollar terms
4. Enable multiple indicators (RSI + MACD + Stoch + ATR) → verify all panes are visible and price area has ≥28% height (panes scale down automatically)
5. **Markers section** shows Earnings + Splits checkboxes
6. On a Daily chart, toggle **Earnings on** → green ▲ (beats) and red ▼ (misses) appear on the candles
7. Toggle **Splits on** → blue squares appear at split dates (if the ticker had any in the last 5 years)
8. Switch to a 5min chart with Earnings on → no markers appear (intraday guard)

---

## Self-Review

### Spec coverage

| Feature | Task |
|---|---|
| computeStochastic (fast %K + %D) | Task 1 |
| computeATR (Wilder smoothing) | Task 1 |
| chartDefaults schema: stoch/atr/markers | Task 2 |
| mergeChartSettings deep-merge | Task 2 |
| Backend: Finnhub earnings history (16 quarters) | Task 3 |
| Backend: Finnhub splits (5 years) | Task 3 |
| GET /api/chart/markers/{ticker} | Task 3 |
| computePaneMargins data-driven refactor | Task 4 |
| indicatorData extended: stoch + atr | Task 4 |
| Stochastic series (2 LineSeries, 'stoch' scale) | Task 5 |
| Stochastic 80/20 reference lines | Task 5 |
| Stochastic crosshair + legend | Task 5 |
| ATR series (1 LineSeries, 'atr' scale) | Task 6 |
| ATR crosshair + legend | Task 6 |
| Earnings markers SWR fetch + merge | Task 7 |
| Split markers SWR fetch + merge | Task 7 |
| Daily/weekly-only guard for event markers | Task 7 |
| Stoch/ATR UI rows in ChartSettingsPanel | Task 8 |
| Markers section in ChartSettingsPanel | Task 8 |
| Deploy | Task 9 |

### Placeholder scan

No TBDs. All code is complete. All types are consistent across tasks.

### Type consistency

- `indicatorData.stoch` returns `{ k: [{time, value}], d: [{time, value}] }` — used correctly in Task 5 as `stochD.k` / `stochD.d` (where `stochD = indicatorData.stoch`).
- `indicatorData.atr` returns `[{time, value}]` — used correctly in Task 6 as `indicatorData.atr`.
- `cs.indicators.stoch` fields: `enabled`, `kPeriod`, `dPeriod`, `kColor`, `dColor` — used consistently in Tasks 2, 5, 8.
- `cs.indicators.atr` fields: `enabled`, `period`, `color` — used consistently in Tasks 2, 6, 8.
- `cs.markers` fields: `earnings`, `splits` — used consistently in Tasks 2, 7, 8.
- `computeStochastic(bars, kPeriod, dPeriod)` — parameter order matches calls in Task 4 (`ind.stoch.kPeriod, ind.stoch.dPeriod`) and Task 1 definition.
- `computeATR(bars, period)` — matches Task 4 call.
