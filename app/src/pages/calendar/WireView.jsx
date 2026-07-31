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

export default function WireView({ dateStr }) {
  const { data } = useWire(dateStr)
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
      <div className={styles.empty}>
        {expected > 0
          ? `${expected} reporters this session — waiting on the first print`
          : 'No reporters scheduled'}
      </div>
    )
  }

  return (
    <div className={styles.wire}>
      {ordered.map(r => {
        const mv = r.move_pct
        return (
          <div key={r.sym} className={`${styles.row} ${weightOf(r)}`}>
            <span className={styles.time}>{fmtTime(r.first_seen_at)}</span>
            <span className={styles.sym} data-testid="wire-sym">{r.sym}</span>
            <span className={mv != null && mv < 0 ? styles.down : styles.up}>
              {mv == null ? '—' : `${mv >= 0 ? '▲' : '▼'} ${Math.abs(mv).toFixed(1)}%`}
            </span>
            {r.eps_act == null ? (
              <span className={styles.pending}>numbers pending…</span>
            ) : (
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
