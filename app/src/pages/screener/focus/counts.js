// The Focus layout's count rules, in ONE place. Every count a member sees (the screen button,
// "1 of N", the drawer, the screen menu, the empty-state pills, the Save hint) goes through here.

const POOL_KEYS = new Set(['universe', 'list'])

// S2: a ranked screen (UCT 50, any `top_n`) lists at most its top_n stocks, while the scan and
// count routes report the full eligible count beside it. The member is shown what the screen
// lists. A count that is not a number (undefined: not asked yet, null: failed) passes through
// untouched: it must never become a number here.
export function capToTopN(n, spec) {
  const top = spec?.rank?.top_n
  return typeof n === 'number' && Number.isFinite(top) && top > 0 ? Math.min(n, top) : n
}

// The universe/list entries of a spec's filter array: the place being searched.
export const poolOf = spec => (spec?.filters || []).filter(f => f && POOL_KEYS.has(f.key))

// S3: a screen that names no universe or list runs in the member's chosen pool (applying it
// carries the pool forward), so its count must be asked in that pool too. A screen that names
// its own pool keeps it.
export function withPool(spec, pool) {
  const base = spec || { filters: [] }
  if (!pool?.length || poolOf(base).length) return base
  return { ...base, filters: [...(base.filters || []), ...pool] }
}
