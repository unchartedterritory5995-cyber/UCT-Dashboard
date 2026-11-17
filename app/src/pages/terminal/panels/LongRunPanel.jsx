// LEAD: the long-run leader lists (30 / 60 / 90-day gainers, volume records, new listings).
//
// ⭐ NO NEW ROUTE. The six preset scans the Scanner widget on /charts already reads
// (ScannerResults.jsx `SCAN_ENDPOINTS`; api/routers/scans.py, paid), one per lens. The pure half
// (the lenses, the URL builder, the row shaping) is longRunModel.js, re-exported below.
//
//   LEAD            the 30-day gainers          LEAD 60D / LEAD 90D   the longer windows
//   LEAD VOL1Y      1-year volume highs         LEAD VOLMAX           all-time volume highs
//   LEAD IPO        stocks listed in the last year
//
// A chip switches the lens and writes it back into the panel's command, so a reload, `?cmd=` and
// the history keep it. A symbol loads that name into the linked panels; typing its row number does
// the same. The columns change with the lens: the window's gain, volume against the old record, or
// the first trading day.
//
// ⛔ A failed read is an error with Retry, never an empty list. While the server builds its
// reference it answers `status: "computing"`: that reads "the server is preparing this" and
// re-polls briefly. An 'ok' answer with no rows says it can also mean no live prices yet.
import { useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelSymbol, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelRerun,
  usePanelSymbolRows,
} from '../../../components/terminal'
import CoverageLine from '../../../components/provenance/CoverageLine'
import {
  formatCompactTerminal, formatNumber, formatPercent, formatTimeEt,
} from '../../../lib/presentation/presentationPrimitives'
import { ariaSortFor, nextSort, sortCaretFor, sortRows } from '../../../lib/presentation/dataGrid'
import { canRetry, failureKind, failureText, isWarmingBody, useMarketRead } from './marketRead'
import useWarmingPoll from './warmingPoll'
import WarmingState from './WarmingState'
import {
  LONG_RUN_CODE, LONG_RUN_LENSES, LONG_RUN_LENS_KEYS, defaultLongRunSort, lensOrDefault, longRunCommand, longRunView,
} from './longRunModel'
import styles from './marketPanels.module.css'

export {
  DEFAULT_LENS, LONG_RUN_CODE, LONG_RUN_LENSES, LONG_RUN_LENS_KEYS, defaultLongRunSort, lensOrDefault, listedDate,
  longRunCommand, longRunRows, longRunView, parseLongRunLens,
} from './longRunModel'

/** lens -> the scan route it reads. ONE authority, and it lives HERE, in the module that draws the
 *  results: TERM-047's result-surface census finds a surface by the scan routes its own module names
 *  (helpers are not followed), so in a helper this panel would silently leave that census. */
export const LONG_RUN_ROUTES = Object.freeze({
  '30D': '/api/scans/top-gainers-30d',
  '60D': '/api/scans/top-gainers-60d',
  '90D': '/api/scans/top-gainers-90d',
  VOL1Y: '/api/scans/highest-volume-1y',
  VOLMAX: '/api/scans/highest-volume-ever',
  IPO: '/api/scans/ipo-1y',
})
/** The route one lens reads, or null for a lens that does not exist. */
export const longRunUrl = (lens) => (Object.prototype.hasOwnProperty.call(LONG_RUN_ROUTES, lens) ? LONG_RUN_ROUTES[lens] : null)

/** Rows drawn; the rest are counted in the method line, never silently dropped. */
export const MAX_ROWS = 100
/** The server recomputes each list at most about once a minute. */
const POLL_MS = 60 * 1000
const SOURCE = 'UCT market scans (live prices against daily history)'
const NA = 'n/a'

const SYMBOL_COL = { key: 'sym', label: 'Symbol', title: 'Click a symbol to load it into the linked panels' }

/** Pure: the columns one lens shows. The gain, the volume record and the listing day are each one
 *  lens's own; the last price and today's change ride along on all of them. */
export function longRunColumns(lens) {
  const def = LONG_RUN_LENSES[lensOrDefault(lens)]
  if (def.kind === 'volume') {
    return [
      SYMBOL_COL,
      { key: 'last', label: 'Last ($)', phoneHide: true },
      { key: 'todayPct', label: 'Today' },
      { key: 'volume', label: 'Volume today', title: 'Shares traded so far today' },
      { key: 'record', label: 'Old record', phoneHide: true, title: `The most shares traded on one day in ${def.span}, before today` },
      { key: 'timesRecord', label: 'Times the record', title: 'Today\'s volume divided by the old record' },
    ]
  }
  if (def.kind === 'ipo') {
    return [
      SYMBOL_COL,
      { key: 'last', label: 'Last ($)' },
      { key: 'todayPct', label: 'Today' },
      { key: 'listed', label: 'First traded', title: 'The first day the stock traded' },
    ]
  }
  return [
    SYMBOL_COL,
    { key: 'last', label: 'Last ($)' },
    { key: 'todayPct', label: 'Today', phoneHide: true },
    { key: 'gainPct', label: `${def.sessions}-day gain`, title: `The live price against the close ${def.sessions} trading sessions ago` },
    { key: 'refClose', label: `Close ${def.sessions} sessions ago ($)`, phoneHide: true },
  ]
}

const TEXT_KEYS = new Set(['sym', 'listed'])
const valueOf = (key, r) => r[key]
const isNumeric = (key) => !TEXT_KEYS.has(key)
const firstDirFor = (key) => (key === 'sym' ? 'asc' : 'desc')
const byOrder = (a, b) => a.order - b.order
const pct = (v, decimals) => formatPercent(v, { decimals, signed: true, absent: NA })
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)

/** Pure: one cell as `{ text, toneOf }`; `toneOf` is the signed number a change is coloured by. */
export function longRunCell(key, r) {
  switch (key) {
    case 'last':
    case 'refClose': return { text: formatNumber(r[key], { decimals: 2, absent: NA }) }
    case 'todayPct': return { text: pct(r.todayPct, 2), toneOf: r.todayPct }
    case 'gainPct': return { text: pct(r.gainPct, 1), toneOf: r.gainPct }
    case 'volume':
    case 'record': return { text: formatCompactTerminal(r[key], { absent: NA }) }
    case 'timesRecord': return { text: r.timesRecord == null ? NA : `${formatNumber(r.timesRecord, { decimals: 2 })}×` }
    case 'listed': return { text: r.listed || NA }
    default: return { text: NA }
  }
}

const FLOORS = 'Stocks under $1, or under $1M of average daily dollar volume, are left out.'

/** Pure: what one list is, in a sentence (the scan's own criteria, ScannerResults `SCAN_CRITERIA`). */
export function longRunMethod(lens) {
  const def = LONG_RUN_LENSES[lensOrDefault(lens)]
  if (def.kind === 'volume') {
    return `US common stocks trading more shares today than on any day in ${def.span}, furthest past the old record first. ${FLOORS}`
  }
  if (def.kind === 'ipo') return `US common stocks that first traded in the last year, newest first. Funds are left out. ${FLOORS}`
  return `The top 5% of US common stocks by percent change over ${def.sessions} trading sessions: the live price against the close ${def.sessions} sessions ago. ${FLOORS}`
}

const listName = (def) => `T${def.what.slice(1)} list`
const EMPTY_TITLE = {
  gain: (def) => `No ${def.sessions}-day gainers to rank right now.`,
  volume: (def) => `No stock is past its volume record for ${def.span} yet today.`,
  ipo: () => 'No new listings to show right now.',
}

function LongRunList({ lens }) {
  const def = LONG_RUN_LENSES[lens]
  const read = useMarketRead(longRunUrl(lens), { refreshInterval: POLL_MS })
  const view = useMemo(() => longRunView(read.body, lens), [read.body, lens])
  // 200 {"status":"computing","results":[]}: the reference is still being built.
  const building = !view.rows.length && (view.building || isWarmingBody(read.body))
  const warmPoll = useWarmingPoll(building, read.retry, { everyMs: 10_000, maxTries: 18 })
  const columns = useMemo(() => longRunColumns(lens), [lens])
  const [sort, setSort] = useState(() => defaultLongRunSort(lens))
  const sorted = useMemo(() => sortRows(view.rows, sort, { valueOf, isNumeric, tiebreak: byOrder }), [view.rows, sort])
  const rows = useMemo(() => sorted.slice(0, MAX_ROWS), [sorted])
  const asOf = view.asOf || read.receivedAt
  usePanelFreshness(view.rows.length ? panelAsOf(SOURCE, asOf) : null)
  usePanelSymbolRows(rows.map((r) => r.sym), def.what.replace(/^the /, ''), { total: view.rows.length })

  if (read.loading) return <PanelSkeleton label={`Loading ${def.what}`} testId="terminal-lead-loading" />
  if (read.error && !read.body) {
    const locked = !canRetry(read.error)
    return (
      <PanelState kind={failureKind(read.error)} title={failureText(read.error, listName(def))} testId="terminal-lead-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : 'That is not the same as an empty list. Retry, or pick another list.'}
      </PanelState>
    )
  }
  if (building) {
    return <WarmingState what={def.what} gaveUp={warmPoll.gaveUp} onRetry={warmPoll.retry} testId="terminal-lead-building" />
  }
  if (!view.rows.length) {
    return (
      <PanelState kind="empty" title={EMPTY_TITLE[def.kind](def)} testId="terminal-lead-empty"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        The list is worked out from live prices, so it can also come back empty before the open or when the price feed
        has not answered. Retry, or pick another list.
      </PanelState>
    )
  }

  return (
    <>
      {read.error && <p className={styles.note} role="status">{failureText(read.error, listName(def))} Showing the last read.</p>}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-lead-table" aria-label={`${def.chip}, sortable`}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th scope="col" key={c.key} title={c.title} aria-sort={ariaSortFor(sort, c.key, 'none')}
                  className={c.phoneHide ? styles.phoneHide : undefined}>
                  <button type="button" className={styles.sortBtn} onClick={() => setSort((s) => nextSort(s, c.key, firstDirFor))}
                    data-testid={`terminal-lead-sort-${c.key}`}>
                    {c.label}
                    {sortCaretFor(sort, c.key) ? <span aria-hidden="true">{` ${sortCaretFor(sort, c.key)}`}</span> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.sym} data-testid={`terminal-lead-row-${r.sym}`}>
                {columns.map((c) => {
                  if (c.key === 'sym') {
                    return (
                      <td key={c.key}>
                        <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                        <PanelSymbol sym={r.sym} className={styles.sym} />
                      </td>
                    )
                  }
                  const cell = longRunCell(c.key, r)
                  return (
                    <td key={c.key} className={[c.phoneHide ? styles.phoneHide : '', tone(cell.toneOf) || ''].join(' ').trim() || undefined}>
                      {cell.text}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CoverageLine coverage={view.coverage} density="widget" />
      <p className={styles.muted} data-testid="terminal-lead-method">
        {longRunMethod(lens)}{' '}
        {view.rows.length > rows.length
          ? `Showing the first ${rows.length} of ${formatNumber(view.rows.length, { decimals: 0 })} in this order. `
          : `${formatNumber(view.rows.length, { decimals: 0 })} ${view.rows.length === 1 ? 'stock' : 'stocks'}. `}
        A sign (+/-) marks every change, so color is never the only signal. Click a symbol to load it into the linked
        panels; type a row number to do the same.
        {asOf ? ` List worked out at ${formatTimeEt(asOf, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </>
  )
}

export default function LongRunPanel({ lens: lensProp = null }) {
  const inPanel = useInTerminalPanel()
  const rerun = usePanelRerun()
  // A new `LEAD <lens>` remounts the panel (the shell keys the body on code + args), so the typed
  // lens only ever seeds the state.
  const [lens, setLens] = useState(() => lensOrDefault(lensProp))
  const pick = (next) => {
    if (next === lens) return
    setLens(next)
    rerun?.(longRunCommand(next, inPanel?.code || LONG_RUN_CODE))
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-lead" data-lens={lens}>
      <div className={styles.toolbar} role="toolbar" aria-label="Long-run list controls">
        <div className={styles.group} role="group" aria-label="List">
          {LONG_RUN_LENS_KEYS.map((key) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === lens} onClick={() => pick(key)}
              data-testid={`terminal-lead-lens-${key}`}>{LONG_RUN_LENSES[key].chip}</button>
          ))}
        </div>
      </div>
      {/* Keyed by lens: a new lens is a new read, so one list's rows are never drawn under another's columns. */}
      <LongRunList key={lens} lens={lens} />
    </div>
  )
}
