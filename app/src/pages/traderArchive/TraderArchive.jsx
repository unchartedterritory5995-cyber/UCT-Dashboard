// app/src/pages/traderArchive/TraderArchive.jsx
//
// /trader-archive — the TSDR trader archive for paid members (owner ruling 2026-10-15).
// Four views over GET /api/wisdom/archive/* (require_paid, WISDOM_ARCHIVE_ENABLED):
// search, ticker lookup, setup browser (best/worst by r20) and a per-trader view.
//
// ⛔ THE SERVER IS THE ONE AUTHORITY for every list, count and trader name on this page.
// The setup and trader pickers come from /stats; nothing here restates either roster.
// ⛔ A 404 means the archive is switched off and a 402 means no paid plan — both are said
// as such, never rendered as "nothing found".
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import useSWR from 'swr'

import jsonFetcher from '../../utils/jsonFetcher'
import UIcon from '../../components/ui/UIcon'
import { ARCHIVE_API, clip, dayOf, fmtR, rTone, traderOf } from '../../utils/traderArchive'
import styles from './TraderArchive.module.css'

const VIEWS = [
  { key: 'search', label: 'Search' },
  { key: 'ticker', label: 'Ticker' },
  { key: 'setups', label: 'Setups' },
  { key: 'traders', label: 'Traders' },
]

const SWR_OPTS = { revalidateOnFocus: false, shouldRetryOnError: false }

function StateLine({ error, what }) {
  if (error?.status === 404) {
    return <p className={styles.notice} data-testid="archive-off">The trader archive isn&apos;t available yet.</p>
  }
  if (error?.status === 402) {
    return <p className={styles.notice} data-testid="archive-paywall">The trader archive is part of the paid plan.</p>
  }
  return <p className={styles.notice}>Couldn&apos;t load {what}. Try again in a moment.</p>
}

function Outcome({ value }) {
  const tone = rTone(value)
  return <span className={tone === 'up' ? styles.up : tone === 'down' ? styles.down : undefined}>{fmtR(value)}</span>
}

function RecordList({ records, empty }) {
  if (!records.length) return <p className={styles.empty}>{empty}</p>
  return (
    <ul className={styles.list}>
      {records.map((r) => (
        <li key={r.record_id} className={styles.item}>
          <div className={styles.meta}>
            <span className={styles.trader}>{traderOf(r)}</span>
            <span className={styles.date}>{dayOf(r.stated_date)}</span>
            <span className={styles.kind}>{r.record_type}</span>
            {(r.tickers || []).length > 0 && <span className={styles.tickers}>{r.tickers.join(' · ')}</span>}
          </div>
          {r.note && <p className={styles.note}>{r.note}</p>}
          {r.quote && <blockquote className={styles.quote}>{clip(r.quote, 600)}</blockquote>}
        </li>
      ))}
    </ul>
  )
}

function CallTable({ calls, empty, withNote = false }) {
  if (!calls.length) return <p className={styles.empty}>{empty}</p>
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Posted</th><th>Ticker</th><th>Trader</th><th>Dir</th><th>Setup</th><th>Entry</th><th>Stop</th>
            <th>R5</th><th>R20</th><th>R60</th>{withNote && <th>Note</th>}
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr key={c.call_id}>
              <td>{dayOf(c.posted)}</td>
              <td>{c.ticker}</td>
              <td>{traderOf(c)}</td>
              <td>{c.direction || '—'}</td>
              <td>{c.setup || '—'}</td>
              <td>{c.entry ?? '—'}</td>
              <td>{c.stop ?? '—'}</td>
              <td><Outcome value={c.outcome?.r5} /></td>
              <td><Outcome value={c.outcome?.r20} /></td>
              <td><Outcome value={c.outcome?.r60} /></td>
              {withNote && <td className={styles.noteCell}>{clip(c.record_note, 160)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SearchView() {
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const { data, error } = useSWR(q ? `${ARCHIVE_API}/search?q=${encodeURIComponent(q)}` : null, jsonFetcher, SWR_OPTS)
  return (
    <div>
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); setQ(input.trim()) }}>
        <label className={styles.label} htmlFor="ta-search">Search posts</label>
        <input id="ta-search" className={styles.input} value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="words, a setup, a ticker" />
        <button type="submit" className={styles.button}><UIcon name="search" size={14} /> Search</button>
      </form>
      {q && error && <StateLine error={error} what="search results" />}
      {q && !error && !data && <p className={styles.loading}>Searching…</p>}
      {data && <RecordList records={data.hits || []} empty="No post matches." />}
    </div>
  )
}

function TickerView({ initial }) {
  const [input, setInput] = useState(initial || '')
  const [sym, setSym] = useState(initial || '')
  const { data, error } = useSWR(sym ? `${ARCHIVE_API}/ticker/${encodeURIComponent(sym)}` : null, jsonFetcher, SWR_OPTS)
  const records = useMemo(() => [...(data?.records || [])].reverse(), [data])
  return (
    <div>
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); setSym(input.trim().toUpperCase()) }}>
        <label className={styles.label} htmlFor="ta-ticker">Ticker</label>
        <input id="ta-ticker" className={styles.input} value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. NVDA" />
        <button type="submit" className={styles.button}><UIcon name="search" size={14} /> Look up</button>
      </form>
      {sym && error && <StateLine error={error} what={`the archive for ${sym}`} />}
      {sym && !error && !data && <p className={styles.loading}>Loading {sym}…</p>}
      {data && (
        <div>
          <h2 className={styles.subheading}>{data.ticker}</h2>
          <p className={styles.summary} data-testid="ta-ticker-summary">
            {data.records.length} posts · {data.calls.length} calls · {data.n_scored ?? 0} scored · mean r20 {fmtR(data.mean_r20)}
          </p>
          <h3 className={styles.h3}>Posts, newest first</h3>
          <RecordList records={records} empty="No post names this ticker." />
          <h3 className={styles.h3}>Calls, oldest first</h3>
          <CallTable calls={data.calls || []} empty="No calls on this ticker." />
        </div>
      )}
    </div>
  )
}

function SetupsView({ stats }) {
  const setups = useMemo(() => Object.keys(stats?.calls_by_setup || {}).filter((s) => s !== '(none)'), [stats])
  const [setup, setSetup] = useState('')
  const { data, error } = useSWR(setup ? `${ARCHIVE_API}/setup/${encodeURIComponent(setup)}` : null, jsonFetcher, SWR_OPTS)
  return (
    <div>
      <div className={styles.form}>
        <label className={styles.label} htmlFor="ta-setup">Setup</label>
        <select id="ta-setup" className={styles.input} value={setup} onChange={(e) => setSetup(e.target.value)}>
          <option value="">Pick a setup…</option>
          {setups.map((s) => <option key={s} value={s}>{s} ({stats.calls_by_setup[s]})</option>)}
        </select>
      </div>
      {setup && error && <StateLine error={error} what={`setup ${setup}`} />}
      {setup && !error && !data && <p className={styles.loading}>Loading {setup}…</p>}
      {data && (
        <div>
          <p className={styles.summary}>
            {data.setup}: {data.n_calls} calls, {data.n_scored} scored · mean r20 {fmtR(data.mean_r20)}
          </p>
          <h3 className={styles.h3}>Best by r20</h3>
          <CallTable calls={data.best || []} empty="No scored calls." withNote />
          <h3 className={styles.h3}>Worst by r20</h3>
          <CallTable calls={data.worst || []} empty="No scored calls." withNote />
        </div>
      )}
    </div>
  )
}

function TradersView({ stats }) {
  const traders = stats?.traders || {}
  const [author, setAuthor] = useState('')
  const { data, error } = useSWR(author ? `${ARCHIVE_API}/trader/${encodeURIComponent(author)}` : null, jsonFetcher, SWR_OPTS)
  return (
    <div>
      <div className={styles.chips} role="group" aria-label="Trader">
        {Object.entries(traders).map(([slug, name]) => (
          <button key={slug} type="button" aria-pressed={author === slug}
            className={author === slug ? `${styles.chip} ${styles.chipOn}` : styles.chip}
            onClick={() => setAuthor(slug)}>
            {name} <span className={styles.count}>{stats.records_by_author?.[slug] ?? 0}</span>
          </button>
        ))}
      </div>
      {author && error && <StateLine error={error} what="this trader" />}
      {author && !error && !data && <p className={styles.loading}>Loading…</p>}
      {data && (
        <div>
          <h2 className={styles.subheading}>{data.trader || data.author}</h2>
          <p className={styles.summary} data-testid="ta-trader-summary">
            {data.n_records} posts · {data.n_calls} calls · {data.n_scored} scored · mean r20 {fmtR(data.mean_r20)}
          </p>
          <h3 className={styles.h3}>Recent posts</h3>
          <RecordList records={data.records || []} empty="No posts." />
          <h3 className={styles.h3}>Recent calls</h3>
          <CallTable calls={data.calls || []} empty="No calls." />
        </div>
      )}
    </div>
  )
}

export default function TraderArchive() {
  const [params] = useSearchParams()
  const initialSym = (params.get('sym') || '').toUpperCase().trim()
  const [view, setView] = useState(initialSym ? 'ticker' : 'search')
  const { data: stats, error } = useSWR(`${ARCHIVE_API}/stats`, jsonFetcher, SWR_OPTS)

  return (
    <div className={styles.page} data-testid="trader-archive-page">
      <h1 className={styles.heading}>Trader Archive</h1>
      <p className={styles.lede}>
        Dated posts, lessons and scored calls from the UCT trading team. Outcomes are measured after
        the fact (r20 = return 20 sessions later); nothing here is current advice.
      </p>
      {error && <StateLine error={error} what="the trader archive" />}
      {!error && !stats && <p className={styles.loading}>Loading the archive…</p>}
      {stats && (
        <>
          <p className={styles.summary} data-testid="ta-stats">{stats.records} posts · {stats.calls} calls</p>
          <div className={styles.tabs} role="tablist" aria-label="Archive view">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" role="tab" aria-selected={view === v.key}
                className={view === v.key ? `${styles.tab} ${styles.tabOn}` : styles.tab}
                onClick={() => setView(v.key)}>{v.label}</button>
            ))}
          </div>
          {view === 'search' && <SearchView />}
          {view === 'ticker' && <TickerView initial={initialSym} />}
          {view === 'setups' && <SetupsView stats={stats} />}
          {view === 'traders' && <TradersView stats={stats} />}
        </>
      )}
    </div>
  )
}
