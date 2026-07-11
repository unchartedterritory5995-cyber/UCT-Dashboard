/**
 * Today — All-Accounts lead.
 *
 * The concrete-account modules (live hero, goals) can't render across the
 * aggregate view, but the coach overview DOES support the `_all_` scope — so
 * the lead is the aggregate command-center read (regime · today · week-to-date)
 * plus a muted "pick an account" affordance where the hero/goals would sit. Per
 * §22 this is an explicit decision: never a blank.
 *
 * Props:
 *   overview  coach overview payload fetched with the `_all_` scope
 */
import { moneySigned } from '../../../../lib/journal-2-0'
import UIcon from '../../../../components/ui/UIcon'
import styles from '../TodaySurface.module.css'

function StatBlock({ label, value, tone }) {
  return (
    <div className={styles.statBlock}>
      <div className={styles.statLabel}>{label}</div>
      <div className={`${styles.statValue} ${tone || ''}`}>{value}</div>
    </div>
  )
}

function toneOf(n) {
  if (n == null) return ''
  return n > 0 ? styles.pos : n < 0 ? styles.neg : ''
}

export default function TodayAllAccountsLead({ overview }) {
  const today = overview?.today || {}
  const wtd = overview?.week_to_date || {}
  const regime = overview?.regime

  return (
    <section className={styles.card} data-testid="today-all-accounts" aria-label="All accounts overview">
      <div className={styles.postHead}>
        <h2 className={styles.cardTitle}>All accounts</h2>
        {regime && <span className={styles.regimePill}>{regime}</span>}
      </div>

      <div className={styles.statRow}>
        <StatBlock label="Today’s trades" value={today.trade_count ?? 0} />
        <StatBlock
          label="Today’s P&L"
          value={today.net_pnl_dollar == null ? '—' : moneySigned(today.net_pnl_dollar)}
          tone={toneOf(today.net_pnl_dollar)}
        />
        <StatBlock label="Week trades" value={wtd.trade_count ?? 0} />
        <StatBlock
          label="Week P&L"
          value={wtd.net_pnl_dollar == null ? '—' : moneySigned(wtd.net_pnl_dollar)}
          tone={toneOf(wtd.net_pnl_dollar)}
        />
      </div>

      <div className={styles.selectAcctNote}>
        <UIcon name="user" size={15} style={{ verticalAlign: '-2px', marginRight: 7 }} />
        Select a single account to see your live positions and goals.
      </div>
    </section>
  )
}
