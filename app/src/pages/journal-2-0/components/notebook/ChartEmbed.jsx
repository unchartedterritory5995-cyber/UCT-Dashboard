import { useMemo } from 'react'
import ChartPane from '../../../../components/chart/pane/ChartPane'

// A ts param (epoch seconds or 'YYYY-MM-DD') → the calendar day StockChart's
// anchorDate speaks. Day precision is deliberate for v1: anchored+reveal
// framing ends the first frame at this day's bar and keeps later bars loaded
// off-screen — exactly snapshot semantics, riding the contract-tested
// anchorDate rail (StockChart.anchor.test.jsx) instead of racing raw
// setVisibleRange writes against the first-load layout pass.
function tsToAnchorDay(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v > 10_000_000_000 ? v : v * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  return null
}

const noopStore = () => {}

/**
 * The chart's journal-embed renderer: ChartPane with FROZEN params.
 *
 * - Symbol is LOCKED (no onSymbolChange) and the TF bar is omitted entirely
 *   (showTfBar={false}) — scroll/zoom inside the embed never writes anything;
 *   param changes arrive only through explicit embed-toolbar actions.
 * - `stored` is the fully-merged settings blob frozen at capture; onStore is
 *   a NO-OP so StockChart's internal writes are swallowed rather than landing
 *   on the reader's global chart_settings (the read-only invariant).
 * - liveUpdates only in mode:'live' (badged, capped); snapshots never
 *   subscribe to anything.
 */
export default function ChartEmbed({ attrs, height = 320 }) {
  const params = attrs?.params || {}
  const anchorDate = tsToAnchorDay(params.to)
  const stockChartProps = useMemo(() => ({
    height: '100%',
    liveUpdates: attrs?.mode === 'live',
    showDrawingTools: false,
    ...(anchorDate ? { anchorDate } : {}),
  }), [attrs?.mode, anchorDate])

  return (
    <div style={{ height }}>
      <ChartPane
        sym={params.symbol}
        tf={params.tf || 'D'}
        density="mini"
        showTfBar={false}
        stored={params.settings || null}
        onStore={noopStore}
        stockChartProps={stockChartProps}
      />
    </div>
  )
}
