/**
 * RH-style History section — the user's trades on this symbol: open
 * position entries first, then closed trades newest-first.
 */
import { money, moneySigned, dateShort } from '../../../../lib/journal-2-0'
import styles from './PositionDetailPage.module.css'

export default function HistorySection({ trades, positions }) {
  const open = positions || []
  const closed = [...(trades || [])].sort(
    (a, b) => String(b.exitDate || '').localeCompare(String(a.exitDate || '')),
  )
  if (!open.length && !closed.length) return null
  return (
    <section className={styles.section} aria-label="History">
      <h2 className={styles.sectionTitle}>History</h2>
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
          <li key={t.id} className={styles.histItem}>
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
