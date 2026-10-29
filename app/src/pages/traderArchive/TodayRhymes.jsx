// app/src/pages/traderArchive/TodayRhymes.jsx
//
// The "Today" view of The Desk → Archive: THIS RHYMES. Today's active scanner detections that map
// to a setup in the team archive, each as a card beside the setup's measured record, the ticker's
// own team history and the closest past team calls of that setup in the same market state.
// Reads GET /api/wisdom/archive/rhymes (require_paid, WISDOM_ARCHIVE_ENABLED).
//
// ⛔ Display only: nothing here is a signal. No price level is on the wire and none is drawn.
// ⛔ A 404 (flag off), a 402 (unpaid) and a 503 (scan or store unreadable) are said as such,
// never rendered as "nothing rhymes".
import { useEffect, useState } from 'react'
import useSWR from 'swr'

import jsonFetcher from '../../utils/jsonFetcher'
import { ARCHIVE_API, fmtDay, setupName } from '../../utils/traderArchive'
import { Outcome, SWR_OPTS, pct0 } from './archiveUi'
import styles from './TraderArchive.module.css'

function StateLine({ error }) {
  if (error?.status === 404) return <p className={styles.notice} data-testid="rhymes-off">The trader archive isn&apos;t available yet.</p>
  if (error?.status === 402) return <p className={styles.notice} data-testid="rhymes-paywall">The trader archive is part of the paid plan.</p>
  return <p className={styles.notice} data-testid="rhymes-unavailable">Today&apos;s scan or the archive couldn&apos;t be read. Try again in a moment.</p>
}

function Hit({ hit, onTicker, onSetup }) {
  const pb = hit.playbook || {}
  const th = hit.ticker_history || {}
  const last = th.last_call
  const cut = pb.today_cut
  const setupId = pb.setup_id || hit.setup
  return (
    <article className={styles.card} data-testid="rhyme-hit">
      <header className={styles.cardHead}>
        <div className={styles.cardTitle}>
          {onTicker
            ? <button type="button" className={`${styles.ticker} ${styles.tickerBtn}`} onClick={() => onTicker(hit.ticker)}>{hit.ticker}</button>
            : <span className={styles.ticker}>{hit.ticker}</span>}
        </div>
        {pb.verdict && <span className={styles.verdict}>{pb.verdict}</span>}
      </header>
      {onSetup && setupId
        ? <button type="button" className={`${styles.setupChip} ${styles.setupChipBtn}`} onClick={() => onSetup(setupId)}>{pb.name || setupName(hit.setup)}</button>
        : <span className={styles.setupChip}>{pb.name || setupName(hit.setup)}</span>}
      <p className={styles.rhymeLine}>
        This setup worked <strong>{pct0(pb.win20)}</strong> of the time over {pb.n_scored ?? 0} team calls
        {cut ? <>; in today&apos;s market: {cut.n_scored} calls, win {pct0(cut.win20)}</> : ''}.
      </p>
      <p className={styles.rhymeLine} data-testid="rhyme-history">
        {last
          ? <>The team called {hit.ticker} {th.n_calls} time{th.n_calls === 1 ? '' : 's'}. Last: {last.trader}, {fmtDay(last.posted)}, 20-day result <Outcome value={last.r20} />.</>
          : <>No team call on {hit.ticker} in the archive yet.</>}
      </p>
      {(hit.closest || []).length > 0 && (
        <div className={styles.closest} data-testid="rhyme-closest">
          <span className={styles.closestLabel}>Closest past calls</span>
          {hit.closest.map((c, i) => (
            <span key={`${c.record_id}-${c.ticker}-${i}`} className={styles.closestItem}>
              <span className={styles.closestSym}>{c.ticker}</span> {c.trader} · {fmtDay(c.posted)} · <Outcome value={c.r20} />
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

// After this long the wait is said out loud, instead of "Reading…" sitting there indefinitely.
export const SLOW_MS = 8000

function Waiting() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(t)
  }, [])
  return (
    <p className={styles.loading} data-testid="rhymes-waiting">
      {slow ? 'Matching today’s scan against the archive is taking longer than usual. It can take a minute or two during the trading day.' : 'Reading today’s scan…'}
    </p>
  )
}

export default function TodayRhymes({ onTicker, onSetup }) {
  const { data, error } = useSWR(`${ARCHIVE_API}/rhymes`, jsonFetcher, SWR_OPTS)
  if (error) return <StateLine error={error} />
  if (!data) return <Waiting />
  const hits = data.hits || []
  return (
    <div data-testid="rhymes-view">
      <p className={styles.intro}>
        {hits.length} of today&apos;s scanner hits look like setups the team has traded before
        {data.market_state ? <> · market: {data.market_state}</> : ''}.
      </p>
      {hits.length === 0
        ? <p className={styles.empty}>None of today&apos;s scanner hits match a setup in the team archive.</p>
        : <div className={styles.grid}>{hits.map((h) => <Hit key={`${h.ticker}-${h.setup}`} hit={h} onTicker={onTicker} onSetup={onSetup} />)}</div>}
    </div>
  )
}
