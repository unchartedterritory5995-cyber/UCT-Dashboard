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
import { UNIT, UNIT_LABEL, shortOf, markOf, MARK, MA_EXTREME_LINES } from '../chartMetrics'
import { panelsFor, gridFor, panelIndexByKey } from './panels'
import { stickyColour } from './stickyColours'
import { shouldSample } from './lttb'
import { spanDays, tickBoundary, formatSessionTick, formatTooltipDate } from '../chartTicks'
import { CHART_FONT_FAMILY } from '../../../utils/chartFont'

/**
 * The chart's chrome inks. Canvas cannot read `var(--…)`, so the component resolves
 * the app's tokens at render (`BreadthChartsV2.jsx::readChrome`) and hands them in;
 * these are the fallbacks for a caller that does not (tests, jsdom), and they are the
 * dark-theme values the chart shipped with.
 */
export const DEFAULT_CHROME = Object.freeze({
  axis: '#8b8578',
  grid: 'rgba(139, 133, 120, 0.16)',
  label: '#b8b2a4',
  heading: '#f0efea',
  tooltipBg: 'rgba(24, 22, 18, 0.96)',
  tooltipBorder: 'rgba(139, 133, 120, 0.32)',
  accent: '#dcbb5e',
})

/** The same roles on the light theme (02-design §1 derived chrome: axis text that clears
 *  4.5:1 on the light surface, a gridline that barely separates from it). */
export const LIGHT_CHROME = Object.freeze({
  axis: '#687079',
  grid: 'rgba(31, 35, 40, 0.10)',
  label: '#3d444d',
  heading: '#161a1e',
  tooltipBg: 'rgba(255, 255, 255, 0.98)',
  tooltipBorder: 'rgba(31, 35, 40, 0.14)',
  accent: '#7a5c16',
})

/** Follow-through-day rule ink — V1's violet, so the mark is recognisable across both. */
const FTD_INK = '#a78bfa'

/** Families where a log axis is ever meaningful (02-design §4, Y axes). A bounded
 *  percentage, a ratio around 1, an oscillator or a signed net is never offered one. */
export const LOG_UNITS = new Set([UNIT.COUNT, UNIT.INDEX, UNIT.CUM])

//: V2-3's two coverage inks. ⛔ DIFFERENT ON PURPOSE: "never recorded" and
//: "reconstructed from bars" are different claims, and one ink for both would
//: merge them back into the single undifferentiated state A-10 is about.
//: ⭐ Fill + a solid edge, not fill alone: at 0.10/0.07 opacity (the original
//: values) the band all but disappeared against the panel's own dark ground —
//: exactly the "nearly invisible" audit finding — and a reader cannot act on
//: a caveat they cannot see. The border gives the region a legible boundary
//: even at a fill opacity light enough not to obscure the series drawn over it.
//: ⚰️ At 0.22/0.18 AND drawn once per SERIES, a three-line panel stacked the
//: reconstructed band three times (~45%) and on the Max range washed the whole
//: plot solid blue (production, 2026-09-19). The band is now drawn once per
//: PANEL (`coverageMarks`' `withRuns`), so a lighter fill reads the same in every
//: panel and the edge still carries the boundary.
const NOT_RECORDED_FILL = 'rgba(139, 133, 120, 0.14)'
const NOT_RECORDED_BORDER = 'rgba(139, 133, 120, 0.55)'
const RECONSTRUCTED_FILL = 'rgba(96, 165, 250, 0.09)'
const RECONSTRUCTED_BORDER = 'rgba(96, 165, 250, 0.55)'

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

/** Numbers as a reader wants them: thousands separated, two decimals only below 1,000. */
export function formatValue(v) {
  if (v === null || v === undefined || typeof v !== 'number' || !Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

const escapeHtml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/**
 * The tooltip body: ONE date header, then the rows grouped by panel, value first.
 *
 * ⚰️ ECharts' default formatter printed the date once PER PANEL ("2026-07-10" twice in
 * a two-panel stack), because the stack is several linked axes and the default groups
 * by axis. Built from escaped text — a series name is never interpolated as HTML.
 */
export function tooltipHtml(params, { panels, panelOf, chrome = DEFAULT_CHROME }) {
  const list = Array.isArray(params) ? params : [params]
  if (!list.length) return ''
  const date = list[0].axisValue ?? list[0].name
  const byPanel = new Map()
  for (const p of list) {
    const idx = panelOf(p.seriesId)
    if (idx < 0) continue
    if (!byPanel.has(idx)) byPanel.set(idx, [])
    byPanel.get(idx).push(p)
  }
  const head = `<div style="font-size:11px;color:${chrome.axis};margin-bottom:6px">`
    + `${escapeHtml(formatTooltipDate(String(date)))}</div>`
  const groups = [...byPanel.keys()].sort((a, b) => a - b).map(idx => {
    const title = panels.length > 1
      ? `<div style="font-size:10px;color:${chrome.axis};margin:4px 0 2px">${escapeHtml(panels[idx]?.label ?? '')}</div>`
      : ''
    const rows = byPanel.get(idx).map(p => {
      const raw = Array.isArray(p.value) ? p.value[1] : p.value
      const val = formatValue(raw)
      return '<div style="display:flex;align-items:center;gap:8px;line-height:1.6">'
        + `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>`
        + `<b style="color:${chrome.heading};font-variant-numeric:tabular-nums;min-width:52px">${escapeHtml(val)}</b>`
        + `<span>${escapeHtml(p.seriesName)}</span></div>`
    }).join('')
    return title + rows
  }).join('')
  return head + groups
}

/**
 * Build the option.
 *
 * @param dates        ISO strings, ascending — the shared x
 * @param valuesByKey  { key: (number|null)[] } aligned to `dates`
 * @param selected     the metric keys, in pick order
 * @param opts         see the destructuring below
 */
export function buildOption(dates, valuesByKey, selected, opts = {}) {
  // ⛔⛔ `allowSampling` DEFAULTS FALSE — FAIL CLOSED, same polarity as every enablement
  // gate in this programme. Caught by a rail, not by review: `shouldSample` alone knows
  // nothing about v22/v23, so a first version set `sampling` purely from point count and
  // a v22-only view with a long series (hypothetically) would have been silently
  // downsampled by a V2-3 capability nobody turned on. LTTB is v23's, so the CALLER
  // states that explicitly rather than this module inferring it from data shape.
  const {
    logPanels = new Set(), endLabels = true, coverage = null, allowSampling = false,
    chrome = DEFAULT_CHROME,
    hidden = null,          // Set of keys the reader hid from the readout
    refLines = [],          // [{unit, at, label}] — `chartMetrics.resolveLines`
    extremes = false,       // MA Breadth notable extremes on the percentage panel
    live = null,            // { index, clock } — the provisional intraday point
    slider = true,          // the zoom slider (phones drop it; inside zoom stays)
    heightPx = null,        // measured chart height, for pixel-true margins
    colours = null,         // { key: colour } — `stickyColours.assignColours`
    ftd = null,             // [{date, label}] — `ftdMarkers`, thinned for labelling
  } = opts
  const panels = panelsFor(selected)
  // Margins are percentages of the chart box; with a measured height they are derived
  // from pixels, so the axis labels and the slider keep their room at any height.
  const pct = px => (heightPx ? Math.min(30, (px / heightPx) * 100) : null)
  const grids = gridFor(panels, {
    top: pct(30) ?? 6,
    bottom: pct(slider ? 70 : 30) ?? 14,
    gap: pct(40) ?? 4,
    endLabels,
  })
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

  // A-06: tick text follows the span, and the year is never dropped.
  const span = spanDays(dates[0], dates[dates.length - 1])
  const boundary = tickBoundary(dates, span)
  const tick = (v, i) => formatSessionTick(String(v), span,
    i > 0 && String(dates[i - 1] ?? '').slice(0, 4) !== String(v).slice(0, 4))

  const xAxis = panels.map((_p, i) => ({
    type: 'category',
    data: dates,
    gridIndex: i,
    boundaryGap: false,
    axisLine: { lineStyle: { color: chrome.grid } },
    axisTick: { show: false },
    // Only the LAST panel carries the date labels: repeating them between panels
    // wastes the vertical space the panels themselves need.
    axisLabel: i === panels.length - 1
      ? { color: chrome.axis, fontSize: 11, hideOverlap: true, interval: boundary ?? 'auto', formatter: tick }
      : { show: false },
    axisPointer: {
      show: true,
      label: {
        show: i === panels.length - 1,
        formatter: ({ value }) => formatTooltipDate(String(value)),
        backgroundColor: chrome.tooltipBg,
        color: chrome.heading,
        borderColor: chrome.tooltipBorder,
        borderWidth: 1,
      },
    },
  }))

  const yAxis = panels.map((p, i) => ({
    type: isLog[i] ? 'log' : 'value',
    gridIndex: i,
    scale: p.scaled,
    name: UNIT_LABEL[p.unit] ?? p.unit,
    nameLocation: 'end',
    nameGap: 10,
    nameTextStyle: { color: chrome.axis, fontSize: 10, align: 'right', padding: [0, 6, 0, 0] },
    axisLabel: { color: chrome.axis, fontSize: 11, formatter: v => formatValue(v) },
    splitLine: { lineStyle: { color: chrome.grid } },
    axisLine: { show: false },
    axisTick: { show: false },
  }))

  // The first drawn series of each panel carries that panel's markLines (reference
  // levels, extremes, the LIVE rule), so each sits on its own panel's scale.
  const firstKeyOfPanel = panels.map(p => p.keys.find(k => indexOf(k) >= 0))

  const series = []
  for (const key of selected) {
    const panelIdx = indexOf(key)
    if (panelIdx < 0) continue          // never default to panel 0 — see panels.js
    const values = valuesByKey[key] ?? []
    const mark = markOf(key)
    const last = lastRealIndex(values)
    const colour = colours?.[key] ?? stickyColour(key)
    const lines = firstKeyOfPanel[panelIdx] === key
      ? panelLines(panels[panelIdx], panelIdx, { refLines, extremes, live, ftd, dates, chrome })
      : []
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
      // Dotless, except the provisional intraday tip — so the eye can tell where
      // measured history stops and the estimate begins.
      showSymbol: Boolean(live),
      ...(live ? {
        symbol: (_v, p) => (p.dataIndex === live.index ? 'circle' : 'none'),
        symbolSize: 7,
      } : {}),
      lineStyle: { width: 2, color: colour },
      itemStyle: { color: colour },
      // ⭐ Bars get a small gap so adjacent marks read as separate quantities rather
      // than one filled area — the same surface-gap rule the stacked panels use.
      barMaxWidth: mark === MARK.BARS ? 6 : undefined,
      // ⛔ `connectNulls: false` — a null is an ABSENT reading, and bridging it draws a
      // line through a period nobody measured.
      connectNulls: false,
      // ⛔⛔ NATIVE ECHARTS LTTB, delegated rather than reimplemented (D-053, `lttb.js`).
      // `shouldSample` reads the FULL series length, not the visible/zoomed extent —
      // ECharts recomputes the actual sampling RATE itself from the rendered pixel width
      // on every zoom and resize (`baseAxis.getExtent()` in its own `dataSample`
      // processor), so this only needs to decide whether the series is long enough to be
      // worth asking ECharts to manage at all. `undefined` when below threshold, never
      // `'none'` — the processor treats an unset `sampling` and `'none'` identically, but
      // `undefined` is the honest "we did not ask for this" rather than a stated no-op.
      sampling: (allowSampling && shouldSample(values.length)) ? 'lttb' : undefined,
      // Direct label at the series end. ⭐ At the END only, never a number on every
      // point: `dataviz` calls that out, and on 4,530 sessions it is unreadable anyway.
      endLabel: endLabels && last >= 0
        ? { show: true, formatter: shortOf(key), color: chrome.label, fontSize: 11,
            distance: 6, valueAnimation: false }
        : { show: false },
      // ⛔⛔ TWO SERIES CONVERGING NEAR THE SAME VALUE STACK THEIR END LABELS ON TOP
      // OF EACH OTHER — a real defect found live at Max scale (e.g. "Up 4%+" and
      // "Up 20%/5d" landing within a few pixels at the chart's right edge). This is
      // a DIFFERENT axis from the legend-clipping fix in `panels.js` (that one is
      // HORIZONTAL — the margin was too narrow for a long label; this one is
      // VERTICAL — two labels landing at the same y). Delegated to ECharts' own
      // label-layout pass rather than hand-rolled collision math, the same D-053
      // principle LTTB sampling already follows: `moveOverlap: 'shiftY'` nudges
      // colliding end labels apart along y, across EVERY series sharing this
      // panel's coordinate space, not just within one series' own labels.
      labelLayout: { moveOverlap: 'shiftY' },
      emphasis: { focus: 'series' },
      ...coverageMarks(coverage, key, dates, firstKeyOfPanel[panelIdx] === key),
      ...(lines.length
        ? { markLine: { silent: true, symbol: ['none', 'none'], animation: false, data: lines } }
        : {}),
    })
  }

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: CHART_FONT_FAMILY, color: chrome.label },
    grid: grids,
    xAxis,
    yAxis,
    series,
    // ⛔ ONE CROSSHAIR ACROSS THE STACK. Without the link, hovering one panel reads only
    // that panel and the reader has to align dates by eye — which is the comparison the
    // stack exists to make safe.
    axisPointer: {
      link: [{ xAxisIndex: 'all' }],
      label: { backgroundColor: chrome.tooltipBg },
      lineStyle: { color: chrome.axis, opacity: 0.5 },
    },
    tooltip: {
      trigger: 'axis',
      // ⛔ A vertical hairline, never 'cross'. A cross drew a y-value label on EVERY
      // panel's axis, and the one the pointer had left kept a stale reading (a "10.89"
      // on the percent axis while the pointer sat in the stocks panel).
      axisPointer: { type: 'line' },
      confine: true,
      backgroundColor: chrome.tooltipBg,
      borderColor: chrome.tooltipBorder,
      padding: [8, 10],
      textStyle: { color: chrome.label, fontSize: 12 },
      extraCssText: 'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.35);',
      formatter: params => tooltipHtml(params, { panels, panelOf: indexOf, chrome }),
    },
    // ⛔ ONE ZOOM DRIVING EVERY PANEL.
    dataZoom: [
      { type: 'inside', xAxisIndex: 'all' },
      ...(slider ? [{
        type: 'slider', xAxisIndex: 'all', bottom: 12, height: 20,
        borderColor: chrome.grid,
        backgroundColor: 'transparent',
        fillerColor: 'rgba(139, 133, 120, 0.12)',
        dataBackground: { lineStyle: { color: chrome.axis, opacity: 0.35 }, areaStyle: { opacity: 0 } },
        selectedDataBackground: { lineStyle: { color: chrome.axis, opacity: 0.6 }, areaStyle: { opacity: 0 } },
        // The accent marks the thing you grab, not a band of chrome (02-design §4).
        handleStyle: { color: chrome.accent, borderColor: chrome.accent },
        moveHandleStyle: { color: chrome.grid, opacity: 0.6 },
        emphasis: { handleStyle: { color: chrome.accent } },
        textStyle: { color: chrome.axis, fontSize: 10 },
        labelFormatter: (_v, str) => (str ? formatSessionTick(String(str), 0, true) : ''),
        brushSelect: false,
      }] : []),
    ],
    // Identity is carried by the end labels + the readout above the plot. The hidden
    // legend exists only so a series the reader hid in the readout STAYS hidden across
    // every rebuild (A-08) — the chart runs `notMerge`.
    legend: {
      show: false,
      data: series.map(s => s.name),
      selected: Object.fromEntries(series.map(s => [s.name, !(hidden?.has(s.id))])),
    },
    __refusals: refusals,      // read by the component; see the note in the component
  }
}

/**
 * The markLine items one panel carries: metric reference levels, the MA Breadth
 * extremes (percentage panel only), and the LIVE rule.
 */
function panelLines(panel, panelIdx, { refLines, extremes, live, ftd, dates, chrome }) {
  const out = []
  for (const l of refLines ?? []) {
    if (l.unit !== panel.unit) continue
    out.push({
      yAxis: l.at,
      lineStyle: { color: chrome.axis, type: 'dashed', width: 1, opacity: 0.55 },
      label: { formatter: l.label, position: 'insideEndTop', color: chrome.axis, fontSize: 10 },
    })
  }
  if (extremes && panel.unit === UNIT.PCT) {
    for (const l of MA_EXTREME_LINES) {
      out.push({
        yAxis: l.yAxis,
        lineStyle: { color: l.color, width: 1, type: 'dashed', opacity: l.opacity },
        label: { show: true, position: 'insideEndTop', formatter: String(l.yAxis), color: l.color, fontSize: 10, fontWeight: 600 },
      })
    }
  }
  // Follow-through days: a dotted rule through EVERY panel (they date the market, not
  // one metric), labelled only on the top panel and only on the first of a cluster —
  // the same thinning V1 uses. Violet, as on V1, so the mark reads the same on both.
  for (const m of ftd ?? []) {
    out.push({
      xAxis: m.date,
      lineStyle: { color: FTD_INK, type: 'dotted', width: 1, opacity: 0.8 },
      label: panelIdx === 0 && m.label
        ? { show: true, formatter: 'FTD', position: 'insideEndTop', rotate: 0, align: 'left',
            color: FTD_INK, fontSize: 10, fontWeight: 600 }
        : { show: false },
    })
  }
  if (live && dates[live.index] !== undefined) {
    out.push({
      xAxis: dates[live.index],
      lineStyle: { color: chrome.accent, type: 'dashed', width: 1, opacity: 0.65 },
      label: panelIdx === 0
        ? {
            show: true, formatter: `LIVE ${live.clock ?? ''}`.trim(), position: 'insideEndTop',
            // A vertical markLine's label follows the line (90°) and clips at the edge.
            rotate: 0, align: 'right', distance: [4, 2], color: chrome.accent,
            fontSize: 10, fontWeight: 600, backgroundColor: chrome.tooltipBg, padding: [2, 5], borderRadius: 3,
          }
        : { show: false },
    })
  }
  return out
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
function coverageMarks(coverage, key, dates, withRuns = true) {
  if (!coverage) return {}
  const areas = []

  const region = coverage.regions?.[key]
  if (region) {
    areas.push([
      { xAxis: dates[region.fromIndex],
        itemStyle: { color: NOT_RECORDED_FILL, borderColor: NOT_RECORDED_BORDER, borderWidth: 1 } },
      { xAxis: dates[region.toIndex] },
    ])
  }
  // The provenance strip: reconstructed sessions are REAL readings with a caveat, so they
  // are tinted differently from "not recorded at all" — two different facts, two inks.
  // ⛔ The runs are a property of the SESSION, not of a series, so they are drawn once
  // per panel (on its first series) — never once per line, which stacked the tint.
  for (const run of withRuns ? (coverage.runs ?? []) : []) {
    areas.push([
      { xAxis: dates[run.fromIndex],
        itemStyle: { color: RECONSTRUCTED_FILL, borderColor: RECONSTRUCTED_BORDER, borderWidth: 1 } },
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
