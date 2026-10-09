// The "Mine" chip (wave 3 lane 13, product item #6). ONE control for every panel that can narrow
// itself to the member's own names (MOST, FREC, CN, FEED; CAL says it in words). The set itself is
// hooks/useMyTickers (the calendar's My Stocks); this file only draws the switch and the empty
// state that says how "your names" is built -- never a bare "nothing here".
import styles from './MineChip.module.css'

export default function MineChip({ on, onToggle, explainer, testId = 'mine-chip', disabled = false }) {
  return (
    <button type="button" className={styles.chip} aria-pressed={!!on} disabled={disabled}
      onClick={() => onToggle?.(!on)} title={explainer || 'Only your names'} data-testid={testId}>
      {on ? '✓ ' : ''}Mine
    </button>
  )
}

/** The empty / loading / error answer for a "Mine" view. `state` is useMyTickers' state. */
export function MineEmpty({ state, what, explainer, testId = 'mine-empty', children }) {
  let title
  if (state === 'loading') title = 'Reading your names…'
  else if (state === 'error') title = 'Your names could not be read just now.'
  else if (state === 'empty') title = 'You have no names yet.'
  else title = `Nothing of yours ${what}.`
  return (
    <div className={styles.note} role="status" data-testid={testId} data-state={state}>
      <span className={styles.noteTitle}>{title}</span>
      {state === 'loading' ? null : <span>{explainer}</span>}
      {children ? <span className={styles.row}>{children}</span> : null}
    </div>
  )
}

export { styles as mineStyles }
