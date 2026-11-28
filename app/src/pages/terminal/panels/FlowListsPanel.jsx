// FLWL: two curated options-flow lists in the Terminal (data wave 3).
//
// ⭐ NO NEW ROUTE. `GET /api/live/massive/cream` ("Cream of the Crop": the day's highest-conviction
// option positions, until now only a Discord card) and `GET /api/live/massive/flow-board` (the
// open flow board, until now only the /open-flow page, which has no menu entry). The pure half
// (the URLs, the gates, the row shaping) is flowListsModel.js, re-exported below. Both routes
// belong to the partner-owned Live Flow router: read here, never changed.
//
//   FLWL        Cream of the Crop          FLWL OPEN   the open flow board
//
// A chip switches the list and writes it back into the panel's command. A symbol loads that name
// into the linked panels; typing its row number does the same.
//
// ⛔ ONE LIST IS READ AT A TIME. Both are worked out on the flow-worker, the pod that runs the
// live tape, so the list that is not on screen is never asked for.
// ⛔ A FAILED READ IS NEVER AN EMPTY LIST. A read that fails is an error with Retry; the board's
// `ok: false` is "building" (the panel asks again by itself) or "could not build"; only a healthy
// answer with no rows says nothing qualified, and for Cream of the Crop it says for which date.
//
// The reads go through marketRead.js (the terminal's one bare-SWR reader), and SWR skips ticks
// while the app is hidden.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { PanelColumns, PanelTableHead, usePanelTable } from '../../../components/terminal/PanelTable'
import {
  formatCompactTerminal, formatCurrency, formatNumber, formatPercent, formatTimeEt,
} from '../../../lib/presentation/presentationPrimitives'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  BOARD_DAYS, CREAM_URL, FLOW_BOARD_URL, FLOW_LISTS, FLOW_LISTS_CODE, boardRead, creamRead, directionWords, flowListsCommandArgs,
  normFlowList,
} from './flowListsModel'
import styles from './marketPanels.module.css'

export {
  BOARD_DAYS, BOARD_LIMIT, CREAM_URL, FLOW_BOARD_URL, FLOW_LISTS, FLOW_LISTS_CODE, boardRead, creamRead, directionWords,
  flowListsCommandArgs, isoDay, normFlowList, optionSide, parseFlowList,
} from './flowListsModel'

/** Board rows drawn until the member asks for all of them; the rest are counted, never dropped. */
export const MAX_ROWS = 100
/** The server rebuilds the current day's Cream of the Crop about every 15 minutes; the list moves slowly. */
const CREAM_POLL_MS = 5 * 60 * 1000
/** The board is cached for two minutes on the server (the pace /open-flow reads it at). */
const BOARD_POLL_MS = 2 * 60 * 1000
/** While the server is building a cold board it is asked again at this pace. */
const BUILD_POLL_MS = 20 * 1000
const SOURCE = 'UCT options flow'
const NA = 'n/a'
/** A space and a hyphen that never break a line, so "92% bullish" and a date stay whole in a narrow cell. */
const NBSP = ' '
const unbroken = (s) => String(s).replace(/-/g, '‑')

const count = (n) => formatNumber(n, { decimals: 0 })
const money = (v) => formatCompactTerminal(v, { money: true, absent: NA })
const signedMoney = (v) => (v > 0 ? `+${money(v)}` : money(v))
const toneOf = (direction) => (direction === 'bullish' ? styles.up : direction === 'bearish' ? styles.down : undefined)
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')

/** Pure: a contract in plain words: "$420 call, expires 2026-12-18". Parts the row lacks are left out. */
export function contractText(row) {
  const strike = row?.strike == null ? null : formatCurrency(row.strike, { decimals: Number.isInteger(row.strike) ? 0 : 2 })
  const head = [strike, row?.side].filter(Boolean).join(' ')
  const tail = row?.expiry ? `expires ${row.expiry}` : ''
  return [head, tail].filter(Boolean).join(', ') || 'Not given'
}

function FailedRead({ read, what, code, body = 'That is not the same as an empty list.' }) {
  const locked = !canRetry(read.error)
  return (
    <PanelState kind={read.error ? failureKind(read.error) : 'error'} testId="terminal-flwl-error"
      title={read.error ? failureText(read.error, what) : `${what} could not be read just now.`}
      action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
      {locked ? null : `${body} Retry, or run ${code} again.`}
    </PanelState>
  )
}

const CLICK_LINE = 'Click a symbol to load it into the linked panels; type a row number to do the same.'
const STUDY_LINE = 'A list says which stocks to study; it is not a forecast or a recommendation.'

/** A flow grade as a number to sort by: A+ highest, then A, A-, B+ ... (a letter grade sorts wrong as text). */
export function gradeRank(g) {
  const m = /^([A-F])([+-]?)$/.exec(String(g || '').trim().toUpperCase())
  if (!m) return null
  return (70 - m[1].charCodeAt(0)) * 3 + (m[2] === '+' ? 2 : m[2] === '-' ? 0 : 1)
}

function CreamList({ code }) {
  // The pace follows the server's own word that it is still building (as the open board does).
  const [building, setBuilding] = useState(false)
  const read = useMarketRead(CREAM_URL, { refreshInterval: building ? BUILD_POLL_MS : CREAM_POLL_MS })
  const view = useMemo(() => creamRead(read.body), [read.body])
  if ((view.state === 'computing') !== building) setBuilding(view.state === 'computing')
  const table = usePanelTable({ columns: CREAM_COLUMNS })
  const sorted = useMemo(() => table.apply(view.rows), [view.rows, table.apply])
  const show = table.shows
  const what = FLOW_LISTS.cream.what
  // The time the server built this list when it says so; an older server only names the day.
  usePanelFreshness(view.state === 'ok' && view.rows.length ? panelAsOf(SOURCE, view.builtAt || view.date) : null)
  usePanelSymbolRows(sorted.map((r) => r.sym), 'Cream of the Crop', { total: view.rows.length })

  if (read.loading) return <PanelSkeleton label="Loading Cream of the Crop" testId="terminal-flwl-loading" />
  if (read.error && !read.body) return <FailedRead read={read} what={what} code={code} />
  if (view.state === 'computing') {
    return (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-flwl-cream-building">
        The server is building Cream of the Crop now. During the trading session that can take several minutes, because
        it reads the whole day of options trades. This panel asks again every 20 seconds and fills in on its own. That
        is not the same as no positions.
      </PanelState>
    )
  }
  if (view.state !== 'ok') return <FailedRead read={{ ...read, error: null }} what={what} code={code} />

  const day = view.date
  if (!view.rows.length) {
    return (
      <PanelState kind="empty" testId="terminal-flwl-empty"
        title={day ? `No option position has qualified for ${day} yet.` : 'No option position has qualified yet.'}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Check again</button>}>
        The list fills through the trading session and is complete after the close. Before the open, on a weekend and on
        a market holiday it stays empty until the next session trades. This panel checks again every few minutes.
      </PanelState>
    )
  }

  const { rules } = view
  return (
    <>
      {read.error && <p className={styles.note} role="status">{failureText(read.error, what)} Showing the last read.</p>}
      {view.stale && (
        <p className={styles.note} role="status" data-testid="terminal-flwl-cream-stale">
          The server is rebuilding this list now. Until it lands you are reading the list it built earlier.
        </p>
      )}
      <div className={styles.head}>
        <span className={styles.lede} data-testid="terminal-flwl-totals">
          {count(view.counts.bullish)} bullish and {count(view.counts.bearish)} bearish{' '}
          {view.counts.all === 1 ? 'position' : 'positions'}{day ? ` for ${day}` : ''}.
          {view.net ? ` Across the whole market that day: ${money(view.net.bull)} of bullish premium and ${money(view.net.bear)} of bearish premium.` : ''}
        </span>
        <PanelColumns table={table} testId="terminal-flwl-cream-columns" />
      </div>
      <div className={styles.tableBox} data-fold="510">
        <table className={styles.table} data-testid="terminal-flwl-cream"
          aria-label={`Cream of the Crop${day ? ` for ${day}` : ''}, ${view.rows.length} ${view.rows.length === 1 ? 'position' : 'positions'}`}>
          <PanelTableHead table={table} testId="terminal-flwl-cream" />
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.key} data-testid={`terminal-flwl-row-${r.sym}`} data-direction={r.direction}>
                <td>
                  <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                  <PanelSymbol sym={r.sym} className={styles.sym} />
                </td>
                {show('c.contract') && <td className={`${styles.wrapCell} ${styles.snugTight}`}>{contractText(r)}</td>}
                {show('c.direction') && <td className={toneOf(r.direction)}>{directionWords(r)}</td>}
                {show('c.premium') && <td>{money(r.premium)}</td>}
                {show('c.grade') && <td>{r.grade || 'Not graded'}</td>}
                {show('c.voi') && <td className={styles.phoneHide}>
                  {r.newStrike ? 'New strike' : r.volToOi == null ? NA : `${formatNumber(r.volToOi, { decimals: 1 })}×`}
                </td>}
                {show('c.contracts') && <td className={styles.phoneHide}>{formatNumber(r.contracts, { decimals: 0, absent: NA })}</td>}
                {show('c.dte') && <td className={styles.phoneHide}>{formatNumber(r.daysLeft, { decimals: 0, absent: NA })}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.twoSided.length ? (
        <p className={styles.muted} data-testid="terminal-flwl-two-sided">
          Left out because the day&apos;s flow went both ways: {view.twoSided.map((t) => t.sym).join(', ')}.
        </p>
      ) : null}
      <p className={styles.muted} data-testid="terminal-flwl-method">
        Cream of the Crop is the day&apos;s highest-conviction option positions: one row per contract, bullish first, each
        side ranked by grade and then by premium.
        {rules.perSide != null ? ` At most ${count(rules.perSide)} per side` : ''}
        {rules.perSide != null && rules.perStock != null ? ` and ${count(rules.perStock)} per stock.` : rules.perSide != null ? '.' : ''}
        {' '}Premium is the dollars paid at the ask on that contract in the session. Volume vs open interest is the
        contracts bought at the ask against the open interest before the session; New strike means there was none.
        {' '}Index options are left out
        {rules.noWeeklies ? ', and so are weekly expiries' : ''}
        {rules.minDays > 0 ? `${rules.noWeeklies ? ' and' : ', and so are'} contracts with under ${count(rules.minDays)} days to expiry` : ''}.
        {' '}&quot;Side not confirmed&quot; means the direction was read from the contract type (a call bought is bullish, a
        put bought is bearish) on a large trade at the ask. A word names every direction, so color is never the only
        signal. {STUDY_LINE} {CLICK_LINE} For every options trade, open{' '}
        <PanelCommand cmd="FLOW" label="Open Options flow">Options flow (FLOW)</PanelCommand>.
        {read.receivedAt ? ` Read at ${clock(read.receivedAt)}.` : ''}
      </p>
    </>
  )
}

/** Customization pass 1: each list's columns (components/terminal/PanelTable). The server's order is
 *  the default (Cream: grade, then premium; the open board: net premium) and decides which rows are
 *  listed; a header click sorts the rows listed. The keys carry the list's letter (`c.` / `o.`), so
 *  the columns each list hides are its own; the panel keeps one sort, the list on screen's. */
export const CREAM_COLUMNS = Object.freeze([
  { key: 'c.sym', label: 'Symbol', type: 'text', sort: (r) => r.sym, required: true, title: 'Click a symbol to load it into the linked panels' },
  { key: 'c.contract', label: 'Contract', firstDir: 'asc', sort: (r) => r.daysLeft, thClass: `${styles.wrapCell} ${styles.snugTight}`, title: 'Sorts by days to expiry' },
  { key: 'c.direction', label: 'Direction', type: 'text', sort: (r) => r.direction, title: 'Which way the position leans' },
  { key: 'c.premium', label: 'Premium', sort: (r) => r.premium, title: 'Dollars paid at the ask on this contract in the session' },
  { key: 'c.grade', label: 'Grade', sort: (r) => gradeRank(r.grade), title: 'The flow grade of the position, A+ best' },
  { key: 'c.voi', label: 'Volume vs open interest', sort: (r) => r.volToOi, phoneHide: true, thClass: styles.snugWrap,
    title: 'Contracts bought at the ask, against the open interest before the session' },
  { key: 'c.contracts', label: 'Contracts', sort: (r) => r.contracts, phoneHide: true, title: 'Contracts bought at the ask in the session' },
  { key: 'c.dte', label: 'Days to expiry', firstDir: 'asc', sort: (r) => r.daysLeft, phoneHide: true, thClass: styles.snugWrap },
])

function OpenBoard({ code }) {
  // The pace follows the server's own word that it is still building. `building` is adjusted
  // during render from the last answer (no effect, so no extra pass through an old value).
  const [building, setBuilding] = useState(false)
  const read = useMarketRead(FLOW_BOARD_URL, { refreshInterval: building ? BUILD_POLL_MS : BOARD_POLL_MS })
  const view = useMemo(() => boardRead(read.body), [read.body])
  if ((view.state === 'computing') !== building) setBuilding(view.state === 'computing')
  const [all, setAll] = useState(false)
  const table = usePanelTable({ columns: OPEN_COLUMNS })
  const show = table.shows
  const rows = useMemo(() => table.apply(all ? view.rows : view.rows.slice(0, MAX_ROWS)), [view.rows, all, table.apply])
  const what = FLOW_LISTS.open.what
  usePanelFreshness(view.state === 'ok' && view.rows.length ? panelAsOf(SOURCE, view.builtAt) : null)
  usePanelSymbolRows(rows.map((r) => r.sym), 'the open flow board', { total: view.rows.length })

  if (read.loading) return <PanelSkeleton label="Loading the open flow board" testId="terminal-flwl-loading" />
  if (read.error && !read.body) return <FailedRead read={read} what={what} code={code} />
  if (view.state === 'computing') {
    return (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-flwl-building">
        The server is building the open flow board now. That can take a couple of minutes. This panel asks again every 20
        seconds and fills in on its own. That is not the same as no open positions.
      </PanelState>
    )
  }
  if (view.state === 'unavailable') {
    return (
      <PanelState kind="error" title="The server could not build the open flow board just now." testId="terminal-flwl-error"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as no open positions. Retry, or run {code} again.
      </PanelState>
    )
  }
  if (view.state !== 'ok') return <FailedRead read={{ ...read, error: null }} what={what} code={code} />

  const days = view.days ?? BOARD_DAYS
  if (!view.rows.length) {
    return (
      <PanelState kind="empty" testId="terminal-flwl-empty"
        title={`No stock has open directional option positions from the last ${count(days)} trading days.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Check again</button>}>
        That is what the server worked out, not a failed read.
      </PanelState>
    )
  }

  const bullish = view.rows.filter((r) => r.direction === 'bullish').length
  const bearish = view.rows.filter((r) => r.direction === 'bearish').length
  const cutByServer = view.names != null && view.names > view.rows.length
  return (
    <>
      {read.error && <p className={styles.note} role="status">{failureText(read.error, what)} Showing the last read.</p>}
      <div className={styles.head}>
        <span className={styles.lede} data-testid="terminal-flwl-totals">
          {count(view.rows.length)} {view.rows.length === 1 ? 'stock' : 'stocks'} with open positions: {count(bullish)} leaning
          bullish, {count(bearish)} leaning bearish
          {view.openContracts != null ? `, across ${count(view.openContracts)} open ${view.openContracts === 1 ? 'contract' : 'contracts'}` : ''}.
        </span>
        <PanelColumns table={table} testId="terminal-flwl-open-columns" />
      </div>
      {cutByServer ? (
        <p className={styles.note} role="status" data-testid="terminal-flwl-cut">
          The server sends the {count(view.rows.length)} stocks with the highest net premium of {count(view.names)}, so the most
          bearish names can be missing from this list.
        </p>
      ) : null}
      <div className={styles.tableBox} data-fold="480">
        <table className={styles.table} data-testid="terminal-flwl-open"
          aria-label={`Open flow board, ${rows.length} ${rows.length === 1 ? 'stock' : 'stocks'}`}>
          {/* Two merged columns (bullish and bearish premium), so the board fits a half-width panel. */}
          <PanelTableHead table={table} testId="terminal-flwl-open" />
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} data-testid={`terminal-flwl-row-${r.sym}`} data-direction={r.direction || ''}>
                <td>
                  <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                  <PanelSymbol sym={r.sym} className={styles.sym} />
                </td>
                {show('o.contract') && <td className={`${styles.wrapCell} ${styles.snugTight}`}>{contractText(r)}</td>}
                {show('o.direction') && <td className={toneOf(r.direction)}>{directionWords(r)}</td>}
                {show('o.net') && <td className={tone(r.net)}>{r.net == null ? NA : signedMoney(r.net)}</td>}
                {show('o.split') && <td className={`${styles.phoneHide} ${styles.wrapCell} ${styles.snugTight}`}>
                  {money(r.bull)} / {money(r.bear)}
                  {r.bullShare == null ? null : <span className={styles.muted}>{` (${formatPercent(r.bullShare, { decimals: 0 })}${NBSP}bullish)`}</span>}
                </td>}
                {show('o.since') && <td className={`${styles.phoneHide} ${styles.wrapCell} ${styles.snugTight}`}>
                  <span className={tone(r.stockPct)}>{formatPercent(r.stockPct, { decimals: 1, signed: true, absent: NA })}</span>
                  <span className={styles.muted}>{r.since ? ` since${NBSP}${unbroken(r.since)}` : ' (first trade date not given)'}</span>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.rows.length > MAX_ROWS ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.chip} aria-pressed={all} onClick={() => setAll((v) => !v)} data-testid="terminal-flwl-all">
            {all ? `Show the first ${MAX_ROWS}` : `Show all ${count(view.rows.length)} stocks`}
          </button>
        </div>
      ) : null}
      <p className={styles.muted} data-testid="terminal-flwl-method">
        {view.rows.length > rows.length ? `Showing the ${count(rows.length)} biggest of ${count(view.rows.length)}. ` : ''}
        The open flow board is every stock with directional option positions from the last {count(days)} trading days that
        are still open, biggest net premium first in either direction.
        {view.minDays > 0 ? ` Only contracts with at least ${count(view.minDays)} days to expiry when traded are counted.` : ''}
        {' '}A contract counts as still open while its open interest holds near its peak (the server&apos;s own test). Net
        premium is bullish premium less bearish premium; Largest contract is the stock&apos;s biggest open contract by
        premium; Stock since then is the stock&apos;s move from the first trade to the latest one on the tape. A word and a
        sign (+/-) mark every direction, so color is never the only signal. {STUDY_LINE} {CLICK_LINE}
        {view.builtAt ? ` Board built at ${clock(view.builtAt)}.` : ''}
      </p>
    </>
  )
}

/** The open flow board's columns (see CREAM_COLUMNS above). */
export const OPEN_COLUMNS = Object.freeze([
  { key: 'o.sym', label: 'Symbol', type: 'text', sort: (r) => r.sym, required: true, title: 'Click a symbol to load it into the linked panels' },
  { key: 'o.contract', label: 'Largest contract', firstDir: 'asc', sort: (r) => r.daysLeft, thClass: `${styles.wrapCell} ${styles.snugTight}`,
    title: "The stock's largest open contract by premium (sorts by days to expiry)" },
  { key: 'o.direction', label: 'Direction', type: 'text', sort: (r) => r.direction, title: 'Which way the open premium leans' },
  { key: 'o.net', label: 'Net premium', sort: (r) => r.net, title: 'Bullish premium less bearish premium on the open contracts' },
  { key: 'o.split', label: 'Bullish and bearish premium', sort: (r) => r.bullShare, phoneHide: true, thClass: `${styles.wrapCell} ${styles.snugTight}`,
    title: 'Bullish premium, then bearish premium, on the open contracts, and the bullish share of the two (sorts by the bullish share)' },
  { key: 'o.since', label: 'Stock since first trade', sort: (r) => r.stockPct, phoneHide: true, thClass: `${styles.wrapCell} ${styles.snugTight}`,
    title: "The stock's move from the earliest trade behind these positions to the latest one on the tape, and that first trade's date" },
])

export default function FlowListsPanel({ list: listProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || FLOW_LISTS_CODE
  // A new `FLWL OPEN` remounts the panel (the shell keys the body on code + args), so the typed
  // word only ever seeds the state.
  const [list, setList] = useState(() => normFlowList(listProp))
  // A chip writes itself into the command (`FLWL OPEN`) where the registry takes the word, so a
  // reload keeps it; otherwise it is plain component state (commandWriteBack.js).
  const pick = (next) => { setList(next); writeBack(flowListsCommandArgs({ list: next })) }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-flwl" data-list={list}>
      <div className={styles.toolbar} role="toolbar" aria-label="Options flow lists controls">
        <div className={styles.group} role="group" aria-label="List">
          {Object.entries(FLOW_LISTS).map(([key, l]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === list} onClick={() => pick(key)}
              data-testid={`terminal-flwl-list-${key}`}>{l.chip}</button>
          ))}
        </div>
      </div>
      {/* Keyed by list: a new list is a new read, so one list's rows are never drawn under the other's columns. */}
      {list === 'open' ? <OpenBoard key="open" code={code} /> : <CreamList key="cream" code={code} />}
    </div>
  )
}
