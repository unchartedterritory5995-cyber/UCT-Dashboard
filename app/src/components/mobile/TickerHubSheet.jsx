import { useNavigate } from 'react-router-dom'
import Sheet from './Sheet'
import { useTickerHub } from './TickerHubContext'
import { useFlagged } from '../../hooks/useFlagged'
import useLivePrices from '../../hooks/useLivePrices'
import styles from './TickerHubSheet.module.css'

// Outer gate: only mount the body (and its data hooks) when a ticker is open,
// so live-price polling / flag state don't run app-wide while the hub is closed.
export default function TickerHubSheet() {
  const { sym, closeTicker } = useTickerHub()
  if (!sym) return null
  return <TickerHubBody sym={sym} onClose={closeTicker} />
}

function TickerHubBody({ sym, onClose }) {
  const navigate = useNavigate()
  const { isFlagged, toggle } = useFlagged()
  const { prices } = useLivePrices([sym])

  const live = prices[sym] || prices[String(sym).toUpperCase()]
  const flagged = isFlagged(sym)

  const openChart = () => {
    try { localStorage.setItem('charts_mobile_sym', sym) } catch { /* noop */ }
    onClose()
    navigate('/charts')
  }

  return (
    <Sheet open onClose={onClose} variant="bottom-sheet" title={sym}>
      <div className={styles.body}>
        {live?.price != null && (
          <div className={styles.quote}>
            <span className={styles.price}>${live.price.toFixed(2)}</span>
            {live.change_pct != null && (
              <span className={live.change_pct >= 0 ? styles.up : styles.down}>
                {live.change_pct >= 0 ? '+' : ''}{live.change_pct.toFixed(2)}%
              </span>
            )}
          </div>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={openChart}>
            <span className={styles.aicon} aria-hidden="true">📈</span>Chart
          </button>
          <button
            type="button"
            className={`${styles.action} ${flagged ? styles.on : ''}`}
            onClick={() => toggle(sym)}
          >
            <span className={styles.aicon} aria-hidden="true">⚑</span>Flag
          </button>
        </div>
        <p className={styles.note}>More — alerts, journal, Compass — coming to this hub next.</p>
      </div>
    </Sheet>
  )
}
