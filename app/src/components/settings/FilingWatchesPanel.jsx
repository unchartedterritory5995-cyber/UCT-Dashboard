import useFilingWatch from '../../hooks/useFilingWatch'
import { formatETDate } from '../../utils/timeAgo'
import UIcon from '../ui/UIcon'
import styles from '../../pages/Settings.module.css'

// ── S7 Filing Watches — Stage 5 minimal management panel ────────────────
// "Notify me about new SEC filings for {sym}" — list + suspend/reactivate
// only. Shares useFilingWatch with the creation surfaces (TickerPopup,
// TickerHubSheet, Research header) so a change here is reflected there via
// the same SWR cache key, no separate state to keep in sync (E3).
//
// Extracted to its own file (rather than left inline in Settings.jsx, which
// has no dedicated test file and heavy unrelated dependencies) specifically
// so it's unit-testable in isolation.
export default function FilingWatchesPanel() {
  const filingWatch = useFilingWatch()
  const watches = [...filingWatch.predicates].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))

  if (filingWatch.isLoading) {
    return <div className={styles.section}><span className={styles.hint}>Loading filing watches...</span></div>
  }

  return (
    <div className={styles.section}>
      <p className={styles.hint} style={{ marginTop: 0, marginBottom: 12 }}>
        Securities you've asked to be notified about when they file something new with the SEC.
      </p>
      {watches.length === 0 ? (
        <span className={styles.hint}>No filing watches yet — use the filing-watch action on a ticker's chart or Research page.</span>
      ) : (
        <div className={styles.sessionList}>
          {watches.map(w => {
            const sym = w.entity_scope?.symbol || w.entity_scope?.id || '—'
            const suspended = !!w.suspended_at
            const busy = filingWatch.watchState(sym) === 'CREATING' || filingWatch.watchState(sym) === 'SUSPENDING'
            return (
              <div key={w.id} className={styles.sessionRow}>
                <span className={styles.sessionIcon}><UIcon name="document" size={13} gold={!suspended} /></span>
                <div className={styles.sessionInfo}>
                  <div className={styles.sessionLabel}>
                    {sym}
                    {suspended
                      ? <span className={styles.sessionCurrentPill} style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>Suspended</span>
                      : <span className={styles.sessionCurrentPill}>Active</span>}
                  </div>
                  <div className={styles.sessionMeta}>
                    Created {w.created_at ? formatETDate(w.created_at) : '—'}
                  </div>
                </div>
                <button
                  className={styles.btnMuted}
                  disabled={busy}
                  aria-label={suspended ? `Reactivate filing watch for ${sym}` : `Suspend filing watch for ${sym}`}
                  onClick={() => {
                    if (suspended) filingWatch.createOrReactivate(sym)
                    else filingWatch.suspend(w.id, sym)
                  }}
                >
                  {busy ? '…' : suspended ? 'Reactivate' : 'Suspend'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
