/**
 * Today — zero-data (fresh account) experience.
 *
 * The new-user funnel's front door. Three ways to get a brand-new journal from
 * empty to populated: connect a broker (→ the Accounts home, where
 * BrokerConnectionsCard lives), import a CSV (reuses ImportCsvModal), or log the
 * first trade by hand (reuses AddTradeModal). The live hero + goals are
 * intentionally suppressed here — there is nothing yet to show.
 *
 * ── P0 First-Insight evolution (flag `firstInsight`, default ON) ─────────────
 * The funnel now aims at a generated insight, not an empty dashboard. The three
 * paths become PROMINENT cards under one headline ("Let's find your edge — 5
 * minutes."), the Import CSV path names the competitor presets explicitly
 * (TradeZella / Tradervue / TraderSync / any broker CSV), and the Compass line
 * promises importers an instant first edge report. When the flag is OFF, the
 * ORIGINAL guided checklist renders unchanged (the legacy render path is kept
 * for the instant per-browser kill-switch).
 *
 * Modal state lives in the parent surface; this component only fires the
 * `onImport` / `onLogTrade` callbacks. No emoji — UIcon glyphs only.
 */
import { NavLink } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import { useFeatureFlag } from '../../featureFlags'
import styles from '../TodaySurface.module.css'

export default function TodayZeroData({ onImport, onLogTrade }) {
  const firstInsightOn = useFeatureFlag('firstInsight')

  // Flag OFF → the original guided checklist, unchanged.
  if (!firstInsightOn) {
    return <LegacyChecklist onImport={onImport} onLogTrade={onLogTrade} />
  }

  // Flag ON → the First-Insight funnel: three prominent path cards.
  return (
    <section className={styles.card} data-testid="today-zero-data" aria-label="Get started">
      <h2 className={styles.cardTitle}>Let’s find your edge — 5 minutes.</h2>
      <p className={styles.cardLead}>
        The fastest way to see what’s working is to get your trades in. Pick
        whichever path fits — your first edge report is waiting on the other side.
      </p>

      <div className={styles.pathGrid}>
        <div className={styles.pathCard}>
          <span className={styles.pathIcon}><UIcon name="link" size={22} /></span>
          <div className={styles.pathHead}>Connect your broker</div>
          <div className={styles.pathSub}>
            Auto-import every trade, position, and balance — no manual entry.
          </div>
          <NavLink to="/journal/accounts" className={styles.pathBtn}>
            Connect broker
          </NavLink>
        </div>

        <div className={styles.pathCard}>
          <span className={styles.pathIcon}><UIcon name="download" size={22} /></span>
          <div className={styles.pathHead}>Import a CSV</div>
          <div className={styles.pathSub}>
            Import from TradeZella, Tradervue, TraderSync, or any broker CSV —
            presets built in.
          </div>
          <button type="button" className={styles.pathBtn} onClick={onImport}>
            Import CSV
          </button>
        </div>

        <div className={styles.pathCard}>
          <span className={styles.pathIcon}><UIcon name="edit" size={22} /></span>
          <div className={styles.pathHead}>Log your first trade</div>
          <div className={styles.pathSub}>
            Enter one by hand to see the journal come alive.
          </div>
          <button type="button" className={styles.pathBtnPrimary} onClick={onLogTrade}>
            Log a trade
          </button>
        </div>
      </div>

      <p className={styles.compassIntro}>
        <UIcon name="compass" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        Importers arrive with hundreds of historical trades — your first edge
        report is instant. Compass reads your trades and talks you through the
        setups, mistakes, and discipline as you go.
      </p>
    </section>
  )
}

// ── Legacy guided checklist (flag OFF — kept verbatim for the kill-switch) ────

function LegacyChecklist({ onImport, onLogTrade }) {
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
