// app/src/components/TickerPopup.jsx
import { useState, useEffect, lazy, Suspense } from 'react'
import useRealtimePrices from '../hooks/useRealtimePrices'
import UIcon from './ui/UIcon'
import { setVoicePageHint } from '../context/VoiceContext'
import { useFlagged } from '../hooks/useFlagged'
import useTickerTags from '../hooks/useTickerTags'
import { TAG_BY_KEY } from '../constants/tagColors'
import TickerActionsMenu, { useTickerActions } from './TickerActions'
import { useTickerHub } from './mobile/TickerHubContext'
import { useIsTouch } from '../hooks/useBreakpoint'
import { prefetchAllTimeframes, prefetchBar } from '../utils/prefetchBars'
import styles from './TickerPopup.module.css'

// The SAME chart the /charts workspace renders — identity row, session toggle,
// market clock, timeframe bar, market-cap/earnings/UCT-rating meta, settings
// gear and drawing tools. Lazy, so none of it lands in the eager entry chunk.
const ChartPane = lazy(() => import('./chart/pane/ChartPane'))
const FundamentalSnapshot = lazy(() => import('./FundamentalSnapshot'))
const AnalystPanel = lazy(() => import('./fundamentals/AnalystPanel'))
const OwnershipPanel = lazy(() => import('./fundamentals/OwnershipPanel'))

// `tab` is still this component's state (the voice page hint reads it, and it
// seeds ChartPane's timeframe), but the visible button row is ChartPane's now.
const TAB_TO_TF = { '1min': '1', '5min': '5', '15min': '15', '30min': '30', '1hr': '60', 'Daily': 'D', 'Weekly': 'W', 'Monthly': 'M' }
const TF_TO_TAB = Object.fromEntries(Object.entries(TAB_TO_TF).map(([k, v]) => [v, k]))

export default function TickerPopup({ sym, tvSym, as: Tag = 'span', customChartFn, className, children, markers = null, priceLines = null, stopPrice = null, open: openProp, onClose }) {
  // Controlled mode (open/onClose provided): no trigger element renders and the
  // parent owns open state — used for delegated $TICKER-chip clicks in The Floor,
  // where chips are sanitized static HTML, not React children. Uncontrolled mode
  // (every existing call site) is byte-identical in behavior.
  const [modalOpenState, setModalOpen] = useState(false)
  const controlled = openProp !== undefined
  const modalOpen = controlled ? openProp : modalOpenState
  const closeModal = () => { if (controlled) onClose?.(); else setModalOpen(false) }
  const [tab, setTab] = useState('Daily')
  const [view, setView] = useState('chart') // 'chart' | 'fundamentals'
  const [flagToast, setFlagToast] = useState(null)
  const [compareSymbol, setCompareSymbol] = useState('')

  const { isFlagged, toggle: toggleFlag } = useFlagged()
  const { getTag } = useTickerTags()
  const tagColor = getTag(sym)
  const tickerActions = useTickerActions()
  const { openTicker } = useTickerHub()
  const isTouch = useIsTouch()

  // Fetch live price only when modal is open
  const { prices } = useRealtimePrices(modalOpen && sym ? [sym] : [])
  const liveData = prices[sym]

  // Clear flag toast after 1.5s
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1500)
    return () => clearTimeout(t)
  }, [flagToast])

  useEffect(() => {
    if (!modalOpen) return
    const handleKey = (e) => {
      if (e.key === 'Escape') { closeModal(); return }
      if (e.shiftKey && e.key === 'F') {
        const willFlag = !isFlagged(sym)
        toggleFlag(sym)
        setFlagToast(willFlag ? 'added' : 'removed')
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [modalOpen, sym, isFlagged, toggleFlag])

  // P4-F unification: while this ticker modal is open, tell Compass the
  // user is looking at this symbol. So if they open the orb from inside
  // the modal, Compass starts the session knowing the ticker context.
  useEffect(() => {
    if (!modalOpen || !sym) return
    const tabHint = tab && tab !== 'Daily' ? `, ${tab}` : ''
    setVoicePageHint(`chart of ${sym}${tabHint}`)
    return () => setVoicePageHint(null)
  }, [modalOpen, sym, tab])

  return (
    <>
      {!controlled && (
      <Tag
        className={`${styles.trigger}${className ? ` ${className}` : ''}`}
        onClick={() => {
          // On touch, a tap opens the universal Ticker Hub sheet; desktop keeps
          // the full chart modal.
          if (isTouch) { openTicker(sym); return }
          setModalOpen(true); setTab('Daily'); setView('chart'); prefetchAllTimeframes(sym)
        }}
        onMouseEnter={() => {
          prefetchBar(sym, 'D')
          // Warm the ChartPane CHUNK too, not just the bars. The pane pulls the
          // symbol search, day gain, market clock and settings modal with it, so
          // on a cold first open the module fetch — not the data — is what holds
          // the "Loading chart…" fallback up. Hovering a ticker is the earliest
          // reliable signal that a popup is coming.
          import('./chart/pane/ChartPane')
        }}
        {...tickerActions.longPressProps(sym)}
        role="button"
        aria-label={`View chart for ${sym}`}
        data-testid={`ticker-${sym}`}
      >
        {tagColor && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: TAG_BY_KEY[tagColor]?.hex, marginRight: 3, verticalAlign: 'middle' }} />}
        {children ?? sym}
      </Tag>
      )}
      {tickerActions.menu && <TickerActionsMenu menu={tickerActions.menu} onClose={tickerActions.closeMenu} />}

      {modalOpen && (
        <div
          className={styles.overlay}
          onClick={closeModal}
          data-testid="chart-modal"
        >
          <div
            className={styles.modal}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`${sym} chart`}
          >
            <div className={styles.modalHeader}>
              {tagColor && <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: TAG_BY_KEY[tagColor]?.hex, marginRight: 5 }} />}
              <span className={styles.modalSym}>{sym}</span>
              {liveData && (
                <>
                  <span className={styles.modalPrice}>${liveData.price?.toFixed(2)}</span>
                  <span className={`${styles.modalChange} ${liveData.change_pct >= 0 ? styles.modalChangeUp : styles.modalChangeDown}`}>
                    {liveData.change_pct >= 0 ? '+' : ''}{liveData.change_pct?.toFixed(2)}%
                  </span>
                </>
              )}
              {flagToast && (
                <span className={`${styles.flagToast} ${flagToast === 'added' ? styles.flagToastAdded : styles.flagToastRemoved}`}>
                  <UIcon name="flag" size={12} style={{ verticalAlign: '-1px', marginRight: 3 }} />{flagToast === 'added' ? 'Flagged' : 'Removed'}
                </span>
              )}
              <button
                className={`${styles.flagBtn}${isFlagged(sym) ? ' ' + styles.flagBtnActive : ''}`}
                onClick={() => { const willFlag = !isFlagged(sym); toggleFlag(sym); setFlagToast(willFlag ? 'added' : 'removed') }}
                title={isFlagged(sym) ? 'Remove from Flagged (Shift+F)' : 'Add to Flagged (Shift+F)'}
                aria-label={isFlagged(sym) ? 'Remove from flagged list' : 'Add to flagged list'}
              >
                <UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />{isFlagged(sym) ? 'Flagged' : 'Flag'}
              </button>
              <button
                className={styles.closeBtn}
                onClick={closeModal}
                aria-label="Close chart"
              >
                {'×'} close
              </button>
            </div>

            <div className={styles.modalModeRow}>
              <div className={styles.modalModeToggle} role="tablist" aria-label="View mode">
                <button
                  className={`${styles.modalModeBtn} ${view === 'chart' ? styles.modalModeBtnActive : ''}`}
                  onClick={() => setView('chart')}
                  role="tab"
                  aria-selected={view === 'chart'}
                >
                  Chart
                </button>
                <button
                  className={`${styles.modalModeBtn} ${view === 'fundamentals' ? styles.modalModeBtnActive : ''}`}
                  onClick={() => setView('fundamentals')}
                  role="tab"
                  aria-selected={view === 'fundamentals'}
                >
                  Fundamentals
                </button>
                <button
                  className={`${styles.modalModeBtn} ${view === 'analyst' ? styles.modalModeBtnActive : ''}`}
                  onClick={() => setView('analyst')}
                  role="tab"
                  aria-selected={view === 'analyst'}
                >
                  Analyst
                </button>
                <button
                  className={`${styles.modalModeBtn} ${view === 'ownership' ? styles.modalModeBtnActive : ''}`}
                  onClick={() => setView('ownership')}
                  role="tab"
                  aria-selected={view === 'ownership'}
                >
                  Ownership
                </button>
              </div>
              {/* The timeframe row used to live here. ChartPane owns it now — it
                  renders the same bar /charts does, honouring the user's own
                  favourites, so a second row here would duplicate it. */}
            </div>

            <div className={styles.chartArea}>
              {view === 'chart' ? (
                <Suspense fallback={<div className={styles.chartLoading}>Loading chart…</div>}>
                  {/* `stored={null}` with no `onStore` = THE user's own chart:
                      ChartPane reads and writes the global chart_settings blob, so
                      this popup renders whatever they configured on /charts.
                      `onSymbolChange` is deliberately omitted — a TickerPopup shows
                      the ticker its caller opened, so the identity row is a static
                      label rather than a search box. */}
                  <ChartPane
                    sym={sym}
                    tf={TAB_TO_TF[tab]}
                    onTfChange={next => setTab(TF_TO_TAB[next] || tab)}
                    stored={null}
                    stockChartProps={{
                      height: 'min(650px, 70vh)',
                      markers,
                      priceLines,
                      compareSymbol: compareSymbol || null,
                      onCompareChange: setCompareSymbol,
                    }}
                  />
                </Suspense>
              ) : view === 'analyst' ? (
                <Suspense fallback={<div className={styles.chartLoading}>Loading analyst…</div>}>
                  <AnalystPanel sym={sym} />
                </Suspense>
              ) : view === 'ownership' ? (
                <Suspense fallback={<div className={styles.chartLoading}>Loading ownership…</div>}>
                  <OwnershipPanel sym={sym} />
                </Suspense>
              ) : (
                <Suspense fallback={<div className={styles.chartLoading}>Loading fundamentals…</div>}>
                  <FundamentalSnapshot sym={sym} enabled={view === 'fundamentals'} />
                </Suspense>
              )}
            </div>

          </div>
        </div>
      )}
    </>
  )
}
