// Sorting for the Grid view, kept apart from the component so it is unit-testable.
export const GRID_SORTS = [
  { key: 'pct', label: '% change', get: (r) => r.pct, dirAware: true },
  { key: 'rvol', label: 'RVOL', get: (r) => r.rvol },
  { key: 'mcap', label: 'Market cap', get: (r) => r.mcap },
  { key: 'rating', label: 'UCT rating', get: (r) => r.rating },
  { key: 'sym', label: 'Symbol', get: (r) => r.sym, text: true },
]

export function sortGridRows(rows, key, dir = 1) {
  const s = GRID_SORTS.find(x => x.key === key) || GRID_SORTS[0]
  const sign = s.dirAware ? dir : 1
  return [...rows].sort((a, b) => {
    const va = s.get(a), vb = s.get(b)
    if (s.text) return String(va || '').localeCompare(String(vb || ''))
    const fa = Number.isFinite(va), fb = Number.isFinite(vb)
    if (fa !== fb) return fa ? -1 : 1
    return fa ? sign * (vb - va) : 0
  })
}
