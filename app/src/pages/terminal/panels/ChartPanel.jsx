// GP — the shared StockChart, embedded AS-IS (the chart engine is not touched). Daily, with
// the drawing toolbar and replay off: a panel is a read, the full workspace is /charts.
import StockChart from '../../../components/StockChart'

export default function ChartPanel({ sym }) {
  return (
    <div style={{ height: '100%', minHeight: 320 }} data-testid="terminal-chart-panel">
      <StockChart sym={sym} tf="D" height="100%" showDrawingTools={false} hideReplay liveUpdates />
    </div>
  )
}
