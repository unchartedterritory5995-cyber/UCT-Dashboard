import FrozenList from './FrozenList'

/**
 * Watchlist journal renderer: the captured LIST (owner-approved payload
 * freeze) — symbols with per-symbol notes and price/±% as they stood at
 * capture. Lists mutate and delete, so the payload is the only durable
 * record. NOT the live Watchlists page (page-grade renderer: global keydown,
 * TickerActions writes, prefetch warms — the P2 disqualification).
 */
export default function WatchlistEmbed({ attrs, height = 320 }) {
  const params = attrs?.params || {}
  const n = Array.isArray(params.rows) ? params.rows.length
    : Array.isArray(params.symbols) ? params.symbols.length : 0
  return (
    <div style={{ height, overflow: 'hidden' }}>
      <FrozenList
        title={params.watchName || 'Watchlist'}
        subtitle={`${n} symbols`}
        asOf={asOfText(attrs?.capturedAt)}
        rows={params.rows}
      />
    </div>
  )
}

function asOfText(capturedAt) {
  if (!capturedAt) return null
  const d = new Date(capturedAt)
  if (Number.isNaN(d.getTime())) return null
  return `as of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}
