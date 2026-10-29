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
import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'

import jsonFetcher from '../../utils/jsonFetcher'
import { ARCHIVE_API, fmtDay, setupName, splitSetupName } from '../../utils/traderArchive'
import { Outcome, pct0 } from './archiveUi'
import styles from './TraderArchive.module.css'

export const RHYMES_URL = `${ARCHIVE_API}/rhymes`

// A cold server computes Today in the background (archive/rhymes.py) and a request that outlives
// the CDN's timeout comes back 5xx. Retry those a few times; a 404 (off) or 402 (unpaid) is final.
export const RHYMES_RETRY = { count: 4, intervalMs: 15000 }
// A cold server answers 202 {status: "warming"} while it computes in the background: ask again
// every WARMING_POLL_MS until the answer lands, then stop polling.
export const WARMING_POLL_MS = 15000
const isWarming = (d) => d?.status === 'warming'
const isRetryable = (error) => error?.status >= 500

function useRhymes() {
  // How many 5xx retries are still to come: while any are, the page keeps saying "matching"
  // instead of flashing an error it is about to recover from (a pod restart answers 502 once).
  const retriesLeft = useRef(RHYMES_RETRY.count)
  const swr = useSWR(RHYMES_URL, jsonFetcher, {
    revalidateOnFocus: false,
    // SWR reads this at MOUNT (no data yet) and again only after each poll, so "no data" must poll
    // too, or polling never starts; an answer that is not "warming" returns 0 and stops it.
    refreshInterval: (d) => (d === undefined || isWarming(d) ? WARMING_POLL_MS : 0),
    onSuccess: () => { retriesLeft.current = RHYMES_RETRY.count },
    onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
      if (!isRetryable(error) || retryCount > RHYMES_RETRY.count) {
        retriesLeft.current = 0
        return
      }
      retriesLeft.current = RHYMES_RETRY.count - retryCount
      setTimeout(() => revalidate({ retryCount }), RHYMES_RETRY.intervalMs)
    },
  })
  return { ...swr, recovering: isRetryable(swr.error) && retriesLeft.current > 0 }
}

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
  const setupLabel = pb.name ? splitSetupName(pb.name).title : setupName(hit.setup)
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
        ? <button type="button" className={`${styles.setupChip} ${styles.setupChipBtn}`} onClick={() => onSetup(setupId)}>{setupLabel}</button>
        : <span className={styles.setupChip}>{setupLabel}</span>}
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

function Waiting({ warming = false }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(t)
  }, [])
  const text = warming
    ? 'Matching today’s scan against the archive. Right after an update this takes a few minutes; this page checks back on its own.'
    : slow
      ? 'Matching today’s scan against the archive is taking longer than usual. It can take a minute or two during the trading day.'
      : 'Reading today’s scan…'
  return <p className={styles.loading} data-testid="rhymes-waiting">{text}</p>
}

export default function TodayRhymes({ onTicker, onSetup }) {
  const { data, error, recovering } = useRhymes()
  if (error && recovering) return <Waiting warming />
  if (error) return <StateLine error={error} />
  if (!data) return <Waiting />
  if (isWarming(data)) return <Waiting warming />
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
