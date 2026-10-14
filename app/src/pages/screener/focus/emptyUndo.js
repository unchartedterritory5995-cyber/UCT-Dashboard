// emptyUndo.js — the empty state's "your last change took the list from N to 0"
// bookkeeping (spec §8.4). Pure: the orchestrator keeps the previous spec and
// total, and asks this whether the newest change is the one that emptied it.
import { chipLabel } from '../chipLabel'

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const POOL_KEYS = new Set(['universe', 'list'])

// Exactly one key added or changed between two filter maps. A removal is not a
// change that can empty a list (removing a filter only widens it), so it is null.
export function diffOneFilter(prev = {}, next = {}) {
  const p = prev || {}
  const n = next || {}
  const keys = new Set([...Object.keys(p), ...Object.keys(n)])
  const changed = [...keys].filter(k => !same(p[k], n[k]))
  if (changed.length !== 1) return null
  const key = changed[0]
  return n[key] ? { key } : null
}

function poolLabel(key, spec) {
  if (key === 'list') return `Universe: ${spec?.label || 'your list'}`
  return `Universe: ${spec?.label || (spec?.value === 'uct' ? 'UCT Universe' : 'All stocks')}`
}

// Only when the list HAD rows, now has none, and exactly one filter differs.
export function describeEmptying({ prevSpec, prevTotal, nextSpec, nextTotal, defs = {} } = {}) {
  if (!(prevTotal > 0) || nextTotal !== 0) return null
  const d = diffOneFilter(prevSpec?.filters, nextSpec?.filters)
  if (!d) return null
  const spec = nextSpec.filters[d.key]
  if (POOL_KEYS.has(d.key)) return { label: poolLabel(d.key, spec), from: prevTotal }
  const def = defs[d.key] || { key: d.key, label: d.key, presets: [] }
  return { label: chipLabel(def, spec) || def.label, from: prevTotal }
}
