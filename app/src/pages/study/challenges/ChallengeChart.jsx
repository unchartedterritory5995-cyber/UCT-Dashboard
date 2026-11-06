// THE ONE CHART a challenge mounts: the drill player's lockdown recipe (studyMode, the bars in hand, frozen, no
// watermark, no live updates, no feeds, the house look), framed on the last `view` bars, with the library's tap
// (a touch tap too) handed back as {time, index, bar, price}. `chartOpts` is an item-style chart option set
// (`overlays: false`, `volume: false`, studyChartLook) a mode such as Hard uses to strip the chart to candles.
import { useCallback, useMemo } from 'react'
import StockChart from '../../../components/StockChart'
import useSessionChartSettings from '../../../components/chart/pane/useSessionChartSettings'
import useHouseChart from '../useHouseChart'
import usePreferences from '../../../hooks/usePreferences'
import { studySettingsOverride } from '../studyChartLook'
import { tapDayKey } from '../chartTapTime'
import { useIsPhone } from '../../../hooks/useBreakpoint'

export default function ChallengeChart({ id, bars, view = null, height = 320, annotations = null, markers = null, extra = null, onBarTap = null, chartOpts = null, fetcher }) {
  const houseSettings = useHouseChart(fetcher)
  // a bare chart (`overlays: false`, Hard mode) must switch off the member's OWN averages too: the chart merges
  // their blob in underneath the override, as instances, so the override reads it (the same cached preferences
  // the chart reads; no request for any other chart)
  const bare = !!chartOpts && chartOpts.overlays === false
  const { prefs } = usePreferences(bare)
  const member = bare ? prefs.chart_settings : null
  const studyOverride = useMemo(() => studySettingsOverride(chartOpts, houseSettings, bare ? { memberSettings: member } : {}), [chartOpts, houseSettings, bare, member])
  const sessionChart = useSessionChartSettings(studyOverride, id || null)
  const phone = useIsPhone()
  const n = bars?.length || 0
  // framed the workbench's way: the last `view` bars with room to the right of the newest candle, so a pointer chip
  // never runs into the price scale (the drill player's exact date range put the last candle against it)
  const shown = Math.max(20, Math.min(n, view || n))
  const onChartTap = useCallback((p) => {
    if (!onBarTap || !p || !bars?.length) return
    const keys = p.time == null ? [] : [p.time, tapDayKey(p.time)].map(String)
    let i = keys.length ? bars.findIndex((b) => keys.includes(String(b.t))) : -1
    // no bar under the cursor (the blank space right of the newest candle, or between bars): the nearest one by position
    if (i < 0 && Number.isFinite(p.logical)) i = Math.max(0, Math.min(bars.length - 1, Math.round(p.logical)))
    if (i < 0) return
    onBarTap({ time: bars[i].t, index: i, bar: bars[i], price: p.price })
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
