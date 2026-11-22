// THE ONE CHART a challenge mounts: the drill player's lockdown recipe (studyMode, the bars in hand, frozen, no live
// updates, no feeds), framed on the last `view` bars, with the library's tap (a touch tap too) handed back as
// {time, index, bar, price}. `chartOpts` is an item-style chart option set (`overlays: false`, `volume: false`,
// studyChartLook) a mode such as Hard uses to strip the chart to candles.
//
// `look` (round 18): 'house' is the owner's house look over the schema defaults, as before; 'widget' is the MEMBER'S OWN
// Charts-tab widget — their resolved widget settings as the base (useChartSurfaceSettings → ownChartSource, the same
// resolution ChartPane renders), the pane's own look props (paneLookProps: bold candles, the vertical legend, the pane
// margins, their canvas theme), the brand mark on, and the legend shown. Owner, batch 18, on the Hard chart: "It should
// look like the users chart widget from the charts tab. Should have our logo." `watermark` is a text to show as the
// widget's own watermark once it may be known (the ticker after the reveal); null keeps it off, since the symbol the
// chart is mounted under is the ITEM id and must never print.
import { useCallback, useMemo } from 'react'
import StockChart from '../../../components/StockChart'
import useSessionChartSettings from '../../../components/chart/pane/useSessionChartSettings'
import useChartSurfaceSettings from '../../../components/chart/pane/useChartSurfaceSettings'
import { paneLookProps } from '../../../components/chart/pane/paneLook'
import useHouseChart from '../useHouseChart'
import usePreferences from '../../../hooks/usePreferences'
import { studySettingsOverride, widgetSettingsOverride } from '../studyChartLook'
import { tapDayKey } from '../chartTapTime'
import { useIsPhone } from '../../../hooks/useBreakpoint'

export default function ChallengeChart({ id, bars, view = null, height = 320, annotations = null, callouts = null, calloutLook = null, markers = null, extra = null, onBarTap = null, chartOpts = null, look = 'widget', watermark = null, fetcher, frameEnd = null }) {
  const widget = look === 'widget'
  const houseSettings = useHouseChart(fetcher)
  // a bare chart (`overlays: false`, Hard mode) must switch off the member's OWN averages too: the chart merges
  // their blob in underneath the override, as instances, so the override reads it (the same cached preferences
  // the chart reads; no request for any other chart)
  const bare = !!chartOpts && chartOpts.overlays === false
  const { prefs } = usePreferences(bare || widget)
  // the member's own widget look: read-only here (the session override below is what the chart persists to)
  const surface = useChartSurfaceSettings()
  const member = bare ? prefs.chart_settings : null
  const own = widget ? surface.ownChartSource : null
  const studyOverride = useMemo(() => (widget
    ? widgetSettingsOverride(chartOpts, own, bare ? { memberSettings: [member, own] } : null)
    : studySettingsOverride(chartOpts, houseSettings, bare ? { memberSettings: member } : {})),
  [widget, chartOpts, own, houseSettings, bare, member])
  const lookProps = useMemo(() => (widget ? paneLookProps({ cs: surface.cs, theme: surface.theme, prefs }) : null), [widget, surface.cs, surface.theme, prefs])
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
  const showWatermark = widget && !!watermark
  return (
    <div style={{ height, cursor: onBarTap ? 'crosshair' : undefined }} data-testid="challenge-chart" data-look={look}>
      <StockChart
        {...(lookProps || {})}
        // A challenge chart keeps no saved pan/zoom on the device. Said outright (after the
        // spread) so the settings census can read it: persistenceManifest.test.js.
        viewLockKey={null}
        sym={id}
        tf="D"
        height={height}
        studyMode
        barsOverride={bars}
        frozen
        hideWatermark={!showWatermark}
        watermark={showWatermark ? watermark : undefined}
        showBrandMark={widget}
        liveUpdates={false}
        backgroundWarm={false}
        disablePatterns
        hideJournalOverlay
        hideCompare
        hideLegend={!widget || phone}
        hideScaleToggle
        showDrawingTools={false}
        hotkeysActive={false}
        dailyDefaultBars={shown}
        // the replay (2026-11-08): the frame ends on its newest day and re-frames as each day arrives, `view` wide
        anchorDate={frameEnd ? String(frameEnd) : null}
        hideAnchorMarker={!!frameEnd}
        rightPadBars={phone ? 3 : 2}   // the owner: "a slight gap at the right ... like 1-2 candles space at max"
        settingsOverride={sessionChart.settingsOverride}
        onSettingsPersist={sessionChart.onSettingsPersist}
        annotations={annotations}
        annotationsVisible={!!annotations}
        annotationsTextVisible={!!annotations}
        markers={markers}
        callouts={callouts && callouts.length ? callouts : null}
        calloutLook={calloutLook}
        onChartTap={onBarTap ? onChartTap : null}
        {...(extra || {})}
      />
    </div>
  )
}
