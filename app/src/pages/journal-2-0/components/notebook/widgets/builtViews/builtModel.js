// Built widget views (wave 8, Task 8.13): the one reading of a built payload every view shares.
//
// A payload's values live on FIXED keys (`v1..v3`, `n1..n3`, `s1..s3`, server widget_engine/payload.py), never on
// measure names, and its `measures` list says how each slot reads (`label`, `unit`, `kind`, `fmt`). Rows are
// grouped with `Map` elsewhere, never plain objects, so a label like "__proto__" is an ordinary string here.
import { money, moneySigned, percent, rMultiple } from '../../../../../../lib/journal-2-0/format'

export const SLOTS = 3
export const NO_DATA = 'no data'
export const SMALL_SAMPLE = 'small sample'

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** The payload's measures, at most three, each `{label, unit, kind, fmt}`. */
export function measuresOf(p) {
  const list = Array.isArray(p?.measures) ? p.measures : []
  return list.slice(0, SLOTS).map((m) => (isRecord(m) ? m : {}))
}

/** The noun a measure counts in ("Not enough trades yet (3)", "Not enough days yet (2)"). */
export const unitWord = (unit) => (unit === 'days' ? 'days' : 'trades')

/** One value as text, by the measure's `fmt`. Never throws; a non-finite value is "no data". */
export function fmtValue(v, fmt) {
  if (!finite(v)) return NO_DATA
  switch (fmt) {
    case 'money': return moneySigned(v)
    case 'money_plain': return money(v)
    case 'pct': return percent(v, { isRatio: true, dp: 1 })
    case 'ratio': return v.toFixed(2)
    case 'r': return rMultiple(v)
    case 'count': return String(Math.round(v))
    case 'signed_count': return v > 0 ? `+${Math.round(v)}` : String(Math.round(v))
    case 'days': return `${v.toFixed(1)} days`
    default: return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
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
    return { text: `Not enough ${unitWord(measure?.unit)} yet (${finite(n) ? n : 0})`, hidden: true, small: false, value: null }
  }
  return { text: fmtValue(v, measure?.fmt), small: s === 'small' && finite(v), hidden: false, value: finite(v) ? v : null }
}

const dayText = (d) => (typeof d === 'string' ? d.slice(0, 10) : '')
const RESULT = { win: 'Win', loss: 'Loss', be: 'Breakeven' }
const TOTAL_VIEWS = new Set(['number', 'compare', 'progress'])
const plain = (text) => ({ text, small: false, hidden: false })

/** The view's own rows as one table: `{columns: [{key, label}], rows: [{key, cells: [{text, small, hidden}],
 *  flagged}]}`. It is what TableView draws and what "Show as table" (TableAlt) lays out, so both read the SAME
 *  rows: a number reads its total, a table, bar or list its rows, a line its series, a heat map its cells and a
 *  scatter its points. */
export function tableModelOf(p) {
  const measures = measuresOf(p)
  const view = typeof p?.view === 'string' ? p.view : 'number'
  if (view === 'scatter') {
    const pts = Array.isArray(p?.points) ? p.points.filter(isRecord) : []
    return {
      columns: [{ key: 'd', label: 'Day' }, { key: 'x', label: measures[0]?.label || 'X' },
        { key: 'y', label: measures[1]?.label || 'Y' }, { key: 'r', label: 'Result' }],
      rows: pts.map((pt, i) => ({
        key: `p${i}`, flagged: false,
        cells: [plain(dayText(pt.d) || NO_DATA), plain(fmtValue(pt.x, measures[0]?.fmt)),
          plain(fmtValue(pt.y, measures[1]?.fmt)),
          plain(typeof pt.r === 'string' && Object.hasOwn(RESULT, pt.r) ? RESULT[pt.r] : '')],
      })),
    }
  }
  let list
  if (TOTAL_VIEWS.has(view)) list = isRecord(p?.value) ? [{ ...p.value, label: 'All' }] : []
  else if (view === 'line') list = Array.isArray(p?.series) ? p.series : []
  else if (view === 'heat') list = Array.isArray(p?.cells) ? p.cells : []
  else list = Array.isArray(p?.rows) ? p.rows : []
  list = list.filter(isRecord)
  const slots = view === 'heat' ? measures.slice(0, 1) : measures
  const hasLabel2 = list.some((r) => typeof r.label2 === 'string' && r.label2)
  return {
    columns: [
      { key: 'label', label: view === 'line' || view === 'heat' ? 'Period' : 'Group' },
      ...(hasLabel2 ? [{ key: 'label2', label: 'Then' }] : []),
      ...slots.map((m, i) => ({ key: `v${i + 1}`, label: m.label || `Measure ${i + 1}` })),
    ],
    rows: list.map((r, i) => ({
      key: `r${i}`,
      flagged: r.flagged === true,
      cells: [
        plain(typeof r.label === 'string' && r.label ? r.label : '(none)'),
        ...(hasLabel2 ? [plain(typeof r.label2 === 'string' && r.label2 ? r.label2 : '(none)')] : []),
        ...slots.map((m, k) => cellOf(r, k + 1, m)),
      ],
    })),
  }
}
