// app/src/components/tiles/NHNLModal.jsx
import { useEffect, useMemo } from 'react'
import TickerPopup from '../TickerPopup'
import useLivePrices from '../../hooks/useLivePrices'
import styles from './NHNLModal.module.css'

export default function NHNLModal({ type, tickers, onClose }) {
  // type: 'highs' | 'lows'
  const isHighs = type === 'highs'
  const title   = isHighs ? '52-Week New Highs' : '52-Week New Lows'
  const color   = isHighs ? 'var(--gain)' : 'var(--loss)'

  // Stable ticker list for useLivePrices (modal is only mounted when open)
  const allTickers = useMemo(() => tickers.map(t => t), [tickers])
  const { prices } = useLivePrices(allTickers)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} role="dialog" onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title} style={{ color }}>{title}</span>
          <span className={styles.count} style={{ color }}>
            {tickers.length} stocks
          </span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>
        <div className={styles.grid}>
          {tickers.length === 0
            ? <p className={styles.empty}>No data available</p>
            : tickers.map(sym => {
                const pct = prices[sym]?.change_pct
                const hasPct = pct != null
                return (
                  <TickerPopup key={sym} sym={sym} className={styles.chip}>
                    {sym}
                    {hasPct && (
                      <span
                        className={styles.changePct}
                        style={{ color: pct >= 0 ? 'var(--gain)' : 'var(--loss)' }}
                      >
                        {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                      </span>
                    )}
                  </TickerPopup>
                )
              })
          }
        </div>
      </div>
    </div>
  )
}
