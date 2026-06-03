// Generalized grouping for any breadth stock-list surface.
// Pure + standalone (no React / CSS) so it's cheap to unit-test and shared by
// the drill modal AND the CustomScan scanner — that's what keeps grouping
// uniform across surfaces.
//
//   items         — array of row objects
//   labelByTicker — { TICKER: groupLabel|null } (industry OR sector map)
//   opts.tickerOf — row -> ticker string   (default r => r.t)
//   opts.pctOf    — row -> % move number   (default r => r.pct)
//
// Returns { groups, order }:
//   groups — [{ key, count, avgPct, items }] sorted by count DESC (most
//            represented first), tie-break by |avgPct| desc. "Unclassified"
//            always sorts LAST. Items within a group sort by |pct| desc.
//   order  — all items flattened in grouped display order.

export const UNCLASSIFIED_GROUP = 'Unclassified'

export function groupItems(items, labelByTicker, opts = {}) {
  const tickerOf = opts.tickerOf || (r => r?.t)
  const pctOf = opts.pctOf || (r => r?.pct)

  const buckets = new Map()
  for (const it of items ?? []) {
    const sym = (tickerOf(it) || '').toUpperCase()
    const label = (labelByTicker?.[sym] || '').trim() || UNCLASSIFIED_GROUP
    if (!buckets.has(label)) buckets.set(label, [])
    buckets.get(label).push(it)
  }

  const groups = []
  for (const [key, arr] of buckets) {
    const sorted = [...arr].sort((a, b) => Math.abs(pctOf(b) ?? 0) - Math.abs(pctOf(a) ?? 0))
    const avgPct = sorted.length
      ? sorted.reduce((s, x) => s + (pctOf(x) ?? 0), 0) / sorted.length
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
