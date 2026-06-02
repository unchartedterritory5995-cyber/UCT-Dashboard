// app/src/pages/calendar/filterLogic.js
export const DEFAULT_FILTERS = {
  audience: 'mine',   // 'mine' | 'watchlist' | 'positions' | 'uct20' | 'all'
  minMcap: 0,         // billions
  sort: 'mine',       // 'mine' | 'time' | 'mcap' | 'move'
  // A3: additional metric filters (null = off)
  minAvgVol: null,    // minimum avg volume (shares), e.g. 500000
  priceMin: null,     // minimum price, e.g. 5
  priceMax: null,     // maximum price, e.g. 1000
}

export function applyFilters(rows, f) {
  let out = rows
  if (f.audience === 'mine') out = out.filter(r => r.mine)
  else if (f.audience !== 'all') out = out.filter(r => r._sources?.includes(f.audience))
  if (f.minMcap > 0) out = out.filter(r => (r.mc_b ?? Infinity) >= f.minMcap)

  // A3: avg volume filter — null-safe passthrough (missing metric → keep row)
  if (f.minAvgVol != null && f.minAvgVol > 0) {
    out = out.filter(r => r._avg_vol == null || r._avg_vol >= f.minAvgVol)
  }

  // A3: price range filters — null-safe passthrough
  if (f.priceMin != null && f.priceMin > 0) {
    out = out.filter(r => r._price == null || r._price >= f.priceMin)
  }
  if (f.priceMax != null && f.priceMax > 0) {
    out = out.filter(r => r._price == null || r._price <= f.priceMax)
  }

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
