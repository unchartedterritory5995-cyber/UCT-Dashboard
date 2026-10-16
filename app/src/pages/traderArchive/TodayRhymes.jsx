// app/src/pages/traderArchive/TodayRhymes.jsx
//
// The "Today" view of /trader-archive: THIS RHYMES. Today's active scanner detections that map
// to a setup in the team archive, each beside the setup's measured record, the ticker's own team
// history and the closest past team calls of that setup in the same market state.
// Reads GET /api/wisdom/archive/rhymes (require_paid, WISDOM_ARCHIVE_ENABLED).
//
// ⛔ Display only: nothing here is a signal. No price level is on the wire and none is drawn.
// ⛔ A 404 (flag off), a 402 (unpaid) and a 503 (scan or store unreadable) are said as such,
// never rendered as "nothing rhymes".
import useSWR from 'swr'

import jsonFetcher from '../../utils/jsonFetcher'
import { ARCHIVE_API, dayOf, fmtR, rTone } from '../../utils/traderArchive'
import styles from './TraderArchive.module.css'

const SWR_OPTS = { revalidateOnFocus: false, shouldRetryOnError: false }

const pct0 = (v) => (v === null || v === undefined ? '—' : `${Math.round(Number(v) * 100)}%`)

function Outcome({ value }) {
  const tone = rTone(value)
  return <span className={tone === 'up' ? styles.up : tone === 'down' ? styles.down : undefined}>{fmtR(value)}</span>
}

function StateLine({ error }) {
  if (error?.status === 404) return <p className={styles.notice} data-testid="rhymes-off">The trader archive isn&apos;t available yet.</p>
  if (error?.status === 402) return <p className={styles.notice} data-testid="rhymes-paywall">The trader archive is part of the paid plan.</p>
  return <p className={styles.notice} data-testid="rhymes-unavailable">Today&apos;s scan or the archive couldn&apos;t be read. Try again in a moment.</p>
}

function Hit({ hit }) {
  const pb = hit.playbook || {}
  const th = hit.ticker_history || {}
  const last = th.last_call
  const cut = pb.today_cut
  return (
    <li className={styles.item} data-testid="rhyme-hit">
      <div className={styles.meta}>
        <a className={styles.tickers} href={`/trader-archive?sym=${encodeURIComponent(hit.ticker)}`}>{hit.ticker}</a>
        <span className={styles.kind}>{pb.name || hit.setup}</span>
        <span className={styles.trader}>{pb.verdict}</span>
      </div>
      <p className={styles.note}>
        Team record: {pb.n_scored ?? 0} scored calls, win {pct0(pb.win20)} at 20 days
        {cut ? `; in today's market: ${cut.n_scored} calls, win ${pct0(cut.win20)}` : ''}.
      </p>
      <p className={styles.note} data-testid="rhyme-history">
        {last
          ? <>Team called {hit.ticker} {th.n_calls} time{th.n_calls === 1 ? '' : 's'}; last {last.trader}, {dayOf(last.posted)} ({last.setup || 'call'}) r20 <Outcome value={last.r20} /> · {last.record_id}</>
          : <>No team call on {hit.ticker} in the archive.</>}
      </p>
      {(hit.closest || []).length > 0 && (
        <p className={styles.note} data-testid="rhyme-closest">
          Closest past calls:{' '}
          {hit.closest.map((c, i) => (
            <span key={`${c.record_id}-${c.ticker}-${i}`}>
              {i > 0 && ' · '}{c.ticker} {c.trader} {dayOf(c.posted)} r20 <Outcome value={c.r20} />
            </span>
          ))}
        </p>
      )}
    </li>
  )
}

export default function TodayRhymes() {
  const { data, error } = useSWR(`${ARCHIVE_API}/rhymes`, jsonFetcher, SWR_OPTS)
  if (error) return <StateLine error={error} />
  if (!data) return <p className={styles.loading}>Reading today&apos;s scan…</p>
  const hits = data.hits || []
  return (
    <div data-testid="rhymes-view">
      <p className={styles.summary}>
        {hits.length} of today&apos;s scanner hits rhyme with the team archive · market {data.market_state || 'unknown'}.
        Display only, measured after the fact; not a signal.
      </p>
      {hits.length === 0
        ? <p className={styles.empty}>None of today&apos;s scanner hits map to a setup in the team archive.</p>
        : <ul className={styles.list}>{hits.map((h) => <Hit key={`${h.ticker}-${h.setup}`} hit={h} />)}</ul>}
    </div>
  )
}
