// BRKO: the breakout-ready list (wave 8, lane G; GAP-ANALYSIS-2026-10-05 #23). Names that are
// tight, sit near a pattern pivot, and have a rising RS line, from the nightly screener snapshot.
//
// ⭐ NO NEW ROUTE. One read: `POST /api/screener/scan` (api/routers/screener.py, paid) with a FIXED
// spec. That route is a SQL query over the precomputed screener snapshot (`screener_rows`, built at
// 03:00 by snapshot_builder.py), never a universe scan per request. Every column the spec names is
// a screener filter the member can already use on /screener:
//   pattern_engine_dir >= 1          the pattern engine's best active detection is bullish
//   pattern_entry_dist_pct -2 to +5  price is within 5% below that detection's entry (the pivot),
//                                    or at most 2% through it
//   close_cv_pct < 4                 the closes are clustered (the screener's "Tight band" preset)
//   rs_line_trend = up               the RS line vs SPY is rising over 20 bars
//   rs_rank >= 70                    a leader by RS rank (1 to 99)
// `pattern_entry_dist_pct` is `(entry / price - 1) x 100` (live_tier.py), so the pivot price is
// `price x (1 + dist / 100)`, exact algebra, never a second source.
//
// The scan's own four-count receipt (`coverage`, served while COVERAGE_RECEIPTS_SCANS_ENABLED is on)
// renders through CoverageLine, so "no match" and "could not compute" stay different facts.
//
// ⛔ A FAILED READ IS NEVER "NOTHING TODAY". An empty answer says the scan found nothing in that
// snapshot; a failure says it could not be read, with Retry.
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import jsonFetcher from '../../../utils/jsonFetcher'
import {
  PanelCommand, PanelSkeleton, PanelSymbol, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { formatCurrency, formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { ariaSortFor, nextSort, sortCaretFor, sortRows } from '../../../lib/presentation/dataGrid'
import CoverageLine from '../../../components/provenance/CoverageLine'
import { canRetry, failureText } from './marketRead'
import styles from './marketPanels.module.css'

export const BRKO_URL = '/api/screener/scan'
/** How near the pivot counts as "near": up to 5% below it, or up to 2% through it. */
export const PIVOT_BAND = Object.freeze({ below: 5, through: 2 })
export const MIN_RS_RANK = 70
export const MAX_CLOSE_CV = 4
export const MAX_ROWS = 200

const COLUMNS_READ = [
  'company', 'price', 'rs_rank', 'rs_line_trend', 'close_cv_pct', 'tight_consolidation',
  'pattern_engine_ids', 'pattern_entry_dist_pct', 'base_render', 'snapshot_date',
]

/** The one spec BRKO sends. Frozen: a test pins it, and nothing edits it at run time. */
export const BRKO_SPEC = Object.freeze({
  filters: [
    { key: 'pattern_engine_dir', op: 'gte', min: 1 },
    { key: 'pattern_entry_dist_pct', op: 'between', min: -PIVOT_BAND.through, max: PIVOT_BAND.below },
    { key: 'close_cv_pct', op: 'lt', max: MAX_CLOSE_CV },
    { key: 'rs_line_trend', op: 'eq', value: 'up' },
    { key: 'rs_rank', op: 'gte', min: MIN_RS_RANK },
  ],
  sort: { key: 'rs_rank', dir: 'desc' },
  view: 'overview',
  columns: COLUMNS_READ,
  page: 1,
  page_size: MAX_ROWS,
})

const POLL_MS = 30 * 60 * 1000
const swrKey = [BRKO_URL, 'terminal-brko']
export const CATALOG_URL = '/api/patterns/catalog'
const CATALOG_KEY = [CATALOG_URL, 'terminal-brko-catalog']
const fetchScan = ([url]) => jsonFetcher(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(BRKO_SPEC),
}).then((body) => ({ body, receivedAt: new Date().toISOString() }))

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** Engine ids members know by name. Anything else is spelled out from its id. */
const PATTERN_NAMES = {
  vcp: 'VCP',
  flat_base: 'Flat base',
  high_tight_flag: 'High tight flag',
  cup_handle: 'Cup with handle',
  cup_handle_uct: 'Cup with handle',
  bull_flag: 'Bull flag',
  pennant: 'Pennant',
  ascending_triangle: 'Ascending triangle',
  rectangle: 'Rectangle',
  qullamaggie_setup: 'Qullamaggie setup',
  remount: 'Remount',
  rounded_base: 'Rounded base',
  double_bottom: 'Double bottom',
}
const LEAD = ['vcp', 'flat_base', 'high_tight_flag', 'cup_handle_uct', 'cup_handle']

/** Pure: the setup words for one row: VCP and flat base lead, then bullish, then neutral ids.
 *  `catalog` is GET /api/patterns/catalog's `patterns` map ({id: {name, direction}}): the screener's
 *  id list carries EVERY active detection, bearish ones included, and a bearish word in a bullish
 *  breakout list misleads. Without a catalog (it failed or has not loaded) nothing is dropped. */
export function setupLabel(ids, baseRender = null, catalog = null) {
  const dirOf = (t) => catalog?.[t]?.direction || null
  const tokens = String(ids || '').split(',').map((t) => t.trim()).filter(Boolean)
    .filter((t) => dirOf(t) !== 'bearish')
  const rank = (t) => (LEAD.includes(t) ? 0 : dirOf(t) === 'bullish' ? 1 : dirOf(t) === 'neutral' ? 2 : 1)
  const ordered = [...LEAD.filter((t) => tokens.includes(t)),
    ...tokens.filter((t) => !LEAD.includes(t)).map((t, i) => [t, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([t]) => t)]
  const words = [...new Set(ordered.map((t) => PATTERN_NAMES[t] || catalog?.[t]?.name
    || `${t.charAt(0).toUpperCase()}${t.slice(1).replace(/_/g, ' ')}`))]
  if (words.length) return words.slice(0, 2).join(', ')
  return baseRender ? String(baseRender) : 'Pattern'
}

/** Pure: the scan's answer as panel rows, plus its snapshot date and match count. */
export function breakoutRows(body, catalog = null) {
  const raw = Array.isArray(body?.rows) ? body.rows : []
  const rows = raw
    .filter((r) => r && r.ticker && num(r.pattern_entry_dist_pct) != null)
    .map((r) => {
      const dist = num(r.pattern_entry_dist_pct)
      const price = num(r.price)
      return {
        sym: String(r.ticker).trim().toUpperCase(),
        company: r.company ? String(r.company) : '',
        setup: setupLabel(r.pattern_engine_ids, r.base_render, catalog),
        dist,
        near: Math.abs(dist),
        pivot: price != null && price > 0 ? price * (1 + dist / 100) : null,
        price,
        rs: num(r.rs_rank),
        tight: num(r.close_cv_pct),
        asOf: r.snapshot_date ? String(r.snapshot_date) : null,
      }
    })
    .sort((a, b) => a.near - b.near || (b.rs ?? -1) - (a.rs ?? -1) || (a.sym < b.sym ? -1 : 1))
    .map((r, i) => ({ ...r, order: i }))
  const asOf = body?.snapshot_date || body?.snapshot?.snapshot_date || rows.find((r) => r.asOf)?.asOf || null
  return { rows, asOf, total: num(body?.total) ?? rows.length }
}

/** Pure: "+3.2% below" / "1.1% through" / "at the pivot", in words, never colour alone. */
export function pivotText(dist) {
  if (dist == null) return 'n/a'
  if (Math.abs(dist) < 0.05) return 'At pivot'
  return dist > 0
    ? `${formatPercent(dist, { decimals: 1 })} below`
    : `${formatPercent(-dist, { decimals: 1 })} through`
}

/** Pure: the PLAN command a row opens, its pivot prefilled as the buy point when there is one. */
export function planCmd(r) {
  return r.pivot != null && r.pivot > 0
    ? `${r.sym} PLAN ${formatNumber(r.pivot, { decimals: 2, grouping: false })}`
    : `${r.sym} PLAN`
}

const COLUMNS = [
  { key: 'order', label: '#', title: 'Closest to its pivot first' },
  { key: 'sym', label: 'Symbol', title: 'Click a symbol to open its DES' },
  { key: 'setup', label: 'Setup', title: 'The pattern engine\'s active detections (VCP and flat base first)' },
  { key: 'near', label: 'To pivot', title: 'How far price sits from the pattern\'s entry (the pivot)' },
  { key: 'pivot', label: 'Pivot', phoneHide: true, title: 'The pattern\'s entry price' },
  { key: 'rs', label: 'RS', title: 'RS rank, 1 to 99. Every row also has a rising RS line.' },
  { key: 'tight', label: 'Tightness', title: 'How clustered the recent closes are (lower is tighter)' },
  { key: 'asOf', label: 'As of', phoneHide: true, title: 'The screener snapshot date for this row' },
]
const valueOf = (key, r) => r[key]
const isNumeric = (key) => !['sym', 'setup', 'asOf'].includes(key)
const firstDirFor = (key) => (['sym', 'order', 'near', 'tight', 'setup'].includes(key) ? 'asc' : 'desc')
const byOrder = (a, b) => a.order - b.order

export default function BreakoutPanel() {
  const inPanel = useInTerminalPanel()
  const r = useSWR(swrKey, fetchScan, { refreshInterval: POLL_MS, keepPreviousData: true, revalidateOnFocus: false })
  // The pattern catalog only names and directs ids; a failed read leaves the words unfiltered.
  const cat = useSWR(CATALOG_KEY, ([url]) => jsonFetcher(url), { revalidateOnFocus: false, dedupingInterval: 3600000 })
  const board = useMemo(() => breakoutRows(r.data?.body, cat.data?.patterns || null), [r.data, cat.data])
  const [sort, setSort] = useState({ key: 'order', dir: 'asc' })
  const rows = useMemo(() => sortRows(board.rows, sort, { valueOf, isNumeric, tiebreak: byOrder }), [board.rows, sort])
  usePanelFreshness(r.data ? panelAsOf('UCT screener snapshot (nightly build)', board.asOf) : null)
  usePanelSymbolRows(rows.map((x) => x.sym), 'Breakout-ready', { total: board.total })
  const retry = () => r.mutate()

  if (!r.data && !r.error) return <PanelSkeleton label="Loading the breakout-ready list" testId="terminal-brko-loading" />
  if (!r.data && r.error) {
    const locked = !canRetry(r.error)
    const title = r.error?.status === 400
      ? 'The breakout scan cannot run on this server yet. The screener snapshot is missing a column it needs.'
      : failureText(r.error, 'The breakout-ready list')
    return (
      <PanelState kind={locked ? 'locked' : 'error'} title={title} testId="terminal-brko-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={retry}>Retry</button>}>
        {locked ? null : 'That is not the same as no setups today. Retry, or run BRKO again.'}
      </PanelState>
    )
  }

  const method = (
    <p className={styles.muted} data-testid="terminal-brko-method">
      From the nightly screener snapshot{board.asOf ? ` (as of ${board.asOf})` : ''}. A name is listed when the pattern
      engine's best active detection is bullish, price is within {PIVOT_BAND.below}% below its pivot or at most{' '}
      {PIVOT_BAND.through}% through it, the closes are tight (spread under {MAX_CLOSE_CV}%), the RS line vs SPY is
      rising, and the RS rank is {MIN_RS_RANK} or higher. Click a symbol to open its DES, or Plan to write a trade plan.
      {r.data?.receivedAt ? ` Read at ${formatTimeEt(r.data.receivedAt, { zoneSuffix: 'ET', absent: '' })}.` : ''}
    </p>
  )

  if (!board.rows.length) {
    return (
      <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-brko">
        <PanelState kind="empty" title="No breakout-ready names in today's scan." testId="terminal-brko-empty">
          Nothing in the latest snapshot passed every test below. The list fills again when setups tighten up.
        </PanelState>
        <CoverageLine coverage={r.data?.body?.coverage ?? null} density="widget" />
        {method}
      </div>
    )
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-brko">
      {r.error && <p className={styles.note} role="status">{failureText(r.error, 'The breakout-ready list')} Showing the last read.</p>}
      {board.total > board.rows.length ? (
        <p className={styles.note} role="status" data-testid="terminal-brko-capped">
          {formatNumber(board.total, { decimals: 0 })} names matched; the {formatNumber(board.rows.length, { decimals: 0 })} with
          the highest RS rank are shown.
        </p>
      ) : null}
      {sort.key !== 'order' ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.chip} onClick={() => setSort({ key: 'order', dir: 'asc' })}
            data-testid="terminal-brko-sort-reset">Closest to pivot first</button>
        </div>
      ) : null}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-brko-table" aria-label={`${board.rows.length} breakout-ready names, sortable`}>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th scope="col" key={c.key} title={c.title} aria-sort={ariaSortFor(sort, c.key, 'none')}
                  className={c.phoneHide ? styles.phoneHide : undefined}>
                  <button type="button" className={styles.sortBtn} onClick={() => setSort((s) => nextSort(s, c.key, firstDirFor))}
                    data-testid={`terminal-brko-sort-${c.key}`}>
                    {c.label}
                    {sortCaretFor(sort, c.key) ? <span aria-hidden="true">{` ${sortCaretFor(sort, c.key)}`}</span> : null}
                  </button>
                </th>
              ))}
              <th scope="col"><span className="sr-only">Plan</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.sym} data-testid={`terminal-brko-row-${x.sym}`}>
                <td className={styles.rowNum}>{x.order + 1}</td>
                <td><PanelSymbol sym={x.sym} className={styles.sym} /></td>
                <td className={styles.wrapCell}>{x.setup}</td>
                <td>{pivotText(x.dist)}</td>
                <td className={styles.phoneHide}>{formatCurrency(x.pivot, { absent: 'n/a' })}</td>
                <td>{formatNumber(x.rs, { decimals: 0, absent: 'n/a' })}</td>
                <td>{formatPercent(x.tight, { decimals: 1, absent: 'n/a' })}</td>
                <td className={styles.phoneHide}>{x.asOf || 'n/a'}</td>
                <td><PanelCommand cmd={planCmd(x)} label={`Plan a trade in ${x.sym}`} className={styles.linkBtn}>Plan</PanelCommand></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CoverageLine coverage={r.data?.body?.coverage ?? null} density="widget" />
      {method}
    </div>
  )
}
