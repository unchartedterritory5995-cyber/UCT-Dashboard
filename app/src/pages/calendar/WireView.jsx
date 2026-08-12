// app/src/pages/calendar/WireView.jsx
//
// The Wire — earnings results as they hit the tape.
//
// THE ORDERING RULE, which is the whole design: a row's position is its ARRIVAL
// TIME and never changes. Ranking by move (the first draft of the spec) would
// reorder rows as prices tick, so a name you were reading would jump and the
// upgrade-in-place promise would break. Significance instead drives visual
// WEIGHT — a big mover renders loud, a small one renders quiet, both stay put.
import { useMemo } from 'react'
import styles from './WireView.module.css'
import { useWire } from './useWire'
import { useWireCoverage } from './useWireCoverage'

/** Compact money: 51.2B / 9.4M / 1.24 */
function fmtNum(v) {
  if (v == null || Number.isNaN(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  return v.toFixed(2)
}

// Weight, never position.
function weightOf(row) {
  const m = Math.abs(row.move_pct ?? row.peak_move_pct ?? 0)
  if (m >= 8) return styles.loud
  if (m >= 4) return styles.mid
  return styles.quiet
}

function fmtTime(epochSeconds) {
  if (!epochSeconds) return '--:--:--'
  return new Date(epochSeconds * 1000).toLocaleTimeString('en-US', {
    hour12: false, timeZone: 'America/New_York',
  })
}

const COV_NAME_CAP = 8

/**
 * The trust line: is what you're reading COMPLETE? Rendered only for the
 * current session (a date before the wire existed would scream "missing"
 * about rows nobody ever recorded — the server decides via
 * `is_current_session`, one authority). Three honest states: complete,
 * incomplete WITH THE NAMES, and unmeasured — which renders as unknown,
 * never as clean.
 */
function CoverageLine({ cov }) {
  if (!cov || !cov.is_current_session) return null
  if (cov.measured === false) {
    return (
      <div className={styles.covUnknown} data-testid="wire-coverage">
        Completeness unverified — the provider check is unavailable right now
      </div>
    )
  }
  const missing = cov.missing_from_feed ?? []
  const pending = cov.numbers_pending_on_feed ?? []
  if (!missing.length && !pending.length) {
    return (
      <div className={styles.covOk} data-testid="wire-coverage">
        ✓ Complete — all {cov.reported} reported names are on the feed
      </div>
    )
  }
  const names = (syms) => {
    const shown = syms.slice(0, COV_NAME_CAP).join(', ')
    const extra = syms.length - COV_NAME_CAP
    return extra > 0 ? `${shown} +${extra} more` : shown
  }
  return (
    <div className={styles.covWarn} data-testid="wire-coverage">
      {missing.length > 0 && (
        <span>{missing.length} reported {missing.length === 1 ? 'name' : 'names'} not
          {' '}shown yet: {names(missing)}</span>
      )}
      {pending.length > 0 && (
        <span>{missing.length > 0 ? ' · ' : ''}numbers pending for {names(pending)}</span>
      )}
    </div>
  )
}

export default function WireView({ dateStr }) {
  const { data } = useWire(dateStr)
  const { data: cov } = useWireCoverage(dateStr)
  const rows = data?.rows ?? []
  const expected = data?.expected ?? 0

  // Sort by arrival DESC. first_seen_at is immutable server-side, so a row
  // never changes position once it has been placed.
  const ordered = useMemo(
    () => [...rows].sort((a, b) => (b.first_seen_at ?? 0) - (a.first_seen_at ?? 0)),
    [rows],
  )

  if (!ordered.length) {
    return (
      <>
        <CoverageLine cov={cov} />
        <div className={styles.empty}>
          {expected > 0
            ? `${expected} reporters this session — waiting on the first print`
            : 'No reporters scheduled'}
        </div>
      </>
    )
  }

  return (
    <div className={styles.wire}>
      <CoverageLine cov={cov} />
      {ordered.map(r => {
        const mv = r.move_pct
        return (
          <div key={r.sym} className={`${styles.row} ${weightOf(r)}`}>
            <span className={styles.time}>{fmtTime(r.first_seen_at)}</span>
            <span className={styles.sym} data-testid="wire-sym">{r.sym}</span>
            <span className={mv != null && mv < 0 ? styles.down : styles.up}>
              {mv == null ? '—' : `${mv >= 0 ? '▲' : '▼'} ${Math.abs(mv).toFixed(1)}%`}
            </span>
            {r.eps_act == null && r.rev_act == null ? (
              <span className={styles.pending}>numbers pending…</span>
            ) : (
              // Show whatever the company actually published — KOPN
              // (2026-08-11) printed a +22% revenue beat with NO EPS figure,
              // and an eps-only gate hid that revenue behind "pending…".
              // fmtNum renders a missing side as an em dash, which is honest.
              <span className={styles.nums}>
                EPS {fmtNum(r.eps_act)} vs {fmtNum(r.eps_est)}
                {' · '}Rev {fmtNum(r.rev_act)} vs {fmtNum(r.rev_est)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
