// Spec §6.3. A ✓ only for a filter that reads one column with a plain
// comparison; pools read "In …"; everything that cannot be checked per row
// (scan joins, logic trees, ranks, field-to-field, structure contains) is a
// plain sentence. Never a ✓ we cannot back with the row's own value.
import { chipLabel } from '../chipLabel'

export const NOT_CHECKABLE_KEYS = new Set([
  'universe', 'list', 'scan', 'tickers', 'arith', 'base_structure', 'pattern_engine_id',
])
const CHECK_OPS = new Set(['gte', 'lte', 'gt', 'lt', 'between', 'eq', 'in', 'not_in'])
const MAX = 5

const isCheckable = (key, spec) =>
  !NOT_CHECKABLE_KEYS.has(key) && CHECK_OPS.has(spec?.op) && !String(spec?.op || '').endsWith('_col')

export function whyColumns(filters) {
  return Object.entries(filters || {}).filter(([k, v]) => v && isCheckable(k, v)).map(([k]) => k)
}

function fmtValue(def, v) {
  if (v === null || v === undefined || v === '') return '—'
  if (def?.type === 'bool') return v ? 'Yes' : 'No'
  if (typeof v !== 'number') return String(v)
  const n = Math.abs(v) >= 100 ? v.toFixed(2).replace(/\.00$/, '') : String(Math.round(v * 100) / 100)
  if (def?.unit === '$') return `$${n}`
  if (def?.unit === '%') return `${n}%`
  return n
}

// chipLabel says "RS Rank: ≥ 80"; the strip reads "RS Rank ≥ 80".
const stripColon = s => s.replace(/:\s*/, ' ').replace(/\s+/g, ' ').trim()

export function whyItsHere({ filters = {}, logic = null, rank = null, metaFilters = [], row = {} } = {}) {
  const defs = Object.fromEntries((metaFilters || []).map(f => [f.key, f]))
  const all = []
  for (const [key, spec] of Object.entries(filters || {})) {
    if (!spec) continue
    if (key === 'universe') { all.push({ kind: 'pool', label: `In ${spec.label || 'UCT Universe'}` }); continue }
    if (key === 'list') { all.push({ kind: 'pool', label: `In ${spec.label || 'your list'}` }); continue }
    if (key === 'scan') { all.push({ kind: 'note', label: `In My Scan ${spec.label || ''}`.trim() }); continue }
    const def = defs[key] || { key, label: key, presets: [] }
    if (!isCheckable(key, spec)) {
      all.push({ kind: 'note', label: `Matches ${def.label}` }); continue
    }
    if (def.type === 'bool') { all.push({ kind: 'check', label: def.label, value: fmtValue(def, row[key]) }); continue }
    all.push({ kind: 'check', label: stripColon(chipLabel(def, spec)), value: fmtValue(def, row[key]) })
  }
  if (logic) all.push({ kind: 'note', label: 'Matches your custom criteria' })
  if (rank) all.push({ kind: 'note', label: rank.top_n ? `Ranked in the top ${rank.top_n} by your weights` : 'Ranked by your weights' })
  return { items: all.slice(0, MAX), more: Math.max(0, all.length - MAX) }
}
