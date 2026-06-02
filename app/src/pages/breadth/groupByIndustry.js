// Industry grouping for the breadth drill-down "Grouped" view.
// Pure + standalone (no React / CSS imports) so it's cheap to unit-test.
//
//   items       — [{ t, n, c, vr, a50, atr, pct }] (a breadth drill list)
//   industries  — { TICKER: industry|null } from /api/breadth/industries
//
// Returns { groups, order }:
//   groups — [{ key, count, avgPct, items }] sorted by count DESC (most
//            represented industry first), tie-break by |avgPct| desc.
//            "Unclassified" (no industry yet) always sorts LAST. Items within
//            a group are sorted by |pct| desc.
//   order  — all items flattened in grouped display order (drives copy).

export const UNCLASSIFIED_GROUP = 'Unclassified'

export function groupItemsByIndustry(items, industries) {
  const buckets = new Map()
  for (const it of items ?? []) {
    const ind = (industries?.[(it.t || '').toUpperCase()] || '').trim() || UNCLASSIFIED_GROUP
    if (!buckets.has(ind)) buckets.set(ind, [])
    buckets.get(ind).push(it)
  }
  const groups = []
  for (const [key, arr] of buckets) {
    const sorted = [...arr].sort((a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0))
    const avgPct = sorted.length
      ? sorted.reduce((s, x) => s + (x.pct ?? 0), 0) / sorted.length
      : 0
    groups.push({ key, count: sorted.length, avgPct, items: sorted })
  }
  groups.sort((a, b) => {
    if (a.key === UNCLASSIFIED_GROUP && b.key !== UNCLASSIFIED_GROUP) return 1
    if (b.key === UNCLASSIFIED_GROUP && a.key !== UNCLASSIFIED_GROUP) return -1
    if (b.count !== a.count) return b.count - a.count
    return Math.abs(b.avgPct) - Math.abs(a.avgPct)
  })
  return { groups, order: groups.flatMap(g => g.items) }
}
