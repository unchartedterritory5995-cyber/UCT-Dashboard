// THE FULL UCT CHART WIDGET (owner, round 3: 69/100, "honestly love it"): the same ChartPane every /charts widget,
// popup and journal card mounts — identity row, timeframe bar, toolbar, legend, the member's saved look.
// Two ways to feed it: `cutoff` = the real data path cut off at a date (the chart's own replay cutoff, as the
// journal's before/after cards do); `bars` = explicit bars (the Study bank's stored window, no fetch), which also
// makes tap-to-pick and bar-by-bar replay possible because the bars are in hand.
import { Suspense, useCallback, useMemo, useRef, useState } from 'react'
import ChartPane from '../components/chart/pane/ChartPane'

export default function WidgetChart({
  sym, tf = 'D', cutoff = null, bars = null, density = 'full', height = 460, annotations = null, hideTicker = false,
  rightPadBars = 2, frozen = false, markers = null, onBarTap = null, defaultBars = null, extra = null,
}) {
  // the widget's own timeframe bar works (the pane is controlled: it needs a tf setter to switch)
  const [tfState, setTfState] = useState(tf)
  const last = useRef(null)
  const onCrosshairMove = useCallback((c) => { if (c && c.time != null) last.current = { time: c.time, price: c.cursorPrice ?? c.price } }, [])
  const onClick = useCallback(() => {
    if (!onBarTap || !last.current) return
    const i = bars ? bars.findIndex((b) => String(b.t) === String(last.current.time)) : -1
    onBarTap({ time: last.current.time, index: i, bar: i >= 0 ? bars[i] : null })
  }, [onBarTap, bars])
  const scp = useMemo(() => ({
    height: '100%',
    ...(bars ? { barsOverride: bars } : { replayCutoff: cutoff }),
    ...(defaultBars ? { dailyDefaultBars: defaultBars } : {}),
    liveUpdates: false,
    backgroundWarm: false,
    hideJournalOverlay: true,
    disablePatterns: true,      // pattern polling is meaningless on a frozen historical frame
    rightPadBars,
    frozen,
    annotations,
    annotationsVisible: !!annotations,
    annotationsTextVisible: !!annotations,
    onCrosshairMove,
    ...(markers ? { markers } : {}),
    ...(hideTicker ? { hideWatermark: true } : {}),
    ...(extra || {}),
  }), [bars, cutoff, defaultBars, rightPadBars, frozen, annotations, markers, hideTicker, extra, onCrosshairMove])
  return (
    <div onClick={onClick} style={{ height, display: 'flex', flexDirection: 'column', cursor: onBarTap ? 'crosshair' : undefined }}>
      <Suspense fallback={<div style={{ height, display: 'grid', placeItems: 'center', color: '#9a958a' }}>Loading the chart</div>}>
        <ChartPane sym={sym} tf={tfState} onTfChange={setTfState} density={density} showTfBar={density !== 'mini'} stored={null} stockChartProps={scp} />
      </Suspense>
    </div>
  )
}
