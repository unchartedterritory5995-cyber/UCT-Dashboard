import { useState } from 'react'
import styles from './TickerPopup.module.css'

const FINVIZ_CHART = sym => `https://finviz.com/chart.ashx?t=${sym}&ty=c&ta=1&p=d&s=l`

export default function TickerPopup({ sym, children }) {
  const [hovered, setHovered] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <span
        className={styles.trigger}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setModalOpen(true)}
        role="button"
        aria-label={`View chart for ${sym}`}
        data-testid={`ticker-${sym}`}
      >
        {children ?? sym}
        {hovered && (
          <div className={styles.popup}>
            <img
              src={FINVIZ_CHART(sym)}
              alt={`${sym} chart`}
              className={styles.popupChart}
            />
          </div>
        )}
      </span>

      {modalOpen && (
        <div
          className={styles.overlay}
          onClick={() => setModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`${sym} chart`}
          data-testid="chart-modal"
        >
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalSym}>{sym}</span>
              <button
                className={styles.closeBtn}
                onClick={() => setModalOpen(false)}
                aria-label="Close chart"
              >
                ×
              </button>
            </div>
            <img
              src={FINVIZ_CHART(sym)}
              alt={`${sym} full chart`}
              className={styles.modalChart}
            />
            <a
              href={`https://finviz.com/quote.ashx?t=${sym}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.finvizLink}
            >
              View on Finviz ↗
            </a>
          </div>
        </div>
      )}
    </>
  )
}
