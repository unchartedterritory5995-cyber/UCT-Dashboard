/**
 * Today — manual (no broker sync) market-session lead.
 *
 * A synced account gets the live BrokerAccountHero; a manual account can't, so
 * this is the honest fallback: today's realized P&L (from the coach overview,
 * which already computes it), the open-positions list (reused HoldingsList),
 * and a "log today's trades" quick-entry so the day stays current. No fabricated
 * live equity curve — manual books don't have a broker net-liq to draw.
 *
 * Props:
 *   overview   the coach overview payload (today.net_pnl_dollar / trade_count)
 *   positions  open share positions (for the list)
 *   prices     live price map (for the list)
 *   onLogTrade / onLogPosition  open the add flows (owned by the surface)
 */
import { moneySigned } from '../../../../lib/journal-2-0'
import HoldingsList from '../../components/HoldingsList'
import UIcon from '../../../../components/ui/UIcon'
import styles from '../TodaySurface.module.css'

export default function TodayNoSync({
  overview, positions = [], prices = {}, onLogTrade, onLogPosition,
}) {
  const today = overview?.today || {}
  const pnl = today.net_pnl_dollar
  const tone = pnl == null ? '' : pnl > 0 ? styles.pos : pnl < 0 ? styles.neg : ''
  const hasPositions = positions.length > 0

  return (
    <section className={styles.card} data-testid="today-no-sync" aria-label="Today (manual account)">
      <header className={styles.manualHead}>
        <div>
          <div className={styles.cardEyebrow}>Today’s realized P&amp;L</div>
          <div className={`${styles.bigNumber} ${tone}`}>
            {pnl == null ? '—' : moneySigned(pnl)}
          </div>
          <div className={styles.cardSub}>
            {today.trade_count ? `${today.trade_count} trade${today.trade_count === 1 ? '' : 's'} logged today` : 'No trades logged yet today'}
          </div>
        </div>
        <div className={styles.manualActions}>
          <button type="button" className={styles.checkBtnPrimary} onClick={onLogTrade}>
            <UIcon name="plus" size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />
            Log a trade
          </button>
          <button type="button" className={styles.checkBtn} onClick={onLogPosition}>
            Log a position
          </button>
        </div>
      </header>

      {hasPositions ? (
        <HoldingsList positions={positions} prices={prices} />
      ) : (
        <p className={styles.cardSub}>
          No open positions. Log today’s trades above and they’ll show here.
        </p>
      )}
    </section>
  )
}
