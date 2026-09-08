/**
 * RH-style History section — every trade for THIS SYMBOL IN THIS ACCOUNT
 * (open position entries first, then closed trades newest-first), NOT
 * "the trades that opened/closed this exact position." Seam 11 Phase A
 * (2026-09-06) found there is no deterministic exact-position-lineage link
 * for broker-synced or CSV-imported trades — j2_trades.position_id is a
 * structurally random, inert sentinel for both (see trades.py::
 * bulk_insert_trades) — and confirmed SnapTrade itself supplies no
 * position/lot-level identifier to recover one from. Account+security
 * history IS fully deterministic today (symbol + the caller's already
 * account-scoped trades/positions lists, never position_id), which is why
 * this section already worked correctly for every source; the caption
 * below exists so what it shows is never misread as more than that —
 * e.g. after a broker position fully closes and later reopens, this list
 * shows BOTH lifecycles' trades together, not just the current one's.
 */
import { money, moneySigned, dateShort } from '../../../../lib/journal-2-0'
import styles from './PositionDetailPage.module.css'

export default function HistorySection({ trades, positions, onRowAction }) {
  const open = positions || []
  const closed = [...(trades || [])].sort(
    (a, b) => String(b.exitDate || '').localeCompare(String(a.exitDate || '')),
  )
  if (!open.length && !closed.length) return null
  return (
    <section className={styles.section} aria-label="History">
      <h2 className={styles.sectionTitle}>History</h2>
      <p className={styles.sectionCaption}>
        Trade history for this security in this account — not limited to this specific position.
      </p>
      <ul className={styles.histList}>
        {open.map((p) => (
          <li key={`open-${p.side}-${p.id}`} className={styles.histItem}>
            <div>
              <div className={styles.histTitle}>
                Opened {p.side === 'Short' ? 'short' : 'long'} · {p.shares} @ {money(p.entryPrice)}
              </div>
              <div className={styles.histMeta}>{dateShort(p.entryDate)}</div>
            </div>
            <span className={styles.histOpenChip}>OPEN</span>
          </li>
        ))}
        {closed.map((t) => (
          <li
            key={t.id}
            className={`${styles.histItem} ${onRowAction ? styles.histItemClickable : ''}`}
            role={onRowAction ? 'button' : undefined}
            tabIndex={onRowAction ? 0 : undefined}
            onClick={onRowAction ? () => onRowAction('open', t) : undefined}
            onKeyDown={onRowAction ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowAction('open', t) }
            } : undefined}
          >
            <div>
              <div className={styles.histTitle}>
                {t.side === 'Short' ? 'Short' : 'Long'} · {t.shares} @ {money(t.entryPrice)} → {money(t.exitPrice)}
              </div>
              <div className={styles.histMeta}>
                {dateShort(t.entryDate)} – {dateShort(t.exitDate)}
                {t.setup ? ` · ${t.setup}` : ''}
              </div>
            </div>
            <span className={
              t.pnlDollar > 0 ? styles.pos : t.pnlDollar < 0 ? styles.neg : ''
            }>
              {moneySigned(t.pnlDollar)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
