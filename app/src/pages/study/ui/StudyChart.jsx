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
import { useIsPhone } from '../../../hooks/useBreakpoint'
import brandMark from '../../../components/intro/assets/compass-mark.png'
import ws from '../../charts/ChartsWorkspace.module.css'
import { widgetSettingsOverride } from '../studyChartLook'
import s from './study.module.css'

/** The identity badge: masked (a lock and four dots) or the ticker with its company logo, the way the widget shows it. */
export function SymbolBadge({ symbol = null, masked = true }) {
  const [logoOk, setLogoOk] = useState(true)
  const show = !masked && !!symbol
  if (!show) return <span className={`${s.symBadge} ${s.masked}`} data-testid="sym-label" aria-label="ticker hidden"><UIcon name="lock" size={13} gold={false} />••••</span>
  return (
    <span className={`${s.symBadge} ${s.reveal}`} data-testid="sym-label">
      {logoOk ? <img className={s.symLogo} src={`/api/ticker-logo/${encodeURIComponent(symbol)}`} alt="" onError={() => setLogoOk(false)} /> : null}
      {symbol}
    </span>
  )
}

export default function StudyChart({ id, bars, view = null, height = 400, annotations = null, chartOpts = null, symbol = null, masked = true, watermark = null, extra = null }) {
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
    rightPadBars: phone ? 7 : 4,
    settingsOverride: session.settingsOverride,
    onSettingsPersist: session.onSettingsPersist,
    annotations,
    annotationsVisible: !!annotations,
    annotationsTextVisible: !!annotations,
    ...(extra || {}),
  }), [bars, showWatermark, watermark, phone, shown, session.settingsOverride, session.onSettingsPersist, annotations, extra])
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
