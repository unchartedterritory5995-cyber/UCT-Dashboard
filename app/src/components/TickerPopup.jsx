// app/src/components/TickerPopup.jsx
import { useState, useEffect, lazy, Suspense } from 'react'
import styles from './TickerPopup.module.css'

const StockChart = lazy(() => import('./StockChart'))

const TABS = ['5min', '30min', '1hr', 'Daily', 'Weekly']
const TAB_TO_TF = { '5min': '5', '30min': '30', '1hr': '60', 'Daily': 'D', 'Weekly': 'W' }

const finvizChart = (sym, period) =>
  `https://finviz.com/chart.ashx?t=${sym}&ty=c&ta=1&p=${period}&s=l`

export default function TickerPopup({ sym, tvSym, showFinviz = true, as: Tag = 'span', customChartFn, className, children, markers = null, priceLines = null }) {
  const [hovered, setHovered] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  const [tab, setTab] = useState('Daily')

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
                  height="min(400px, 50vh)"
                  markers={markers}
                  priceLines={priceLines}
                />
              </Suspense>
            </div>

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
