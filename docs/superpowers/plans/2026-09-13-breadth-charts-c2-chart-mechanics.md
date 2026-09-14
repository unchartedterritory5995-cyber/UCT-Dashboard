# Breadth Data Charts — C2 "chart mechanics" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The legacy chart stops misbehaving: reference lines sit on their own family's axis and survive hand edits, a
flattened series is announced instead of hidden, dates carry their year, zoom and hidden series survive every rebuild,
the chart draws once instead of replaying on every live tick, and Notable Extremes appears only where it works.

**Architecture:** Three pure modules — `breadth/chartTicks.js` (tick and tooltip dates), `breadth/chartZoom.js` (zoom
window as dates), `breadth/chartMagnitude.js` (the runtime flattening rule) — and a metric-attached reference-line map in
`chartMetrics.js` replace the preset `lines:` arrays and the hand-typed `MAX_ABS` test table. `BreadthCharts.jsx` keeps
`notMerge` and gains zoom, legend and paint state so every rebuild re-applies what the member set (D-028).

**Tech Stack:** React 19, ECharts 6 via echarts-for-react 3.0.6, Vitest 4 + Testing Library.

**Spec:** `docs/breadth/01-audit.md` A-02, A-03, A-04 (C), A-06, A-07, A-08, A-22 (C); `docs/breadth/02-design.md` §4
(ticks, tooltip header), §7 (motion); decisions D-009, D-028 … D-031.

## Global Constraints

- Canonical reference constants only (standing decision): parity 1.0, thrust 2.0, fear 25 / greed 75, VIX 20, flat 0.
- One authority per value: lines live on metrics (`METRIC_REF_LINES`); presets carry no `lines:`; the 6× limit is one
  exported constant, not a test table.
- No new polling site, no new endpoint, no flag (corrective merge). Copy in sentence case.
- Motion (02-design §7): first paint draws 400 ms; every later change is instant; `prefers-reduced-motion` is instant always.
- Assert on what ECharts is handed (`props.option`, `props.onEvents`) and on rendered text; never on component state.
- Tests before code, seen failing; own tool call before commit; named paths only; totals lines checked.
- Acceptance: six-shard gate on the C2 tree adds no failing test to `docs/breadth/gates.md`'s C1 set.

---

## File structure

| File | Responsibility |
|---|---|
| Create `app/src/pages/breadth/chartTicks.js` (+ `.test.js`) | `spanDays`, `tickBoundary`, `formatSessionTick`, `formatTooltipDate` |
| Create `app/src/pages/breadth/chartZoom.js` (+ `.test.js`) | `zoomWindowFrom(params, dates)`, `zoomValues(zoom, dates)` |
| Create `app/src/pages/breadth/chartMagnitude.js` (+ `.test.js`) | `MAGNITUDE_LIMIT`, `magnitudeGaps`, `describeGap` |
| Modify `app/src/pages/breadth/chartMetrics.js` | `METRIC_REF_LINES`; `resolveLines(selected, extentOf)`; presets lose `lines:` |
| Modify `app/src/pages/breadth/chartMetrics.test.js` | resolveLines rewritten; `MAX_ABS` table and its two tests removed |
| Modify `app/src/pages/BreadthCharts.jsx` (+ `.module.css`) | per-axis line series, zoom state, legend.selected, first-paint motion, ticks, notice, extremes only in MA Breadth |
| Modify `app/src/pages/BreadthCharts.test.jsx` | line series names per axis; hand-edit and Volume Thrust rails |
| Create `app/src/pages/BreadthCharts.mechanics.test.jsx` | zoom, hidden, motion, ticks, notice, extremes placement |

---

### Task 1: `chartTicks.js` (A-06)

**Produces:** `spanDays(fromIso, toIso) → number` · `tickBoundary(dates, span) → null | (index) => boolean` ·
`formatSessionTick(iso, span, isFirstOfYear) → string` · `formatTooltipDate(iso) → 'Fri, Sep 11, 2026'`

- [ ] **Step 1: failing test** `app/src/pages/breadth/chartTicks.test.js`

```js
// app/src/pages/breadth/chartTicks.test.js
import { describe, it, expect } from 'vitest'
import { spanDays, tickBoundary, formatSessionTick, formatTooltipDate } from './chartTicks'

describe('spanDays', () => {
  it('counts calendar days between two session dates', () => {
    expect(spanDays('2026-06-15', '2026-09-11')).toBe(88)
    expect(spanDays('2024-09-16', '2026-09-11')).toBe(725)
    expect(spanDays(null, '2026-09-11')).toBe(0)
  })
})

describe('formatSessionTick', () => {
  // A-06: labels were MM/DD, so over a year "03/31" appeared twice, a year apart.
  it('shows month and day within six months, and the year on the first session of a year', () => {
    expect(formatSessionTick('2026-06-15', 90, false)).toBe('Jun 15')
    expect(formatSessionTick('2026-01-02', 90, true)).toBe('Jan 2, 2026')
  })
  it('shows month and short year up to two years', () => {
    expect(formatSessionTick('2026-06-01', 365, false)).toBe("Jun '26")
    expect(formatSessionTick('2025-03-31', 730, false)).toBe("Mar '25")
  })
  it('shows the year beyond two years', () => {
    expect(formatSessionTick('2024-01-02', 731, true)).toBe('2024')
  })
})

describe('tickBoundary', () => {
  const dates = ['2025-12-30', '2025-12-31', '2026-01-02', '2026-01-05', '2026-02-02', '2026-02-03']
  it('leaves spacing to ECharts within six months', () => {
    expect(tickBoundary(dates, 90)).toBeNull()
  })
  it('labels the first session of each month up to two years', () => {
    const at = tickBoundary(dates, 400)
    expect(dates.map((_, i) => at(i))).toEqual([true, false, true, false, true, false])
  })
  it('labels the first session of each year beyond two years', () => {
    const at = tickBoundary(dates, 900)
    expect(dates.map((_, i) => at(i))).toEqual([true, false, true, false, false, false])
  })
})

describe('formatTooltipDate', () => {
  it('names the weekday and the year (02-design §4)', () => {
    expect(formatTooltipDate('2026-09-11')).toBe('Fri, Sep 11, 2026')
    expect(formatTooltipDate('2024-02-29')).toBe('Thu, Feb 29, 2024')
  })
})
```

- [ ] **Step 2:** `npx vitest run src/pages/breadth/chartTicks.test.js` → FAIL (module missing)
- [ ] **Step 3: implement** `app/src/pages/breadth/chartTicks.js`

```js
/**
 * Dates on the Data Charts x axis and in its tooltip.
 *
 * ⚰️ THE DEFECT (audit A-06): ticks were `MM/DD`, so a year-long window showed
 * "03/31" twice, a year apart, and nothing said which was which. The format now
 * follows the visible span (02-design §4): ≤ 6 months "Jun 15" (the first session
 * of a year carries it), ≤ 2 years "Jun '26" on month starts, longer "2026" on
 * year starts. Session dates are ISO labels; no time zone is involved.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SHORT_SPAN_DAYS = 183
const MEDIUM_SPAN_DAYS = 730

const parts = iso => iso.split('-').map(Number)

/** Calendar days from `fromIso` to `toIso`; 0 when either is missing. */
export function spanDays(fromIso, toIso) {
  if (!fromIso || !toIso) return 0
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000)
}

/** Which categories carry a label: null lets ECharts space them; otherwise month or year starts. */
export function tickBoundary(dates, span) {
  if (span <= SHORT_SPAN_DAYS) return null
  const cut = span <= MEDIUM_SPAN_DAYS ? 7 : 4          // 'YYYY-MM' or 'YYYY'
  return index => index === 0 || dates[index].slice(0, cut) !== dates[index - 1].slice(0, cut)
}

export function formatSessionTick(iso, span, isFirstOfYear = false) {
  const [y, m, d] = parts(iso)
  if (span > MEDIUM_SPAN_DAYS) return String(y)
  if (span > SHORT_SPAN_DAYS) return `${MONTHS[m - 1]} '${String(y).slice(2)}`
  return isFirstOfYear ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${d}`
}

export function formatTooltipDate(iso) {
  const [y, m, d] = parts(iso)
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`
}
```

- [ ] **Step 4:** PASS · **Step 5:** commit both files — "Breadth charts: dates on the axis carry their year (A-06)"

---

### Task 2: `chartZoom.js` (A-07)

**Produces:** `zoomWindowFrom(params, dates) → {from, to} | null` (null = the whole range) ·
`zoomValues(zoom, dates) → {startValue, endValue} | null`

ECharts payloads, read in `echarts/lib/component/dataZoom`: inside zoom dispatches `{batch: [{start, end}]}` (percent,
`roams.js`), the slider `{start, end}` (`SliderZoomView.js`), and `startValue`/`endValue` are honoured when present
(`dataZoomAction.js`).

- [ ] **Step 1: failing test** `app/src/pages/breadth/chartZoom.test.js`

```js
// app/src/pages/breadth/chartZoom.test.js
import { describe, it, expect } from 'vitest'
import { zoomWindowFrom, zoomValues } from './chartZoom'

const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-08']

describe('zoomWindowFrom', () => {
  it('reads an inside-zoom batch in percent', () => {
    expect(zoomWindowFrom({ batch: [{ start: 50, end: 100 }] }, dates)).toEqual({ from: '2026-09-03', to: '2026-09-08' })
  })
  it('reads a slider payload in percent', () => {
    expect(zoomWindowFrom({ start: 0, end: 25 }, dates)).toEqual({ from: '2026-09-01', to: '2026-09-02' })
  })
  it('prefers explicit values, by index or by category', () => {
    expect(zoomWindowFrom({ startValue: 1, endValue: 3 }, dates)).toEqual({ from: '2026-09-02', to: '2026-09-04' })
    expect(zoomWindowFrom({ startValue: '2026-09-02', endValue: '2026-09-03' }, dates)).toEqual({ from: '2026-09-02', to: '2026-09-03' })
  })
  it('treats the whole range as no zoom', () => {
    expect(zoomWindowFrom({ start: 0, end: 100 }, dates)).toBeNull()
    expect(zoomWindowFrom({ start: 10, end: 90 }, [])).toBeNull()
  })
})

describe('zoomValues', () => {
  // The window is dates, so a new live row or a changed selection keeps it where the member put it.
  it('maps a date window onto the sessions present', () => {
    expect(zoomValues({ from: '2026-09-02', to: '2026-09-05' }, dates)).toEqual({ startValue: '2026-09-02', endValue: '2026-09-04' })
  })
  it('returns null when nothing is zoomed or no session falls inside', () => {
    expect(zoomValues(null, dates)).toBeNull()
    expect(zoomValues({ from: '2026-10-01', to: '2026-10-05' }, dates)).toBeNull()
  })
})
```

- [ ] **Step 2:** FAIL · **Step 3: implement** `app/src/pages/breadth/chartZoom.js`

```js
/**
 * The zoom window as DATES.
 *
 * ⚰️ THE DEFECT (audit A-07): the chart rebuilds with `notMerge`, so every change —
 * a ticked metric, a live tick, a hidden series — threw the zoom away and showed
 * the full range again. Held as dates, the window survives any rebuild and any
 * new row; it is written back as `dataZoom.startValue/endValue`.
 */
export function zoomWindowFrom(params, dates) {
  if (!dates?.length) return null
  const last = dates.length - 1
  const b = params?.batch?.[0] ?? params ?? {}
  const clamp = i => Math.max(0, Math.min(last, i))
  const index = (value, pct, fallback) => {
    if (typeof value === 'number') return clamp(Math.round(value))
    if (typeof value === 'string') { const i = dates.indexOf(value); return i >= 0 ? i : fallback }
    if (typeof pct === 'number') return clamp(Math.round((pct / 100) * last))
    return fallback
  }
  const a = index(b.startValue, b.start, 0)
  const z = index(b.endValue, b.end, last)
  const from = Math.min(a, z)
  const to = Math.max(a, z)
  return from <= 0 && to >= last ? null : { from: dates[from], to: dates[to] }
}

export function zoomValues(zoom, dates) {
  if (!zoom || !dates?.length) return null
  const inside = dates.filter(d => d >= zoom.from && d <= zoom.to)
  return inside.length ? { startValue: inside[0], endValue: inside[inside.length - 1] } : null
}
```

- [ ] **Step 4:** PASS · **Step 5:** commit — "Breadth charts: hold the zoom window as dates (A-07)"

---

### Task 3: reference lines attach to metrics and draw per axis (A-02, A-03)

**Produces:** `METRIC_REF_LINES: Record<key, {at, label}[]>` · `resolveLines(selected, extentOf) → {unit, at, label, axis}[]`

- [ ] **Step 1: failing tests**

`chartMetrics.test.js` — replace the whole `describe('resolveLines', …)` block (lines 398–464) with:

```js
describe('resolveLines — lines belong to metrics (D-009)', () => {
  const always = () => [-1e9, 1e9]

  it('draws nothing when no plotted metric owns a line', () => {
    expect(resolveLines(['up_4pct_today', 'new_52w_highs'], always)).toEqual([])
  })

  it('draws a metric\'s lines on the axis its family resolved to, once per level', () => {
    // two counts, two ratios: counts keep the left axis on the tie, ratios go right
    const out = resolveLines(['up_4pct_today', 'down_4pct_today', 'ratio_5day', 'ratio_10day'], always)
    expect(out.map(l => [l.at, l.label, l.axis])).toEqual([[1, 'parity', 1], [2, 'thrust', 1]])
  })

  // A-02: Volume Thrust's flat line was drawn at ratio 0, the bottom of the plot.
  it('puts each family\'s line on its own axis when two families own lines', () => {
    const out = resolveLines(['up_vol_ratio', 'adv_decline'], always)
    expect(out).toEqual([
      { unit: UNIT.RATIO, at: 1, label: 'parity', axis: 0 },
      { unit: UNIT.NET, at: 0, label: 'flat', axis: 1 },
    ])
  })

  // An anchored axis already includes 0, so a line may extend it: greed at 75 stays
  // visible while Fear/Greed sits at 8.7, because the distance to it is the information.
  it('always draws on an anchored family, even outside the data', () => {
    expect(resolveLines(['cnn_fear_greed'], () => [8.7, 12.0])).toHaveLength(2)
  })

  // ECharts expands an axis to contain a markLine, so a zero line on a window starting
  // at 5,781 would drag the auto-framed CUM axis back to 0.
  it('suppresses a line that would expand an auto-framed axis, and when the extent is unknown', () => {
    expect(resolveLines(['adv_decline_cum'], () => [5781, 13981])).toEqual([])
    expect(resolveLines(['adv_decline_cum'], () => [-995, 13981])).toHaveLength(1)
    expect(resolveLines(['adv_decline_cum'], () => null)).toEqual([])
  })

  it('only names metrics the catalog offers, with canonical constants', () => {
    const CANON = new Set(['1|parity', '2|thrust', '25|fear', '75|greed', '20|20', '0|flat'])
    for (const [key, lines] of Object.entries(METRIC_REF_LINES)) {
      expect(LABEL_MAP[key], `${key} is not a catalog metric`).toBeTruthy()
      for (const l of lines) expect(CANON, `${key} ${l.at} ${l.label}`).toContain(`${l.at}|${l.label}`)
    }
  })

  it('leaves presets with no lines of their own — one authority', () => {
    expect(CHART_PRESETS.filter(p => 'lines' in p).map(p => p.id)).toEqual([])
  })

  // The rail the audit asked for, over every preset.
  it('draws every preset\'s lines on the axis of the family they name', () => {
    for (const preset of CHART_PRESETS) {
      const { axisByKey } = resolveAxes(preset.metrics)
      for (const line of resolveLines(preset.metrics, always)) {
        expect(line.axis, `${preset.label}: ${line.label}`).toBe(axisForUnit(preset.metrics, line.unit, axisByKey))
      }
    }
  })

  it('never lets an extremes preset plot a percentage metric that owns a line', () => {
    for (const preset of CHART_PRESETS.filter(p => p.extremes?.length)) {
      const owners = preset.metrics.filter(k => METRIC_REF_LINES[k] && unitOf(k) === UNIT.PCT)
      expect(owners, preset.label).toEqual([])
    }
  })
})
```

and add `METRIC_REF_LINES,` to the import block.

`BreadthCharts.test.jsx` — in `describe('reference lines from a preset')` replace both tests with:

```jsx
  const lineSeries = opt => opt.series.filter(s => s.name.startsWith('__ref_lines_'))

  it('draws the parity and thrust levels on the ratio axis', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('Breadth Thrust')
    await waitFor(() => expect(lineSeries(captured)).toHaveLength(1))
    const [ref] = lineSeries(captured)
    expect(ref.markLine.data.map(d => d.yAxis)).toEqual([1, 2])
    // Ratios took the left axis, so the levels belong there.
    expect(ref.yAxisIndex).toBe(0)
  })

  // A-03: the lines drew only while the selection exactly equalled a preset.
  it('keeps the lines when the selection is edited by hand', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('Breadth Thrust')
    await waitFor(() => expect(lineSeries(captured)).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: /^Regime/ }))
    fireEvent.click(screen.getByLabelText('VIX'))
    await waitFor(() => expect(realSeries(captured)).toHaveLength(6))
    expect(lineSeries(captured).flatMap(s => s.markLine.data.map(d => d.yAxis))).toEqual(expect.arrayContaining([1, 2]))
  })

  // A-02: the flat line sat at ratio 0 on the ratio axis instead of at net 0.
  it('draws Volume Thrust\'s flat line on the net axis and parity on the ratio axis', async () => {
    render(<BreadthCharts />)
    await chart()
    clickPreset('Volume Thrust')
    await waitFor(() => expect(lineSeries(captured)).toHaveLength(2))
    expect(seriesNamed(captured, '__ref_lines_0__').markLine.data.map(d => d.yAxis)).toEqual([1])
    expect(seriesNamed(captured, '__ref_lines_1__').markLine.data.map(d => d.yAxis)).toEqual([0])
  })

  it('suppresses a line that would expand an auto-framed axis', async () => {
    render(<BreadthCharts />)
    await chart()
    // The fixture has no adv_decline_cum, so the CUM extent is unknown. A zero
    // line drawn anyway would drag the framed axis back to zero.
    clickPreset('A/D Line')
    await waitFor(() => expect(realSeries(captured).length).toBeGreaterThan(0))
    expect(lineSeries(captured)).toEqual([])
  })
```

- [ ] **Step 2:** `npx vitest run src/pages/breadth/chartMetrics.test.js src/pages/BreadthCharts.test.jsx` → FAIL
- [ ] **Step 3: implement**

`chartMetrics.js` — delete every preset's `lines: [...]` (thrust, volatility, sentiment, ad-line, volume-thrust,
vol-complex; keep their comments that explain metric choice). After `staleAllowance`, add:

```js
// ── Reference lines ───────────────────────────────────────────────────────────
// Canonical levels belong to the METRIC that defines them (D-009). A line draws
// whenever a metric that owns it is plotted, on that metric's axis — so a hand
// edit keeps it (A-03), and two families' lines never share one axis (A-02).
const PARITY = { at: 1, label: 'parity' }
const THRUST = { at: 2, label: 'thrust' }
const VIX_20 = { at: 20, label: '20' }
const FLAT = { at: 0, label: 'flat' }

export const METRIC_REF_LINES = {
  ratio_5day: [PARITY, THRUST],
  ratio_10day: [PARITY, THRUST],
  up_vol_ratio: [PARITY],
  cboe_putcall: [PARITY],
  avg_10d_cpc: [PARITY],
  cnn_fear_greed: [{ at: 25, label: 'fear' }, { at: 75, label: 'greed' }],
  vix: [VIX_20],
  vxn: [VIX_20],
  avg_10d_vix: [VIX_20],
  avg_10d_vxn: [VIX_20],
  adv_decline: [FLAT],
  adv_decline_cum: [FLAT],
}
```

and replace `resolveLines` with:

```js
/**
 * Reference lines that should actually draw, each with the axis it belongs to.
 *
 * On an auto-framed family a line outside the data would expand the axis to reach
 * it — ECharts grows an axis to contain a markLine — undoing scaleForUnit, so it is
 * suppressed, and so is a line whose extent is unknown. Anchored families already
 * include zero; there the line draws regardless.
 *
 * @param selected  metric keys currently plotted
 * @param extentOf  (unit) => [min, max] over visible rows, or null when unknown
 */
export function resolveLines(selected, extentOf) {
  if (!selected?.length) return []
  const { axisByKey } = resolveAxes(selected)
  const drawn = new Set()
  const out = []
  for (const key of selected) {
    const unit = unitOf(key)
    for (const line of METRIC_REF_LINES[key] ?? []) {
      const id = `${unit}|${line.at}|${line.label}`
      if (drawn.has(id)) continue
      if (scaleForUnit(unit)) {
        const extent = extentOf(unit)
        if (!extent || line.at < extent[0] || line.at > extent[1]) continue
      }
      drawn.add(id)
      out.push({ unit, at: line.at, label: line.label, axis: axisByKey[key] ?? 0 })
    }
  }
  return out
}
```

`BreadthCharts.jsx` — delete the `activePresetDef` memo; replace the single `__ref_lines__` block with:

```jsx
    // One marker series per axis, so each family's lines sit on its own scale (A-02).
    const refLines = resolveLines(selected, extentOf)
    for (const axis of [0, 1]) {
      const onAxis = refLines.filter(l => l.axis === axis)
      if (!onAxis.length) continue
      series.push({
        name: `__ref_lines_${axis}__`,
        type: 'line',
        data: [],
        yAxisIndex: axis,
        silent: true,
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          animation: false,
          label: { formatter: p => p.data.label, color: '#706b5e', fontSize: 10, position: 'insideEndTop' },
          lineStyle: { color: '#4a4d3f', type: 'dashed', width: 1 },
          data: onAxis.map(l => ({ yAxis: l.at, label: l.label })),
        },
      })
    }
```

and drop `activePresetDef` from the option memo's dependency list.

- [ ] **Step 4:** `npx vitest run src/pages/breadth/chartMetrics.test.js src/pages/BreadthCharts.test.jsx` → PASS
- [ ] **Step 5:** commit — "Breadth charts: reference lines belong to metrics and draw on their own axis (A-02, A-03)"

---

### Task 4: `chartMagnitude.js` — the runtime flattening rule (A-04)

**Produces:** `MAGNITUDE_LIMIT = 6` · `magnitudeGaps(selected, rows, axisByKey) → {axis, small, large, ratio}[]` ·
`describeGap(gap, labelOf) → string`

- [ ] **Step 1: failing test** `app/src/pages/breadth/chartMagnitude.test.js`, and in `chartMetrics.test.js` delete the
  `MAX_ABS` constant and the two tests that read it ("keeps same-family metrics within 6x…", "would have failed on both
  round-one defects").

```js
// app/src/pages/breadth/chartMagnitude.test.js
//
// A-04: a hand-typed MAX_ABS table in a test was the only magnitude guard, it had
// drifted (Breadth Thrust's ratio axis spans 23x on today's data), and it never ran
// for a member's own selection. The rule now runs on the rows on screen.
import { describe, it, expect } from 'vitest'
import { MAGNITUDE_LIMIT, magnitudeGaps, describeGap } from './chartMagnitude'

const rows = (series) => Array.from({ length: 5 }, (_, i) =>
  Object.fromEntries(Object.entries(series).map(([k, peak]) => [k, i === 2 ? peak : peak / 2])))

describe('magnitudeGaps', () => {
  it('flags the smaller series when two on one axis differ by more than the limit', () => {
    const gaps = magnitudeGaps(['universe_count', 'new_52w_lows'], rows({ universe_count: 3000, new_52w_lows: 10 }),
      { universe_count: 0, new_52w_lows: 0 })
    expect(gaps).toEqual([{ axis: 0, small: 'new_52w_lows', large: 'universe_count', ratio: 300 }])
  })

  // The two round-one defects, as fixtures rather than as a table.
  it('would have caught QQQ beside the S&P and ATR extension beside monthly movers', () => {
    expect(magnitudeGaps(['sp500_close', 'qqq_close'], rows({ sp500_close: 7737, qqq_close: 746 }),
      { sp500_close: 1, qqq_close: 1 })).toHaveLength(1)
    expect(magnitudeGaps(['up_25pct_month', 'atr_ext_7'], rows({ up_25pct_month: 385, atr_ext_7: 34 }),
      { up_25pct_month: 0, atr_ext_7: 0 })).toHaveLength(1)
  })

  // CONTROL: froth's closest pair (4.8x) and series on different axes are not gaps.
  it('leaves series within the limit, or on different axes, alone', () => {
    expect(magnitudeGaps(['hvc_52w', 'atr_ext_7'], rows({ hvc_52w: 163, atr_ext_7: 34 }),
      { hvc_52w: 0, atr_ext_7: 0 })).toEqual([])
    expect(magnitudeGaps(['universe_count', 'ratio_5day'], rows({ universe_count: 3000, ratio_5day: 2 }),
      { universe_count: 0, ratio_5day: 1 })).toEqual([])
  })

  it('ignores a series with nothing numeric in the window', () => {
    expect(magnitudeGaps(['universe_count', 'new_52w_lows'], rows({ universe_count: 3000 }),
      { universe_count: 0, new_52w_lows: 0 })).toEqual([])
    expect(MAGNITUDE_LIMIT).toBe(6)
  })
})

describe('describeGap', () => {
  const label = k => ({ new_52w_lows: '52W Lows (Close)', universe_count: 'Universe Count' }[k])
  it('says which series is flattened, by how much, on this axis', () => {
    expect(describeGap({ axis: 0, small: 'new_52w_lows', large: 'universe_count', ratio: 300 }, label))
      .toBe('52W Lows (Close) is 300× smaller than Universe Count on this axis.')
    expect(describeGap({ axis: 0, small: 'new_52w_lows', large: 'universe_count', ratio: 7.25 }, label))
      .toBe('52W Lows (Close) is 7.3× smaller than Universe Count on this axis.')
  })
})
```

- [ ] **Step 2:** FAIL · **Step 3: implement** `app/src/pages/breadth/chartMagnitude.js`

```js
/**
 * When one series on an axis is far smaller than another, it draws as a line on
 * the floor. Legacy charts say so (audit A-04); V2 will split it into its own panel.
 * Computed from the rows on screen, so it describes what the member is looking at.
 */
export const MAGNITUDE_LIMIT = 6

const isNum = v => typeof v === 'number' && Number.isFinite(v)

export function magnitudeGaps(selected, rows, axisByKey) {
  const byAxis = new Map()
  for (const key of selected ?? []) {
    const peak = (rows ?? []).reduce((m, r) => (isNum(r[key]) ? Math.max(m, Math.abs(r[key])) : m), 0)
    if (peak <= 0) continue
    const axis = axisByKey[key] ?? 0
    if (!byAxis.has(axis)) byAxis.set(axis, [])
    byAxis.get(axis).push({ key, peak })
  }
  const gaps = []
  for (const [axis, series] of byAxis) {
    if (series.length < 2) continue
    const large = series.reduce((a, b) => (b.peak > a.peak ? b : a))
    for (const s of series) {
      const ratio = large.peak / s.peak
      if (s !== large && ratio > MAGNITUDE_LIMIT) gaps.push({ axis, small: s.key, large: large.key, ratio })
    }
  }
  return gaps
}

export function describeGap(gap, labelOf) {
  const times = gap.ratio >= 10 ? String(Math.round(gap.ratio)) : gap.ratio.toFixed(1)
  return `${labelOf(gap.small)} is ${times}× smaller than ${labelOf(gap.large)} on this axis.`
}
```

- [ ] **Step 4:** `npx vitest run src/pages/breadth/chartMagnitude.test.js src/pages/breadth/chartMetrics.test.js` → PASS
- [ ] **Step 5:** commit — "Breadth charts: a flattened series is announced, from the rows on screen (A-04)"

---

### Task 5: `BreadthCharts.jsx` — zoom, hidden series and motion survive rebuilds; ticks, notice, extremes (A-04, A-06, A-07, A-08, A-22)

**Consumes:** Tasks 1, 2, 4.

- [ ] **Step 1: failing test** `app/src/pages/BreadthCharts.mechanics.test.jsx`

```jsx
// app/src/pages/BreadthCharts.mechanics.test.jsx
//
// What the member set must survive a rebuild: the zoom window (A-07) and a hidden
// series (A-08). The chart draws once, then updates instantly (02-design §7). Ticks
// carry the year (A-06); a flattened series is announced (A-04); Notable Extremes
// appears only in the group where it draws (A-22). Asserted on what ECharts is handed.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BreadthCharts from './BreadthCharts'
import { todayET, shiftISO } from './breadth/sessionDates'

let captured = null
let events = null
vi.mock('echarts-for-react', () => ({
  default: (props) => { captured = props.option; events = props.onEvents; return <div data-testid="echart" /> },
}))

const ROWS = Array.from({ length: 40 }, (_, i) => ({
  date: shiftISO(todayET(), i - 39),
  breadth_score: 60 + (i % 9), pct_above_50sma: 45 + (i % 7),
  universe_count: 3000 + i, new_52w_lows: 10 + (i % 5), new_52w_highs: 40 + (i % 6),
}))

beforeEach(() => {
  captured = null
  events = null
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    const u = String(url)
    const body = u.includes('/api/breadth-monitor/live') ? { ok: false }
      : u.includes('/api/breadth-monitor') ? { rows: ROWS }
      : u.includes('/api/auth/preferences') ? (opts?.method === 'POST' ? { ok: true } : {}) : {}
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  }))
})

const renderTab = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}><BreadthCharts /></SWRConfig>,
)
const chart = async () => { await waitFor(() => expect(captured?.series?.length).toBeGreaterThan(0)); return captured }

describe('zoom survives rebuilds (A-07)', () => {
  it('holds the window the member zoomed to across a selection change', async () => {
    renderTab()
    await chart()
    act(() => events.datazoom({ batch: [{ start: 50, end: 100 }] }))
    const from = ROWS[20].date
    await waitFor(() => expect(captured.dataZoom[0].startValue).toBe(from))
    expect(captured.dataZoom[1].startValue).toBe(from)
    expect(captured.dataZoom[0].endValue).toBe(ROWS[39].date)

    fireEvent.click(screen.getByRole('button', { name: /^Highs \/ Lows/ }))
    fireEvent.click(screen.getByLabelText('52W Highs (Close)'))
    await waitFor(() => expect(captured.series.some(s => s.name === '52W Highs (Close)')).toBe(true))
    expect(captured.dataZoom[0].startValue).toBe(from)
  })

  // CONTROL: a new date range is a new domain; the old zoom does not carry into it.
  it('lets a changed range drop the zoom', async () => {
    renderTab()
    await chart()
    act(() => events.datazoom({ batch: [{ start: 50, end: 100 }] }))
    await waitFor(() => expect(captured.dataZoom[0].startValue).toBe(ROWS[20].date))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: ROWS[5].date } })
    await waitFor(() => expect(captured.dataZoom[0].startValue).toBeUndefined())
  })
})

describe('a hidden series stays hidden (A-08)', () => {
  it('writes the readout\'s hidden set into the option, so a rebuild re-applies it', async () => {
    renderTab()
    await chart()
    fireEvent.click(screen.getByRole('button', { name: /^Health Score/ }))
    await waitFor(() => expect(captured.legend.selected['Health Score']).toBe(false))
    expect(captured.legend.selected['% Above 50SMA']).toBe(true)
    fireEvent.click(screen.getByLabelText(/Follow-through days/))
    await waitFor(() => expect(captured.series.length).toBeGreaterThan(0))
    expect(captured.legend.selected['Health Score']).toBe(false)
  })
})

describe('motion (02-design §7)', () => {
  it('draws once, then updates instantly', async () => {
    renderTab()
    const opt = await chart()
    expect(opt.animationDurationUpdate).toBe(0)
    expect(opt.animationDuration).toBe(400)
    act(() => events.finished())
    await waitFor(() => expect(captured.animationDuration).toBe(0))
  })
})

describe('ticks and tooltip carry the year (A-06)', () => {
  it('formats a short window as month and day, and the tooltip header with the weekday and year', async () => {
    renderTab()
    const opt = await chart()
    const label = opt.xAxis.axisLabel.formatter(ROWS[1].date, 1)
    expect(label).toMatch(/^[A-Z][a-z]{2} \d{1,2}(, \d{4})?$/)
    expect(opt.xAxis.axisLabel.interval).toBe('auto')
    const header = opt.tooltip.formatter([{ axisValue: '2026-09-11', value: ['2026-09-11', 50], color: '#fff', seriesName: 'Health Score' }])
    expect(header).toContain('Fri, Sep 11, 2026')
  })
})

describe('a flattened series is announced (A-04)', () => {
  it('names the series, the factor and the axis', async () => {
    renderTab()
    await chart()
    fireEvent.click(screen.getByRole('button', { name: /^Primary Breadth/ }))
    fireEvent.click(screen.getByLabelText('Universe Count'))
    fireEvent.click(screen.getByRole('button', { name: /^Highs \/ Lows/ }))
    fireEvent.click(screen.getByLabelText('52W Lows (Close)'))
    expect(await screen.findByText(/^52W Lows \(Close\) is \d+× smaller than Universe Count on this axis\.$/)).toBeInTheDocument()
  })

  // CONTROL: the default selection is two percentages within the limit.
  it('says nothing when the series share a scale', async () => {
    renderTab()
    await chart()
    expect(screen.queryByText(/smaller than .* on this axis/)).not.toBeInTheDocument()
  })
})

describe('Notable Extremes (A-22)', () => {
  it('appears only in MA Breadth, the group whose lines it draws', async () => {
    renderTab()
    await chart()
    fireEvent.click(screen.getByRole('button', { name: /^Regime/ }))
    expect(screen.queryByRole('button', { name: /Notable Extremes/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^MA Breadth/ }))
    expect(screen.getByRole('button', { name: /Notable Extremes/ })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2:** `npx vitest run src/pages/BreadthCharts.mechanics.test.jsx` → FAIL

- [ ] **Step 3: implement** `BreadthCharts.jsx`

Imports:

```jsx
import { spanDays, tickBoundary, formatSessionTick, formatTooltipDate } from './breadth/chartTicks'
import { zoomWindowFrom, zoomValues } from './breadth/chartZoom'
import { magnitudeGaps, describeGap } from './breadth/chartMagnitude'
```

State, after `hidden`:

```jsx
  // A-07: the zoom window as dates, tagged with the range it was made in — a new
  // range is a new domain, so a zoom from another range is ignored, not carried.
  const [zoomState, setZoomState] = useState(null)
  const windowKey = `${fromDate}|${toDate}`
  const zoom = zoomState?.windowKey === windowKey ? zoomState : null
  // 02-design §7: the first paint draws; later changes are instant.
  const [painted, setPainted] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches),
  )
```

After `rows`, add:

```jsx
  const dates = useMemo(() => rows.map(r => r.date), [rows])
  const visibleRows = useMemo(() => {
    if (!zoom) return rows
    return rows.filter(r => r.date >= zoom.from && r.date <= zoom.to)
  }, [rows, zoom])

  const onEvents = useMemo(() => ({
    datazoom: params => {
      const next = zoomWindowFrom(params, dates)
      setZoomState(next ? { ...next, windowKey } : null)
    },
    finished: () => setPainted(true),
  }), [dates, windowKey])
```

`toggleSeries` becomes (the rebuild applies `legend.selected`; the imperative toggle is gone):

```jsx
  // Drives the hidden legend rather than the selection, so hiding a series to
  // read another one can't re-resolve the axes underneath it. A-08: the hidden set
  // is written into `legend.selected`, so every rebuild re-applies it.
  function toggleSeries(key) {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
```

and `chartRef` with its `ref={chartRef}` is removed.

Inside the option memo: `const zoomed = zoomValues(zoom, dates)`, `const span = spanDays(zoomed?.startValue ?? dates[0], zoomed?.endValue ?? dates[dates.length - 1])`,
`const boundary = tickBoundary(dates, span)`. Then:

```jsx
      animationDuration: painted ? 0 : 400,
      animationDurationUpdate: 0,
      legend: {
        show: false,
        data: selected.map(key => LABEL_MAP[key] ?? key),
        selected: Object.fromEntries(selected.map(key => [LABEL_MAP[key] ?? key, !hidden.has(key)])),
      },
```

tooltip header: `` `<div style="font-size:11px;color:#706b5e;margin-bottom:4px">${formatTooltipDate(date)}</div>` ``

xAxis.axisLabel:

```jsx
        axisLabel: {
          color: '#706b5e',
          fontSize: 11,
          hideOverlap: true,
          interval: boundary ?? 'auto',
          formatter: (v, i) => formatSessionTick(v, span, i > 0 && dates[i - 1]?.slice(0, 4) !== v.slice(0, 4)),
        },
```

dataZoom:

```jsx
      dataZoom: [
        { type: 'inside', zoomOnMouseWheel: true, ...(zoomed ?? {}) },
        {
          type: 'slider',
          bottom: 4,
          height: 22,
          fillerColor: 'rgba(201,168,76,0.10)',
          borderColor: '#2e3127',
          handleStyle: { color: '#c9a84c' },
          textStyle: { color: '#706b5e' },
          ...(zoomed ?? {}),
        },
      ],
```

Option memo dependencies add `hidden, zoom, dates, painted` and drop `activePresetDef`.

Magnitude notice, computed beside the option:

```jsx
  const gapNotices = useMemo(() => {
    const { axisByKey } = resolveAxes(selected)
    return magnitudeGaps(selected, visibleRows, axisByKey).map(g => describeGap(g, k => LABEL_MAP[k] ?? k))
  }, [selected, visibleRows])
```

rendered right after `<MetricReadout … />`:

```jsx
            {gapNotices.length > 0 && (
              <div className={styles.gapNotice} role="status">
                {gapNotices.map(text => <p key={text}>{text}</p>)}
              </div>
            )}
```

`<ReactECharts … onEvents={onEvents} />`.

Notable Extremes — the extremes row renders only for MA Breadth:

```jsx
              {g.group === 'MA Breadth' && (
                <div className={styles.extremesRow}>
                  …unchanged button…
                </div>
              )}
```

`BreadthCharts.module.css` — before the load-problem block:

```css
/* A-04: a series flattened by a larger one on the same axis is named, not hidden. */
.gapNotice {
  padding: 0 16px 6px;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--warn);
}
.gapNotice p { margin: 0; }
```

- [ ] **Step 4: verify** — `npx vitest run src/pages/BreadthCharts.mechanics.test.jsx src/pages/BreadthCharts.test.jsx src/pages/BreadthCharts.live.test.jsx src/pages/BreadthCharts.loadError.test.jsx src/pages/BreadthCharts.refresh.test.jsx src/pages/breadth src/styles/tokens.reachable.test.js` → PASS.
  Mutation proofs (harness: control first, bytes restored, tree clean after):
  1. `...(zoomed ?? {})` removed from the inside zoom → "holds the window" fails;
  2. `windowKey` check removed (`const zoom = zoomState`) → "a changed range drops the zoom" fails;
  3. `selected:` line removed from `legend` → "hidden series" fails;
  4. `animationDuration: painted ? 0 : 400` → `400` → "draws once" fails;
  5. `METRIC_REF_LINES.adv_decline` removed → Volume Thrust rail fails;
  6. per-axis loop replaced by `axis: 0` for all lines → "each family on its own axis" fails;
  7. `MAGNITUDE_LIMIT` → `1000` → "names the series" fails, control stays green;
  8. `g.group === 'MA Breadth' &&` removed → Notable Extremes test fails.
- [ ] **Step 5:** commit — "Breadth charts: zoom and hidden series survive rebuilds, the chart draws once, a flattened series is named, Notable Extremes only where it works (A-04, A-06, A-07, A-08, A-22)"

---

### Task 6: gate, merge, verify

- [ ] Six-shard gate on the clean C2 tree; failing set vs `gates.md` C1 set; named-list rails unchanged; record in `gates.md`.
- [ ] `git fetch origin`; merge origin/master (never rebase); overlap check on C2 files; watch coverage.
- [ ] Guarded push (master ancestor, no data-shaped files, no web deploy in flight); watch web to SUCCESS.
- [ ] STATUS entry with the member summary:

> **What members will see.** Reference lines stay put when you add or remove a metric, and each sits on its own scale.
> Axis dates carry their year. Zooming in holds while you change metrics or while the chart updates during the session, a
> hidden series stays hidden, and the chart no longer replays its drawing every minute. When one line is too small to read
> beside another on the same axis, the chart says so. Notable Extremes appears only under MA Breadth, where it draws.
