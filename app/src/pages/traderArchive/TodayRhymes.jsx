// app/src/pages/traderArchive/TodayRhymes.jsx
//
// The "Today" view of The Desk → Archive: THIS RHYMES. Today's active scanner detections that map
// to a setup in the team archive, GROUPED BY SETUP: one card per setup carries its measured record,
// today's market cut and its closest past team calls (said once, not once per ticker), followed by
// the tickers that rhyme with it and each one's own team history.
// Reads GET /api/wisdom/archive/rhymes (require_paid, WISDOM_ARCHIVE_ENABLED).
//
// ⛔ Display only: nothing here is a signal. No price level is on the wire and none is drawn.
// ⛔ A 404 (flag off), a 402 (unpaid) and a 503 (scan or store unreadable) are said as such,
// never rendered as "nothing rhymes".
import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'

import jsonFetcher from '../../utils/jsonFetcher'
import { ARCHIVE_API, EDGE_Z, MIN_CONTEXT_N, fmtDay, setupName, splitSetupName } from '../../utils/traderArchive'
import { Outcome, SectionTitle, StatTile, pct0 } from './archiveUi'
import styles from './TraderArchive.module.css'

// The route's maximum page (rhymes.MAX_HITS): enough hits for several setups to appear.
export const RHYMES_LIMIT = 200
export const RHYMES_URL = `${ARCHIVE_API}/rhymes?limit=${RHYMES_LIMIT}`
// Simple first (owner, 2026-10-29): the top setups and the top names in each, the rest one click away.
export const SETUPS_SHOWN = 5
export const TICKERS_SHOWN = 5

// A cold server computes Today in the background (archive/rhymes.py); during the boot rush a request
// can come back 5xx. Retry those for ~5 minutes (measured 2026-10-29: the first compute after a deploy
// landed 215 s after boot, and 4 retries gave up before it); a 404 (off) or 402 (unpaid) is final.
export const RHYMES_RETRY = { count: 20, intervalMs: 15000 }
// A cold server answers 202 {status: "warming"} while it computes in the background: ask again
// every WARMING_POLL_MS until the answer lands, then stop polling.
export const WARMING_POLL_MS = 15000
const isWarming = (d) => d?.status === 'warming'
// Only a definite 4xx answer is final (404 off, 402 unpaid). A 5xx, and a failure with NO status at
// all (the connection reset while a deploy swapped pods: jsonFetcher sets .status only on an HTTP
// answer), are retried. Measured 2026-10-29: the status-less case left Today on an error for good.
const isRetryable = (error) => !(error?.status >= 400 && error?.status < 500)

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

/** The server's verdict in the Playbooks' words: proven at |z| >= EDGE_Z on >= MIN_CONTEXT_N calls. */
function verdictLabel(pb) {
  const z = pb?.edgeR_z
  const proven = z !== null && z !== undefined && Math.abs(z) >= EDGE_Z && (pb?.n_scored ?? 0) >= MIN_CONTEXT_N
  return { proven, label: proven ? 'Proven edge' : 'Not proven yet', z }
}

/** Hits grouped by setup, in the server's rank order (a setup sits where its best hit ranked). */
export function groupBySetup(hits) {
  const groups = new Map()
  for (const h of hits || []) {
    const key = h.playbook?.setup_id || h.setup
    if (!groups.has(key)) groups.set(key, { key, playbook: h.playbook || {}, setup: h.setup, closest: h.closest || [], hits: [] })
    groups.get(key).hits.push(h)
  }
  return [...groups.values()]
}

function TickerRow({ hit, onTicker }) {
  const th = hit.ticker_history || {}
  const last = th.last_call
  return (
    <li className={styles.rhymeRow} data-testid="rhyme-hit">
      {onTicker
        ? <button type="button" className={`${styles.ticker} ${styles.tickerBtn}`} onClick={() => onTicker(hit.ticker)}>{hit.ticker}</button>
        : <span className={styles.ticker}>{hit.ticker}</span>}
      <span className={styles.rhymeHistory} data-testid="rhyme-history">
        {last
          ? <>Team called it {th.n_calls}×. Last: {last.trader}, {fmtDay(last.posted)}, {last.r20 === null || last.r20 === undefined
            ? 'too early to score'
            : <>20-day <Outcome value={last.r20} /></>}</>
          : <>No team call on {hit.ticker} yet.</>}
      </span>
    </li>
  )
}

function SetupGroup({ group, onTicker, onSetup }) {
  const [all, setAll] = useState(false)
  const pb = group.playbook
  const cut = pb.today_cut
  const v = verdictLabel(pb)
  const title = pb.name ? splitSetupName(pb.name).title : setupName(group.setup)
  const shown = all ? group.hits : group.hits.slice(0, TICKERS_SHOWN)
  // "Closest" excludes each hit's own ticker server-side; the group shows the first hit's list.
  const closest = group.closest
  return (
    <article className={styles.rhymeGroup} data-testid="rhyme-group">
      <header className={styles.cardHead}>
        <div>
          {onSetup && group.key
            ? <button type="button" className={styles.groupTitleBtn} onClick={() => onSetup(group.key)}>{title}</button>
            : <h3 className={styles.groupTitle}>{title}</h3>}
          <p className={styles.byline}>{group.hits.length} name{group.hits.length === 1 ? '' : 's'} on today&apos;s scan</p>
        </div>
        <span className={v.proven ? `${styles.verdict} ${styles.verdictOn}` : styles.verdict}
          title={v.z !== null && v.z !== undefined ? `z ${v.z}` : undefined}>{v.label}</span>
      </header>
      <div className={styles.tiles}>
        <StatTile label={`worked, over ${pb.n_scored ?? 0} team calls`}>{pct0(pb.win20)}</StatTile>
        {cut && <StatTile label={`worked in today's market (${cut.n_scored} calls)`}>{pct0(cut.win20)}</StatTile>}
      </div>
      <ul className={styles.rhymeRows}>
        {shown.map((h) => <TickerRow key={h.ticker} hit={h} onTicker={onTicker} />)}
      </ul>
      {group.hits.length > TICKERS_SHOWN && (
        <button type="button" className={styles.linkBtn} onClick={() => setAll((x) => !x)}>
          {all ? 'Show fewer' : `Show all ${group.hits.length}`}
        </button>
      )}
      {closest.length > 0 && (
        <div className={styles.closest} data-testid="rhyme-closest">
          <span className={styles.closestLabel}>Closest past team calls of this setup</span>
          {closest.map((c, i) => (
            <span key={`${c.record_id}-${c.ticker}-${i}`} className={styles.closestItem}>
              <span className={styles.closestSym}>{c.ticker}</span> {c.trader} · {fmtDay(c.posted)} · <Outcome value={c.r20} />
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

export default function TodayRhymes({ onTicker, onSetup }) {
  const { data, error, recovering } = useRhymes()
  const groups = useMemo(() => groupBySetup(data?.hits), [data])
  const [allSetups, setAllSetups] = useState(false)
  if (error && recovering) return <Waiting warming />
  if (error) return <StateLine error={error} />
  if (!data) return <Waiting />
  if (isWarming(data)) return <Waiting warming />
  const hits = data.hits || []
  const total = data.n_hits ?? hits.length
  return (
    <div data-testid="rhymes-view">
      <p className={styles.intro}>
        {total.toLocaleString()} of today&apos;s scanner hits look like setups the team has traded before
        {data.market_state ? <> · market: {data.market_state}</> : ''}.
        {total > hits.length && <> The names the team knows best, grouped by setup.</>}
      </p>
      {hits.length === 0
        ? <p className={styles.empty}>None of today&apos;s scanner hits match a setup in the team archive.</p>
        : (
          <>
            <SectionTitle count={groups.length}>Setups on today&apos;s scan</SectionTitle>
            <div className={styles.groupList}>
              {(allSetups ? groups : groups.slice(0, SETUPS_SHOWN)).map((g) => (
                <SetupGroup key={g.key} group={g} onTicker={onTicker} onSetup={onSetup} />))}
            </div>
            {groups.length > SETUPS_SHOWN && (
              <button type="button" className={styles.moreBtn} aria-expanded={allSetups} onClick={() => setAllSetups((x) => !x)}>
                {allSetups ? 'Show fewer setups' : `Show ${groups.length - SETUPS_SHOWN} more setups`}
              </button>
            )}
          </>
        )}
    </div>
  )
}
