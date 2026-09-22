// app/src/pages/research/LeadershipBadge.jsx
// Packet I CP1 (signed 2026-09-22, fingerprint 830cec48e) -- "has this ticker
// been one of UCT's top-20 leadership picks, and for how long?"
//
// GET /api/leader-persistence/{symbol} already computed this (real query
// against leadership_snapshots, weekend-gap-aware) -- it just had zero
// frontend callers anywhere in the app until this component. Modeled
// directly on DeskCoverage.jsx's own idiom: one self-contained card, one
// inline fetch, renders null when there is nothing to show, so a ticker
// that has never been a pick (the common case) sees no empty box.
//
// ⛔ The endpoint has THREE distinct "empty" response shapes (engine
// unavailable: 2 keys; no rows for this ticker: 3 keys; real data: 5 keys --
// found and documented in tests/test_leader_persistence.py, NOT fixed here,
// changing the endpoint is explicitly out of this packet's scope). This
// component reads `data?.consecutive_days` defensively and never assumes
// `first_seen`/`last_seen` are present.
import useSWR from 'swr'
import styles from './ResearchPage.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

export default function LeadershipBadge({ sym }) {
  const { data } = useSWR(
    sym ? `/api/leader-persistence/${encodeURIComponent(sym)}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const days = data?.consecutive_days || 0
  // Not currently a pick -- the common case for most tickers. Render
  // nothing rather than a permanent "not a leader" note; Overview already
  // carries plenty of content, and a null-state banner on most symbols
  // would be noise, not signal.
  if (!days) return null

  return (
    <section className={styles.card} data-testid="leadership-badge">
      <div className={styles.ct}>UCT20 Leadership</div>
      <div>
        <span className={styles.gold}>On Leadership 20 for {days} session{days > 1 ? 's' : ''}</span>
        {typeof data.total_appearances === 'number' && (
          <span className={styles.muted}> · {data.total_appearances} total appearance{data.total_appearances !== 1 ? 's' : ''}</span>
        )}
      </div>
      {data.first_seen && (
        <div className={styles.muted} style={{ marginTop: 4 }}>First seen {data.first_seen}</div>
      )}
    </section>
  )
}
