import { useState } from 'react'
import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import styles from './ResearchCov.module.css'

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
export function emptyText(data, form, label) {
  const src = data.source ? ` (${data.source})` : ''
  const why = data.reason ? `: ${data.reason}` : ''
  if (data.state === 'pending') return `Pending${why}.${src}`
  if ((data.state === 'ok' || data.state === 'stale') && Array.isArray(data.rows)) {
    const what = form && form !== 'All' ? `${form === '4' ? 'Form 4' : form} filing` : 'filing in the forms this feed covers'
    const stale = data.state === 'stale' && data.reason ? ` Note: ${data.reason}.` : ''
    return `None: no ${what} for ${label} among the most recent filings we fetched.${stale}${src}`
  }
  if (data.state === 'none_in_scope') return `None${why}.${src}`
  return `Unavailable${why}.${src}`
}

function Row({ r, showCompany }) {
  return (
    <tr data-testid={`filing-${r.accession}`}>
      <td>{r.form}</td>
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

export default function FilingsFeedTab({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const [scope, setScope] = useState('ticker')
  const [form, setForm] = useState('All')
  const q = form === 'All' ? '' : `?form=${encodeURIComponent(form)}`
  const url = scope === 'ticker'
    ? (s ? `/api/research/filings-feed/${encodeURIComponent(s)}${q}` : null)
    : `/api/research/filings-feed${q}`
  const { data, error } = useSWR(url, sectionFetcher, {
    revalidateOnFocus: false,
    // live: re-read the cache every minute, every 5s while the server says pending
    refreshInterval: (d) => (d && d.state === 'pending' ? 5000 : 60000),
  })

  const label = scope === 'ticker' ? s : 'the market'
  let body
  if (error) {
    body = <div className={styles.note} data-testid="feed-unavailable">
      The filings feed is unavailable right now. That is a gap in what we could read, not a finding about {label}.
    </div>
  } else if (!data) {
    body = <div className={styles.note}>Loading filings…</div>
  } else if (data.paywalled) {
    body = <div className={styles.note}>The filings feed requires a paid plan.</div>
  } else if (!data.rows || data.rows.length === 0) {
    body = <div className={styles.gap} data-testid="feed-gap">{emptyText(data, form, label)}</div>
  } else {
    body = (
      <>
        {(data.reason || data.partial) && <div className={styles.gap} data-testid="feed-partial">{[data.reason, data.partial].filter(Boolean).join('. ')}.</div>}
        <div className={styles.scroll}>
          <table className={styles.grid} data-testid="feed">
            <thead><tr>
              <th scope="col">Form</th>{scope === 'market' && <th scope="col">Company</th>}
              <th scope="col">8-K items</th><th scope="col">Accepted (ET)</th><th scope="col">Accession</th><th scope="col">Source</th>
            </tr></thead>
            <tbody>{data.rows.map((r) => <Row key={r.accession} r={r} showCompany={scope === 'market'} />)}</tbody>
          </table>
        </div>
        <p className={styles.muted} data-testid="feed-source">
          {scope === 'ticker'
            ? `Source: ${data.source}${data.merged_from_feed ? ` plus ${data.merged_from_feed} newer from the SEC latest-filings feed` : ''}.`
            : `Source: ${data.source}, polled every ${data.poll_minutes} minutes.`}
        </p>
      </>
    )
  }

  return (
    <section className={styles.section} data-testid="filings-feed">
      <div className={styles.toggle}>
        {[['ticker', s || 'Ticker'], ['market', 'All market']].map(([k, l]) => (
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
