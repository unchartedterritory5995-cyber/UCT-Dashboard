import CompanyLogo from '../../components/CompanyLogo'
import SymbolSearch from '../../components/chart/SymbolSearch'
import RsBadge from '../../components/RsBadge'
import RatingBadges from './RatingBadges'
import UIcon from '../../components/ui/UIcon'
import useFilingWatch from '../../hooks/useFilingWatch'
import styles from './ResearchPage.module.css'

// S7 filing watch — "Notify me about new SEC filings for {sym}". Placed in
// the header (not inside the Filings tab) so the action is visible
// regardless of which Research tab the member is viewing (D7) — this is the
// surface that closes RESEARCH → MONITOR.
const FILING_WATCH_COPY = {
  NOT_WATCHING: { label: 'Notify me of new SEC filings', title: sym => `Notify me about new SEC filings for ${sym}` },
  ACTIVE: { label: 'Watching SEC filings', title: () => 'Watching SEC filings — click to suspend' },
  SUSPENDED: { label: 'Watch suspended', title: sym => `Filing watch suspended — click to reactivate for ${sym}` },
  CREATING: { label: 'Setting up…', title: () => 'Setting up filing watch…' },
  SUSPENDING: { label: 'Suspending…', title: () => 'Suspending filing watch…' },
  ERROR: { label: 'Try again', title: () => 'Filing watch failed — click to retry' },
  LOADING: { label: 'Filing watch', title: () => 'Filing watch' },
}

function FilingWatchAction({ sym }) {
  const filingWatch = useFilingWatch()
  const state = filingWatch.watchState(sym)
  const busy = state === 'CREATING' || state === 'SUSPENDING' || state === 'LOADING'
  const copy = FILING_WATCH_COPY[state] || FILING_WATCH_COPY.LOADING
  const onClick = () => {
    if (busy) return
    if (state === 'ACTIVE') {
      const w = filingWatch.getWatch(sym)
      if (w) filingWatch.suspend(w.id, sym)
    } else {
      filingWatch.createOrReactivate(sym)
    }
  }
  return (
    <button
      type="button"
      className={styles.hdrWatchBtn}
      onClick={onClick}
      disabled={busy}
      title={copy.title(sym)}
      aria-label={copy.title(sym)}
      aria-pressed={state === 'ACTIVE'}
    >
      <UIcon name="document" size={14} gold={state === 'ACTIVE'} />
      <span>{copy.label}</span>
    </button>
  )
}

function pctClass(v) {
  if (v == null) return ''
  return v >= 0 ? styles.up : styles.down
}

export default function ResearchHeader({ sym, meta, live, ratings, onSymbolChange }) {
  const change = live?.change_pct
  return (
    <header className={styles.hdr}>
      <CompanyLogo sym={sym} size={52} />
      <div className={styles.hdrId}>
        <div className={styles.hdrName}>
          {sym}
          <span className={styles.hdrCo}> · {meta?.name || ''}</span>
        </div>
        <div className={styles.hdrSub}>
          {[meta?.exchange, meta?.sector, meta?.industry].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className={styles.hdrRs}>
        <RsBadge sym={sym} />
      </div>
      <FilingWatchAction sym={sym} />
      <div className={styles.hdrPx}>
        {live?.price != null && (
          <div className={styles.hdrPxBig}>
            ${Number(live.price).toFixed(2)}{' '}
            {change != null && (
              <span className={pctClass(change)}>
                {change >= 0 ? '▲' : '▼'}{Math.abs(change).toFixed(2)}%
              </span>
            )}
          </div>
        )}
        <div className={styles.hdrSearch}>
          <SymbolSearch sym={sym} onSymbolChange={onSymbolChange} />
        </div>
      </div>
      <div className={styles.hdrRatings}>
        <RatingBadges ratings={ratings} />
      </div>
    </header>
  )
}
