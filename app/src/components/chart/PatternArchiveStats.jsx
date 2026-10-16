// app/src/components/chart/PatternArchiveStats.jsx — the "Historical Stats" body of the
// pattern side panel, filled from the TSDR trader archive.
//
// One request per detection: GET /api/wisdom/archive/pattern/{pattern_id}?ticker={sym}
// (require_paid, WISDOM_ARCHIVE_ENABLED). The server resolves the detector to an archive
// setup through the ONE setup vocabulary; this file restates no mapping. A 404 (detector
// maps to no setup, no playbook, or the flag is off) or a 402 (no paid plan) keeps the
// panel's original placeholder, word for word.
//
// ⛔ DISPLAY ONLY. Nothing here feeds the detection's confidence, its historical score or
// what fires. No price levels are shown for archive calls.
//
// Reference lines ("auto chart"): when the server adds `lines` (WISDOM_ARCHIVE_LINES_ENABLED), they
// are handed up through `onLines` as chart price lines: the team's usual trigger / entry / stop
// lines for this setup on this ticker, as of today. `onLines(null)` when there are none, when the
// read fails, and when the panel closes. `onLines` must be a stable function (StockChart passes a
// state setter), or this effect re-runs every render.

import { useEffect } from 'react'
import useSWR from 'swr'
import jsonFetcher from '../../utils/jsonFetcher'
import { ARCHIVE_API, MIN_CONTEXT_N, archiveRefPriceLines, dayOf, edgeVerdict, fmtR, rTone, traderOf } from '../../utils/traderArchive'
import styles from './PatternSidePanel.module.css'

export const PLACEHOLDER = 'Pattern stats available after Phase 7 launch — outcome tracker pending.'

/** No polling, no focus refetch, no retry: one read per panel open, cached by SWR's key. */
const SWR_OPTS = { revalidateOnFocus: false, revalidateIfStale: false, shouldRetryOnError: false }

const pct0 = (v) => (v === null || v === undefined ? '—' : `${Math.round(Number(v) * 100)}%`)
const fmtEdgeR = (v) => (v === null || v === undefined ? '—' : `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)}R`)

function Outcome({ value }) {
  const tone = rTone(value)
  return <span className={tone === 'up' ? styles.archiveUp : tone === 'down' ? styles.archiveDown : undefined}>{fmtR(value)}</span>
}

function CallRow({ call }) {
  return (
    <li className={styles.archiveCall}>
      <span className={styles.archiveTicker}>{call.ticker}</span>
      <span className={styles.archiveMuted} title={dayOf(call.posted)}>{traderOf(call)}</span>
      <Outcome value={call.r20} />
    </li>
  )
}

export function archiveUrl(patternId, sym) {
  if (!patternId) return null
  const q = sym ? `?ticker=${encodeURIComponent(sym)}` : ''
  return `${ARCHIVE_API}/pattern/${encodeURIComponent(patternId)}${q}`
}

export default function PatternArchiveStats({ patternId, sym, onLines }) {
  const { data, error } = useSWR(archiveUrl(patternId, sym), jsonFetcher, SWR_OPTS)
  const rawLines = error ? null : data?.lines

  useEffect(() => {
    if (typeof onLines !== 'function') return undefined
    const drawn = archiveRefPriceLines(rawLines)
    onLines(drawn.length ? drawn : null)
    return () => onLines(null)
  }, [rawLines, onLines])

  if (error || !patternId) return <div className={styles.placeholder}>{PLACEHOLDER}</div>
  if (!data) return <div className={styles.placeholder} data-testid="archive-stats-loading">Loading the team&apos;s record…</div>

  const all = data.stats?.all || {}
  const cut = data.market?.cut
  const state = data.market?.state
  const t = data.ticker
  return (
    <div className={styles.archiveStats} data-testid="archive-stats">
      <p className={styles.archiveLead}>
        The team&apos;s record on <strong>{data.name || data.setup_id}</strong>
        {' '}— {all.n_scored ?? 0} scored calls · {edgeVerdict(all)}
      </p>
      <dl className={styles.archiveGrid}>
        <dt>Win 20d</dt><dd>{pct0(all.win20)}</dd>
        <dt>Vs same stock</dt><dd><Outcome value={all.med_edge20} /></dd>
        <dt>Edge R</dt><dd>{fmtEdgeR(all.mean_edgeR)}</dd>
      </dl>
      {state && (
        <p className={styles.archiveLine} data-testid="archive-market-cut">
          {cut && (cut.n_scored ?? 0) >= MIN_CONTEXT_N
            ? <>QQQ {state} today: {cut.n_scored} calls in this tape, win {pct0(cut.win20)}, edge {fmtEdgeR(cut.mean_edgeR)}.</>
            : <>QQQ {state} today: fewer than {MIN_CONTEXT_N} scored calls in this tape.</>}
        </p>
      )}
      {(data.best?.length > 0 || data.worst?.length > 0) && (
        <div className={styles.archiveColumns}>
          <div>
            <h4 className={styles.archiveH4}>Best calls</h4>
            <ul className={styles.archiveList}>{(data.best || []).map((c) => <CallRow key={c.call_id} call={c} />)}</ul>
          </div>
          <div>
            <h4 className={styles.archiveH4}>Worst calls</h4>
            <ul className={styles.archiveList}>{(data.worst || []).map((c) => <CallRow key={c.call_id} call={c} />)}</ul>
          </div>
        </div>
      )}
      {t && (
        <p className={styles.archiveLine} data-testid="archive-ticker-line">
          {t.n_calls
            ? <>{t.ticker}: {t.n_calls} team calls{t.last_call ? <>, last {traderOf(t.last_call)} on {dayOf(t.last_call.posted)} ({t.last_call.setup}, 20d <Outcome value={t.last_call.r20} />)</> : null}.</>
            : <>{t.ticker}: the team has not called it.</>}
        </p>
      )}
      <a className={styles.archiveLink} href={`/trader-archive?view=playbooks&setup=${encodeURIComponent(data.setup_id)}`}>
        Open the full playbook
      </a>
    </div>
  )
}
