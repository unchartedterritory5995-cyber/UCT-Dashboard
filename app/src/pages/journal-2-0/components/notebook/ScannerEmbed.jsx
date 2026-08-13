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
  return (
    <div style={{ height, overflow: 'hidden' }}>
      <FrozenList
        title={params.scanName || params.scanKey || 'Scan'}
        subtitle={`${Array.isArray(params.rows) ? params.rows.length : 0} stocks`}
        asOf={params.asOf ? `as of ${params.asOf}` : null}
        rows={params.rows}
      />
    </div>
  )
}
