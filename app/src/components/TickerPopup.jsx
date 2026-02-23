// app/src/components/TickerPopup.jsx
import { useState, useEffect } from 'react'
import styles from './TickerPopup.module.css'

const TABS = ['5min', '30min', '1hr', 'Daily', 'Weekly']
const TV_ALL_INTERVALS = { '5min': '5', '30min': '30', '1hr': '60', 'Daily': 'D', 'Weekly': 'W' }
const FV_PERIODS       = { 'Daily': 'd', 'Weekly': 'w' }

const finvizChart = (sym, period) =>
  `https://finviz.com/chart.ashx?t=${sym}&ty=c&ta=1&p=${period}&s=l`

const tvUrl = (sym, interval) =>
  `https://www.tradingview.com/widgetembed/?symbol=${sym}&interval=${interval}&theme=dark&style=1&locale=en&hide_top_toolbar=0&hideideas=1`

export default function TickerPopup({ sym, tvSym, showFinviz = true, as: Tag = 'span', customChartFn, className, children }) {
  const [hovered, setHovered] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [tab, setTab] = useState('Daily')

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
        onMouseEnter={() => showFinviz && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => { setModalOpen(true); setTab('Daily') }}
        role="button"
        aria-label={`View chart for ${sym}`}
        data-testid={`ticker-${sym}`}
      >
        {children ?? sym}
        {showFinviz && hovered && (
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
              {customChartFn ? (
                <img
                  src={customChartFn(tab)}
                  alt={`${sym} ${tab} chart`}
                  className={styles.modalChart}
                />
              ) : showFinviz && FV_PERIODS[tab] ? (
                <img
                  src={finvizChart(sym, FV_PERIODS[tab])}
                  alt={`${sym} ${tab} chart`}
                  className={styles.modalChart}
                />
              ) : (
                <iframe
                  src={tvUrl(tvSym ?? sym, TV_ALL_INTERVALS[tab])}
                  title={`${sym} ${tab}`}
                  className={styles.tvFrame}
                />
              )}
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
