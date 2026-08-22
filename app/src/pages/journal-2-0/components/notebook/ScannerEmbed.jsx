import FrozenList from './FrozenList'

/**
 * Scanner journal renderer: the captured RESULT LIST (owner-approved payload
 * freeze) — ranked symbols with price/±% as they stood at capture. NOT the
 * live Watchlists-page table the widget renders through (page-grade
 * renderer: global keydown, TickerActions writes, prefetch warms — the same
 * renderer-disqualification the P2 audit gave periodsort).
 */
export default function ScannerEmbed({ attrs, height = 320 }) {
  const params = attrs?.params || {}
  // The backend ET stamp when the capture carried one; otherwise the capture
  // date — a frozen list must always say WHEN it was true (panel batch 3:
  // scanner/watchlist/themes are excluded from the frame's as-of chip because
  // this line is their stamp).
  let asOf = params.asOf ? `as of ${params.asOf}` : null
  if (!asOf && attrs?.capturedAt) {
    const d = new Date(attrs.capturedAt)
    if (!Number.isNaN(d.getTime())) {
      asOf = `as of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    }
  }
  return (
    <div style={{ height, overflow: 'hidden' }}>
      <FrozenList
        title={params.scanName || params.scanKey || 'Scan'}
        subtitle={`${Array.isArray(params.rows) ? params.rows.length : 0} stocks`}
        asOf={asOf}
        rows={params.rows}
      />
    </div>
  )
}
