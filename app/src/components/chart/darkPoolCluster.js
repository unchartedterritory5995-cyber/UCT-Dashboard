// Shared dark-pool print clustering. Merges individual prints that sit at nearly
// the same price into one aggregated "zone" so the chart overlay shows a handful
// of meaningful price levels instead of dozens of overlapping bars.
//
// Extracted from pages/DarkPool.jsx so both the Dark Pool page and the in-chart
// dark-pool setting (StockChart) render from ONE implementation — the clustering
// rule can never diverge between the two surfaces.
export function clusterDarkPoolPrints(prints, { zonePct = 0.02 } = {}) {
  if (!prints || prints.length === 0) return []
  // Defensively read fields — backend may use either short or long names
  const readPrice    = p => (p?.price ?? p?.p ?? 0)
  const readNotional = p => (p?.notional ?? p?.n ?? p?.premium ?? 0)
  const readVolume   = p => (p?.volume ?? p?.v ?? 0)

  const sorted = [...prints].sort((a, b) => readPrice(a) - readPrice(b))
  const zones = []
  let current = null

  for (const p of sorted) {
    const price = readPrice(p)
    const notional = readNotional(p)
    const volume = readVolume(p)
    if (price <= 0) continue

    const ref = current?.price ?? price
    const tol = ref * zonePct
    if (current && Math.abs(price - ref) <= tol) {
      // Merge into current zone
      current._members.push(p)
      current.notional = (current.notional || 0) + notional
      current.volume = (current.volume || 0) + volume
      // Volume-weighted avg price (fall back to count weighting if no volume)
      const wSum = current._members.reduce((s, x) => s + readPrice(x) * (readVolume(x) || 1), 0)
      const wDen = current._members.reduce((s, x) => s + (readVolume(x) || 1), 0)
      current.price = wDen > 0 ? wSum / wDen : price
      current.priceLow = Math.min(current.priceLow, price)
      current.priceHigh = Math.max(current.priceHigh, price)
      // Keep the latest timestamp visible if present
      if (p.time && (!current.time || String(p.time) > String(current.time))) current.time = p.time
      if (p.timestamp && (!current.timestamp || String(p.timestamp) > String(current.timestamp))) current.timestamp = p.timestamp
    } else {
      // Start a new zone. Spread the source print first so unknown fields
      // (color, sector, message, etc.) pass through to the chart unchanged
      // for single-member zones — only multi-print zones get the aggregated
      // shape. Identifier fields then get overwritten with cluster values.
      current = {
        ...p,
        price, notional, volume,
        priceLow: price, priceHigh: price,
        _members: [p],
      }
      zones.push(current)
    }
  }

  // For multi-print zones, synthesize a message that reflects the aggregate.
  // Single-member zones keep their original message untouched.
  return zones.map(z => {
    if (z._members.length === 1) {
      const { _members, priceLow, priceHigh, ...single } = z
      return single
    }
    const count = z._members.length
    const dollarsLabel = z.notional >= 1e9 ? "$" + (z.notional/1e9).toFixed(2) + "B"
                       : z.notional >= 1e6 ? "$" + (z.notional/1e6).toFixed(1) + "M"
                       : z.notional >= 1e3 ? "$" + (z.notional/1e3).toFixed(0) + "K"
                       : "$" + Math.round(z.notional)
    const { _members, ...out } = z
    return {
      ...out,
      message: `DARK ZONE  ${dollarsLabel} · ${count} prints clustered`,
      _isCluster: true,
      _clusterCount: count,
    }
  })
}
