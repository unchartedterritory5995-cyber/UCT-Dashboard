// app/src/pages/traderArchive/TraderArchive.jsx
//
// /trader-archive — the TSDR trader archive for paid members (owner ruling 2026-10-15).
// Five views over GET /api/wisdom/archive/* (require_paid, WISDOM_ARCHIVE_ENABLED):
// search, ticker lookup, setup browser (best/worst by r20), a per-trader view and the setup
// playbooks (definition, measured record, the contexts it worked in, the traders' teachings).
//
// ⛔ THE SERVER IS THE ONE AUTHORITY for every list, count and trader name on this page.
// The setup and trader pickers come from /stats and the playbook picker from /playbooks;
// nothing here restates any roster.
// ⛔ A 404 means the archive is switched off and a 402 means no paid plan — both are said
// as such, never rendered as "nothing found".
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import useSWR from 'swr'

import jsonFetcher from '../../utils/jsonFetcher'
import UIcon from '../../components/ui/UIcon'
import { ARCHIVE_API, MIN_CONTEXT_N, clip, dayOf, edgeVerdict, fmtR, rTone, traderOf } from '../../utils/traderArchive'
import PlaybookCharts from './PlaybookCharts'
import ArchiveThumbs from './ArchiveThumbs'
import TodayRhymes from './TodayRhymes'
import styles from './TraderArchive.module.css'

const VIEWS = [
  { key: 'search', label: 'Search' },
  { key: 'ticker', label: 'Ticker' },
  { key: 'setups', label: 'Setups' },
  { key: 'traders', label: 'Traders' },
  { key: 'playbooks', label: 'Playbooks' },
  { key: 'today', label: 'Today' },
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
          <ArchiveThumbs ids={r.images} />
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

const pct0 = (v) => (v === null || v === undefined ? '—' : `${Math.round(Number(v) * 100)}%`)
const fmtEdge = (v) => (v === null || v === undefined ? '—' : `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)}`)

const verdictOf = edgeVerdict

function StatsRow({ label, st }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{st?.n_scored ?? 0}</td>
      <td>{pct0(st?.win20)}</td>
      <td><Outcome value={st?.med_r20} /></td>
      <td><Outcome value={st?.med_edge20} /></td>
      <td>{fmtEdge(st?.mean_edgeR)}</td>
    </tr>
  )
}

function PlaybookView({ initial = '' }) {
  const { data: index, error: indexError } = useSWR(`${ARCHIVE_API}/playbooks`, jsonFetcher, SWR_OPTS)
  const [setup, setSetup] = useState(initial)
  const { data, error } = useSWR(setup ? `${ARCHIVE_API}/playbook/${encodeURIComponent(setup)}` : null, jsonFetcher, SWR_OPTS)
  const cuts = useMemo(() => {
    const out = []
    for (const [group, rows] of Object.entries(data?.context || {})) {
      for (const [value, st] of Object.entries(rows || {})) {
        if ((st?.n_scored ?? 0) >= MIN_CONTEXT_N) out.push({ group: group.replace(/_/g, ' '), value, st })
      }
    }
    return out.sort((a, b) => (b.st.mean_edgeR ?? -99) - (a.st.mean_edgeR ?? -99))
  }, [data])
  if (indexError) return <StateLine error={indexError} what="the setup playbooks" />
  if (!index) return <p className={styles.loading}>Loading the playbooks…</p>
  const all = data?.stats?.all
  return (
    <div>
      <div className={styles.form}>
        <label className={styles.label} htmlFor="ta-playbook">Playbook</label>
        <select id="ta-playbook" className={styles.input} value={setup} onChange={(e) => setSetup(e.target.value)}>
          <option value="">Pick a setup…</option>
          {(index.setups || []).map((s) => <option key={s.setup_id} value={s.setup_id}>{s.name} ({s.n ?? 0})</option>)}
        </select>
      </div>
      {setup && error && <StateLine error={error} what="this playbook" />}
      {setup && !error && !data && <p className={styles.loading}>Loading the playbook…</p>}
      {data && (
        <div data-testid="ta-playbook">
          <h2 className={styles.subheading}>{data.name}</h2>
          <p className={styles.summary}>
            {(data.aliases || []).length > 0 && <>Also called {data.aliases.join(', ')}. </>}
            {(data.used_by || []).length > 0 && <>Used by {data.used_by.map((u) => u.trader || u.author).join(', ')}.</>}
          </p>
          <p className={styles.summary} data-testid="ta-playbook-verdict">
            {all?.n_scored ?? 0} scored calls · {verdictOf(all)}. Edge is the call&apos;s result minus the same
            stock on a random day; trade R is capped at −1 to +10.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th></th><th>Scored</th><th>Win 20d</th><th>Median 20d</th><th>vs same stock</th><th>Edge R</th></tr></thead>
              <tbody>
                <StatsRow label="All calls" st={all} />
                <StatsRow label="Entries, ideas, adds" st={data.stats?.trades} />
              </tbody>
            </table>
          </div>
          <h3 className={styles.h3}>When it worked, by context (at least {MIN_CONTEXT_N} scored calls)</h3>
          {cuts.length === 0 ? <p className={styles.empty}>No context has enough scored calls yet.</p> : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Context</th><th>Scored</th><th>Win 20d</th><th>Median 20d</th><th>vs same stock</th><th>Edge R</th></tr></thead>
                <tbody>{cuts.map((c) => <StatsRow key={`${c.group}:${c.value}`} label={`${c.group}: ${c.value}`} st={c.st} />)}</tbody>
              </table>
            </div>
          )}
          <h3 className={styles.h3}>Teachings, in the traders&apos; posts</h3>
          {(data.teachings || []).length === 0 ? <p className={styles.empty}>No teaching names this setup.</p> : (
            <ul className={styles.list}>
              {data.teachings.map((t) => (
                <li key={t.record_id} className={styles.item}>
                  <div className={styles.meta}>
                    <span className={styles.trader}>{traderOf(t)}</span>
                    <span className={styles.date}>{dayOf(t.date)}</span>
                    <span className={styles.kind}>{t.record_id}</span>
                  </div>
                  {t.note && <p className={styles.note}>{t.note}</p>}
                  <ArchiveThumbs ids={t.images} />
                </li>
              ))}
            </ul>
          )}
          <h3 className={styles.h3}>Best calls</h3>
          <ExampleTable rows={data.winners || []} />
          <h3 className={styles.h3}>Failures</h3>
          <ExampleTable rows={data.failures || []} />
          <PlaybookCharts winners={data.winners || []} failures={data.failures || []} />
        </div>
      )}
    </div>
  )
}

function ExampleTable({ rows }) {
  if (!rows.length) return <p className={styles.empty}>None recorded.</p>
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>Posted</th><th>Ticker</th><th>Trader</th><th>Dir</th><th>Trade R</th><th>R20</th><th>Market</th><th>In their words</th><th>Chart</th></tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.call_id}>
              <td>{dayOf(e.posted)}</td>
              <td>{e.ticker}</td>
              <td>{traderOf(e)}</td>
              <td>{e.direction || '—'}</td>
              <td>{fmtEdge(e.sim_R)}</td>
              <td><Outcome value={e.r20} /></td>
              <td>{e.regime || '—'}</td>
              <td className={styles.noteCell}>{clip(e.evidence, 160)}</td>
              <td><ArchiveThumbs ids={e.images} max={1} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function TraderArchive() {
  const [params] = useSearchParams()
  const initialSym = (params.get('sym') || '').toUpperCase().trim()
  const initialSetup = (params.get('setup') || '').toLowerCase().trim()
  const askedView = params.get('view')
  // ?view=playbooks&setup=kicker is the pattern side panel's "Open the full playbook" link.
  const [view, setView] = useState(VIEWS.some((v) => v.key === askedView) ? askedView : (initialSym ? 'ticker' : 'search'))
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
          {view === 'playbooks' && <PlaybookView initial={initialSetup} />}
          {view === 'today' && <TodayRhymes />}
        </>
      )}
    </div>
  )
}
