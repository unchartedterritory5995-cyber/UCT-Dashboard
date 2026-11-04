// THE ONE CHART a challenge mounts: the drill player's lockdown recipe (studyMode, the bars in hand, frozen, no
// watermark, no live updates, no feeds, the house look), framed on the last `view` bars, with the library's tap
// (a touch tap too) handed back as {time, index, bar, price}.
import { useCallback, useMemo } from 'react'
import StockChart from '../../../components/StockChart'
import useSessionChartSettings from '../../../components/chart/pane/useSessionChartSettings'
import useHouseChart from '../useHouseChart'
import { studySettingsOverride } from '../studyChartLook'
import { tapDayKey } from '../chartTapTime'
import { useIsPhone } from '../../../hooks/useBreakpoint'

export default function ChallengeChart({ id, bars, view = null, height = 320, annotations = null, markers = null, extra = null, onBarTap = null, fetcher }) {
  const houseSettings = useHouseChart(fetcher)
  const studyOverride = useMemo(() => studySettingsOverride(null, houseSettings, {}), [houseSettings])
  const sessionChart = useSessionChartSettings(studyOverride, id || null)
  const phone = useIsPhone()
  const n = bars?.length || 0
  // framed the workbench's way: the last `view` bars with room to the right of the newest candle, so a pointer chip
  // never runs into the price scale (the drill player's exact date range put the last candle against it)
  const shown = Math.max(20, Math.min(n, view || n))
  const onChartTap = useCallback((p) => {
    if (!onBarTap || !p || p.time == null) return
    const keys = [p.time, tapDayKey(p.time)].map(String)
    const i = bars ? bars.findIndex((b) => keys.includes(String(b.t))) : -1
    onBarTap({ time: i >= 0 ? bars[i].t : tapDayKey(p.time), index: i, bar: i >= 0 ? bars[i] : null, price: p.price })
  }, [onBarTap, bars])
  if (!n) return null
  return (
    <div style={{ height, cursor: onBarTap ? 'crosshair' : undefined }} data-testid="challenge-chart">
      <StockChart
        sym={id}
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
        hotkeysActive={false}
        dailyDefaultBars={shown}
        rightPadBars={phone ? 7 : 4}
        settingsOverride={sessionChart.settingsOverride}
        onSettingsPersist={sessionChart.onSettingsPersist}
        annotations={annotations}
        annotationsVisible={!!annotations}
        annotationsTextVisible={!!annotations}
        markers={markers}
        onChartTap={onBarTap ? onChartTap : null}
        {...(extra || {})}
      />
    </div>
  )
}
