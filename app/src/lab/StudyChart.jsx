// The firm's own chart component, in the Study dress: stored bars, the house look (owner's saved chart settings over
// the schema defaults), frozen, no ticker chrome. Pieces pass markers / annotations / highlighted bars on top.
import { useMemo, useRef, useCallback } from 'react'
import StockChart from '../components/StockChart'
import useHouseChart from '../pages/study/useHouseChart'
import { studySettingsOverride } from '../pages/study/studyChartLook'

export default function StudyChart({
  bars, height = 360, markers = null, annotations = null, highlightBarTime = null, highlightColor = '#e6b800',
  highlightBodyOnly = false, onBarTap = null, chartOpts = null, exitDate: exitProp = null,
}) {
  const house = useHouseChart()
  const settingsOverride = useMemo(() => studySettingsOverride(chartOpts, house), [chartOpts, house])
  const entryDate = bars?.[0]?.t ?? null
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
        entryDate={entryDate}
        exitDate={exitDate}
        exactDateRange
        settingsOverride={settingsOverride}
        annotations={annotations}
        annotationsVisible={!!annotations}
        markers={markers}
        highlightBarTime={highlightBarTime}
        highlightColor={highlightColor}
        highlightBodyOnly={highlightBodyOnly}
        onCrosshairMove={onCrosshairMove}
      />
    </div>
  )
}
