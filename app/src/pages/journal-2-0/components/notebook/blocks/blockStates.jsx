// The states every trader block body shares (Notebook P2a): loading, empty, failed, and "needs a switch
// that is off". One set of words, so a member reads the same sentence in every block.
import styles from './Blocks.module.css'

export const BLOCK_ERROR_SENTENCE = "This block couldn't load. Your note is safe."

export function BlockLoading() {
  return <p className={styles.muted} aria-live="polite">Loading…</p>
}
export function BlockEmpty({ title, children }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {children}
    </div>
  )
}
/** `onRetry`: a "Try again" button. `onReload` + `reloadName`: a "Reload" button whose accessible
 *  name says which block it is for and starts with the visible word (PlaceholderChip's pattern). */
export function BlockError({ onRetry, onReload, reloadName }) {
  return (
    <div className={styles.error} role="status">
      <p>{BLOCK_ERROR_SENTENCE}</p>
      {onRetry && <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={onRetry}>Try again</button>}
      {onReload && <button type="button" className={`btn btn-ghost ${styles.tap}`} aria-label={reloadName} onClick={onReload}>Reload</button>}
    </div>
  )
}
export function BlockNeedsSwitch({ what }) {
  return <p className={styles.muted} role="status">{`This block needs ${what}, which is not on for you.`}</p>
}
