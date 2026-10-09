// RSL: the RS leaderboard, the top names by relative-strength rank (wave 7, lane C).
//
// ⭐ NO NEW ROUTE. `GET /api/rs-rankings` (api/services/rs_ranking.py) is the cached 1-99 percentile
// rank of the whole cap universe, best first: a weighted 3m/6m/1m/1w return (3m required) ranked
// against every other name. The UCT 20 page reads the same table. The panel shows the top
// `TOP_N` and sorts within them; the full universe is thousands of rows.
//
// ⛔ A cold server answers 503 {"status":"warming"} while it computes (never in the request); that
// reads "Loading, the server is preparing this" and re-polls briefly, never "no leaders". A 503
// without that body is an outage (error with Retry); a 402 or a switched-off route has no Retry.
import { useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelSymbol, PanelState, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { ariaSortFor, nextSort, sortCaretFor, sortRows } from '../../../lib/presentation/dataGrid'
import { canRetry, failureKind, failureText, isWarmingError, useMarketRead } from './marketRead'
import useWarmingPoll from './warmingPoll'
import WarmingState from './WarmingState'
import styles from './marketPanels.module.css'

export const RS_URL = '/api/rs-rankings'
export const TOP_N = 100
const POLL_MS = 30 * 60 * 1000

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** Pure: the leaderboard, best rank first, capped at `topN`. `total` is the universe ranked. */
export function rsLeaders(body, topN = TOP_N) {
  const all = (Array.isArray(body) ? body : [])
    .filter((r) => r && r.ticker && num(r.rs_rank) != null)
    .map((r) => ({
      sym: String(r.ticker).trim().toUpperCase(),
      rank: num(r.rs_rank),
      score: num(r.rs_score),
      w1: num(r.returns?.['1w']),
      m1: num(r.returns?.['1m']),
      m3: num(r.returns?.['3m']),
      m6: num(r.returns?.['6m']),
    }))
    .sort((a, b) => b.rank - a.rank || (b.score ?? -Infinity) - (a.score ?? -Infinity) || (a.sym < b.sym ? -1 : 1))
  return { rows: all.slice(0, topN).map((r, i) => ({ ...r, order: i })), total: all.length }
}

const COLUMNS = [
  { key: 'order', label: '#', title: 'Place on the leaderboard' },
  { key: 'sym', label: 'Symbol', title: 'Click a symbol to open its DES' },
  { key: 'rank', label: 'RS rank', title: 'Percentile against the whole universe, 1 to 99' },
  { key: 'score', label: 'Score', phoneHide: true, title: 'Weighted return over 3M, 6M, 1M and 1W (3M weighs most)' },
  { key: 'w1', label: '1W', phoneHide: true },
  { key: 'm1', label: '1M', phoneHide: true },
  { key: 'm3', label: '3M' },
  { key: 'm6', label: '6M', phoneHide: true },
]
const valueOf = (key, r) => r[key]
const isNumeric = (key) => key !== 'sym'
const firstDirFor = (key) => (key === 'sym' || key === 'order' ? 'asc' : 'desc')
const byOrder = (a, b) => a.order - b.order
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)

export default function RsLeadersPanel() {
  const inPanel = useInTerminalPanel()
  const read = useMarketRead(RS_URL, { refreshInterval: POLL_MS })
  // The server answers 503 {"status":"warming"} with Retry-After: 30 while it builds the ranking.
  const warming = !read.body && isWarmingError(read.error)
  const warmPoll = useWarmingPoll(warming, read.retry, { everyMs: 10_000, maxTries: 12 })
  const board = useMemo(() => rsLeaders(read.body), [read.body])
  const [sort, setSort] = useState({ key: 'order', dir: 'asc' })
  const rows = useMemo(() => sortRows(board.rows, sort, { valueOf, isNumeric, tiebreak: byOrder }), [board.rows, sort])
  usePanelFreshness(board.rows.length ? { source: 'UCT RS ranking (daily closes)' } : null)
  usePanelSymbolRows(rows.map((r) => r.sym), 'RS leaders', { total: board.total })

  if (read.loading) return <PanelSkeleton label="Loading RS rankings" testId="terminal-rsl-loading" />
  if (warming) {
    return <WarmingState what="the RS rankings" gaveUp={warmPoll.gaveUp} onRetry={warmPoll.retry} testId="terminal-rsl-warming" />
  }
  if (read.error && !read.body) {
    const locked = !canRetry(read.error)
    return (
      <PanelState kind={failureKind(read.error)} title={failureText(read.error, 'RS rankings')} testId="terminal-rsl-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : 'Retry, or run RSL again.'}
      </PanelState>
    )
  }
  if (!board.rows.length) {
    return <PanelState kind="empty" title="No RS ranks yet." testId="terminal-rsl-empty">The ranking fills in once daily closes are loaded.</PanelState>
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-rsl">
      {read.error && <p className={styles.note} role="status">{failureText(read.error, 'RS rankings')} Showing the last read.</p>}
      {sort.key !== 'order' ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.chip} onClick={() => setSort({ key: 'order', dir: 'asc' })}
            data-testid="terminal-rsl-sort-reset">Leaderboard order</button>
        </div>
      ) : null}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-rsl-table" aria-label={`Top ${board.rows.length} by RS rank, sortable`}>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th scope="col" key={c.key} title={c.title} aria-sort={ariaSortFor(sort, c.key, 'none')}
                  className={c.phoneHide ? styles.phoneHide : undefined}>
                  <button type="button" className={styles.sortBtn} onClick={() => setSort((s) => nextSort(s, c.key, firstDirFor))}
                    data-testid={`terminal-rsl-sort-${c.key}`}>
                    {c.label}
                    {sortCaretFor(sort, c.key) ? <span aria-hidden="true">{` ${sortCaretFor(sort, c.key)}`}</span> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sym} data-testid={`terminal-rsl-row-${r.sym}`}>
                <td className={styles.rowNum}>{r.order + 1}</td>
                <td><PanelSymbol sym={r.sym} className={styles.sym} /></td>
                <td>{formatNumber(r.rank, { decimals: 0 })}</td>
                <td className={styles.phoneHide}>{formatNumber(r.score, { decimals: 2 })}</td>
                <td className={`${styles.phoneHide} ${tone(r.w1) || ''}`}>{formatPercent(r.w1, { decimals: 1, signed: true })}</td>
                <td className={`${styles.phoneHide} ${tone(r.m1) || ''}`}>{formatPercent(r.m1, { decimals: 1, signed: true })}</td>
                <td className={tone(r.m3)}>{formatPercent(r.m3, { decimals: 1, signed: true })}</td>
                <td className={`${styles.phoneHide} ${tone(r.m6) || ''}`}>{formatPercent(r.m6, { decimals: 1, signed: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted} data-testid="terminal-rsl-method">
        The top {board.rows.length} of {formatNumber(board.total, { decimals: 0 })} names by RS rank. RS rank is a 1 to 99
        percentile of a weighted 3M, 6M, 1M and 1W return (3M weighs most) against the whole universe, recomputed about hourly
        from daily closes. A sign (+/−) marks every return, so colour is never the only signal. Click a symbol to open its DES;
        type a row number to load it into the linked panels.
        {read.receivedAt ? ` Read at ${formatTimeEt(read.receivedAt, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </div>
  )
}
