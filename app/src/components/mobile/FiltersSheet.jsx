import Sheet from './Sheet'
import styles from './FiltersSheet.module.css'

/* FiltersSheet — the canonical mobile filter pattern: a bottom-sheet holding
 * the filter controls (children), a "Clear all" in the header when filters are
 * active, and a sticky "Apply" footer. The triggering button + active-filter
 * chips live at the call site (per-surface).
 */
export default function FiltersSheet({
  open,
  onClose,
  onClear,
  onApply,
  title = 'Filters',
  activeCount = 0,
  applyLabel = 'Apply',
  children,
}) {
  if (!open) return null
  const header = (
    <div className={styles.hdr}>
      <span>{title}{activeCount > 0 ? ` · ${activeCount}` : ''}</span>
      {activeCount > 0 && onClear && (
        <button type="button" className={styles.clear} onClick={onClear}>Clear all</button>
      )}
    </div>
  )
  const footer = onApply ? (
    <button type="button" className={styles.apply} onClick={onApply}>
      {applyLabel}{activeCount > 0 ? ` (${activeCount})` : ''}
    </button>
  ) : null

  return (
    <Sheet open onClose={onClose} variant="bottom-sheet" title={header} footer={footer}>
      <div className={styles.body}>{children}</div>
    </Sheet>
  )
}
