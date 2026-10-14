import styles from './FocusScreener.module.css'
import own from './FiltersDrawer.module.css'
import useLazyCounts from './useLazyCounts'
import { dropOptions, MAX_DROP_PILLS, LOGIC_ID } from './drawerFilters'
import { capToTopN } from './counts'

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

// The ONE place a pill words its count. undefined = still asking, null = the count
// failed: neither may ever read as 0.
const countText = n => (n === undefined ? 'counting…' : n === null ? 'count unavailable'
  : `${n.toLocaleString('en-US')} ${n === 1 ? 'match' : 'matches'}`)


export function EmptyState({ filterCount, lastChange, onUndo, onOpenFilters, spec = null, meta = null, onRemoveFilter = null, onRemoveLogic = null }) {
  const head = filterCount === 0 ? 'No stocks match this screen'
    : filterCount === 1 ? 'No stocks match this filter' : `No stocks match all ${filterCount} filters`
  const options = onRemoveFilter ? dropOptions(spec, meta, !!onRemoveLogic) : []
  const shown = options.slice(0, MAX_DROP_PILLS)
  // A pill's count is keyed on the spec it describes, not just its filter: after any edit the
  // remaining pills read "counting…" until their own answer lands, never the previous screen's.
  const countKey = o => `${o.id}|${JSON.stringify(o.spec)}`
  const counts = useLazyCounts(Object.fromEntries(shown.map(o => [countKey(o), o.spec])), shown.length > 0)
  const remove = id => (id === LOGIC_ID ? onRemoveLogic() : onRemoveFilter(id))
  return (
    <div className={styles.stateBox}>
      {/* Only the verdict is a live region; the pills' eight async counts must not be announced. */}
      <div role="status" className={own.stateStatus}>
        <p className={styles.stateHead}>{head}</p>
        {lastChange && (
          <p className={styles.stateBody}>
            Your last change, <b>{lastChange.label}</b>, took the list from {lastChange.from} to 0.
          </p>
        )}
      </div>
      {shown.length > 0 && (
        <>
          <p className={styles.stateBody}>Remove one filter to see what it brings back:</p>
          <ul className={own.dropPills}>
            {shown.map(o => {
              const n = capToTopN(counts[countKey(o)], o.spec)
              return (
                <li key={o.id}>
                  <button type="button" className={own.dropPill} aria-label={`Remove ${o.label}, ${countText(n)}`} onClick={() => remove(o.id)}>
                    <span>{o.label}</span>
                    <span className={`${own.dropGain} ${n > 0 ? own.dropGainSome : ''}`}>{`remove → ${countText(n)}`}</span>
                  </button>
                </li>
              )
            })}
            {options.length > shown.length && (
              <li className={own.dropMore}>{`+${options.length - shown.length} more in Filters`}</li>
            )}
          </ul>
        </>
      )}
      <div className={styles.stateActions}>
        {lastChange && <button type="button" className={styles.btnPrimary} onClick={onUndo}>Undo that change</button>}
        <button type="button" className={styles.btn} onClick={onOpenFilters}>Open filters</button>
      </div>
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  const msg = String(message ?? '').trim().replace(/\.+$/, '')
  return (
    <div className={styles.stateBox} role="alert">
      <p className={styles.stateHead}>The screen didn&apos;t load</p>
      <p className={styles.stateBody}>{msg ? <span>{`${msg}.`}</span> : null}{msg ? ' ' : null}<span>Your filters are kept.</span></p>
      <button type="button" className={styles.btn} onClick={onRetry}>Try again</button>
    </div>
  )
}
