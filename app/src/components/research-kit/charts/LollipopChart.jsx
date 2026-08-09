// app/src/components/research-kit/charts/LollipopChart.jsx
//
// ⚠️ P2 HARD REQUIREMENT (SDD ledger, this plan's progress.md): jsdom has no
// canvas, so `renderLollipopItem.test.jsx` proves the drawing CONTRACT against
// a stub `api` (fixed index*20 / 200-value*100 coordinates) — it never renders
// a real ECharts custom-series frame. That stub-api coverage is a deliberate
// risk the plan accepted, on the condition that LollipopChart is verified in a
// REAL BROWSER (a ticker with both reported and not-yet-reported quarters)
// before P2's review closes. Do not treat the green test suite alone as proof
// the lollipop actually paints correctly.
import EmptyState from '../EmptyState'
import EyebrowLabel from '../EyebrowLabel'
import EChart, { CHART_INK, GRID_BASE, TOOLTIP_BASE, axisBase } from './echartsCore'
import styles from './LollipopChart.module.css'

/**
 * §3.4 skeleton size contract. `SIZE` is a NAMED EXPORT, not a static on the
 * default export — `LollipopChart.SIZE` is `undefined` (I3). Import it through
 * the barrel instead:
 *
 *   import { LollipopChart, LOLLIPOP_SIZE, EyebrowLabel } from '.../research-kit'
 *
 * `SIZE`/`LOLLIPOP_SIZE` is the CHART BOX only (the ECharts canvas) — it does
 * NOT include this component's own `EyebrowLabel` or its horizon caption line
 * below the chart. To reserve the component's FULL rendered height with zero
 * layout shift, compose both pieces:
 *
 *   {isLoading
 *     ? <><EyebrowLabel>Estimate vs reported</EyebrowLabel><SkeletonBlock size={LOLLIPOP_SIZE} /></>
 *     : <LollipopChart quarters={quarters} label="Estimate vs reported" />}
 */
export const SIZE = { width: '100%', height: 240 }

const num = (v) => {
  // `Number(null) === 0` — without the explicit null/undefined check below,
  // an absent value silently becomes a real zero instead of "not plottable".
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 'beat' | 'miss' | 'inline' | null for one earnings-history row.
 * null means "no realized outcome to state" — an unreported quarter or a row
 * missing either side of the comparison. Never guess.
 */
/**
 * WHICH numbers a lollipop draws. The chart shape — estimate dot, actual dot,
 * the stem between them, beat/miss colouring — is identical for EPS and
 * revenue; only the field names and the money formatting differ. Naming them
 * here keeps ONE renderer rather than a near-copy that drifts.
 *
 * EPS and revenue must never share a y-axis: one is dollars-per-share and the
 * other is billions, so a shared scale flattens EPS into the zero line. They
 * are alternate VIEWS of the same quarters, which is why the section toggles
 * between them instead of overlaying.
 */
export const LOLLI_METRICS = {
  eps: {
    key: 'eps',
    label: 'EPS',
    estimate: 'eps_estimate',
    actual: 'eps_actual',
    low: 'eps_estimate_low',
    high: 'eps_estimate_high',
    surprise: 'surprise_pct',
  },
  revenue: {
    key: 'revenue',
    label: 'Revenue',
    estimate: 'revenue_estimate',
    actual: 'revenue_actual',
    // Revenue carries no consensus whisker in this payload; the renderer
    // simply draws no whisker when these read null.
    low: null,
    high: null,
    surprise: 'revenue_surprise_pct',
  },
}

const DEFAULT_METRIC = LOLLI_METRICS.eps

/** Read a metric field, tolerating a descriptor that declares it absent. */
function mval(row, metric, slot) {
  const k = (metric || DEFAULT_METRIC)[slot]
  return k ? num(row?.[k]) : null
}

export function beatState(row, metric = DEFAULT_METRIC) {
  if (!row || !row.reported) return null
  const est = mval(row, metric, 'estimate')
  const act = mval(row, metric, 'actual')
  if (est == null || act == null) return null
  if (act > est) return 'beat'
  if (act < est) return 'miss'
  return 'inline'
}

/**
 * [min, max] for the value axis, spanning every finite estimate, actual and
 * whisker end with 12% headroom. Returns null when nothing is plottable — the
 * caller then renders an EmptyState rather than an axis around nothing.
 */
export function yDomain(rows, metric = DEFAULT_METRIC) {
  const vals = []
  for (const r of rows || []) {
    for (const slot of ['estimate', 'actual', 'low', 'high']) {
      const v = mval(r, metric, slot)
      if (v != null) vals.push(v)
    }
  }
  if (!vals.length) return null
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  // A flat series would otherwise collapse to a zero-height axis.
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.12
  return [lo - pad, hi + pad]
}

/** "8 quarters · Q3 24 – Q2 26" — the horizon is READ FROM THE DATA (§2.2:
 *  every chip carries its denominator). Never hardcode a quarter count. */
export function horizonLabel(rows) {
  const list = rows || []
  if (!list.length) return ''
  const first = list[0]?.quarter ?? ''
  const last = list[list.length - 1]?.quarter ?? ''
  const noun = list.length === 1 ? 'quarter' : 'quarters'
  return list.length === 1 ? `1 ${noun} · ${first}` : `${list.length} ${noun} · ${first} – ${last}`
}

/**
 * ECharts `custom` renderItem — the whole lollipop for ONE quarter.
 *
 * Encoded dimensions: [0]=category index, [1]=estimate, [2]=actual,
 * [3]=analyst low, [4]=analyst high, [5]=reported (1|0).
 *
 * Pure: everything it needs arrives through `api`, so a test drives it with a
 * stub `{ value, coord }` and asserts the shapes — the only way to prove chart
 * drawing under jsdom, which has no canvas.
 *
 * §3.3 grammar, normative here: the estimate dot is ALWAYS hollow (expectation)
 * and dashed when the quarter has not reported (that dashed ring IS the
 * "next-quarter estimate" of §4.3.2); the actual dot is ALWAYS solid (realized)
 * and green/red by beat — with the hollow-vs-solid fill carrying the meaning
 * alongside the hue.
 */
export function renderLollipopItem(params, api) {
  const children = []
  const idx = api.value(0)
  const est = num(api.value(1))
  const act = num(api.value(2))
  const lo = num(api.value(3))
  const hi = num(api.value(4))
  const reported = api.value(5) === 1
  if (est == null) return { type: 'group', children }

  const at = (v) => api.coord([idx, v])
  const [x, estY] = at(est)

  if (lo != null && hi != null) {
    const [, loY] = at(lo)
    const [, hiY] = at(hi)
    const stroke = { stroke: CHART_INK.muted, lineWidth: 1, opacity: 0.7 }
    children.push({ type: 'line', shape: { x1: x, y1: hiY, x2: x, y2: loY }, style: stroke })
    for (const capY of [hiY, loY]) {
      children.push({ type: 'line', shape: { x1: x - 3, y1: capY, x2: x + 3, y2: capY }, style: stroke })
    }
  }

  if (reported && act != null) {
    const [, actY] = at(act)
    children.push({
      type: 'line',
      shape: { x1: x, y1: estY, x2: x, y2: actY },
      style: { stroke: CHART_INK.muted, lineWidth: 1.5 },
    })
  }

  const ring = { fill: 'transparent', stroke: CHART_INK.muted, lineWidth: 1.5 }
  if (!reported) ring.lineDash = [3, 3]
  children.push({ type: 'circle', shape: { cx: x, cy: estY, r: 4 }, style: ring })

  if (reported && act != null) {
    const [, actY] = at(act)
    const fill = act > est ? CHART_INK.gain : act < est ? CHART_INK.loss : CHART_INK.bright
    children.push({ type: 'circle', shape: { cx: x, cy: actY, r: 4.5 }, style: { fill } })
  }

  return { type: 'group', children }
}

/** The ECharts option — pure, so the chart's contract is unit-testable. */
export function buildLollipopOption(rows, { valueFormatter, metric } = {}) {
  const list = rows || []
  const m = metric || DEFAULT_METRIC
  const domain = yDomain(list, m) || [0, 1]
  const fmt = valueFormatter || ((v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`))

  return {
    grid: { ...GRID_BASE },
    xAxis: {
      type: 'category',
      data: list.map((r) => r?.quarter ?? ''),
      ...axisBase(),
    },
    yAxis: {
      type: 'value',
      min: domain[0],
      max: domain[1],
      splitNumber: 3,
      ...axisBase({
        splitLine: { show: true, lineStyle: { color: CHART_INK.grid } },
        axisLabel: { color: CHART_INK.muted, fontSize: 10, formatter: (v) => fmt(v) },
      }),
    },
    tooltip: {
      ...TOOLTIP_BASE,
      trigger: 'item',
      formatter: (p) => {
        const r = list[p.dataIndex] || {}
        const state = beatState(r, m)
        const head = `${r.quarter ?? ''}${r.session ? ` · ${String(r.session).toUpperCase()}` : ''}`
        const estLine = `Est ${fmt(mval(r, m, 'estimate'))}`
        if (!r.reported) return `${head}<br/>${estLine} · not reported yet`
        const surprise = m.surprise ? num(r[m.surprise]) : null
        const tail = surprise == null ? '' : ` (${surprise > 0 ? '+' : ''}${surprise.toFixed(1)}%)`
        return `${head}<br/>${estLine}<br/>Act ${fmt(mval(r, m, 'actual'))}${tail}${state ? ` · ${state}` : ''}`
      },
    },
    series: [{
      type: 'custom',
      name: m.label,
      renderItem: renderLollipopItem,
      encode: { x: 0, y: [1, 2, 3, 4] },
      clip: true,
      data: list.map((r, i) => [
        i,
        mval(r, m, 'estimate'),
        mval(r, m, 'actual'),
        mval(r, m, 'low'),
        mval(r, m, 'high'),
        r?.reported ? 1 : 0,
      ]),
    }],
  }
}

/**
 * Estimate vs reported EPS per quarter (spec §4.3.2; dataviz pattern 1).
 *
 * Reads the earnings-history payload (§6 row 3) DIRECTLY, oldest-first — P2
 * passes the endpoint rows with no adapter. Rows that have not reported keep
 * their place and render as the dashed next-quarter estimate; that is why the
 * backend accessor is required to keep the not-yet-reported row.
 *
 * Below two quarters this renders an EmptyState: one dot is not a habit.
 */
export default function LollipopChart({
  quarters,
  label = 'Estimate vs reported',
  info,
  height = SIZE.height,
  className = '',
  ariaLabel,
  valueFormatter,
  metric = DEFAULT_METRIC,
}) {
  const rows = Array.isArray(quarters) ? quarters : []
  const m = metric || DEFAULT_METRIC

  if (rows.length < 2) {
    return (
      <EmptyState
        icon="chart"
        title="Not enough earnings history"
        hint="Two reported quarters are needed to show whether this company habitually beats."
        className={className}
      />
    )
  }

  const option = buildLollipopOption(rows, { valueFormatter, metric: m })
  const states = rows.map((r) => beatState(r, m)).filter(Boolean)
  const beats = states.filter((s) => s === 'beat').length
  const horizon = horizonLabel(rows)
  const built = ariaLabel
    || `Estimate versus reported ${m.label}, ${horizon}. Beat ${beats} of ${states.length} reported quarters.`

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}
      <EChart option={option} height={height} ariaLabel={built} testId="rk-lollipop" />
      <div className={`${styles.horizon} t-num`} data-testid="rk-lollipop-horizon">
        {horizon}
      </div>
    </div>
  )
}
