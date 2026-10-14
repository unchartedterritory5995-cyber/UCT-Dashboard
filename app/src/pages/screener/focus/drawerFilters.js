// Plain data and rules for the Filters drawer and the empty state's "remove one" pills.
import { chipLabel } from '../chipLabel'
import { compactDigits } from './whyItsHere'

// Owner decision 2 (2026-10-14): these come first, in this order. Keys are the screener
// meta's (api/services/screener/filters.py); a key the meta does not send is skipped.
export const COMMON_FILTERS = ['price', 'market_cap', 'rs_rank', 'avg_volume_30d', 'sector']

// An enum with more choices than this is a select with a narrowing box, not a wall of buttons.
export const BUTTONS_MAX = 12
export const choicesOf = f => (f.presets || []).filter(p => p.label !== 'Any')
export const isLongEnum = f => f?.type === 'enum' && choicesOf(f).length > BUTTONS_MAX

// At most this many "remove → N matches" pills; their counts go out as one batch request.
export const MAX_DROP_PILLS = 8
export const LOGIC_ID = '__logic'
const POOL_KEYS = new Set(['universe', 'list'])

// One pill per active filter (the universe/list pool is the place being searched, not a
// filter), each carrying the spec the screen would run with that one filter removed.
export function dropOptions(spec, meta, withLogic) {
  const filters = spec?.filters || []
  const defs = Object.fromEntries((meta?.filters || []).map(f => [f.key, f]))
  const out = []
  for (const { key, ...v } of filters) {
    if (POOL_KEYS.has(key)) continue
    const label = compactDigits(chipLabel(defs[key] || { key, label: key, presets: [] }, v) || key)
    out.push({ id: key, label, spec: { ...spec, filters: filters.filter(f => f.key !== key) } })
  }
  if (withLogic && spec?.logic) {
    const { logic: _logic, ...rest } = spec
    out.push({ id: LOGIC_ID, label: 'Custom criteria', spec: rest })
  }
  return out
}
