// UCT Terminal — ONE look for "there is nothing to show here, and here is why".
//
// Empty, error, not-switched-on, needs-input and paused states inside a terminal panel all use
// this block, so a member reads the same shape whatever panel they are in: a monochrome icon,
// one sentence saying what is missing, an optional hint, and at most one action.
//
//   import { PanelState } from '../../components/terminal'
//   <PanelState kind="error" title="Couldn't load the news just now." action={<button …>Retry</button>} />
//
// kinds: 'empty' · 'error' · 'locked' (not enabled / not on this plan) · 'input' (needs a ticker
// or argument) · 'paused' (the panel is elsewhere, e.g. popped out). Colours are app tokens only.
// An error never paints the sentence red — red means "price down" in this product; the error
// kind is marked by its icon and a leading bar instead.
import UIcon from '../ui/UIcon'
import styles from './PanelState.module.css'

const ICON = { empty: 'document', error: 'warning', locked: 'lock', input: 'search', paused: 'pause' }

export default function PanelState({ kind = 'empty', title, children, action, role, testId, compact = false }) {
  const icon = ICON[kind] || ICON.empty
  return (
    <div
      className={`${styles.state} ${compact ? styles.compact : ''}`}
      data-kind={kind}
      role={role ?? (kind === 'error' ? 'alert' : undefined)}
      data-testid={testId}
    >
      <span className={styles.icon} aria-hidden="true"><UIcon name={icon} size={compact ? 14 : 18} gold={false} /></span>
      <div className={styles.text}>
        {title != null && <p className={styles.title}>{title}</p>}
        {children != null && <div className={styles.hint}>{children}</div>}
        {action != null && <div className={styles.action}>{action}</div>}
      </div>
    </div>
  )
}
