// app/src/components/tiles/NHNLModal.jsx
import { useEffect } from 'react'
import TickerPopup from '../TickerPopup'
import styles from './NHNLModal.module.css'

export default function NHNLModal({ type, tickers, onClose }) {
  // type: 'highs' | 'lows'
  const isHighs = type === 'highs'
  const title   = isHighs ? '52-Week New Highs' : '52-Week New Lows'
  const color   = isHighs ? 'var(--gain)' : 'var(--loss)'

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
            : tickers.map(sym => (
                <TickerPopup key={sym} ticker={sym} className={styles.chip} />
              ))
          }
        </div>
      </div>
    </div>
  )
}
