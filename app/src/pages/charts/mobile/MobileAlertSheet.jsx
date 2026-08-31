import { useState } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import haptics from '../../../components/mobile/haptics'
import useWatchlistAlerts from '../../../hooks/useWatchlistAlerts'
import useRealtimePrices from '../../../hooks/useRealtimePrices'
import styles from './MobileCharts.module.css'

/* Price alert from the chart — the TradingView-mobile staple. A big decimal
 * input seeded from the live price, and two commit buttons that ARE the
 * direction ("Alert above" / "Alert below"), so there is no separate picker
 * step. Rides the same createAlert the desktop chart's right-click uses, so
 * delivery (bell + email + Discord + sound) is identical.
 *
 * State lives in AlertBody, which the Sheet unmounts on close — every open
 * re-seeds from the CURRENT live price with no reset effects.
 */
export default function MobileAlertSheet({ open, onClose, sym, className = '' }) {
  return (
    <Sheet open={open} onClose={onClose} variant="bottom-sheet" title={`Alert — ${sym}`} ariaLabel="Set price alert" className={className}>
      <AlertBody sym={sym} onClose={onClose} />
    </Sheet>
  )
}

function AlertBody({ sym, onClose }) {
  const { createAlert, deleteAlert, getAlertsForSym } = useWatchlistAlerts()
  const { prices } = useRealtimePrices([sym])
  // The symbol's live alerts, so state is visible and nobody stacks blind
  // duplicates. deleteAlert mutates every alerts cache — the list refreshes
  // through the same SWR key this read comes from.
  const active = getAlertsForSym(sym)
  const live = prices?.[sym]?.price
  const [value, setValue] = useState(() => (Number.isFinite(live) ? String(live >= 1 ? live.toFixed(2) : live.toFixed(4)) : ''))
  const [status, setStatus] = useState(null)   // null | 'done' | 'error'

  const price = Number.parseFloat(value)
  const valid = Number.isFinite(price) && price > 0

  const fire = async (direction) => {
    if (!valid) return
    try {
      await createAlert(sym, price, direction)
      haptics.success()
      setStatus('done')
      setTimeout(onClose, 900)
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className={styles.alertBody}>
      {Number.isFinite(live) && (
        <div className={styles.alertLive}>
          Last price <span className={styles.alertLivePx}>{live >= 1 ? live.toFixed(2) : live.toFixed(4)}</span>
        </div>
      )}
      <input
        className={styles.alertInput}
        value={value}
        onChange={(e) => { setValue(e.target.value.replace(/[^0-9.]/g, '')); setStatus(null) }}
        inputMode="decimal"
        aria-label="Alert price"
        placeholder={Number.isFinite(live) ? undefined : 'Price'}
        autoComplete="off"
      />
      <div className={styles.alertActions}>
        <button
          type="button"
          className={`${styles.alertBtn} ${styles.alertBtnUp}`}
          disabled={!valid || status === 'done'}
          onClick={() => fire('above')}
        >
          Alert above
        </button>
        <button
          type="button"
          className={`${styles.alertBtn} ${styles.alertBtnDown}`}
          disabled={!valid || status === 'done'}
          onClick={() => fire('below')}
        >
          Alert below
        </button>
      </div>
      {status === 'done' && <div className={styles.alertOk}>Alert set — you’ll get a ping when it hits.</div>}
      {status === 'error' && <div className={styles.alertErr}>Couldn’t save the alert — try again.</div>}

      {active.length > 0 && (
        <div className={styles.alertList}>
          <div className={styles.sectionLabel}>Active alerts on {sym}</div>
          {active.map((a) => (
            <div key={a.id} className={styles.alertRow}>
              <span className={`${styles.alertDir} ${a.direction === 'above' ? styles.chgUp : styles.chgDown}`}>
                {a.direction === 'above' ? '▲' : '▼'}
              </span>
              <span className={styles.alertRowPx}>
                {Number(a.target_price) >= 1 ? Number(a.target_price).toFixed(2) : Number(a.target_price).toFixed(4)}
              </span>
              <span className={styles.alertRowKind}>{a.direction === 'above' ? 'crosses above' : 'crosses below'}</span>
              <button
                type="button"
                className={styles.alertDel}
                aria-label={`Delete ${a.direction} alert at ${a.target_price}`}
                onClick={() => { haptics.tap(); deleteAlert(a.id) }}
              >
                <UIcon name="trash" size={15} gold={false} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
