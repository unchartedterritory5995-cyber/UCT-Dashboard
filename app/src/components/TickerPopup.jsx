// app/src/components/TickerPopup.jsx
import { useState, useEffect, lazy, Suspense } from 'react'
import useSWR from 'swr'
import useLivePrices from '../hooks/useLivePrices'
import PositionCalc from './PositionCalc'
import styles from './TickerPopup.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const StockChart = lazy(() => import('./StockChart'))

const TABS = ['5min', '30min', '1hr', 'Daily', 'Weekly']
const TAB_TO_TF = { '5min': '5', '30min': '30', '1hr': '60', 'Daily': 'D', 'Weekly': 'W' }

const finvizChart = (sym, period) =>
  `https://finviz.com/chart.ashx?t=${sym}&ty=c&ta=1&p=${period}&s=l`

function EarningsIntelSection({ data }) {
  if (!data) return null
  const { beat_history, consensus, price_target } = data
  const hasBeatHistory = beat_history && beat_history.length > 0
  const hasConsensus = consensus && (consensus.buy || consensus.hold || consensus.sell || consensus.strongBuy || consensus.strongSell)
  const hasTarget = price_target && price_target.targetMean != null
  if (!hasBeatHistory && !hasConsensus && !hasTarget) return null

  const totalBuys = hasConsensus ? (consensus.strongBuy + consensus.buy) : 0
  const totalSells = hasConsensus ? (consensus.strongSell + consensus.sell) : 0

  return (
    <div className={styles.earningsIntel}>
      {hasBeatHistory && (
        <div className={styles.eiBlock}>
          <span className={styles.eiLabel}>Last {beat_history.length}Q</span>
          <span className={styles.eiBeats}>
            {beat_history.map((q, i) => (
              <span key={i} className={q.beat === true ? styles.eiBeat : q.beat === false ? styles.eiMiss : styles.eiNA}>
                {q.beat === true ? '\u2713' : q.beat === false ? '\u2717' : '-'}
              </span>
            ))}
          </span>
        </div>
      )}
      {hasConsensus && (
        <div className={styles.eiBlock}>
          <span className={styles.eiLabel}>Analysts</span>
          <span className={styles.eiConsensus}>
            {totalBuys > 0 && <span className={styles.eiBuyCount}>{totalBuys} Buy</span>}
            {consensus.hold > 0 && <span className={styles.eiHoldCount}>{consensus.hold} Hold</span>}
            {totalSells > 0 && <span className={styles.eiSellCount}>{totalSells} Sell</span>}
          </span>
        </div>
      )}
      {hasTarget && (
        <div className={styles.eiBlock}>
          <span className={styles.eiLabel}>Target</span>
          <span className={styles.eiTarget}>
            ${price_target.targetMean.toFixed(2)}
            <span className={styles.eiTargetRange}>
              (${price_target.targetLow?.toFixed(2)} – ${price_target.targetHigh?.toFixed(2)})
            </span>
          </span>
        </div>
      )}
    </div>
  )
}

function InsiderSection({ txns }) {
  if (!txns || txns.length === 0) return null
  const recent = txns.slice(0, 5)
  return (
    <div className={styles.insiderSection}>
      <div className={styles.insiderHeader}>INSIDER ACTIVITY</div>
      <div className={styles.insiderList}>
        {recent.map((t, i) => (
          <div key={i} className={styles.insiderRow}>
            <span className={styles.insiderName}>{t.name}</span>
            <span className={styles.insiderTitle}>{t.title}</span>
            <span className={`${styles.insiderBadge} ${t.type === 'buy' ? styles.insiderBuy : styles.insiderSell}`}>
              {t.type === 'buy' ? 'BUY' : 'SELL'}
            </span>
            <span className={styles.insiderShares}>{t.shares?.toLocaleString()} sh</span>
            <span className={styles.insiderAmt}>${t.amount >= 1_000_000 ? `${(t.amount / 1_000_000).toFixed(1)}M` : t.amount >= 1_000 ? `${(t.amount / 1_000).toFixed(0)}K` : t.amount.toLocaleString()}</span>
            <span className={styles.insiderDate}>{t.date}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TickerPopup({ sym, tvSym, showFinviz = true, as: Tag = 'span', customChartFn, className, children, markers = null, priceLines = null, stopPrice = null }) {
  const [hovered, setHovered] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  const [tab, setTab] = useState('Daily')

  // Fetch live price only when modal is open
  const { prices } = useLivePrices(modalOpen && sym ? [sym] : [])

  // Fetch insider transactions when modal is open
  const { data: insiderTxns } = useSWR(
    modalOpen && sym ? `/api/insider/${sym}` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  // Fetch earnings intelligence when modal is open
  const { data: earningsIntel } = useSWR(
    modalOpen && sym ? `/api/earnings/intel/${sym}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  )
  const liveData = prices[sym]

  // Disable hover preview on touch devices (gets stuck on mobile)
  const isTouchDevice = typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)

  useEffect(() => {
    if (!modalOpen) return
    const handleKey = (e) => { if (e.key === 'Escape') setModalOpen(false) }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [modalOpen])

  return (
    <>
      <Tag
        className={`${styles.trigger}${className ? ` ${className}` : ''}`}
        onMouseEnter={() => !isTouchDevice && showFinviz && setHovered(true)}
        onMouseLeave={() => !isTouchDevice && setHovered(false)}
        onClick={() => { setHovered(false); setModalOpen(true); setTab('Daily') }}
        role="button"
        aria-label={`View chart for ${sym}`}
        data-testid={`ticker-${sym}`}
      >
        {children ?? sym}
        {showFinviz && hovered && !isTouchDevice && (
          <div className={styles.popup}>
            <img
              src={finvizChart(sym, 'd')}
              alt={`${sym} preview`}
              className={styles.popupChart}
            />
          </div>
        )}
      </Tag>

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
              <span className={styles.modalSym}>{sym}</span>
              {liveData && (
                <>
                  <span className={styles.modalPrice}>${liveData.price?.toFixed(2)}</span>
                  <span className={`${styles.modalChange} ${liveData.change_pct >= 0 ? styles.modalChangeUp : styles.modalChangeDown}`}>
                    {liveData.change_pct >= 0 ? '+' : ''}{liveData.change_pct?.toFixed(2)}%
                  </span>
                </>
              )}
              <button
                className={styles.closeBtn}
                onClick={() => setModalOpen(false)}
                aria-label="Close chart"
              >
                × close
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
                />
              </Suspense>
            </div>

            <PositionCalc currentPrice={liveData?.price} stopPrice={stopPrice} />

            <EarningsIntelSection data={earningsIntel} />
            <InsiderSection txns={insiderTxns} />

            <div className={styles.modalFooter}>
              {showFinviz && (
                <a
                  href={`https://finviz.com/quote.ashx?t=${sym}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.footerLink}
                >
                  Open in FinViz →
                </a>
              )}
              <a
                href={`https://www.tradingview.com/chart/?symbol=${tvSym ?? sym}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.footerLink}
              >
                Open in TradingView →
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
