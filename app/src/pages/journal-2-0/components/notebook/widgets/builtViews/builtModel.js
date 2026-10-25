// Built widget views (wave 8, Task 8.13): the one reading of a built payload every view shares.
//
// A payload's values live on FIXED keys (`v1..v3`, `n1..n3`, `s1..s3`, server widget_engine/payload.py), never on
// measure names, and its `measures` list says how each slot reads (`label`, `unit`, `kind`, `fmt`). Rows are
// grouped with `Map` elsewhere, never plain objects, so a label like "__proto__" is an ordinary string here.
import { money, moneySigned, percent, rMultiple } from '../../../../../../lib/journal-2-0/format'

export const SLOTS = 3
export const NO_DATA = 'no data'
export const SMALL_SAMPLE = 'small sample'
/** Profit factor's cap (server measures.PF_CAP). Ruling R-29: a `pf` value at the cap reads "5+". */
export const PF_CAP = 5
/** Where the coverage hint ("Add stops to see R for more trades") sends the member. */
export const ADD_STOPS_HREF = '/journal/trades?seg=closed'
export const ADD_STOPS_HINT = 'Add stops to see R for more trades'
/** An empty closed-trades widget's door (spec 5.9). */
export const LOG_TRADE_HREF = '/journal/trades'
/** A drilled trade opens on its own page (ruling R-30: the equity trade route, App.jsx `/journal-2-0/trade/:id`). */
export const tradeHref = (id) => `/journal-2-0/trade/${encodeURIComponent(String(id))}`

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** The payload's measures, at most three, each `{label, unit, kind, fmt}`. */
export function measuresOf(p) {
  const list = Array.isArray(p?.measures) ? p.measures : []
  return list.slice(0, SLOTS).map((m) => (isRecord(m) ? m : {}))
}

/** The noun a measure counts in ("Not enough trades yet (3)", "Not enough days yet (2)"). */
export const unitWord = (unit) => (unit === 'days' ? 'days' : unit === 'positions' ? 'positions' : 'trades')

const NOUNS = {
  trades: ['trade', 'trades'], decisive: ['decisive trade', 'decisive trades'], days: ['day', 'days'],
  entries: ['entry', 'entries'], positions: ['position', 'positions'],
}
/** A count in the measure's OWN unit ("1 trade", "12 decisive trades", "3 days"). */
export function countNoun(unit, n) {
  const pair = typeof unit === 'string' && Object.hasOwn(NOUNS, unit) ? NOUNS[unit] : NOUNS.trades
  return n === 1 ? pair[0] : pair[1]
}

/** The count line under one total figure: "from 47 trades", or, when the measure is known on fewer rows than the
 *  widget read (`coverage[i-1].have < total`), "from 9 of 47 trades" (an R measure adds "(38 have no stop)").
 *  `hint` is the coverage hint the server sent (the "Add stops" door), or null. Never a guessed count. */
export function countText(value, i, measure, coverage) {
  const cov = Array.isArray(coverage) ? coverage[i - 1] : null
  const hint = isRecord(cov) && typeof cov.hint === 'string' && cov.hint ? cov.hint : null
  if (isRecord(cov) && finite(cov.have) && finite(cov.total) && cov.have < cov.total) {
    const gap = cov.total - cov.have
    const tail = measure?.fmt === 'r' ? ` (${gap} ${gap === 1 ? 'has' : 'have'} no stop)` : ''
    return { text: `from ${cov.have} of ${cov.total} ${countNoun(measure?.unit, cov.total)}${tail}`, hint }
  }
  const n = isRecord(value) ? value[`n${i}`] : null
  return { text: finite(n) ? `from ${n} ${countNoun(measure?.unit, n)}` : '', hint }
}

/** Spec 5.2: an average or a rate is never read without its count. */
export const isCounted = (measure) => measure?.kind === 'average' || measure?.kind === 'rate'

/** "from 12 decisive trades" for one cell of an average or rate (its `n`, in the measure's own unit); '' for a
 *  sum, a count or an extreme, and '' when the count is unknown (never a guessed one). */
export function fromText(cell, measure) {
  if (!isCounted(measure) || !finite(cell?.n)) return ''
  return `from ${cell.n} ${countNoun(measure?.unit, cell.n)}`
}

/** One cell as a screen reader (and a tooltip) reads it: value, the badge, and an average's count. */
export function cellSpeech(cell, measure) {
  const from = fromText(cell, measure)
  return `${cell?.text ?? NO_DATA}${cell?.small ? `, ${SMALL_SAMPLE}` : ''}${from ? `, ${from}` : ''}`
}

/** One value as text, by the measure's `fmt`. Never throws; a non-finite value is "no data". */
export function fmtValue(v, fmt) {
  if (!finite(v)) return NO_DATA
  switch (fmt) {
    case 'money': return moneySigned(v)
    case 'money_plain': return money(v)
    case 'pct': return percent(v, { isRatio: true, dp: 1 })
    case 'ratio': return v.toFixed(2)
    case 'pf': return v >= PF_CAP ? '5+' : v.toFixed(2)
    case 'r': return rMultiple(v)
    case 'count': return String(Math.round(v))
    case 'signed_count': return v > 0 ? `+${Math.round(v)}` : String(Math.round(v))
    case 'days': return `${v.toFixed(1)} days`
    default: return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
}

/** A value short enough for a heat-map cell ("+1.5k", "-200", "55%", "+1.5R"). "no data" when unknown. */
export function compactValue(v, fmt) {
  if (!finite(v)) return NO_DATA
  const sign = v > 0 ? '+' : v < 0 ? '-' : ''
  const a = Math.abs(v)
  // ⛔ Never "+0" (or "-0.00") for a value that is not zero, and never "1000" or "1000.0k": a value that ROUNDS up
  // to the next unit is written in it ("1.0k", "1.0m").
  const tiny = (unit = '') => (v < 0 ? `>-0.01${unit}` : `+<0.01${unit}`)
  const short = (x) => {
    if (x > 0 && x < 0.005) return null
    if (Number((x / 1e9).toFixed(1)) >= 1 || Number((x / 1e6).toFixed(1)) >= 1000) return `${(x / 1e9).toFixed(1)}b`
    if (Number((x / 1e6).toFixed(1)) >= 1 || Number((x / 1e3).toFixed(1)) >= 1000) return `${(x / 1e6).toFixed(1)}m`
    if (Math.round(x) >= 1000) return `${(x / 1e3).toFixed(1)}k`
    if (x > 0 && x < 0.5) return x.toFixed(2)
    return `${Math.round(x)}`
  }
  const signed = (x) => { const t = short(x); return t === null ? tiny() : `${sign}${t}` }
  switch (fmt) {
    case 'money': return signed(a)
    case 'money_plain': return short(a) ?? '<0.01'   // unsigned by design
    case 'pct': { const r = Math.round(v * 100); return r === 0 && v !== 0 ? (v < 0 ? '>-1%' : '<1%') : `${r}%` }
    case 'r':
      if (v === 0) return '0R'
      if (a > 0 && a < 0.005) return tiny('R')
      return `${sign}${a < 0.05 ? a.toFixed(2) : a.toFixed(1)}R`
    case 'pf': return v >= PF_CAP ? '5+' : v.toFixed(1)
    case 'ratio': return a > 0 && a < 0.05 ? (v < 0 ? '>-0.1' : '<0.1') : v.toFixed(1)
    default: return signed(a)
  }
}

/** One slot of one row (or of the total) as `{text, small, hidden, value}`: a hidden value says
 *  "Not enough trades yet (n)", a small one carries the badge, a missing one is "no data", never a zero. */
export function cellOf(row, i, measure) {
  const r = isRecord(row) ? row : {}
  const v = r[`v${i}`]
  const n = r[`n${i}`]
  const s = r[`s${i}`]
  if (s === 'hide') {
    // A count it does not know is left out, never written as a zero.
    const text = `Not enough ${unitWord(measure?.unit)} yet${finite(n) ? ` (${n})` : ''}`
    return { text, hidden: true, small: false, value: null, n: finite(n) ? n : null }
  }
  return { text: fmtValue(v, measure?.fmt), small: s === 'small' && finite(v), hidden: false, value: finite(v) ? v : null,
    n: finite(n) ? n : null }
}

/** Ruling R-25 on the client: a SHARED widget's body becomes the archive image a public page shows, so it never
 *  draws an account NAME. Where the payload marks a label field as an account (`labelKind` / `label2Kind` ===
 *  'account'), each distinct label becomes "Account N", numbered by first appearance across rows, then series, then
 *  cells, so one account keeps one number: the same rule as the server's public_note_payload._relabel_accounts.
 *  The two fields never share a numbering. Unshared, or with no account label, `p` comes back as it is. Every view
 *  reads its rows through this (tableModelOf does), so a chart view added later inherits it. */
export function relabelAccounts(p) {
  if (!isRecord(p) || p.share !== true) return p
  const fields = [['labelKind', 'label'], ['label2Kind', 'label2']].filter(([k]) => p[k] === 'account')
  if (!fields.length) return p
  const out = { ...p }
  for (const key of ['rows', 'series', 'cells']) {
    if (Array.isArray(p[key])) out[key] = p[key].map((it) => (isRecord(it) ? { ...it } : it))
  }
  for (const [, field] of fields) {
    const numbering = new Map()
    for (const key of ['rows', 'series', 'cells']) {
      for (const it of Array.isArray(out[key]) ? out[key] : []) {
        if (!isRecord(it) || it[field] === null || it[field] === undefined) continue
        const name = String(it[field])
        if (!numbering.has(name)) numbering.set(name, `Account ${numbering.size + 1}`)
        it[field] = numbering.get(name)
      }
    }
  }
  return out
}

// ── Wave 10 (Task 10.18): the engine's display keys (widget_engine/payload.py, Task 10.5) ──────────────────────
// `drawdown.line`, `stop.line` and a goal-less `notice` are SERVER sentences: shown verbatim, never rebuilt here.

/** The legend of a running total's drawdown band, and the Drawdown column's word for a day at the high. */
export const DRAWDOWN_LEGEND = 'Drawdown'
export const AT_HIGH = 'At the high'
/** The two captioned quadrants of an MAE (across) vs MFE (up) scatter, and the line under it. */
export const QUADRANT_TEXT = Object.freeze({ gave: 'gave it back', tight: 'stopped too tight' })
export const QUADRANT_NOTE = 'Dashed lines mark 1R on each axis.'

const NO_W10 = Object.freeze({ drawdown: null, stop: null, goal: null, quadrants: false, cumulative: false })
const sentence = (x) => (isRecord(x) && typeof x.line === 'string' && x.line ? x.line : null)

/** The wave 10 keys a view may draw, read ONCE here. ⛔ Ruling W10-R7: a SHARED body (the archive image a public page
 *  shows) reads none of them, so it is exactly the wave 8 view whatever the payload carries; a missing or malformed
 *  key is absent too (the wave 8 view), never a zero. `goal.target` is null when the member set no goal. */
export function w10Of(p) {
  if (!isRecord(p) || p.share === true) return NO_W10
  const view = typeof p.view === 'string' ? p.view : 'number'
  const label = typeof p.targetLabel === 'string' && p.targetLabel ? p.targetLabel : null
  return {
    drawdown: sentence(p.drawdown),
    stop: isRecord(p.stop) ? { line: sentence(p.stop), hit: finite(p.stop.losses) && finite(p.stop.after) && p.stop.losses >= p.stop.after } : null,
    goal: view === 'progress' && label ? { label, target: finite(p.target) && p.target > 0 ? p.target : null } : null,
    quadrants: view === 'scatter' && p.quadrants === 'excursion',
    cumulative: view === 'line' && Array.isArray(p.series) && p.series.some((r) => isRecord(r) && Object.hasOwn(r, 'dd1')),
  }
}

/** The slot (0-based) of the plan's measure `key` (the frozen plan's measure list is the payload's, in order); -1 when
 *  the note carries no plan (`defRef`) or the plan does not measure it. */
export function measureSlotOf(p, key) {
  const list = Array.isArray(p?.def?.measures) ? p.def.measures.slice(0, SLOTS) : []
  return list.findIndex((m) => isRecord(m) && m.key === key)
}

/** A goal amount reads unsigned ("$1,000.00"): a goal is a size, not a gain. */
export const goalText = (target, fmt) => fmtValue(target, fmt === 'money' ? 'money_plain' : fmt)
/** "30%" of a target, or '' when either is unknown (never "0%" for an unknown). */
export const shareText = (value, target) => (finite(value) && finite(target) && target
  ? `${Math.round((value / target) * 100)}%` : '')

/** The server's notice a Progress view shows in place of its bar: a goal widget whose member set no goal. null when
 *  the view draws a bar (or the wave 8 view), so the placed widget says the notice under the body instead. */
export function progressNoticeOf(p) {
  const g = w10Of(p).goal
  return g && g.target === null && typeof p?.notice === 'string' && p.notice ? p.notice : null
}

/** Which captioned quadrant (MAE across, MFE up, both in R) a point is in: 'gave' (MFE at least 1R, MAE under 1R),
 *  'tight' (MAE at least 1R, MFE under 1R), or null. */
export function quadrantOf(x, y) {
  if (!finite(x) || !finite(y)) return null
  if (y >= 1 && x < 1) return 'gave'
  if (x >= 1 && y < 1) return 'tight'
  return null
}

/** One period of a running total, as the readout and a screen reader read it: "-$50.00 total · -$250.00 that day".
 *  A day with no amount of its own says "no data that day", never a zero. */
export function runningSpeech(cell, day, measure) {
  if (!cell || cell.hidden || typeof cell.value !== 'number') return cellSpeech(cell, measure)
  const d = finite(day) ? fmtValue(day, measure?.fmt) : NO_DATA
  return `${cell.text} total · ${d} that day${cell.small ? `, ${SMALL_SAMPLE}` : ''}`
}

const dayText = (d) => (typeof d === 'string' ? d.slice(0, 10) : '')
const isNum = (v) => v === null || finite(v)
const RESULT = { win: 'Win', loss: 'Loss', be: 'Breakeven' }
const TOTAL_VIEWS = new Set(['number', 'compare', 'progress'])
const plain = (text) => ({ text, small: false, hidden: false })

/** The cell a drill asks the server for (drill.clean_cell): `{}` for a total, `{label}` / `{label, label2}` for a
 *  group, `{d, x, y}` for a scatter point. It is built from the RAW item, never the relabelled one: a shared
 *  widget draws "Account 1", but the server finds the group by its real label. null when it cannot be asked. */
function drillCellOf(view, item) {
  if (!isRecord(item)) return null
  if (view === 'scatter') {
    if (typeof item.d !== 'string' || !item.d || !isNum(item.x ?? null) || !isNum(item.y ?? null)) return null
    return { d: item.d, x: item.x ?? null, y: item.y ?? null }
  }
  if (typeof item.label !== 'string') return null
  const out = { label: item.label }
  if (typeof item.label2 === 'string') out.label2 = item.label2
  return out
}

const listOf = (p, view) => {
  let list
  if (TOTAL_VIEWS.has(view)) list = isRecord(p?.value) ? [{ ...p.value, label: 'All' }] : []
  else if (view === 'line') list = Array.isArray(p?.series) ? p.series : []
  else if (view === 'heat') list = Array.isArray(p?.cells) ? p.cells : []
  else if (view === 'scatter') list = Array.isArray(p?.points) ? p.points : []
  else list = Array.isArray(p?.rows) ? p.rows : []
  return list.filter(isRecord)
}

/** The view's own rows as one table: `{columns: [{key, label}], rows: [{key, cells: [{text, small, hidden}],
 *  flagged, label, label2, values, drill}]}`. It is what TableView draws, what "Show as table" (TableAlt) lays
 *  out AND what every chart view draws, so all of them read the SAME rows through the SAME account relabelling
 *  (R-25): a number reads its total, a table, bar or list its rows, a line its series, a heat map its cells and a
 *  scatter its points. `label`/`label2` are the display labels, `values` the measure cells, `drill` the cell the
 *  drill-down asks for (built from the raw item; `{}` for a total). */
export function tableModelOf(raw) {
  const p = relabelAccounts(raw)
  const measures = measuresOf(p)
  const view = typeof p?.view === 'string' ? p.view : 'number'
  const w10 = w10Of(raw)
  if (view === 'scatter') {
    const pts = listOf(p, 'scatter')
    const rawPts = listOf(raw, 'scatter')
    return {
      columns: [{ key: 'd', label: 'Day' }, { key: 'x', label: measures[0]?.label || 'X' },
        { key: 'y', label: measures[1]?.label || 'Y' }, { key: 'r', label: 'Result' },
        ...(w10.quadrants ? [{ key: 'q', label: 'Quadrant' }] : [])],
      rows: pts.map((pt, i) => ({
        key: `p${i}`, flagged: false, label: dayText(pt.d), label2: null,
        point: { x: finite(pt.x) ? pt.x : null, y: finite(pt.y) ? pt.y : null,
          r: typeof pt.r === 'string' && Object.hasOwn(RESULT, pt.r) ? pt.r : null },
        quadrant: w10.quadrants ? quadrantOf(pt.x, pt.y) : null,
        values: [], drill: drillCellOf('scatter', rawPts[i]),
        cells: [plain(dayText(pt.d) || NO_DATA), plain(fmtValue(pt.x, measures[0]?.fmt)),
          plain(fmtValue(pt.y, measures[1]?.fmt)),
          plain(typeof pt.r === 'string' && Object.hasOwn(RESULT, pt.r) ? RESULT[pt.r] : ''),
          ...(w10.quadrants ? [plain(QUADRANT_TEXT[quadrantOf(pt.x, pt.y)] || '')] : [])],
      })),
    }
  }
  const list = listOf(p, view)
  const rawList = listOf(raw, view)
  const total = TOTAL_VIEWS.has(view)
  // Every measure, for every view (a heat map shades the first; the table lists them all). An average or a rate
  // gets its own count column beside it (spec 5.2: never read without its count).
  const slots = measures
  const hasLabel2 = list.some((r) => typeof r.label2 === 'string' && r.label2)
  const countCell = (c, m) => plain(finite(c.n) ? `${c.n} ${countNoun(m?.unit, c.n)}` : NO_DATA)
  // Wave 10 (Task 10.18): "Show as table" carries every new key. A running total adds each measure's own amount that
  // day and the first measure's drop from its high; a total adds the drawdown's dates, the stop-after line and the
  // goal with the share of it. Absent keys add no column, so a wave 9 payload lays out exactly as wave 8.
  const cum = w10.cumulative
  const nameOf = (m, i) => m.label || `Measure ${i + 1}`
  const extras = []
  if (total && w10.drawdown) extras.push({ key: 'dd', label: 'Drawdown dates', cell: () => plain(w10.drawdown) })
  if (total && w10.stop?.line) extras.push({ key: 'stop', label: 'Stop after', cell: () => plain(w10.stop.line) })
  if (total && w10.goal) {
    const g = w10.goal
    // with no goal set the cell is "no data": the server's notice is said once, under the table (BuiltWidgetEmbed)
    extras.push({ key: 'goal', label: g.label, cell: () => plain(goalText(g.target, slots[0]?.fmt)) })
    extras.push({ key: 'goalShare', label: 'Of goal',
      cell: (r) => plain(shareText(finite(r.v1) ? r.v1 : null, g.target) || NO_DATA) })
  }
  const ddCell = (r) => {
    if (!finite(r.dd1)) return plain(NO_DATA)
    return plain(r.dd1 === 0 ? AT_HIGH : fmtValue(r.dd1, slots[0]?.fmt))
  }
  return {
    columns: [
      { key: 'label', label: view === 'line' || view === 'heat' ? 'Period' : 'Group' },
      ...(hasLabel2 ? [{ key: 'label2', label: 'Then' }] : []),
      ...slots.flatMap((m, i) => [
        { key: `v${i + 1}`, label: cum ? `${nameOf(m, i)}, running total` : nameOf(m, i) },
        ...(isCounted(m) ? [{ key: `n${i + 1}`, label: `${nameOf(m, i)} (n)` }] : []),
        ...(cum ? [{ key: `d${i + 1}`, label: `${nameOf(m, i)}, that day` }] : []),
      ]),
      ...(cum ? [{ key: 'dd1', label: DRAWDOWN_LEGEND }] : []),
      ...extras.map((x) => ({ key: x.key, label: x.label })),
    ],
    rows: list.map((r, i) => {
      const label = typeof r.label === 'string' && r.label ? r.label : '(none)'
      const label2 = hasLabel2 ? (typeof r.label2 === 'string' && r.label2 ? r.label2 : '(none)') : null
      const values = slots.map((m, k) => cellOf(r, k + 1, m))
      const day = cum ? slots.map((m, k) => (finite(r[`d${k + 1}`]) ? r[`d${k + 1}`] : null)) : null
      return {
        key: `r${i}`,
        flagged: r.flagged === true,
        label, label2, values,
        ...(cum ? { day, dd: finite(r.dd1) ? r.dd1 : null } : {}),
        drill: total ? {} : drillCellOf(view, rawList[i]),
        cells: [plain(label), ...(hasLabel2 ? [plain(label2)] : []),
          ...values.flatMap((c, k) => [c, ...(isCounted(slots[k]) ? [countCell(c, slots[k])] : []),
            ...(cum ? [plain(fmtValue(day[k], slots[k]?.fmt))] : [])]),
          ...(cum ? [ddCell(r)] : []),
          ...extras.map((x) => x.cell(r))],
      }
    }),
  }
}
