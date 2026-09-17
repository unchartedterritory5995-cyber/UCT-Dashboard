/**
 * V2-2 — the ECharts option for a stack of unit-family panels.
 *
 * ⭐ PURE ON PURPOSE. It takes data and returns an option object; it imports no React and
 * touches no DOM. Everything V2-2 is judged on — which series is in which panel, what
 * colour it is, whether a log axis was refused, where the end labels sit — is decidable
 * from the returned object, so the rails read the ANSWER rather than a screenshot. The
 * screenshots then check the things only a browser can (layout, collision, overflow),
 * which is the division of labour §3.2 exists for.
 *
 * ⛔ ONE X-AXIS SCALE ACROSS THE STACK, ONE ZOOM, ONE CROSSHAIR. Panels that scroll
 * independently are worse than a dual axis: the reader believes two panels are aligned
 * in time when they are not. `axisPointer.link` and `dataZoom.xAxisIndex: 'all'` are
 * what make the stack one chart rather than several.
 */
import { UNIT_LABEL, shortOf, markOf, MARK } from '../chartMetrics'
import { panelsFor, gridFor, panelIndexByKey } from './panels'
import { stickyColour } from './stickyColours'

/** Ink that reads on both themes — V2-2's palette lands with W2-0. */
const AXIS_INK = '#8b8578'
const GRID_INK = 'rgba(139, 133, 120, 0.16)'
const LABEL_INK = '#b8b2a4'
//: V2-3's two coverage inks. ⛔ DIFFERENT ON PURPOSE: "never recorded" and
//: "reconstructed from bars" are different claims, and one ink for both would
//: merge them back into the single undifferentiated state A-10 is about.
const NOT_RECORDED_INK = 'rgba(139, 133, 120, 0.10)'
const RECONSTRUCTED_INK = 'rgba(96, 165, 250, 0.07)'

/**
 * Can this panel take a log axis?
 *
 * ⛔⛔ A LOG AXIS WITH A NON-POSITIVE VALUE IS A LIE, AND ECHARTS DRAWS IT ANYWAY —
 * it drops the offending points and renders a confident line through the survivors.
 * Signed families (net advancers, spreads, oscillators) are exactly the ones a reader
 * might reach for a log scale on, and exactly the ones where the result is silent data
 * loss. So the refusal is computed from the DATA, not from the unit: a count family that
 * happens to contain a zero is refused too.
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function logEligibility(panel, valuesByKey) {
  const bad = []
  for (const key of panel.keys) {
    for (const v of valuesByKey[key] ?? []) {
      if (typeof v === 'number' && Number.isFinite(v) && v <= 0) { bad.push(key); break }
    }
  }
  if (bad.length) {
    return {
      ok: false,
      reason: `Log scale needs every value above zero. ${bad.map(shortOf).join(', ')} `
            + `${bad.length === 1 ? 'has' : 'have'} values at or below zero in this range.`,
    }
  }
  return { ok: true }
}

/**
 * Build the option.
 *
 * @param dates        ISO strings, ascending — the shared x
 * @param valuesByKey  { key: (number|null)[] } aligned to `dates`
 * @param selected     the metric keys, in pick order
 * @param opts         { logPanels: Set<unit>, endLabels: boolean }
 */
export function buildOption(dates, valuesByKey, selected, opts = {}) {
  const { logPanels = new Set(), endLabels = true, coverage = null } = opts
  const panels = panelsFor(selected)
  const grids = gridFor(panels)
  const { indexOf } = panelIndexByKey(panels)

  // ⛔ A panel that ASKED for log and cannot have it is recorded, not silently linear:
  // the caller renders the reason, so a control that did nothing is never mysterious.
  const refusals = []
  const isLog = panels.map(p => {
    if (!logPanels.has(p.unit)) return false
    const e = logEligibility(p, valuesByKey)
    if (!e.ok) { refusals.push({ unit: p.unit, reason: e.reason }); return false }
    return true
  })

  const xAxis = panels.map((_p, i) => ({
    type: 'category',
    data: dates,
    gridIndex: i,
    boundaryGap: false,
    axisLine: { lineStyle: { color: GRID_INK } },
    axisTick: { show: false },
    // Only the LAST panel carries the date labels: repeating them between panels
    // wastes the vertical space the panels themselves need.
    axisLabel: i === panels.length - 1
      ? { color: AXIS_INK, fontSize: 11, hideOverlap: true }
      : { show: false },
    axisPointer: { show: true, label: { show: i === panels.length - 1 } },
  }))

  const yAxis = panels.map((p, i) => ({
    type: isLog[i] ? 'log' : 'value',
    gridIndex: i,
    scale: p.scaled,
    name: UNIT_LABEL[p.unit] ?? p.unit,
    nameLocation: 'end',
    nameTextStyle: { color: AXIS_INK, fontSize: 10, align: 'left' },
    axisLabel: { color: AXIS_INK, fontSize: 11 },
    splitLine: { lineStyle: { color: GRID_INK } },
    axisLine: { show: false },
    axisTick: { show: false },
  }))

  const series = []
  for (const key of selected) {
    const panelIdx = indexOf(key)
    if (panelIdx < 0) continue          // never default to panel 0 — see panels.js
    const values = valuesByKey[key] ?? []
    const mark = markOf(key)
    const last = lastRealIndex(values)
    series.push({
      id: key,
      name: shortOf(key),
      // ⛔ A-28 · THE MARK COMES FROM THE REGISTRY, NOT FROM A TEST HERE. This read
      // `WEEKLY_METRICS.has(key)` directly, which was a second authority over "how is
      // this drawn" — right for weekly surveys and blind to the two metrics A-28 names
      // for BARS. `markOf` is the one answer: bars for a signed net and a sparse spike
      // count, steps for anything on a weekly cadence, lines elsewhere.
      type: mark === MARK.BARS ? 'bar' : 'line',
      // ⛔ Interpolating between two weekly readings invents daily values nobody
      // published; drawing a curve through 26 distinct spike counts invents a shape.
      step: mark === MARK.STEP ? 'end' : false,
      smooth: false,
      data: values,
      xAxisIndex: panelIdx,
      yAxisIndex: panelIdx,
      showSymbol: false,
      lineStyle: { width: 2, color: stickyColour(key) },
      itemStyle: { color: stickyColour(key) },
      // ⭐ Bars get a small gap so adjacent marks read as separate quantities rather
      // than one filled area — the same surface-gap rule the stacked panels use.
      barMaxWidth: mark === MARK.BARS ? 6 : undefined,
      // ⛔ `connectNulls: false` — a null is an ABSENT reading, and bridging it draws a
      // line through a period nobody measured.
      connectNulls: false,
      // Direct label at the series end. ⭐ At the END only, never a number on every
      // point: `dataviz` calls that out, and on 4,530 sessions it is unreadable anyway.
      endLabel: endLabels && last >= 0
        ? { show: true, formatter: shortOf(key), color: LABEL_INK, fontSize: 11,
            distance: 6, valueAnimation: false }
        : { show: false },
      emphasis: { focus: 'series' },
      ...coverageMarks(coverage, key, dates),
    })
  }

  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: grids,
    xAxis,
    yAxis,
    series,
    // ⛔ ONE CROSSHAIR ACROSS THE STACK. Without the link, hovering one panel reads only
    // that panel and the reader has to align dates by eye — which is the comparison the
    // stack exists to make safe.
    axisPointer: {
      link: [{ xAxisIndex: 'all' }],
      label: { backgroundColor: '#2a2721' },
      lineStyle: { color: GRID_INK },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      confine: true,
      backgroundColor: 'rgba(24, 22, 18, 0.96)',
      borderColor: GRID_INK,
      textStyle: { color: LABEL_INK, fontSize: 12 },
    },
    // ⛔ ONE ZOOM DRIVING EVERY PANEL.
    dataZoom: [
      { type: 'inside', xAxisIndex: 'all' },
      { type: 'slider', xAxisIndex: 'all', bottom: 8, height: 18,
        borderColor: GRID_INK, fillerColor: 'rgba(139,133,120,0.12)' },
    ],
    legend: { show: false },   // identity is carried by the end labels + the panel axis
    __refusals: refusals,      // read by the component; see the note in the component
  }
}


/**
 * V2-3 (A-10) · the shaded regions for one series.
 *
 * ⛔⛔ RETURNS AN EMPTY OBJECT WHEN THERE IS NOTHING TO SAY, and that is load-bearing
 * rather than tidy. The owner's rail is that with coverage absent, V2-3 renders EXACTLY
 * what V2-2 renders — so this must contribute NO KEYS at all, not a `markArea` holding an
 * empty array. An empty markArea is still a property on the series, still serialises, and
 * would make the two options unequal while looking harmless.
 *
 * ⛔ A SPAN BEFORE A SERIES BEGINS IS SHADED, NEVER BLANK. Blank reads as "measured and
 * flat", which is precisely the lie A-10 names: *"Series that begin 2026-01-02 simply
 * start mid-plot."*
 */
function coverageMarks(coverage, key, dates) {
  if (!coverage) return {}
  const areas = []

  const region = coverage.regions?.[key]
  if (region) {
    areas.push([
      { xAxis: dates[region.fromIndex], itemStyle: { color: NOT_RECORDED_INK } },
      { xAxis: dates[region.toIndex] },
    ])
  }
  // The provenance strip: reconstructed sessions are REAL readings with a caveat, so they
  // are tinted differently from "not recorded at all" — two different facts, two inks.
  for (const run of coverage.runs ?? []) {
    areas.push([
      { xAxis: dates[run.fromIndex], itemStyle: { color: RECONSTRUCTED_INK } },
      { xAxis: dates[run.toIndex] },
    ])
  }

  if (!areas.length) return {}
  return { markArea: { silent: true, animation: false, data: areas } }
}

/** Index of the last non-null value, or -1. */
function lastRealIndex(values) {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] !== null && values[i] !== undefined) return i
  }
  return -1
}
