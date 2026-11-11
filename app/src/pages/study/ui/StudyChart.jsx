// THE CHART IS THE WIDGET (round 19; owner, batch 19: "idk why we are recreating charts instead of just importing our
// widget"). This mounts the Charts tab's own ChartPane — its identity row, its settings resolution (the member's own
// widget look, useChartSurfaceSettings), its look props, its brand mark — around the bank's bars. What Study adds is
// only what a bank chart needs: `identityLabel` (the pane shows an exhibit, not a ticker: a masked badge until the
// reveal, then the ticker with its logo; nothing is looked up on the item id, Shift+F flags nothing), no timeframe bar
// (owner: "unless i can change timeframe just remove those"), and the drill's lockdown through `stockChartProps`
// (studyMode, the bars in hand, frozen, no feeds). The settings override composes the member's widget blob with the
// study gates (studyChartLook.widgetSettingsOverride) and persists only for the session.
import { useMemo, useState } from 'react'
import ChartPane from '../../../components/chart/pane/ChartPane'
import useChartSurfaceSettings from '../../../components/chart/pane/useChartSurfaceSettings'
import useSessionChartSettings from '../../../components/chart/pane/useSessionChartSettings'
import UIcon from '../../../components/ui/UIcon'
import usePreferences from '../../../hooks/usePreferences'
import useTickerMeta from '../../../hooks/useTickerMeta'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import brandMark from '../../../components/intro/assets/compass-mark.png'
import ws from '../../charts/ChartsWorkspace.module.css'
import { widgetSettingsOverride } from '../studyChartLook'
import s from './study.module.css'

/** The identity badge: masked (a lock and four dots) or, after the answer, the ticker and the company's name, the way the
 *  widget shows a symbol (round 21; owner, batch 21: the reveal with a stray logo and a watermark across the candles Cut).
 *  The logo shows only once it has actually loaded, so a missing or odd one never reads as a broken badge. */
export function SymbolBadge({ symbol = null, masked = true }) {
  const show = !masked && !!symbol
  const [logo, setLogo] = useState('wait')          // wait | ok | none
  const meta = useTickerMeta(show ? symbol : null)
  if (!show) return <span className={`${s.symBadge} ${s.masked}`} data-testid="sym-label" aria-label="ticker hidden"><UIcon name="lock" size={13} gold={false} />••••</span>
  return (
    <span className={`${s.symBadge} ${s.reveal}`} data-testid="sym-label">
      {logo !== 'none' ? <img className={`${s.symLogo} ${logo === 'ok' ? s.symLogoOn : ''}`} src={`/api/ticker-logo/${encodeURIComponent(symbol)}`} alt="" onLoad={() => setLogo('ok')} onError={() => setLogo('none')} /> : null}
      <b className={s.symTicker}>{symbol}</b>
      {meta?.name ? <span className={s.symCo}>{meta.name}</span> : null}
    </span>
  )
}

export default function StudyChart({ id, bars, view = null, height = 400, annotations = null, callouts = null, calloutLook = null, chartOpts = null, symbol = null, masked = true, watermark = null, extra = null, frameEnd = null, markers = null }) {
  const { prefs } = usePreferences(true)
  const surface = useChartSurfaceSettings()        // read-only here: the session override below is what the chart persists to
  const own = surface.ownChartSource
  const bare = !!chartOpts && chartOpts.overlays === false
  const override = useMemo(() => widgetSettingsOverride(chartOpts, own, bare ? { memberSettings: [prefs.chart_settings, own] } : null), [chartOpts, own, bare, prefs.chart_settings])
  const session = useSessionChartSettings(override, id || null)
  const phone = useIsPhone()
  const n = bars?.length || 0
  const shown = Math.max(20, Math.min(n, view || n))
  const showWatermark = !masked && !!watermark
  const stockChartProps = useMemo(() => ({
    studyMode: true,
    barsOverride: bars,
    frozen: true,
    hideWatermark: !showWatermark,
    watermark: showWatermark ? watermark : undefined,
    liveUpdates: false,
    backgroundWarm: false,
    disablePatterns: true,
    hideJournalOverlay: true,
    hideCompare: true,
    hideLegend: phone,
    hideScaleToggle: true,
    showRangeSelector: false,
    showDrawingTools: false,
    hotkeysActive: false,
    dailyDefaultBars: shown,
    // the replay (2026-11-08): the frame ends on its newest day and re-frames as each day arrives, `view` wide, so it
    // starts close and widens with the run (the owner: "the replay starts way too far back")
    ...(frameEnd ? { anchorDate: String(frameEnd), hideAnchorMarker: true } : {}),
    rightPadBars: phone ? 3 : 2,          // the owner, batch 2: "a slight gap at the right ... like 1-2 candles space at max"
    settingsOverride: session.settingsOverride,
    onSettingsPersist: session.onSettingsPersist,
    annotations,
    markers,   // the trade's action items (challenges/tradeMarks.tradeMarkers): the chart's own bar markers
    annotationsVisible: !!annotations,
    annotationsTextVisible: !!annotations,
    // round 21: the pointer is the chart's own callout layer (open space, never over a candle; ui/callout.js)
    callouts: callouts && callouts.length ? callouts : null,
    calloutLook,
    ...(extra || {}),
  }), [bars, showWatermark, watermark, phone, shown, frameEnd, markers, session.settingsOverride, session.onSettingsPersist, annotations, callouts, calloutLook, extra])
  if (!n) return null
  return (
    <div className={`${ws.widget} ${s.frame}`} style={{ height }} data-charts-theme={prefs?.charts_theme || 'default'} data-testid="study-chart" data-masked={showWatermark || (!masked && symbol) ? '0' : '1'}>
      <div className={s.paneFill}>
        <ChartPane
          sym={id}
          tf="D"
          onSymbolChange={null}
          density="compact"
          showTfBar={false}
          identityLabel={<SymbolBadge symbol={symbol} masked={masked} />}
          stockChartProps={stockChartProps}
          slots={{ headerRight: <span className={s.frameBrand} aria-label="UCT Intelligence"><img src={brandMark} alt="" /><span>UCT Intelligence</span></span> }}
        />
      </div>
    </div>
  )
}
