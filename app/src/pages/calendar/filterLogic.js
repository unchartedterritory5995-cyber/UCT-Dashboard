// app/src/pages/calendar/filterLogic.js
export const DEFAULT_FILTERS = {
  // First paint shows the whole market ranked big→small (mine still pinned
  // first by the default sort) — a fresh visitor must never land on a sparse
  // "My Stocks" week. Owner decision 2026-07-13.
  audience: 'all',    // 'mine' | 'watchlist' | 'positions' | 'uct20' | 'all'
  minMcap: 0,         // billions — quick-bar cap pills write 0 | 1 | 10 | 100
  sort: 'mine',       // 'mine' | 'time' | 'mcap' | 'move'
  // A3: additional metric filters (null = off)
  minAvgVol: null,    // minimum avg volume (shares), e.g. 500000
  priceMin: null,     // minimum price, e.g. 5
  priceMax: null,     // maximum price, e.g. 1000
  confirmedOnly: false, // hide entries whose report DATE is only an estimate
  sector: null,       // scope to one GICS sector (null = all)
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

  // Date-integrity: hide reporters whose date is only an estimate (unconfirmed).
  if (f.confirmedOnly) out = out.filter(r => !r.date_est)

  // Sector scoping — one GICS sector at a time. Strict match: the chips are
  // derived only from sectors actually present in the loaded data, so their
  // counts stay honest. A name whose sector hasn't resolved yet simply isn't
  // offered under any chip (it still shows in the unscoped "All" view).
  if (f.sector) out = out.filter(r => r.sector === f.sector)

  // Quick search — matches ticker or company-name substring, case-insensitive.
  // f.q is EPHEMERAL (component state merged in by Calendar.jsx) — it must
  // never be written into the persisted calendar_filters preference.
  const needle = (f.q || '').trim().toUpperCase()
  if (needle) {
    out = out.filter(r =>
      (r.sym || '').toUpperCase().includes(needle) ||
      (r.name || '').toUpperCase().includes(needle))
  }

  return out
}

// True when a day HAS reporters but the quick filters (search text / cap
// pills) hid every one — drives the per-day "N hidden by filters" line.
// Audience-only emptiness stays quiet: hiding days is what audience scoping
// is FOR, while a quick filter that silently blanks a day reads as a bug.
export function hiddenByQuickFilters(rawCount, visibleCount, f) {
  return rawCount > 0 && visibleCount === 0 &&
    (!!(f.q || '').trim() || f.minMcap > 0)
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
