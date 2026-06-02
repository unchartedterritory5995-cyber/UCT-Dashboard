// app/src/pages/calendar/filterLogic.js
export const DEFAULT_FILTERS = {
  audience: 'mine',   // 'mine' | 'watchlist' | 'positions' | 'uct20' | 'all'
  minMcap: 0,         // billions
  sort: 'mine',       // 'mine' | 'time' | 'mcap' | 'move'
}

export function applyFilters(rows, f) {
  let out = rows
  if (f.audience === 'mine') out = out.filter(r => r.mine)
  else if (f.audience !== 'all') out = out.filter(r => r._sources?.includes(f.audience))
  if (f.minMcap > 0) out = out.filter(r => (r.mc_b ?? Infinity) >= f.minMcap)
  return out
}

export function sortEntries(rows, sort) {
  const copy = [...rows]
  if (sort === 'mcap') copy.sort((a, b) => (b.mc_b ?? 0) - (a.mc_b ?? 0))
  else if (sort === 'move')
    copy.sort((a, b) => (b.expected_move?.pct ?? -1) - (a.expected_move?.pct ?? -1))
  else if (sort === 'mine')
    copy.sort((a, b) => (b.mine === true) - (a.mine === true))
  // 'time' = preserve incoming BMO/AMC order
  return copy
}
