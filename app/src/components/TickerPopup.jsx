// app/src/components/TickerPopup.jsx
import { useState, useEffect, lazy, Suspense } from 'react'
import useRealtimePrices from '../hooks/useRealtimePrices'
import { useFlagged } from '../hooks/useFlagged'
import useTickerTags from '../hooks/useTickerTags'
import { TAG_BY_KEY } from '../constants/tagColors'
import TickerActionsMenu, { useTickerActions } from './TickerActions'
import { prefetchAllTimeframes } from '../utils/prefetchBars'
import styles from './TickerPopup.module.css'

const StockChart = lazy(() => import('./StockChart'))

const TABS = ['1min', '5min', '15min', '30min', '1hr', 'Daily', 'Weekly', 'Monthly']
const TAB_TO_TF = { '1min': '1', '5min': '5', '15min': '15', '30min': '30', '1hr': '60', 'Daily': 'D', 'Weekly': 'W', 'Monthly': 'M' }
const TF_TO_TAB = Object.fromEntries(Object.entries(TAB_TO_TF).map(([k, v]) => [v, k]))

export default function TickerPopup({ sym, tvSym, as: Tag = 'span', customChartFn, className, children, markers = null, priceLines = null, stopPrice = null }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [tab, setTab] = useState('Daily')
  const [flagToast, setFlagToast] = useState(null)
  const [compareSymbol, setCompareSymbol] = useState('')

  const { isFlagged, toggle: toggleFlag } = useFlagged()
  const { getTag } = useTickerTags()
  const tagColor = getTag(sym)
  const tickerActions = useTickerActions()

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

  return (
    <>
      <Tag
        className={`${styles.trigger}${className ? ` ${className}` : ''}`}
        onClick={() => { setModalOpen(true); setTab('Daily'); prefetchAllTimeframes(sym) }}
        onMouseEnter={() => prefetchAllTimeframes(sym)}
        onContextMenu={e => tickerActions.openMenu(e, sym)}
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
                  {flagToast === 'added' ? '⚑ Flagged' : '⚑ Removed'}
                </span>
              )}
              <button
                className={`${styles.flagBtn}${isFlagged(sym) ? ' ' + styles.flagBtnActive : ''}`}
                onClick={() => { const willFlag = !isFlagged(sym); toggleFlag(sym); setFlagToast(willFlag ? 'added' : 'removed') }}
                title={isFlagged(sym) ? 'Remove from Flagged (Shift+F)' : 'Add to Flagged (Shift+F)'}
                aria-label={isFlagged(sym) ? 'Remove from flagged list' : 'Add to flagged list'}
              >
                {'⚑'} {isFlagged(sym) ? 'Flagged' : 'Flag'}
              </button>
              <button
                className={styles.closeBtn}
                onClick={() => setModalOpen(false)}
                aria-label="Close chart"
              >
                {'×'} close
              </button>
            </div>

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

            <div className={styles.chartArea}>
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
            </div>

          </div>
        </div>
      )}
    </>
  )
}
