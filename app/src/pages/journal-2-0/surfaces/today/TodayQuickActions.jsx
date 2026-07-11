/**
 * Today — quick actions row (P4 B3).
 *
 * SHORTCUTS to existing flows, not new homes (§63):
 *   - "Log trade"     → opens the add flow (the parent surface owns the modal;
 *                        `onLogTrade` mirrors the "+ Log Trade" header path).
 *   - "Open Journal"  → `/journal/journal` (Calendar / Notebook surface).
 *   - "Review a trade"→ `/journal/trades?seg=closed` (closed-trades segment).
 *
 * No emoji — every glyph is a `UIcon`. Phone stacks to a single column via CSS
 * `@media (max-width:640px)`.
 */
import { useNavigate } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import styles from './TodayQuickActions.module.css'

export default function TodayQuickActions({ onLogTrade }) {
  const navigate = useNavigate()

  return (
    <section className={styles.actions} aria-label="Quick actions">
      <button
        type="button"
        data-testid="qa-log-trade"
        className={styles.action}
        onClick={onLogTrade}
      >
        <UIcon name="plus" size={15} aria-hidden="true" />
        <span>Log trade</span>
      </button>

      <button
        type="button"
        data-testid="qa-open-journal"
        className={styles.action}
        onClick={() => navigate('/journal/journal')}
      >
        <UIcon name="journal" size={15} aria-hidden="true" />
        <span>Open Journal</span>
      </button>

      <button
        type="button"
        data-testid="qa-review-trade"
        className={styles.action}
        onClick={() => navigate('/journal/trades?seg=closed')}
      >
        <UIcon name="search" size={15} aria-hidden="true" />
        <span>Review a trade</span>
      </button>
    </section>
  )
}
