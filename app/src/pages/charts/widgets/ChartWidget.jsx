import { useCallback, useEffect, useRef, useState } from 'react'
import StockChart from '../../../components/StockChart'
import SymbolSearch from '../../../components/chart/SymbolSearch'
import ShareToFloor from '../../../components/community/ShareToFloor'
import { useWorkspace } from '../WorkspaceContext'
import styles from '../ChartsWorkspace.module.css'

const TFS = [
  ['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'],
  ['60', '1h'], ['D', '1D'], ['W', '1W'], ['M', '1M'],
]

// Letter or digit, no modifier combos. Period allowed for class-share tickers (BRK.B).
const TICKER_KEY_RE = /^[A-Za-z0-9.]$/

export default function ChartWidget({ color, opts, onOptsChange }) {
  const { groupSyms, setGroupSym, crosshairBus } = useWorkspace()
  const sym = groupSyms[color] || 'SPY'

  // ── Crosshair sync within the color group ──
  // Stable per-widget id so we ignore our own broadcasts. Charts sharing a
  // color group mirror each other's crosshair (same symbol; exact when the
  // timeframes match, nearest-time when they differ).
  const widgetIdRef = useRef(null)
  if (!widgetIdRef.current) widgetIdRef.current = `w${Math.random().toString(36).slice(2, 9)}`
  const [externalCrosshair, setExternalCrosshair] = useState(null)

  const reportCrosshair = useCallback((payload) => {
    crosshairBus?.emit(color, widgetIdRef.current, payload)
  }, [crosshairBus, color])

  useEffect(() => {
    if (!crosshairBus) return undefined
    return crosshairBus.subscribe(({ color: c, sourceId, payload }) => {
      if (c === color && sourceId !== widgetIdRef.current) setExternalCrosshair(payload)
    })
  }, [crosshairBus, color])
  // Drop any stale external crosshair when this widget's own symbol changes.
  useEffect(() => { setExternalCrosshair(null) }, [sym])
  const tf = opts?.tf || 'D'
  const setTf = useCallback((nextTf) => {
    if (nextTf === tf) return
    onOptsChange?.({ ...(opts || {}), tf: nextTf })
  }, [opts, tf, onOptsChange])

  const searchRef = useRef(null)
  const focusableRef = useRef(null)

  // Single ticker-change handler — every path (search dropdown pick, typed
  // submit, StockChart's own onSymbolChange) routes through this. After the
  // sym updates we refocus the chart container so the user can immediately
  // start typing again for the next ticker without re-clicking the chart.
  const handleSymbolChange = useCallback((s) => {
    if (!s) return
    setGroupSym(color, s)
    requestAnimationFrame(() => {
      focusableRef.current?.focus({ preventScroll: true })
    })
  }, [color, setGroupSym])

  const handleChartClick = useCallback(() => {
    // Don't steal focus from a child input (e.g., the open search dropdown).
    const ae = document.activeElement
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return
    focusableRef.current?.focus({ preventScroll: true })
  }, [])

  const handleChartKeyDown = useCallback((e) => {
    // Bail if the event is bubbling up from an input (search box, etc.).
    const tgt = e.target
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (!TICKER_KEY_RE.test(e.key)) return
    e.preventDefault()
    searchRef.current?.openWith(e.key)
  }, [])

  return (
    <div className={styles.chartWidget}>
      <div className={styles.tfBar}>
        <div className={styles.symbolSlot}>
          <SymbolSearch ref={searchRef} sym={sym} onSymbolChange={handleSymbolChange} />
        </div>
        <span className={styles.tfBarDivider} aria-hidden="true" />
        {TFS.map(([code, label]) => (
          <button
            key={code}
            type="button"
            className={`${styles.tfBtn} ${tf === code ? styles.tfBtnActive : ''}`}
            onClick={() => setTf(code)}
          >{label}</button>
        ))}
        <span style={{ marginLeft: 'auto' }}>
          <ShareToFloor card={{ kind: 'chart', ticker: sym, tf }} compact />
        </span>
      </div>
      <div
        ref={focusableRef}
        className={styles.chartFill}
        tabIndex={0}
        onClick={handleChartClick}
        onKeyDown={handleChartKeyDown}
      >
        <StockChart
          sym={sym}
          tf={tf}
          onSymbolChange={handleSymbolChange}
          onTfChange={setTf}
          onCrosshairMove={reportCrosshair}
          externalCrosshair={externalCrosshair}
          /* Charts-workspace default look = the Model Book "Throughout the
             Years" main chart, 1:1. boldCandles brings the crisp bold vivid
             palette (MB_UP/MB_DOWN solid bodies + deep #0e0f0d canvas), thin
             0.5px curved MAs, and vivid volume bars; volumeMa + markVolumeExtremes
             add the MB volume MA line + gold highest-volume bar. Plus a ~6-month
             daily window, its own compact volume pane, and tight price-scale
             margins so candles fill ~85% of the pane. Scoped here so popups /
             Model Book / Journal charts are unaffected. */
          boldCandles
          ema9MatchCandle
          markVolumeExtremes
          volumeMa={50}
          hidePriceLine
          watermarkOpacity={0.82}
          /* Nudge left of 0.5: the watermark centers on the full pane width, which
             includes the right price-axis gutter, so a true 0.5 reads right-of-center
             over the candles. 0.47 visually centers it on the plot area. */
          watermarkX={0.47}
          dailyDefaultBars={126}
          volumeSeparatePane
          volumePaneHeightPct={16}
          priceScaleTopMargin={0.12}
          priceScaleBottomMargin={0.10}
        />
      </div>
    </div>
  )
}
