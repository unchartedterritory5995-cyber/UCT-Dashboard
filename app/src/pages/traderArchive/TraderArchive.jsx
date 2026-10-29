// app/src/pages/traderArchive/TraderArchive.jsx
//
// The Desk → Archive: the TSDR trader archive for paid members (owner ruling 2026-10-15; moved
// into The Desk and redesigned as cards 2026-10-28). Three views and one search box over
// GET /api/wisdom/archive/* (require_paid, WISDOM_ARCHIVE_ENABLED):
//   Today     — today's scanner hits that rhyme with a team setup
//   Playbooks — a setup's measured record, where it worked, the traders' teachings, best/worst calls
//   Traders   — one trader's recent calls and posts
//   Search    — a ticker (its calls and posts) and/or words across every post
//
// The view lives in the URL (?view, ?q / ?sym, ?setup, ?trader) so every door into the archive
// (archiveHref in utils/traderArchive.js) deep-links, and Back steps through what was opened.
//
// ⛔ THE SERVER IS THE ONE AUTHORITY for every list, count and trader name on this page.
// The trader picker comes from /stats and the playbook picker from /playbooks; nothing here
// restates any roster.
// ⛔ A 404 means the archive is switched off and a 402 means no paid plan — both are said as
// such, never rendered as "nothing found".
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import useSWR from 'swr'

import jsonFetcher from '../../utils/jsonFetcher'
import UIcon from '../../components/ui/UIcon'
import { ARCHIVE_API, EDGE_Z, MIN_CONTEXT_N } from '../../utils/traderArchive'
import {
  Avatar, CallGrid, Outcome, PostFeed, SWR_OPTS, SectionTitle, StatTile, StateLine, pct0,
} from './archiveUi'
import PlaybookCharts from './PlaybookCharts'
import TodayRhymes from './TodayRhymes'
import styles from './TraderArchive.module.css'

const VIEWS = [
  { key: 'today', label: 'Today', icon: 'flame' },
  { key: 'playbooks', label: 'Playbooks', icon: 'book' },
  { key: 'traders', label: 'Traders', icon: 'community' },
]
const VIEW_KEYS = new Set([...VIEWS.map((v) => v.key), 'search'])

// A term that could be a symbol is looked up as one AND searched as words: RS, GAP and PEG are
// real tickers and real setup words, so neither reading is allowed to hide the other.
const TICKER_SHAPED = /^[A-Za-z]{1,5}([.-][A-Za-z])?$/

/** The page's state, read from and written to the URL (the Desk keeps ?section). */
function useArchiveParams() {
  const [params, setParams] = useSearchParams()
  const term = (params.get('q') || params.get('sym') || '').trim()
  const setup = (params.get('setup') || '').toLowerCase().trim()
  const trader = (params.get('trader') || '').trim()
  const asked = params.get('view')
  const view = VIEW_KEYS.has(asked) ? asked : term ? 'search' : setup ? 'playbooks' : 'today'
  const go = (patch) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next)
  }
  return { view, term, setup, trader, go }
}

function SearchBox({ term, onSearch }) {
  const [input, setInput] = useState(term)
  useEffect(() => { setInput(term) }, [term])
  return (
    <form className={styles.search} role="search" onSubmit={(e) => { e.preventDefault(); onSearch(input.trim()) }}>
      <UIcon name="search" size={15} />
      <input className={styles.searchInput} aria-label="Search the archive" value={input}
        onChange={(e) => setInput(e.target.value)} placeholder="Search a ticker or a setup…" />
      <button type="submit" className={styles.searchBtn}>Search</button>
    </form>
  )
}

function SearchView({ term, onTicker }) {
  const sym = TICKER_SHAPED.test(term) ? term.toUpperCase() : ''
  const { data: tick, error: tickError } = useSWR(sym ? `${ARCHIVE_API}/ticker/${encodeURIComponent(sym)}` : null, jsonFetcher, SWR_OPTS)
  const { data: words, error: wordsError } = useSWR(term ? `${ARCHIVE_API}/search?q=${encodeURIComponent(term)}` : null, jsonFetcher, SWR_OPTS)
  const posts = useMemo(() => [...(tick?.records || [])].reverse(), [tick])
  const calls = useMemo(() => [...(tick?.calls || [])].reverse(), [tick])
  const tickerHas = posts.length > 0 || calls.length > 0
  if (!term) return <p className={styles.empty}>Type a ticker like NVDA, or words like &ldquo;flag breakout&rdquo;.</p>
  return (
    <div data-testid="ta-search">
      {sym && tickError && tickError.status !== 404 && <StateLine error={tickError} what={`the archive for ${sym}`} />}
      {sym && !tick && !tickError && <p className={styles.loading}>Looking up {sym}…</p>}
      {tickerHas && (
        <section>
          <div className={styles.profileHead}>
            <span className={styles.bigTicker}>{tick.ticker}</span>
            <div className={styles.tiles} data-testid="ta-ticker-summary">
              <StatTile label="calls">{calls.length}</StatTile>
              <StatTile label="posts">{posts.length}</StatTile>
              <StatTile label="avg 20-day result"><Outcome value={tick.mean_r20} /></StatTile>
            </div>
          </div>
          <SectionTitle count={calls.length}>Calls on {tick.ticker}, newest first</SectionTitle>
          <CallGrid calls={calls} empty={`No calls on ${tick.ticker}.`} />
          <SectionTitle count={posts.length}>Posts about {tick.ticker}</SectionTitle>
          <PostFeed posts={posts} empty={`No post names ${tick.ticker}.`} onTicker={onTicker} />
        </section>
      )}
      {!tickerHas && (sym ? !!(tick || tickError) : true) && (
        <section>
          <SectionTitle count={words?.hits?.length}>Posts that mention &ldquo;{term}&rdquo;</SectionTitle>
          {wordsError && <StateLine error={wordsError} what="search results" />}
          {!words && !wordsError && <p className={styles.loading}>Searching…</p>}
          {words && <PostFeed posts={words.hits || []} empty="Nothing in the archive matches that." onTicker={onTicker} />}
        </section>
      )}
    </div>
  )
}

function TradersView({ stats, author, onPick, onTicker }) {
  const traders = stats?.traders || {}
  const { data, error } = useSWR(author ? `${ARCHIVE_API}/trader/${encodeURIComponent(author)}` : null, jsonFetcher, SWR_OPTS)
  if (!author) {
    return (
      <ul className={styles.pickGrid} aria-label="Traders">
        {Object.entries(traders).map(([slug, name]) => (
          <li key={slug}>
            <button type="button" className={styles.pickCard} onClick={() => onPick(slug)}>
              <Avatar name={name} />
              <span className={styles.pickName}>{name}</span>
              <span className={styles.pickMeta}>
                {stats.calls_by_author?.[slug] ?? 0} calls · {stats.records_by_author?.[slug] ?? 0} posts
              </span>
            </button>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <div>
      <button type="button" className={styles.back} onClick={() => onPick('')}>← All traders</button>
      {error && <StateLine error={error} what="this trader" />}
      {!error && !data && <p className={styles.loading}>Loading…</p>}
      {data && (
        <>
          <div className={styles.profileHead}>
            <Avatar name={data.trader || data.author} />
            <h2 className={styles.subheading}>{data.trader || data.author}</h2>
            <div className={styles.tiles} data-testid="ta-trader-summary">
              <StatTile label="calls">{data.n_calls}</StatTile>
              <StatTile label="posts">{data.n_records}</StatTile>
              <StatTile label="avg 20-day result"><Outcome value={data.mean_r20} /></StatTile>
            </div>
          </div>
          <SectionTitle count={(data.calls || []).length}>Recent calls</SectionTitle>
          <CallGrid calls={data.calls || []} empty="No calls yet." />
          <SectionTitle count={(data.records || []).length}>Recent posts</SectionTitle>
          <PostFeed posts={data.records || []} empty="No posts yet." onTicker={onTicker} />
        </>
      )}
    </div>
  )
}

/** Plain-words verdict: an edge is called proven at |z| >= EDGE_Z on >= MIN_CONTEXT_N calls. */
function verdictOf(st) {
  if (!st?.n_scored) return { label: 'No scored calls yet', proven: false, z: null }
  const z = st.edgeR_z ?? null
  const proven = z !== null && Math.abs(z) >= EDGE_Z && st.n_scored >= MIN_CONTEXT_N
  return { label: proven ? 'Proven edge' : 'Not proven yet', proven, z }
}

const fmtEdge = (v) => (v === null || v === undefined ? '—' : `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)}`)

function NumbersRow({ label, st }) {
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

const CUTS_SHOWN = 5

function PlaybookDetail({ setup, onBack }) {
  const { data, error } = useSWR(`${ARCHIVE_API}/playbook/${encodeURIComponent(setup)}`, jsonFetcher, SWR_OPTS)
  const [allCuts, setAllCuts] = useState(false)
  const cuts = useMemo(() => {
    const out = []
    for (const [group, rows] of Object.entries(data?.context || {})) {
      for (const [value, st] of Object.entries(rows || {})) {
        if ((st?.n_scored ?? 0) >= MIN_CONTEXT_N) out.push({ group: group.replace(/_/g, ' '), value, st })
      }
    }
    return out.sort((a, b) => (b.st.mean_edgeR ?? -99) - (a.st.mean_edgeR ?? -99))
  }, [data])
  const all = data?.stats?.all
  const v = verdictOf(all)
  return (
    <div>
      <button type="button" className={styles.back} onClick={onBack}>← All playbooks</button>
      {error && <StateLine error={error} what="this playbook" />}
      {!error && !data && <p className={styles.loading}>Loading the playbook…</p>}
      {data && (
        <div data-testid="ta-playbook">
          <div className={styles.pbHero}>
            <div>
              <h2 className={styles.subheading}>{data.name}</h2>
              <p className={styles.pbMeta}>
                {(data.aliases || []).length > 0 && <>Also called {data.aliases.join(', ')}. </>}
                {(data.used_by || []).length > 0 && <>Used by {data.used_by.map((u) => u.trader || u.author).join(', ')}.</>}
              </p>
            </div>
            <span className={v.proven ? `${styles.verdict} ${styles.verdictOn}` : styles.verdict}
              data-testid="ta-playbook-verdict" title={v.z !== null ? `z ${v.z}` : undefined}>
              {v.label}
            </span>
          </div>
          <div className={styles.tiles}>
            <StatTile label="calls scored">{all?.n_scored ?? 0}</StatTile>
            <StatTile label="worked after 20 days">{pct0(all?.win20)}</StatTile>
            <StatTile label="typical 20-day move"><Outcome value={all?.med_r20} /></StatTile>
            <StatTile label="vs. the stock on a random day"><Outcome value={all?.med_edge20} /></StatTile>
          </div>

          <SectionTitle>Where it worked best</SectionTitle>
          {cuts.length === 0 ? <p className={styles.empty}>No market context has enough scored calls yet.</p> : (
            <ul className={styles.bars}>
              {(allCuts ? cuts : cuts.slice(0, CUTS_SHOWN)).map((c) => (
                <li key={`${c.group}:${c.value}`} className={styles.barRow}>
                  <span className={styles.barLabel}>{c.group}: {c.value}</span>
                  <span className={styles.barTrack} aria-hidden="true">
                    <span className={styles.barFill} style={{ width: `${Math.round((c.st.win20 ?? 0) * 100)}%` }} />
                  </span>
                  <span className={styles.barValue}>{pct0(c.st.win20)} worked</span>
                  <span className={styles.barN}>{c.st.n_scored} calls</span>
                </li>
              ))}
            </ul>
          )}
          {cuts.length > CUTS_SHOWN && (
            <button type="button" className={styles.linkBtn} onClick={() => setAllCuts((x) => !x)}>
              {allCuts ? 'Show fewer' : `Show all ${cuts.length}`}
            </button>
          )}

          <SectionTitle count={(data.winners || []).length}>Best calls</SectionTitle>
          <CallGrid calls={data.winners || []} empty="None recorded." />
          <SectionTitle count={(data.failures || []).length}>When it failed</SectionTitle>
          <CallGrid calls={data.failures || []} empty="None recorded." />
          <PlaybookCharts winners={data.winners || []} failures={data.failures || []} lines={data.lines || null} />

          {(data.teachings || []).length > 0 && (
            <>
              <SectionTitle count={data.teachings.length}>In the traders&apos; words</SectionTitle>
              <PostFeed posts={data.teachings} empty="" />
            </>
          )}

          <details className={styles.numbers}>
            <summary>The full numbers</summary>
            <p className={styles.fine}>
              &ldquo;vs. the stock&rdquo; is the call&apos;s 20-day result minus the same stock on a random day.
              Edge R is the trade result in risk units, capped at −1 to +10. An edge is called proven at
              |z| ≥ {EDGE_Z} on at least {MIN_CONTEXT_N} calls{v.z !== null ? ` (this one: z ${v.z})` : ''}.
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th></th><th>Scored</th><th>Worked 20d</th><th>Median 20d</th><th>vs stock</th><th>Edge R</th></tr></thead>
                <tbody>
                  <NumbersRow label="All calls" st={all} />
                  <NumbersRow label="Entries, ideas, adds" st={data.stats?.trades} />
                  {cuts.map((c) => <NumbersRow key={`n:${c.group}:${c.value}`} label={`${c.group}: ${c.value}`} st={c.st} />)}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

function PlaybooksView({ setup, onPick }) {
  const { data: index, error } = useSWR(`${ARCHIVE_API}/playbooks`, jsonFetcher, SWR_OPTS)
  if (setup) return <PlaybookDetail setup={setup} onBack={() => onPick('')} />
  if (error) return <StateLine error={error} what="the setup playbooks" />
  if (!index) return <p className={styles.loading}>Loading the playbooks…</p>
  const setups = [...(index.setups || [])].sort((a, b) => (b.n ?? 0) - (a.n ?? 0))
  if (!setups.length) return <p className={styles.empty}>No playbooks yet.</p>
  return (
    <ul className={styles.pickGrid} aria-label="Playbooks">
      {setups.map((s) => (
        <li key={s.setup_id}>
          <button type="button" className={styles.pickCard} onClick={() => onPick(s.setup_id)}>
            <span className={styles.pickName}>{s.name}</span>
            <span className={styles.pickMeta}>{s.n ?? 0} calls</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default function TraderArchive() {
  const { view, term, setup, trader, go } = useArchiveParams()
  const { data: stats, error } = useSWR(`${ARCHIVE_API}/stats`, jsonFetcher, SWR_OPTS)
  const search = (q) => go({ view: q ? 'search' : 'today', q, sym: '' })
  const openTicker = (t) => go({ view: 'search', q: t, sym: '' })

  return (
    <section className={styles.page} data-testid="trader-archive-page">
      <header className={styles.head}>
        <div className={styles.headMain}>
          <span className={styles.headIcon}><UIcon name="quote" size={22} /></span>
          <div>
            <div className={styles.eyebrow}>From the team</div>
            <h2 className={styles.heading}>Trader Archive</h2>
            <p className={styles.lede}>
              {stats ? `${stats.calls.toLocaleString()} calls and ${stats.records.toLocaleString()} posts` : 'Calls and posts'} from
              the UCT trading team, each scored by how the stock did afterwards.
            </p>
          </div>
        </div>
      </header>
      {error && <StateLine error={error} what="the trader archive" />}
      {!error && !stats && <p className={styles.loading}>Loading the archive…</p>}
      {stats && (
        <>
          <div className={styles.bar}>
            <div className={styles.views} role="tablist" aria-label="Archive view">
              {VIEWS.map((v) => (
                <button key={v.key} type="button" role="tab" aria-selected={view === v.key}
                  className={view === v.key ? `${styles.view} ${styles.viewOn}` : styles.view}
                  onClick={() => go({ view: v.key })}>
                  <UIcon name={v.icon} size={14} /> {v.label}
                </button>
              ))}
            </div>
            <SearchBox term={view === 'search' ? term : ''} onSearch={search} />
          </div>
          <div className={styles.body}>
            {view === 'today' && <TodayRhymes onTicker={openTicker} onSetup={(s) => go({ view: 'playbooks', setup: s })} />}
            {view === 'playbooks' && <PlaybooksView setup={setup} onPick={(s) => go({ view: 'playbooks', setup: s })} />}
            {view === 'traders' && <TradersView stats={stats} author={trader} onPick={(a) => go({ view: 'traders', trader: a })} onTicker={openTicker} />}
            {view === 'search' && <SearchView term={term} onTicker={openTicker} />}
          </div>
          <p className={styles.fine}>Results are measured after the fact. Nothing here is a recommendation.</p>
        </>
      )}
    </section>
  )
}

