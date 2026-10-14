import styles from './FocusScreener.module.css'

export function ListSkeleton() {
  return (
    <div role="status" className={styles.skeleton}>
      <span className="sr-only">Loading results</span>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={styles.skelRow} aria-hidden="true">
          <span className={styles.skelA} style={{ width: 40 + (i * 13) % 30 }} />
          <span className={styles.skelB} style={{ width: 90 + (i * 29) % 70 }} />
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ filterCount, lastChange, onUndo, onOpenFilters }) {
  const head = filterCount === 1 ? 'No stocks match this filter' : `No stocks match all ${filterCount} filters`
  return (
    <div className={styles.stateBox}>
      <p className={styles.stateHead}>{head}</p>
      {lastChange && (
        <p className={styles.stateBody}>
          Your last change, <b>{lastChange.label}</b>, took the list from {lastChange.from} to 0.
        </p>
      )}
      <div className={styles.stateActions}>
        {lastChange && <button type="button" className={styles.btnPrimary} onClick={onUndo}>Undo that change</button>}
        <button type="button" className={styles.btn} onClick={onOpenFilters}>Open filters</button>
      </div>
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className={styles.stateBox} role="alert">
      <p className={styles.stateHead}>The screen didn&apos;t load</p>
      <p className={styles.stateBody}>{message} Your filters are kept.</p>
      <button type="button" className={styles.btn} onClick={onRetry}>Try again</button>
    </div>
  )
}
