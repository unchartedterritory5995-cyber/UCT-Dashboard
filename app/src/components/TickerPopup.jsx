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

const StockChart = lazy(() => import('./StockChart'))
const FundamentalSnapshot = lazy(() => import('./FundamentalSnapshot'))
const AnalystPanel = lazy(() => import('./fundamentals/AnalystPanel'))

const TABS = ['1min', '5min', '15min', '30min', '1hr', 'Daily', 'Weekly', 'Monthly']
const TAB_TO_TF = { '1min': '1', '5min': '5', '15min': '15', '30min': '30', '1hr': '60', 'Daily': 'D', 'Weekly': 'W', 'Monthly': 'M' }
const TF_TO_TAB = Object.fromEntries(Object.entries(TAB_TO_TF).map(([k, v]) => [v, k]))

export default function TickerPopup({ sym, tvSym, as: Tag = 'span', customChartFn, className, children, markers = null, priceLines = null, stopPrice = null }) {
  const [modalOpen, setModalOpen] = useState(false)
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
      if (e.key === 'Escape') { setModalOpen(false); return }
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
      <Tag
        className={`${styles.trigger}${className ? ` ${className}` : ''}`}
        onClick={() => {
          // On touch, a tap opens the universal Ticker Hub sheet; desktop keeps
          // the full chart modal.
          if (isTouch) { openTicker(sym); return }
          setModalOpen(true); setTab('Daily'); setView('chart'); prefetchAllTimeframes(sym)
        }}
        onMouseEnter={() => prefetchBar(sym, 'D')}
        {...tickerActions.longPressProps(sym)}
        role="button"
        aria-label={`View chart for ${sym}`}
        data-testid={`ticker-${sym}`}
      >
        {tagColor && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: TAG_BY_KEY[tagColor]?.hex, marginRight: 3, verticalAlign: 'middle' }} />}
        {children ?? sym}
      </Tag>
      {tickerActions.menu && <TickerActionsMenu menu={tickerActions.menu} onClose={tickerActions.closeMenu} />}

      {modalOpen && (
        <div
          className={styles.overlay}
          onClick={() => setModalOpen(false)}
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
                onClick={() => setModalOpen(false)}
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
              </div>
              {view === 'chart' && (
                <div className={styles.modalTabs}>
                  {TABS.map(t => (
                    <button
                      key={t}
                      className={`${styles.modalTab} ${tab === t ? styles.modalTabActive : ''}`}
                      onClick={() => setTab(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.chartArea}>
              {view === 'chart' ? (
                <Suspense fallback={<div className={styles.chartLoading}>Loading chart…</div>}>
                  <StockChart
                    sym={sym}
                    tf={TAB_TO_TF[tab]}
                    height="min(650px, 70vh)"
                    markers={markers}
                    priceLines={priceLines}
                    onTfChange={tf => setTab(TF_TO_TAB[tf] || tab)}
                    compareSymbol={compareSymbol || null}
                    onCompareChange={setCompareSymbol}
                  />
                </Suspense>
              ) : view === 'analyst' ? (
                <Suspense fallback={<div className={styles.chartLoading}>Loading analyst…</div>}>
                  <AnalystPanel sym={sym} />
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
