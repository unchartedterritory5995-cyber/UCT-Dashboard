/**
 * The coach strip's rows (P4a, ruling P4a-T9-R2).
 *
 * ONE place draws a row, because two surfaces show them: the coach strip (CoachStrip.jsx) and the lock notice
 * Today shows on its own when the member has hidden the coach strip (DisciplineLockStrip.jsx). The lock rows
 * themselves are built in coachLock.js.
 *
 * No emoji: every glyph is a gold <UIcon/>.
 */
import UIcon from '../../../components/ui/UIcon'
import styles from './CoachStrip.module.css'

/** The rows themselves. `onOpen(to, onOpenCallback)` is called by a row's open button. */
export default function CoachRows({ items, onOpen }) {
  return items.map((it) => (
    <div
      key={it.key}
      className={`${styles.row} ${styles[it.sev] || ''}`}
      data-testid="coach-row"
      data-kind={it.kind}
      role="status"
    >
      <span className={styles.icon} aria-hidden="true"><UIcon name={it.icon} size={15} /></span>
      <div className={styles.body}>
        {it.label && <div className={styles.label}>{it.label}</div>}
        <div className={styles.msg}>{it.message}</div>
      </div>
      {it.to && (
        <button
          type="button"
          className={styles.openBtn}
          onClick={() => onOpen(it.to, it.onOpen)}
        >
          {it.openLabel}
          <UIcon name="chevronRight" size={13} style={{ verticalAlign: '-2px', marginLeft: 3 }} />
        </button>
      )}
      {it.action && (
        <button
          type="button"
          className={styles.actionBtn}
          onClick={it.action.onClick}
          aria-label={it.action.ariaLabel}
        >
          {it.action.label}
        </button>
      )}
    </div>
  ))
}
