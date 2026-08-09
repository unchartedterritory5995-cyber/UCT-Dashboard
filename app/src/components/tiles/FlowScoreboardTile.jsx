/**
 * FlowScoreboardTile — compact Dashboard entry point to the
 * Flow Scoreboard page (/flow-scoreboard): the verified Top Flow track record.
 *
 * 🔴 This tile pointed at `/options-flow?view=scoreboard` from 2026-07-10 to
 * 2026-08-09 and opened on the default Stocks tab for that entire month:
 * `93980419` wired the in-page view mode and `ed608046` — a bare "Update
 * OptionsFlow.jsx" web-UI commit the SAME DAY — removed it. `/flow-scoreboard`
 * is a real route again, so the tile links straight at the page rather than at
 * a query param a partner-owned file has to keep honouring. The old deep link
 * still forwards (see `OptionsFlowRoute` in App.jsx) for month-old bookmarks.
 * Rail: `app/src/routes/lostDoors.route.test.jsx`.
 *
 * Headline = share of picks whose contract hit +25% at peak, plus the best
 * recent standout. Read-only, one cheap request (server caches 5 min).
 */
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import TileCard from '../TileCard'
import styles from './FlowScoreboardTile.module.css'

// Local copy (kept in sync with FlowScoreboard.jsx) so this tile doesn't pull
// the lazy-loaded page chunk into the Dashboard bundle.
function contractLine(p) {
  const n = Number(p.strike)
  const strike = Number.isFinite(n) ? (n % 1 === 0 ? n.toFixed(0) : String(n)) : String(p.strike ?? '')
  return `$${strike}${p.cp === 'P' ? 'P' : 'C'} ${p.exp || ''}`.trim()
}

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

export default function FlowScoreboardTile() {
  const { data, isLoading } = useSWR('/api/flow-scoreboard', fetcher, {
    refreshInterval: 300_000,
    revalidateOnFocus: false,
  })

  const overall = data?.overall
  const hasData = (data?.picks_tracked ?? 0) > 0
  const topWinner = data?.recent_winners?.[0]

  return (
    <TileCard title="Flow Scoreboard" icon="check" className={styles.tile}>
      <Link to="/flow-scoreboard" className={styles.body} aria-label="Open the Flow Scoreboard">
        {isLoading && !data ? (
          <div className={styles.muted}>Loading…</div>
        ) : !hasData ? (
          <div className={styles.muted}>
            Tracking every Top Flow pick — outcomes publish after two daily snapshots.
          </div>
        ) : (
          <>
            <div className={styles.headline}>
              <span className={styles.headlineValue}>
                {overall?.win_rate_25 == null ? '—' : `${overall.win_rate_25.toFixed(0)}%`}
              </span>
              <span className={styles.headlineLabel}>
                of {data.picks_tracked} tracked picks hit +25% at peak
              </span>
            </div>
            {topWinner && (
              <div className={styles.winnerLine}>
                <span className={styles.winnerSym}>{topWinner.sym}</span>
                <span className={styles.winnerContract}>{contractLine(topWinner)}</span>
                <span className={styles.winnerGain}>+{Number(topWinner.max_gain_pct).toFixed(0)}% peak</span>
              </div>
            )}
          </>
        )}
        <span className={styles.cta}>View scoreboard →</span>
      </Link>
    </TileCard>
  )
}
