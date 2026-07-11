/**
 * Today — zero-data (fresh account) experience.
 *
 * A guided checklist that gets a brand-new journal from empty to populated:
 * connect a broker (→ the Accounts home, where BrokerConnectionsCard lives),
 * import a CSV (reuses ImportCsvModal), or log the first trade by hand (reuses
 * AddTradeModal). Plus a one-line Compass intro so the coach is discoverable
 * from day one. The live hero + goals are intentionally suppressed here — there
 * is nothing yet to show.
 *
 * Modal state lives in the parent surface; this component only fires the
 * `onImport` / `onLogTrade` callbacks. No emoji — UIcon glyphs only.
 */
import { NavLink } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import styles from '../TodaySurface.module.css'

export default function TodayZeroData({ onImport, onLogTrade }) {
  return (
    <section className={styles.card} data-testid="today-zero-data" aria-label="Get started">
      <h2 className={styles.cardTitle}>Let’s set up your journal</h2>
      <p className={styles.cardLead}>
        Three ways to get your trades in — pick whichever fits. Your live
        positions, day P&amp;L, and end-of-day recap all light up once there’s
        data here.
      </p>

      <ul className={styles.checklist}>
        <li className={styles.checkRow}>
          <span className={styles.checkIcon}><UIcon name="link" size={18} /></span>
          <div className={styles.checkBody}>
            <div className={styles.checkHead}>Connect a broker</div>
            <div className={styles.checkSub}>
              Auto-import every trade, position, and balance — no manual entry.
            </div>
          </div>
          <NavLink to="/journal/accounts" className={styles.checkBtn}>
            Connect
          </NavLink>
        </li>

        <li className={styles.checkRow}>
          <span className={styles.checkIcon}><UIcon name="download" size={18} /></span>
          <div className={styles.checkBody}>
            <div className={styles.checkHead}>Import a CSV</div>
            <div className={styles.checkSub}>
              Bring your history from TradeZella, Tradervue, TraderSync, or a
              broker export.
            </div>
          </div>
          <button type="button" className={styles.checkBtn} onClick={onImport}>
            Import CSV
          </button>
        </li>

        <li className={styles.checkRow}>
          <span className={styles.checkIcon}><UIcon name="edit" size={18} /></span>
          <div className={styles.checkBody}>
            <div className={styles.checkHead}>Log your first trade</div>
            <div className={styles.checkSub}>
              Enter one by hand to see the journal come alive.
            </div>
          </div>
          <button type="button" className={styles.checkBtnPrimary} onClick={onLogTrade}>
            Log a trade
          </button>
        </li>
      </ul>

      <p className={styles.compassIntro}>
        <UIcon name="compass" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        Compass is your AI coach — it reads your trades and talks you through the
        setups, mistakes, and discipline as you go.
      </p>
    </section>
  )
}
