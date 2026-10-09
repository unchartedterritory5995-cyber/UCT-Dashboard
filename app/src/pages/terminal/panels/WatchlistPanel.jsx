// MON (and bare `W`) — the member's watchlists as one dense, live table (lane 9, top-10 #5).
//
//   MON / W          your first list            MON 2 / W 2   your second list
//   MON W:ab12       that watchlist by address  MON FLAGGED   your flagged names
//
// ⭐ NO NEW ROUTE AND NO PER-ROW READ. The lists are `GET /api/watchlists?include_prebuilt=0`
// (your OWN lists; the admin-owned index lists are not "your names") plus
// `GET /api/watchlists/flagged`. Prices come from the shared live-price store (one 2 s poll of the
// union of every panel's names, hooks/livePriceStore.js), and 1W / 1M from ONE batched
// `POST /api/watchlist-performance` for the list on screen (the watchlist page's own read).
//
// Clicking a row LOADS that name into the linked group and keeps every panel's function (the
// shell's Shift+Enter path), as MOST does; typing its row number + Enter does the same. The list
// is published for `BOARD GP`, so a list of names becomes a board of charts.
//
// ⛔ A failed read is an ERROR with Retry, never "no watchlists": an empty account and an outage
// are different sentences.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import jsonFetcher from '../../../utils/jsonFetcher'
import useLivePrices from '../../../hooks/useLivePrices'
import useMarketOpen from '../../../hooks/useMarketOpen'
import { BoardFromList, PanelSkeleton, PanelState, useInTerminalPanel, usePanelFreshness, usePanelList } from '../../../components/terminal'
import {
  formatCompactTerminal, formatNumber, formatPercent, formatTimeEt,
} from '../../../lib/presentation/presentationPrimitives'
import { ariaSortFor, nextSort, sortCaretFor, sortRows } from '../../../lib/presentation/dataGrid'
import { SESSION_COPY, sessionOf } from './moversModel'
import styles from './myNamesPanel.module.css'

export const LISTS_URL = '/api/watchlists?include_prebuilt=0'
export const FLAGGED_URL = '/api/watchlists/flagged'
export const PERF_URL = '/api/watchlist-performance'
/** The performance route reads at most 100 names (api/routers/watchlists.py caps it). */
export const PERF_CAP = 100
const stamped = (url) => jsonFetcher(url).then((d) => ({ body: d, receivedAt: new Date().toISOString() }))
const perfFetcher = ([url, key]) => jsonFetcher(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers: key.split(',') }),
})

/** Pure: a list's names, in its own order, deduped and upper-cased. */
export function listSyms(list) {
  const seen = new Set()
  const out = []
  for (const it of Array.isArray(list?.items) ? list.items : []) {
    const s = String(typeof it === 'string' ? it : it?.sym || '').trim().toUpperCase()
    if (s && !seen.has(s)) { seen.add(s); out.push(s) }
  }
  return out
}

/** Pure: the member's lists in the order `MON N` counts them — their own lists as the server
 *  orders them (most recently changed first), then Flagged when it holds a name. */
export function memberLists(lists, flagged) {
  const own = (Array.isArray(lists) ? lists : [])
    .filter((l) => l && l.id && !l.is_prebuilt && !l.is_flagged_list)
    .map((l) => ({ id: String(l.id), name: l.name || 'Untitled list', syms: listSyms(l), flagged: false }))
  const flag = flagged && flagged.id
    ? { id: String(flagged.id), name: flagged.name || 'Flagged', syms: listSyms(flagged), flagged: true }
    : null
  return flag && flag.syms.length ? [...own, flag] : own
}

/** Pure: which list a `MON` argument names. `{ index, missing }` — `missing` is the pick that
 *  matched nothing (said out loud; the first list is shown instead). */
export function pickList(lists, pick) {
  if (!lists.length) return { index: -1, missing: pick || null }
  if (!pick) return { index: 0, missing: null }
  const p = String(pick)
  let at = -1
  if (p === 'FLAGGED') at = lists.findIndex((l) => l.flagged)
  else if (/^W:/i.test(p)) at = lists.findIndex((l) => l.id.toLowerCase() === p.slice(2).toLowerCase())
  else if (/^\d+$/.test(p)) at = Number(p) - 1 < lists.length ? Number(p) - 1 : -1
  return at >= 0 ? { index: at, missing: null } : { index: 0, missing: p }
}

const COLUMNS = [
  { key: 'sym', label: 'Symbol', title: 'Click a symbol to load it into the linked panels' },
  { key: 'last', label: 'Last' },
  { key: 'pct', label: '% Chg' },
  { key: 'volume', label: 'Volume', phoneHide: true, title: 'Shares traded today' },
  { key: 'w1', label: '1W', phoneHide: true, title: 'Return over the last week' },
  { key: 'm1', label: '1M', phoneHide: true, title: 'Return over the last month' },
]
/** What % change means in each session (MOST's badge and title; its basis names an After hours
 *  column this table does not have). */
const BASIS = {
  regular: "% change is the last trade against yesterday's close.",
  pre: "Last is the latest pre-market print and % change is against yesterday's close.",
  post: "% change is today's session against yesterday's close.",
  closed: "These are the last session's numbers. Nothing here moves until the next pre-market.",
}
const valueOf = (key, r) => (key === 'order' ? r.order : r[key])
const isNumeric = (key) => key !== 'sym'
const byOrder = (a, b) => a.order - b.order
const firstDirFor = (key) => (key === 'sym' ? 'asc' : 'desc')
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null)

function failureText(err, what) {
  if (err?.status === 401) return `You are signed out, so ${what} cannot be read. Sign in again.`
  if (err?.status === 402) return `${what[0].toUpperCase()}${what.slice(1)} need a paid plan.`
  if (err?.timedOut) return `${what[0].toUpperCase()}${what.slice(1)} did not answer within 30 seconds.`
  return `${what[0].toUpperCase()}${what.slice(1)} could not be read just now.`
}

export default function WatchlistPanel({ list: pick = null, onRun, onRows }) {
  const inPanel = useInTerminalPanel()
  const market = useMarketOpen()
  const session = sessionOf(market)
  const copy = SESSION_COPY[session]

  const lists = useSWR(LISTS_URL, stamped, { refreshInterval: 60000, keepPreviousData: true })
  const flagged = useSWR(FLAGGED_URL, stamped, { refreshInterval: 60000, keepPreviousData: true })
  const all = useMemo(() => memberLists(lists.data?.body, flagged.data?.body), [lists.data, flagged.data])

  // A new `MON <list>` remounts the panel (the shell keys the body on code + args), so the typed
  // pick only ever seeds the state; the chips change it in place.
  const picked = useMemo(() => pickList(all, pick), [all, pick])
  const [chosen, setChosen] = useState(null)   // a list id the member clicked
  const index = chosen && all.some((l) => l.id === chosen) ? all.findIndex((l) => l.id === chosen) : picked.index
  const current = index >= 0 ? all[index] : null
  const syms = useMemo(() => current?.syms || [], [current])

  const { prices } = useLivePrices(syms)   // the shared pool: one poll for every panel's names
  const perfKey = syms.length ? [PERF_URL, syms.slice(0, PERF_CAP).join(',')] : null
  const perf = useSWR(perfKey, perfFetcher, { refreshInterval: 5 * 60 * 1000, dedupingInterval: 60 * 1000 })

  const [sort, setSort] = useState({ key: 'order', dir: 'asc' })
  const rows = useMemo(() => {
    const base = syms.map((s, i) => {
      const p = prices[s] || {}
      const pf = perf.data?.[s] || {}
      return { sym: s, order: i, last: num(p.price), pct: num(p.change_pct), volume: num(p.volume),
        w1: num(pf['1w']), m1: num(pf['1m']) }
    })
    return sortRows(base, sort, { valueOf, isNumeric, tiebreak: byOrder })
  }, [syms, prices, perf.data, sort])

  const cmds = useMemo(() => rows.map((r) => `$${r.sym}`), [rows])
  const rowSyms = useMemo(() => rows.map((r) => r.sym), [rows])
  useEffect(() => { onRows?.(cmds) }, [onRows, cmds])
  usePanelList(current && rowSyms.length ? { syms: rowSyms, label: `watchlist ${current.name}` } : null)

  const asOf = lists.data?.receivedAt || flagged.data?.receivedAt || null
  usePanelFreshness(asOf ? { freshnessClass: session === 'closed' ? 'end_of_day' : 'real_time', asOf } : null)

  const load = (s) => onRun?.(`$${s}`, { keepFunction: true })
  const toggleSort = (key) => setSort((s) => nextSort(s.key === 'order' ? null : s, key, firstDirFor))

  const loading = (!lists.data && !lists.error) || (!flagged.data && !flagged.error)
  if (loading && !all.length) return <PanelSkeleton label="Loading your watchlists" testId="terminal-watchlist-loading" />
  if (!lists.data && lists.error && !flagged.data) {
    const err = lists.error
    return (
      <PanelState kind={err?.status === 402 ? 'locked' : 'error'} testId="terminal-watchlist-error"
        title={failureText(err, 'your watchlists')}
        action={err?.status === 402 ? null
          : <button type="button" className={styles.chip} onClick={() => { lists.mutate(); flagged.mutate() }}>Retry</button>}>
        {err?.status === 402 ? null : 'That is not the same as having no lists. Retry, or run MON again.'}
      </PanelState>
    )
  }

  if (!all.length) {
    return (
      <PanelState kind="empty" testId="terminal-watchlist-empty" title="You have no watchlists yet.">
        Add one on <Link to="/charts">Charts</Link> (add a Watchlist widget, then New list), or flag a name: right-click
        any ticker and choose Flag. Your lists show up here, live.
        {lists.error ? ` (${failureText(lists.error, 'your lists')} Only your flagged names were checked.)` : ''}
      </PanelState>
    )
  }

  const notes = []
  if (picked.missing && !chosen) {
    notes.push(`There is no list ${/^\d+$/.test(picked.missing) ? `number ${picked.missing}` : picked.missing}; you have ${all.length}. Showing ${all[0].name}.`)
  }
  if (lists.error) notes.push(`${failureText(lists.error, 'your lists')} Showing what could be read.`)
  if (flagged.error) notes.push(`${failureText(flagged.error, 'your flagged names')} Flagged is missing from the list.`)
  if (perf.error) notes.push('1W and 1M could not be read just now; prices are still live.')
  if (syms.length > PERF_CAP) notes.push(`1W and 1M cover the first ${PERF_CAP} of ${syms.length} names.`)

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-watchlist" data-session={session}>
      <div className={styles.head}>
        <span className={`${styles.badge} ${styles[`badge_${session}`]}`} data-testid="terminal-watchlist-session">{copy.badge}</span>
        <span className={styles.lede}>{copy.title}: {BASIS[session]}</span>
      </div>

      <div className={styles.toolbar} role="toolbar" aria-label="Watchlist">
        <div className={styles.group} role="group" aria-label="Your lists">
          {all.map((l, i) => (
            <button key={l.id} type="button" className={styles.chip} aria-pressed={i === index}
              onClick={() => setChosen(l.id)} data-testid={`terminal-watchlist-pick-${i + 1}`}
              title={`MON ${l.flagged ? 'FLAGGED' : i + 1} opens this list`}>
              {l.name} ({l.syms.length})
            </button>
          ))}
        </div>
        {sort.key !== 'order' ? (
          <button type="button" className={styles.chip} onClick={() => setSort({ key: 'order', dir: 'asc' })}
            data-testid="terminal-watchlist-sort-reset">List order</button>
        ) : null}
        <BoardFromList syms={rowSyms} label={current ? `watchlist ${current.name}` : 'watchlist'} testId="terminal-watchlist-board" />
      </div>

      {notes.map((n) => <p key={n} className={styles.note} role="status">{n}</p>)}

      {rows.length === 0 ? (
        <PanelState kind="empty" compact testId="terminal-watchlist-list-empty" title={`${current.name} has no names yet.`}>
          Add names on <Link to="/charts">Charts</Link> (the Watchlist widget), or right-click any ticker and choose
          Add to list.
        </PanelState>
      ) : (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-watchlist-table" aria-label={`${current.name}, sortable`}>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th scope="col" key={c.key} title={c.title} aria-sort={ariaSortFor(sort, c.key, 'none')}
                    className={c.phoneHide ? styles.phoneHide : undefined}>
                    <button type="button" className={styles.sortBtn} onClick={() => toggleSort(c.key)}
                      data-testid={`terminal-watchlist-sort-${c.key}`}>
                      {c.label}
                      {sortCaretFor(sort, c.key) ? <span aria-hidden="true">{` ${sortCaretFor(sort, c.key)}`}</span> : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)
                return (
                  <tr key={r.sym} data-testid={`terminal-watchlist-row-${r.sym}`}>
                    <td>
                      <button type="button" className={styles.rowBtn} onClick={() => load(r.sym)}
                        aria-label={`Load ${r.sym} into the linked panels`}>
                        <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                        <span className={styles.sym}>{r.sym}</span>
                      </button>
                    </td>
                    <td>{formatNumber(r.last, { decimals: 2 })}</td>
                    <td className={tone(r.pct)}>{formatPercent(r.pct, { decimals: 2, signed: true })}</td>
                    <td className={styles.phoneHide}>{formatCompactTerminal(r.volume)}</td>
                    <td className={`${styles.phoneHide} ${tone(r.w1) || ''}`}>{formatPercent(r.w1, { decimals: 1, signed: true })}</td>
                    <td className={`${styles.phoneHide} ${tone(r.m1) || ''}`}>{formatPercent(r.m1, { decimals: 1, signed: true })}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className={styles.muted} data-testid="terminal-watchlist-method">
        {current.flagged ? 'Your flagged names' : `Your list ${current.name}`}: {syms.length} name{syms.length === 1 ? '' : 's'}.
        Prices from the live feed; 1W and 1M from daily closes. A sign (+/−) marks every change, so the colour is never the
        only signal. Click a row, or type its number, to load it into the linked panels.
        {asOf ? ` Lists as of ${formatTimeEt(asOf, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </div>
  )
}
