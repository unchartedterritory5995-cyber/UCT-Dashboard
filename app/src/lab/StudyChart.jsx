// The firm's own chart component in the Study dress. By default it draws with the MEMBER'S OWN saved chart
// settings (prefs.chart_settings, exactly as /charts does); `houseLook` switches to the owner's house look
// with the Study gates instead. Stored bars, frozen, no ticker chrome. Pieces pass markers / annotations /
// highlighted bars on top.
import { useMemo, useRef, useCallback } from 'react'
import StockChart from '../components/StockChart'
import useHouseChart from '../pages/study/useHouseChart'
import { studySettingsOverride } from '../pages/study/studyChartLook'
import useSessionChartSettings from '../components/chart/pane/useSessionChartSettings'

export default function StudyChart({
  bars, height = 360, markers = null, annotations = null, highlightBarTime = null, highlightColor = '#e6b800',
  highlightBodyOnly = false, onBarTap = null, chartOpts = null, exitDate: exitProp = null, houseLook = false,
  rightPadBars = 2, frame = 'exact', defaultBars = 126,
}) {
  // frame='exact' pins the view to [first bar, last bar] (a still exhibit). frame='default' lets the chart keep
  // its own default zoom of `defaultBars` candles, so bars appended one at a time scroll in from the right
  // without the frame re-zooming (replay).
  const house = useHouseChart()
  const override = useMemo(() => (houseLook ? studySettingsOverride(chartOpts, house) : null), [houseLook, chartOpts, house])
  const entryDate = bars?.[0]?.t ?? null
  // ⛔ policy A (settingsScope.rail.test.js rule 1): an override needs a sink, or an edit made on this exhibit
  // (a right-click toggle, an indicator hidden) is written into the member's GLOBAL chart_settings. The same
  // session-scoped sink the product's study charts use (pages/study/ui/StudyChart.jsx): the edit stays on THIS
  // mounted chart until the exhibit changes, and nothing is persisted. Without `houseLook` the base is null and
  // the member's own settings still draw the chart; edits made here simply stay here too.
  const session = useSessionChartSettings(override, `${houseLook ? 'house' : 'own'}:${entryDate}`)
  const exitDate = exitProp || (bars?.length ? bars[bars.length - 1].t : null)
  const last = useRef(null)
  const onCrosshairMove = useCallback((c) => { if (c && c.time != null) last.current = { time: c.time, price: c.cursorPrice } }, [])
  const onClick = useCallback(() => {
    if (!onBarTap || !last.current) return
    const i = bars.findIndex((b) => String(b.t) === String(last.current.time))
    onBarTap({ time: last.current.time, index: i, bar: i >= 0 ? bars[i] : null })
  }, [onBarTap, bars])
  if (!bars || !bars.length) return <div style={{ height, display: 'grid', placeItems: 'center', color: '#9a958a' }}>Loading the chart</div>
  return (
    <div onClick={onClick} style={{ height, cursor: onBarTap ? 'crosshair' : 'default' }}>
      <StockChart
        sym="study"
        tf="D"
        height={height}
        studyMode
        barsOverride={bars}
        frozen
        hideWatermark
        showBrandMark={false}
        liveUpdates={false}
        backgroundWarm={false}
        disablePatterns
        hideJournalOverlay
        hideCompare
        hideLegend
        showDrawingTools={false}
        {...(frame === 'exact' ? { entryDate, exitDate, exactDateRange: true } : { dailyDefaultBars: defaultBars })}
        rightPadBars={rightPadBars}
        settingsOverride={session.settingsOverride}
        onSettingsPersist={session.onSettingsPersist}
        annotations={annotations}
        annotationsVisible={!!annotations}
        annotationsTextVisible={!!annotations}
        markers={markers}
        highlightBarTime={highlightBarTime}
        highlightColor={highlightColor}
        highlightBodyOnly={highlightBodyOnly}
        onCrosshairMove={onCrosshairMove}
      />
    </div>
  )
}
