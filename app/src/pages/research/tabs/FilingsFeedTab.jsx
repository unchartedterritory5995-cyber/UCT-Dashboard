import { useState } from 'react'
import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import styles from './ResearchCov.module.css'
import { memberText, memberSentence } from '../../../lib/presentation/memberCopy'
import { useInTerminalPanel, usePanelFreshness, usePanelRerun } from '../../../components/terminal/terminalPanel'
import { MineEmpty } from '../../../components/terminal/MineChip'
import useMyTickers from '../../../hooks/useMyTickers'
import useSinceLastVisit, { seenKey } from '../../../components/terminal/useSinceLastVisit'
import { NewTag, SinceLine } from '../../../components/terminal/SinceLastVisit'

/** The seen key of one filing: its accepted / filed date + its accession number. */
const filingKey = (r) => seenKey(String(r.accepted || r.filed || ''), r.accession)

// COV-09 (roadmap RM-L19) — new SEC filings, live: this ticker, or the whole
// market. 8-K (with its item codes), 10-Q, 10-K, Form 4, Schedule 13D/G, S-1.
// DARK behind FILINGS_FEED_ENABLED.
//
// ⛔ Every row cites its accession number and links to the SEC index page.
// ⛔ A feed not read yet is "pending", a failed one "unavailable" with the reason —
//    never an empty list that reads as "nothing was filed".

const FORMS = ['All', '8-K', '10-Q', '10-K', '4', 'SCHEDULE 13D', 'SCHEDULE 13G', 'S-1']
const when = (r) => (r.accepted ? String(r.accepted).replace('T', ' ').slice(0, 16) : r.filed || 'unavailable')

// An empty answer, said in words. A missing `reason` is never printed (it once
// read "Unavailable: undefined."), and a read that succeeded but holds none of
// the filtered form says so about the WINDOW we fetched, never about the
// company: the feed and the submissions list are both a recent slice.
/** The note above a feed that answered with rows but was stale or partial: each server clause as
 *  its own capitalised sentence, through memberText like every other line here (audit 2026-10-08:
 *  it printed "the last successful poll was 12 minutes ago. these forms could not be read...",
 *  lowercase, raw, and with a doubled full stop whenever a clause already ended in one). */
export function partialText(data) {
  return [data?.reason, data?.partial].filter(Boolean).map(memberSentence).filter(Boolean).join(' ')
}

export function emptyText(data, form, label) {
  const src = data.source ? ` (${memberText(data.source)})` : ''
  const why = data.reason ? `: ${memberText(data.reason)}` : ''
  if (data.state === 'pending') return `Pending${why}.${src}`
  if ((data.state === 'ok' || data.state === 'stale') && Array.isArray(data.rows)) {
    const what = form && form !== 'All' ? `${form === '4' ? 'Form 4' : form} filing` : 'filing in the forms this feed covers'
    const stale = data.state === 'stale' && data.reason ? ` Note: ${memberText(data.reason)}.` : ''
    return `None: no ${what} for ${label} among the most recent filings we fetched.${stale}${src}`
  }
  if (data.state === 'none_in_scope') return `None${why}.${src}`
  return `Unavailable${why}.${src}`
}

function Row({ r, showCompany, since }) {
  return (
    <tr data-testid={`filing-${r.accession}`}>
      <td>{r.form} <NewTag since={since} itemKey={filingKey(r)} /></td>
      {showCompany && <td>{r.ticker ? `${r.ticker} · ` : ''}{r.company}{r.filed_by ? ` (filed by ${r.filed_by})` : ''}</td>}
      <td>
        {r.items
          ? (r.items.length
              ? <div className={styles.items}>{r.items.map((it) => <span key={it.code}>{it.code} {it.label}</span>)}</div>
              : <span className={styles.gap}>{r.items_note}</span>)
          : <span className={styles.muted}>—</span>}
        {r.subject_note && <div className={styles.gap}>{r.subject_note}</div>}
      </td>
      <td>{when(r)}</td>
      <td><a className={styles.link} href={r.url} target="_blank" rel="noopener noreferrer">{r.accession}</a></td>
      <td className={styles.muted}>{r.source}</td>
    </tr>
  )
}

// `mine` (terminal `NVDA FEED MINE`, wave 3 lane 13): a third scope, the market feed narrowed to the
// member's own names (hooks/useMyTickers). Terminal-only: outside a panel the toggle has two scopes.
export default function FilingsFeedTab({ sym, mine = false }) {
  const s = (sym || '').toUpperCase().trim()
  const inPanel = useInTerminalPanel()
  const rerun = usePanelRerun()
  const [scope, setScopeState] = useState(inPanel && mine ? 'mine' : 'ticker')
  const myNames = useMyTickers({ enabled: scope === 'mine' })
  // Entering or leaving "Mine" is written into the command (`NVDA FEED MINE`) so a reload keeps it.
  const setScope = (next) => {
    if (rerun && (next === 'mine') !== (scope === 'mine')) rerun(`${s ? `${s} ` : ''}FEED${next === 'mine' ? ' MINE' : ''}`)
    else setScopeState(next)
  }
  const [form, setForm] = useState('All')
  const q = form === 'All' ? '' : `?form=${encodeURIComponent(form)}`
  const url = scope === 'ticker'
    ? (s ? `/api/research/filings-feed/${encodeURIComponent(s)}${q}` : null)
    : `/api/research/filings-feed${q}`
  const { data, error, mutate } = useSWR(url, sectionFetcher, {
    revalidateOnFocus: false,
    // live: re-read the cache every minute, every 5s while the server says pending
    refreshInterval: (d) => (d && d.state === 'pending' ? 5000 : 60000),
  })
  // TERM-019: name this panel's source (and its as-of) in the terminal panel header; a no-op elsewhere.
  usePanelFreshness(data && !data.paywalled && !error && data.source
    ? { source: memberText(data.source), age: { asOfDate: data.rows?.[0] && (data.rows[0].accepted || data.rows[0].filed) ? when(data.rows[0]) : null } }
    : null)

  const label = scope === 'ticker' ? s : scope === 'mine' ? 'your names' : 'the market'
  const rows = Array.isArray(data?.rows) && scope === 'mine' ? data.rows.filter((r) => myNames.has(r.ticker)) : data?.rows
  // Wave 3 #7: NEW since this member's last FEED visit -- per ticker, or one record for "Mine".
  // The whole-market scope is not marked (it is everyone's feed, not a list you follow).
  const since = useSinceLastVisit('FEED', scope === 'ticker' ? s : '',
    !error && data && !data.paywalled && Array.isArray(rows) ? rows.map(filingKey) : null,
    { enabled: scope !== 'market' && (scope !== 'mine' || myNames.state === 'ready') })
  let body
  if (error) {
    body = <div className={styles.note} data-testid="feed-unavailable">
      The filings feed is unavailable right now. That is a gap in what we could read, not a finding about {label}.{' '}<button type="button" className={styles.retry} onClick={() => mutate()}>Retry</button>
    </div>
  } else if (!data) {
    body = <div className={styles.note} role="status" data-testid="feed-loading">Loading filings…</div>
  } else if (data.paywalled) {
    body = <div className={styles.note}>The filings feed requires a paid plan.</div>
  } else if (scope === 'mine' && myNames.state !== 'ready' && myNames.state !== 'empty') {
    body = <MineEmpty state={myNames.state} explainer={myNames.explainer} testId="feed-mine-state" />
  } else if (scope === 'mine' && Array.isArray(data.rows) && data.rows.length && !rows.length) {
    body = <MineEmpty state="ready" what={`is among the ${data.rows.length} newest filings`} explainer={myNames.explainer} testId="feed-mine-empty" />
  } else if (!rows || rows.length === 0) {
    body = <div className={styles.gap} data-testid="feed-gap">{emptyText(data, form, label)}</div>
  } else {
    body = (
      <>
        {partialText(data) && <div className={styles.gap} data-testid="feed-partial">{partialText(data)}</div>}
        <SinceLine since={since} noun="filing" />
        <div className={styles.scroll}>
          <table className={styles.grid} data-testid="feed" aria-label={`Filings feed: ${label}`}>
            <thead><tr>
              <th scope="col">Form</th>{scope !== 'ticker' && <th scope="col">Company</th>}
              <th scope="col">8-K items</th><th scope="col">Accepted (ET)</th><th scope="col">Accession</th><th scope="col">Source</th>
            </tr></thead>
            <tbody>{rows.map((r) => <Row key={r.accession} r={r} showCompany={scope !== 'ticker'} since={since} />)}</tbody>
          </table>
        </div>
        <p className={styles.muted} data-testid="feed-source">
          {scope === 'ticker'
            ? `Source: ${memberText(data.source)}${data.merged_from_feed ? ` plus ${data.merged_from_feed} newer from the SEC latest-filings feed` : ''}.`
            : `Source: ${memberText(data.source)}, polled every ${data.poll_minutes} minutes.`}
        </p>
      </>
    )
  }

  return (
    <section className={styles.section} data-testid="filings-feed">
      <div className={styles.toggle}>
        {[['ticker', s || 'Ticker'], ...(inPanel ? [['mine', 'Mine']] : []), ['market', 'All market']].map(([k, l]) => (
          <button key={k} type="button" className={`${styles.toggleBtn} ${scope === k ? styles.toggleOn : ''}`}
            aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>
        ))}
      </div>
      <div className={styles.toggle}>
        {FORMS.map((f) => (
          <button key={f} type="button" className={`${styles.toggleBtn} ${form === f ? styles.toggleOn : ''}`}
            aria-pressed={form === f} onClick={() => setForm(f)}>{f === '4' ? 'Form 4' : f}</button>
        ))}
      </div>
      {body}
    </section>
  )
}
