// THE FULL UCT CHART WIDGET: the same ChartPane every /charts widget, popup and journal card mounts — its own
// identity row, timeframe bar, toolbar, legend, the member's saved look — on the real data path, cut off at the
// question's date with the chart's own replay cutoff (the journal's before/after cards do exactly this).
import { Suspense, useMemo } from 'react'
import ChartPane from '../components/chart/pane/ChartPane'

export default function WidgetChart({
  sym, cutoff, density = 'full', height = 460, annotations = null, hideTicker = false, rightPadBars = 2,
  frozen = false, markers = null, extra = null,
}) {
  const scp = useMemo(() => ({
    height: '100%',
    replayCutoff: cutoff,
    liveUpdates: false,
    backgroundWarm: false,
    hideJournalOverlay: true,
    disablePatterns: true,      // pattern polling is meaningless on a frozen historical frame
    rightPadBars,
    frozen,
    annotations,
    annotationsVisible: !!annotations,
    annotationsTextVisible: !!annotations,
    ...(markers ? { markers } : {}),
    ...(hideTicker ? { hideWatermark: true } : {}),
    ...(extra || {}),
  }), [cutoff, rightPadBars, frozen, annotations, markers, hideTicker, extra])
  return (
    <div style={{ height, display: 'flex', flexDirection: 'column' }}>
      <Suspense fallback={<div style={{ height, display: 'grid', placeItems: 'center', color: '#9a958a' }}>Loading the chart</div>}>
        <ChartPane sym={sym} tf="D" density={density} showTfBar={density !== 'mini'} stored={null} stockChartProps={scp} />
      </Suspense>
    </div>
  )
}
