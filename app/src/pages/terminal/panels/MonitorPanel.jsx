// MON — the watchlist monitor (TERMINAL-NEXT lane T5, competitive-gap audit gap 5).
//
// A dense, sortable, keyboard-driven table over what the member ALREADY keeps: their own
// watchlists, the flagged list and the tag lists. ⛔ NO NEW STORAGE AND NO NEW ROUTE:
//   * lists   — `/api/watchlists?include_prebuilt=0` through SWR with NO refreshInterval, so
//               this panel shares the cache `useUserTickerSet` already keeps and never adds a
//               poll (the pollingSites rail); flagged = `useFlagged`, tags = `useTickerTags`;
//   * prices  — `useRealtimePrices`, the browser-wide priceStreamManager pool: ONE call over
//               the shown symbols, never a per-panel stream;
//   * returns — `useWatchlistPerformance` (the server caps a batch at 100, so the monitor
//               shows at most MAX_ROWS names and SAYS so when a list is longer);
//   * volume average + next earnings — `useWatchlistMeta`, the Watchlists page's own batch.
//
// ⭐ ROW SELECTION DRIVES THE PANEL'S CHANNEL. A click, Enter on the active row, or row <GO>
// (`3` + Enter on the command line) calls `onDrive(sym)`: the shell sets the security of the
// channel this panel joined, so every panel linked to it follows — the monitor itself stays.
// The numbered rows are published through `onRows(rows, go)`: each row is a bare-ticker
// command, and `go(i)` is how the shell asks THIS panel to act on row i instead of
// replacing the monitor with it.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import fetcher from '../../../utils/jsonFetcher'
import { useFlagged } from '../../../hooks/useFlagged'
import useTickerTags from '../../../hooks/useTickerTags'
import useRealtimePrices from '../../../hooks/useRealtimePrices'
import useWatchlistPerformance from '../../../hooks/useWatchlistPerformance'
import useWatchlistMeta from '../../../hooks/useWatchlistMeta'
import { TAG_COLORS } from '../../../constants/tagColors'
import { ABSENT, formatCompact, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import Select from '../../../components/ui/Select'
import styles from './MonitorPanel.module.css'

/** The member's own lists, never the curated index lists (4,725 constituents a page). */
export const LISTS_URL = '/api/watchlists?include_prebuilt=0'
/** `/api/watchlist-performance` answers at most 100 tickers; the monitor shows no more. */
export const MAX_ROWS = 100

/** The columns, in order. `wide` columns drop out on a phone (MonitorPanel.module.css). */
export const COLUMNS = Object.freeze([
  { key: 'sym', label: 'Ticker', text: true },
  { key: 'last', label: 'Last' },
  { key: 'chg', label: 'Chg %' },
  { key: '5d', label: '5D', wide: true },
  { key: '30d', label: '30D', wide: true },
  { key: '90d', label: '90D', wide: true },
  { key: 'ytd', label: 'YTD', wide: true },
  { key: 'vol', label: 'Volume', wide: true },
  { key: 'rvol', label: 'RVOL' },
  { key: 'earn', label: 'Next ER', text: true },
])
const PERIODS = ['5d', '30d', '90d', 'ytd']

function uniqSyms(list) {
  const out = []
  const seen = new Set()
  for (const raw of list || []) {
    const s = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
    if (s && !seen.has(s)) { seen.add(s); out.push(s) }
  }
  return out
}

/** Pure: every list the monitor can show — flagged, each non-empty tag colour, each watchlist. */
export function buildSources({ flagged, flaggedName, tags, lists } = {}) {
  const out = [{ id: 'flagged', kind: 'flagged', label: flaggedName || 'Flagged', syms: uniqSyms(flagged) }]
  const tagMap = tags && typeof tags === 'object' && !Array.isArray(tags) ? tags : {}
  for (const tc of TAG_COLORS) {
    const syms = uniqSyms(Object.keys(tagMap).filter((s) => tagMap[s] === tc.key)).sort()
    if (syms.length) out.push({ id: `tag:${tc.key}`, kind: 'tag', label: `Tag: ${tc.label}`, syms })
  }
  for (const wl of Array.isArray(lists) ? lists : []) {
    if (!wl || wl.id == null) continue
    const syms = uniqSyms((Array.isArray(wl.items) ? wl.items : []).map((i) => i?.sym || i?.ticker))
    out.push({ id: `wl:${wl.id}`, kind: 'watchlist', label: wl.name || `List ${wl.id}`, syms })
  }
  return out
}

/** Pure: the source shown — the chosen one, else the first with names in it, else flagged. */
export function pickSource(sources, chosenId) {
  return sources.find((s) => s.id === chosenId) || sources.find((s) => s.syms.length) || sources[0] || null
}

function earnKey(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof iso === 'string' ? iso : '')
  return m ? Number(`${m[1]}${m[2]}${m[3]}`) : null
}

/** Pure: one row's values (numbers; the earnings date stays its ISO string). The N-day
 *  returns tick against the live price when the batch carries that period's reference
 *  close, exactly as the Watchlists page computes them. */
export function rowValues(sym, q, perf, meta) {
  const price = Number.isFinite(q?.price) ? q.price : null
  const period = (p) => {
    const ref = perf?.refs?.[p]
    if (Number.isFinite(ref) && ref > 0 && price != null) return ((price - ref) / ref) * 100
    return Number.isFinite(perf?.[p]) ? perf[p] : null
  }
  const vol = Number.isFinite(q?.volume) ? q.volume : null
  const avg = meta?.avg_vol_20d
  const rvol = Number.isFinite(meta?.rvol) ? meta.rvol
    : (Number.isFinite(avg) && avg > 0 && vol != null ? (vol / avg) * 100 : null)
  const out = {
    sym,
    last: price,
    chg: Number.isFinite(q?.change_pct) ? q.change_pct : null,
    vol,
    rvol,
    earn: typeof meta?.next_earnings === 'string' && meta.next_earnings ? meta.next_earnings : null,
  }
  for (const p of PERIODS) out[p] = period(p)
  return out
}

/** Pure: sort rows by a column. A missing value sorts LAST in both directions; ties keep
 *  the list's own order. `key: null` is the list's own order. */
export function sortRows(rows, { key, dir } = {}) {
  if (!key) return rows.slice()
  const sign = dir === 'asc' ? 1 : -1
  const val = (r) => (key === 'earn' ? earnKey(r.earn) : r[key])
  return rows
    .map((r, i) => [r, i])
    .sort(([a, ia], [b, ib]) => {
      const va = val(a)
      const vb = val(b)
      if (va == null && vb == null) return ia - ib
      if (va == null) return 1
      if (vb == null) return -1
      if (va === vb) return ia - ib
      return (va < vb ? -1 : 1) * sign
    })
    .map(([r]) => r)
}

/** Pure: the next sort after a header click — a new column starts descending (ticker and
 *  earnings ascending: A first, soonest first); the same column flips; a third click
 *  returns to the list's own order. */
export function nextSort(cur, key) {
  const first = key === 'sym' || key === 'earn' ? 'asc' : 'desc'
  if (cur?.key !== key) return { key, dir: first }
  if (cur.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' }
  return { key: null, dir: null }
}

function cellText(key, r) {
  switch (key) {
    case 'sym': return r.sym
    case 'last': return formatNumber(r.last, { decimals: 2 })
    case 'vol': return formatCompact(r.vol)
    case 'rvol': return r.rvol == null ? ABSENT : `${formatNumber(r.rvol / 100, { decimals: 1 })}x`
    case 'earn': return r.earn || ABSENT
    default: return formatPercent(r[key], { signed: true })
  }
}

function tone(key, r) {
  if (key !== 'chg' && !PERIODS.includes(key)) return undefined
  const v = r[key]
  if (!Number.isFinite(v) || v === 0) return undefined
  return v > 0 ? 'up' : 'down'
}

const SORT_OPTIONS = [
  { value: '', label: 'List order' },
  ...COLUMNS.flatMap((c) => [
    { value: `${c.key}:desc`, label: `${c.label} ${c.text ? 'Z-A / latest' : 'high-low'}` },
    { value: `${c.key}:asc`, label: `${c.label} ${c.text ? 'A-Z / soonest' : 'low-high'}` },
  ]),
]

export default function MonitorPanel({ onRows, onDrive, channel, linkedSym }) {
  const uid = useId()
  const { flagged, flaggedName } = useFlagged()
  const { tags } = useTickerTags()
  const { data: lists, error: listsError } = useSWR(LISTS_URL, fetcher, { revalidateOnFocus: false })
  const sources = useMemo(() => buildSources({ flagged, flaggedName, tags, lists }),
    [flagged, flaggedName, tags, lists])
  const [chosen, setChosen] = useState(null)
  const source = pickSource(sources, chosen)
  const allSyms = source ? source.syms : []
  const shownKey = allSyms.slice(0, MAX_ROWS).join(' ')
  // ONE stable array per list content: every data hook keys on it.
  const syms = useMemo(() => (shownKey ? shownKey.split(' ') : []), [shownKey])

  const { prices, isStreaming } = useRealtimePrices(syms)
  const { perfData } = useWatchlistPerformance(syms)
  const { metaData } = useWatchlistMeta(syms)

  const [sort, setSort] = useState({ key: null, dir: null })
  const rows = useMemo(() => sortRows(
    syms.map((s) => rowValues(s, prices?.[s], perfData?.[s], metaData?.[s])), sort,
  ), [syms, prices, perfData, metaData, sort])

  // The numbered rows (row <GO>): bare-ticker commands in the order shown. Keyed on the
  // order's TEXT, so a price tick that does not reorder publishes nothing new.
  const orderKey = rows.map((r) => r.sym).join(' ')
  const ordered = useMemo(() => (orderKey ? orderKey.split(' ') : []), [orderKey])
  const [active, setActive] = useState(0)
  const activeIdx = ordered.length ? Math.min(active, ordered.length - 1) : -1

  const orderedRef = useRef(ordered)
  orderedRef.current = ordered
  const driveRef = useRef(onDrive)
  driveRef.current = onDrive
  const choose = useCallback((i) => {
    const sym = orderedRef.current[i]
    if (!sym) return false
    setActive(i)
    driveRef.current?.(sym)
    return true
  }, [])
  useEffect(() => { onRows?.(ordered, choose) }, [onRows, ordered, choose])

  const tableRef = useRef(null)
  const onKeyDown = (e) => {
    // Only the table itself: Enter on a focused sort button is that button's click.
    if (e.target !== e.currentTarget || !ordered.length) return
    const last = ordered.length - 1
    const move = { ArrowDown: activeIdx + 1, ArrowUp: activeIdx - 1, Home: 0, End: last,
      PageDown: activeIdx + 10, PageUp: activeIdx - 10 }[e.key]
    if (move != null) {
      e.preventDefault()
      setActive(Math.max(0, Math.min(last, move)))
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      choose(activeIdx)
    }
  }
  useEffect(() => {
    const el = tableRef.current?.querySelector?.('[data-active="true"]')
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIdx])

  const listId = `${uid}-list`
  const sortId = `${uid}-sort`
  const rowId = (i) => `${uid}-row-${i}`
  const listsLoading = lists === undefined && !listsError
  const drives = channel ? `Selecting a row sets ${channel.name}` : 'Not linked: link this panel (the dot) to drive other panels'

  return (
    <div className={styles.monitor} data-testid="terminal-monitor">
      <div className={styles.toolbar}>
        <label className={styles.field} htmlFor={listId}>
          <span className={styles.fieldLabel}>List</span>
          <Select id={listId} className={styles.select} value={source?.id || ''}
            onChange={(e) => { setChosen(e.target.value); setActive(0) }}
            options={sources.map((s) => ({ value: s.id, label: `${s.label} (${s.syms.length})` }))}
            data-testid="terminal-monitor-list" />
        </label>
        <label className={styles.field} htmlFor={sortId}>
          <span className={styles.fieldLabel}>Sort</span>
          <Select id={sortId} className={styles.select}
            value={sort.key ? `${sort.key}:${sort.dir}` : ''}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(':')
              setSort(key ? { key, dir } : { key: null, dir: null })
            }}
            options={SORT_OPTIONS} data-testid="terminal-monitor-sort" />
        </label>
        <span className={styles.status} role="status" data-testid="terminal-monitor-status">
          {drives}{' · '}{isStreaming ? 'live' : 'connecting'}
        </span>
      </div>

      {listsError && (
        <p className={styles.note} role="status" data-testid="terminal-monitor-lists-error">
          Your watchlists could not be loaded just now; the flagged and tag lists still show.
        </p>
      )}
      {allSyms.length > MAX_ROWS && (
        <p className={styles.note} data-testid="terminal-monitor-capped">
          {source.label} has {allSyms.length} names; the monitor shows the first {MAX_ROWS}.
        </p>
      )}

      {!ordered.length ? (
        <p className={styles.empty} data-testid="terminal-monitor-empty">
          {listsLoading ? 'Loading your lists…'
            : `${source?.label || 'This list'} is empty. Flag a ticker, tag one, or add names to a watchlist.`}
        </p>
      ) : (
        <div className={styles.scroller}>
          <table
            ref={tableRef}
            className={styles.table}
            role="grid"
            aria-label={`Monitor: ${source.label}`}
            aria-rowcount={ordered.length + 1}
            aria-activedescendant={activeIdx >= 0 ? rowId(activeIdx) : undefined}
            tabIndex={0}
            onKeyDown={onKeyDown}
            data-testid="terminal-monitor-table"
          >
            <thead>
              <tr>
                <th scope="col" className={styles.num}>#</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" data-wide={c.wide ? 'true' : undefined}
                    className={c.text ? undefined : styles.num}
                    aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className={styles.sortBtn}
                      onClick={() => { setSort((s) => nextSort(s, c.key)); setActive(0) }}
                      aria-label={`Sort by ${c.label}`} data-testid={`terminal-monitor-sort-${c.key}`}>
                      {c.label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.sym} id={rowId(i)} aria-selected={i === activeIdx}
                  data-active={i === activeIdx ? 'true' : 'false'}
                  data-linked={linkedSym && linkedSym === r.sym ? 'true' : 'false'}
                  className={styles.row}
                  onClick={() => choose(i)}
                  data-testid={`terminal-monitor-row-${i + 1}`}>
                  <td className={styles.num}>{i + 1}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} data-wide={c.wide ? 'true' : undefined} data-tone={tone(c.key, r)}
                      className={c.key === 'sym' ? styles.sym : c.text ? undefined : styles.num}>
                      {cellText(c.key, r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
