// THE FULL UCT CHART WIDGET (owner, round 3: 69/100, "honestly love it"): the same ChartPane every /charts widget,
// popup and journal card mounts — identity row, timeframe bar, toolbar, legend, the member's saved look.
// Three ways to feed it: `cutoff` = the real data path cut off at a date (the chart's own replay cutoff);
// `bars` = explicit bars (the Study bank's stored window, no fetch; tap-to-pick and bar-by-bar replay work because
// the bars are in hand); `barsByTf` = explicit bars per timeframe, so the member can switch 30m / 1h / 1D on the
// widget's own bar with no fetch at all (the bar then shows only the timeframes there is data for).
// PHONE (≤640 px, the review of 2026-11-02): the full chrome collapsed onto the candles at 390 px, so on a phone the
// pane runs chart-only (no identity row, no toolbar, no legend, no range bar, no watermark) with the candles given
// the whole width, and the timeframe switch becomes a row of pills above the chart.
import { Suspense, useCallback, useMemo, useState } from 'react'
import ChartPane from '../components/chart/pane/ChartPane'
import { useIsPhone } from '../hooks/useBreakpoint'
import d5 from './duo.module.css'

const TF_ORDER = ['1', '5', '15', '30', '60', 'D', 'W', 'M']
const TF_LABEL = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', D: '1D', W: '1W', M: '1M' }
const PHONE = { showDrawingTools: false, hideLegend: true, hideWatermark: true, showRangeSelector: false, hideScaleToggle: true, hideCountdown: true }

export default function WidgetChart({
  sym, tf = 'D', cutoff = null, bars = null, barsByTf = null, density = 'full', height = 460, annotations = null,
  hideTicker = false, rightPadBars = 2, frozen = false, markers = null, onBarTap = null, defaultBars = null, extra = null,
  onTfChange = null, phoneHeight = null, exactBars = false,
}) {
  const phone = useIsPhone()
  // the widget's own timeframe bar works (the pane is controlled: it needs a tf setter to switch)
  const [tfState, setTf] = useState(tf)
  const setTfState = useCallback((v) => { setTf(v); onTfChange?.(v) }, [onTfChange])
  const data = barsByTf ? (barsByTf[tfState] || null) : bars
  const tfCodes = useMemo(() => (barsByTf ? TF_ORDER.filter((k) => Array.isArray(barsByTf[k]) && barsByTf[k].length) : null), [barsByTf])
  // taps: the chart's own click (fires on a touch tap too), with the cursor's price; the bar is found by time
  const onChartTap = useCallback(({ time, price }) => {
    if (!onBarTap || time == null) return
    const i = data ? data.findIndex((b) => String(b.t) === String(time)) : -1
    onBarTap({ time, index: i, bar: i >= 0 ? data[i] : null, price })
  }, [onBarTap, data])
  const scp = useMemo(() => ({
    height: '100%',
    ...(data ? { barsOverride: data } : { replayCutoff: cutoff }),
    ...(defaultBars ? { dailyDefaultBars: phone && !exactBars ? Math.min(defaultBars, 45) : defaultBars } : (phone ? { dailyDefaultBars: 45 } : {})),
    hotkeysActive: false,       // the lessons own the keyboard (1-4, Enter, space); the chart's timeframe hotkeys must not fire
    liveUpdates: false,
    backgroundWarm: false,
    hideJournalOverlay: true,
    disablePatterns: true,      // pattern polling is meaningless on a frozen historical frame
    rightPadBars,
    frozen,
    annotations,
    annotationsVisible: !!annotations,
    annotationsTextVisible: !!annotations,
    ...(onBarTap ? { onChartTap } : {}),
    ...(markers ? { markers } : {}),
    ...(hideTicker ? { hideWatermark: true } : {}),
    ...(phone ? PHONE : {}),
    ...(extra || {}),
  }), [data, cutoff, defaultBars, rightPadBars, frozen, annotations, markers, hideTicker, extra, onChartTap, onBarTap, phone, exactBars])
  const h = phone ? (phoneHeight || Math.min(height, 360)) : height
  const effDensity = phone ? 'mini' : density
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {phone && tfCodes && tfCodes.length > 1 ? (
        <div className={d5.tfPills}>{tfCodes.map((k) => <button key={k} type="button" className={`${d5.tfPill} ${tfState === k ? d5.on : ''}`} onClick={() => setTfState(k)}>{TF_LABEL[k] || k}</button>)}</div>
      ) : null}
      <div style={{ height: h, display: 'flex', flexDirection: 'column', cursor: onBarTap ? 'crosshair' : undefined }}>
        <Suspense fallback={<div style={{ height: h, display: 'grid', placeItems: 'center', color: '#9a958a' }}>Loading the chart</div>}>
          <ChartPane sym={sym} tf={tfState} onTfChange={setTfState} tfCodes={tfCodes} density={effDensity} showTfBar={effDensity !== 'mini'} stored={null} stockChartProps={scp} />
        </Suspense>
      </div>
    </div>
  )
}
