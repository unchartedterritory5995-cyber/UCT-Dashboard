// ACCUM: repeat-hit option contracts under the day's flow read (data wave 4).
//
// ⭐ NO NEW ROUTE. `GET /api/live/massive/day-stats` (the day's bullish against bearish option
// premium) and `GET /api/live/massive/by-contract` (the contracts hit again and again in the
// session). Until now only the Live Flow page read them, and no Terminal panel showed either
// (LIVE is a door to that page). The pure half (the URLs, the gate, the row shaping, the typed
// words) is repeatContractsModel.js, re-exported below. Both routes belong to the partner-owned
// Live Flow router: read here, never changed.
//
//   ACCUM              today, strongest first      ACCUM LATEST       today, latest first
//   ACCUM 2026-11-13   a past session              ACCUM 11/13 LATEST
//
// A chip switches the order and writes it back into the panel's command. A symbol loads that name
// into the linked panels; typing its row number does the same.
//
// ⛔ TODAY IS READ THROUGH THE TWO KEYS THE FLOW-WORKER ALREADY WARMS (repeatContractsModel.js).
// A past day is offered once, from the empty state, and is one cached read on the server.
// ⛔ A FAILED READ IS NEVER AN EMPTY LIST. A read that fails is an error with Retry; only a healthy
// answer with no contracts says nothing has been hit often enough, and for which date.
// ⛔ THE TWO READS FAIL APART. The day's read is one line above the list: when it cannot be read
// the list still shows, and the other way round.
//
// The reads go through marketRead.js (the terminal's one bare-SWR reader), and SWR skips ticks
// while the app is hidden.
import { useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import {
  formatCompactTerminal, formatCurrency, formatNumber, formatPercent, formatTimeEt,
} from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  REPEAT_CODE, REPEAT_MIN_HITS, REPEAT_ORDERS, dayRead, dayReadUrl, directionWords, leanPhrase, normRepeatDate, normRepeatOrder,
  orderRows, previousWeekday, repeatCommandArgs, repeatContractsUrl, repeatRead,
} from './repeatContractsModel'
import ListAlertSwitch from './ListAlertSwitch'
import styles from './marketPanels.module.css'

export {
  REPEAT_CODE, REPEAT_MIN_HITS, REPEAT_ORDERS, REPEAT_ORDER_ARG_WORDS, dayRead, dayReadUrl, directionWords, isoDay, leanPhrase,
  normRepeatDate, normRepeatOrder, orderRows, parseRepeatOrder, previousWeekday, repeatCommandArgs, repeatContractsUrl, repeatRead,
} from './repeatContractsModel'

/** Rows drawn until the member asks for all of them; the rest are counted, never dropped. */
export const MAX_ROWS = 100
/** The server caches today's answers for two minutes; a past day does not change, so it is read once. */
const TODAY_POLL_MS = 2 * 60 * 1000
const SOURCE = 'UCT options flow'
const LIST = 'The repeat-hit contracts list'
const READ = "The day's flow read"
const NA = 'n/a'
/** A space and a hyphen that never break a line, so "5 min" and a date stay whole in a narrow cell. */
const NBSP = String.fromCharCode(160)
const unbroken = (s) => String(s).replace(/-/g, String.fromCharCode(0x2011))

const count = (n) => formatNumber(n, { decimals: 0, absent: NA })
const money = (v) => formatCompactTerminal(v, { money: true, absent: NA })
const share = (v) => formatPercent(v, { decimals: 0 })
const toneOf = (direction) => (direction === 'bullish' ? styles.up : direction === 'bearish' ? styles.down : undefined)
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')
const plural = (n, one, many) => (n === 1 ? one : many)

/** Pure: a contract in plain words: "$420 call, expires 2026-12-18". Parts the row lacks are left out. */
export function contractText(row) {
  const strike = row?.strike == null ? null : formatCurrency(row.strike, { decimals: Number.isInteger(row.strike) ? 0 : 2 })
  const head = [strike, row?.side].filter(Boolean).join(' ')
  const tail = row?.expiry ? `expires ${row.expiry}` : ''
  return [head, tail].filter(Boolean).join(', ') || 'Not given'
}

/** The one-line read of the day. It never blanks the list: a failed read is a note above it. */
function DayRead({ date }) {
  const read = useMarketRead(dayReadUrl(date), { refreshInterval: date ? 0 : TODAY_POLL_MS })
  const view = useMemo(() => dayRead(read.body), [read.body])

  if (read.loading) return <p className={styles.muted} role="status" data-testid="terminal-accum-read-loading">Reading the day&apos;s flow.</p>
  if ((read.error && !read.body) || view.state !== 'ok') {
    // Signed out, not on a paid plan, not switched on: the list below says so once.
    if (read.error && (read.error.status === 401 || !canRetry(read.error))) return null
    return (
      <p className={styles.note} role="status" data-testid="terminal-accum-read-error">
        {read.error && !read.body ? failureText(read.error, READ) : `${READ} could not be read just now.`} The contracts below
        are a separate read.{' '}
        <button type="button" className={styles.linkBtn} onClick={read.retry}>Retry the read</button>
      </p>
    )
  }

  const day = view.date
  const on = day ? ` for ${day}` : ''
  return (
    <>
      <div className={styles.head}>
        <span className={styles.lede} data-testid="terminal-accum-read" data-lean={view.lean || ''}>
          {view.lean ? (
            <>
              <span className={toneOf(view.lean)}>{leanPhrase(view)}</span>{on}: {money(view.bull)} bullish
              {view.bullSharePct == null ? '' : ` (${share(view.bullSharePct)})`} against {money(view.bear)} bearish
              {view.trades == null ? '' : `, from ${count(view.trades)} directional ${plural(view.trades, 'trade', 'trades')}`}.
              {view.lastHour ? ` ${view.lastHour.live ? 'Last 60 minutes' : 'Last hour of the session'}: ${money(view.lastHour.bull)} bullish, ${money(view.lastHour.bear)} bearish.` : ''}
            </>
          ) : date ? `No directional option premium was read${on}.` : `No directional option premium has been read${on} yet.`}
        </span>
      </div>
      {view.coversFrom ? (
        <p className={styles.note} role="status" data-testid="terminal-accum-read-cut">
          The server cut this day&apos;s read: it starts at {clock(view.coversFrom)}, so the morning is missing from these totals.
        </p>
      ) : null}
      {read.error ? <p className={styles.note} role="status">{failureText(read.error, READ)} Showing the last read.</p> : null}
    </>
  )
}

function Contracts({ code, date, order, onDate }) {
  const read = useMarketRead(repeatContractsUrl(date), { refreshInterval: date ? 0 : TODAY_POLL_MS })
  const view = useMemo(() => repeatRead(read.body), [read.body])
  const [all, setAll] = useState(false)
  const ordered = useMemo(() => orderRows(view.rows, order), [view.rows, order])
  const rows = useMemo(() => (all ? ordered : ordered.slice(0, MAX_ROWS)), [ordered, all])
  usePanelFreshness(view.state === 'ok' && view.rows.length ? panelAsOf(SOURCE, view.latestAt || view.date) : null)
  usePanelSymbolRows(rows.map((r) => r.sym), 'the repeat-hit contracts', { total: view.rows.length })

  if (read.loading) return <PanelSkeleton label="Loading the repeat-hit contracts" testId="terminal-accum-loading" />
  if ((read.error && !read.body) || view.state !== 'ok') {
    const failed = read.body ? null : read.error
    const locked = !canRetry(failed)
    return (
      <PanelState kind={failed ? failureKind(failed) : 'error'} testId="terminal-accum-error"
        title={failed ? failureText(failed, LIST) : `${LIST} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as an empty list. Retry, or run ${code} again.`}
      </PanelState>
    )
  }

  const day = view.date
  const minHits = view.minHits ?? REPEAT_MIN_HITS
  const earlier = previousWeekday(day)
  if (!view.rows.length) {
    return (
      <PanelState kind="empty" testId="terminal-accum-empty"
        title={date
          ? `No contract was hit ${count(minHits)} or more times${day ? ` on ${day}` : ''}.`
          : `No contract has been hit ${count(minHits)} or more times${day ? ` on ${day}` : ''} yet.`}
        action={earlier ? (
          <button type="button" className={styles.chip} onClick={() => onDate(earlier)} data-testid="terminal-accum-earlier">
            Show the weekday before ({unbroken(earlier)})
          </button>
        ) : null}>
        {date
          ? 'That is what the server worked out for that day, not a failed read. A weekend or a market holiday has no trades.'
          : 'The list fills through the trading session. Before the open, on a weekend and on a market holiday it stays empty until the next session trades. This panel checks again every two minutes.'}
      </PanelState>
    )
  }

  return (
    <>
      {read.error && <p className={styles.note} role="status">{failureText(read.error, LIST)} Showing the last read.</p>}
      <div className={styles.tableBox} data-fold="550">
        <table className={styles.table} data-testid="terminal-accum-table"
          aria-label={`Repeat-hit option contracts${day ? ` for ${day}` : ''}, ${rows.length} ${plural(rows.length, 'contract', 'contracts')}`}>
          <thead>
            <tr>
              <th scope="col" title="Click a symbol to load it into the linked panels">Symbol</th>
              <th scope="col" className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`}>Contract</th>
              <th scope="col" title="Trades on this contract in the session that cleared the size floor for the stock, and all its trades counted">Hits</th>
              <th scope="col" title="Dollars across all the contract's trades in the session, and the session's contracts against the open interest before it (OI)">Premium</th>
              <th scope="col" title="Which way the contract's premium leans, and the share of all its premium on that side; the rest went the other way or has no readable side">Direction</th>
              <th scope="col" className={`${styles.phoneHide} ${styles.wrapCell} ${styles.snugTight}`}
                title="The grade of the build as a whole, A+ best, and its fastest stretch when four or more hits landed inside five minutes">Grade and pace</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} data-testid="terminal-accum-row" data-sym={r.sym} data-direction={r.direction}>
                <td>
                  <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                  <PanelSymbol sym={r.sym} className={styles.sym} />
                </td>
                <td className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`}>{unbroken(contractText(r))}</td>
                <td>
                  {count(r.hits)}
                  {r.trades != null && r.hits != null && r.trades > r.hits ? <span className={styles.muted}>{` of${NBSP}${count(r.trades)}`}</span> : null}
                </td>
                <td className={styles.phoneWrap}>
                  {money(r.premium)}
                  {r.volToOi == null ? null : <span className={styles.muted}>{` ${formatNumber(r.volToOi, { decimals: 1 })}×${NBSP}OI`}</span>}
                </td>
                <td className={`${toneOf(r.direction) || ''} ${styles.phoneWrap}`.trim()}>
                  {directionWords(r)}
                  {r.leanSharePct == null ? null : <span className={styles.muted}>{` (${share(r.leanSharePct)})`}</span>}
                </td>
                <td className={`${styles.phoneHide} ${styles.wrapCell} ${styles.snugTight}`}>
                  {r.grade || 'Not graded'}
                  {r.burst && r.burstHits != null ? (
                    <span className={styles.muted}>{` ${count(r.burstHits)} in 5${NBSP}min${r.burstRising ? ', price rising' : ''}`}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.rows.length > MAX_ROWS ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.chip} aria-pressed={all} onClick={() => setAll((v) => !v)} data-testid="terminal-accum-all">
            {all ? `Show the first ${MAX_ROWS}` : `Show all ${count(view.rows.length)} contracts`}
          </button>
        </div>
      ) : null}
      <p className={styles.muted} data-testid="terminal-accum-method">
        {view.rows.length > rows.length ? `Showing the first ${count(rows.length)} of ${count(view.rows.length)} in this order. ` : ''}
        A contract is listed when it was hit {count(minHits)} or more times in the session by trades that clear a size floor set
        for the stock&apos;s market cap, and its total premium clears a second floor; the whole session is read, not a sample.
        Repeated buying of one contract is how a position gets built, so this is the accumulation the trade-by-trade tape
        hides. Hits counts the trades over the floor, then all the contract&apos;s trades. Premium is the dollars across all of
        them; the figure beside it is the session&apos;s contracts against the open interest before the session (OI), left out
        when that open interest is not known, and under 1× the trades may not be new positions. Direction is the side the
        premium leans and the share of all the contract&apos;s premium on that side; Mixed means both sides traded. Grade
        scores the build as a whole. Strongest first is the server&apos;s own score (hits times premium, weighted for
        one-sidedness, volume against open interest and pace); Latest first is the newest trade first. A word marks every
        direction, so color is never the only signal. A list says which stocks to study; it is not a forecast or a
        recommendation. Click a symbol to load it into the linked panels; type a row number to do the same.
        {view.latestAt ? ` Newest trade in this list: ${clock(view.latestAt)}.` : ''}
        {read.receivedAt ? ` Read at ${clock(read.receivedAt)}.` : ''}
      </p>
    </>
  )
}

export default function RepeatContractsPanel({ date: dateProp = null, order: orderProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || REPEAT_CODE
  // A new `ACCUM LATEST` remounts the panel (the shell keys the body on code + args), so the typed
  // words only ever seed the state.
  const [date, setDate] = useState(() => normRepeatDate(dateProp))
  const [order, setOrder] = useState(() => normRepeatOrder(orderProp))
  // A pick writes itself into the command (`ACCUM 2026-11-13 LATEST`) where the registry takes the
  // words, so a reload keeps it; otherwise it is plain component state (commandWriteBack.js).
  const pick = (next) => {
    const now = { date, order, ...next }
    setDate(now.date)
    setOrder(now.order)
    writeBack(repeatCommandArgs(now))
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-accum" data-order={order} data-date={date || ''}>
      <div className={styles.toolbar} role="toolbar" aria-label="Repeat-hit contracts controls">
        <div className={styles.group} role="group" aria-label="Order">
          {Object.entries(REPEAT_ORDERS).map(([key, o]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === order} onClick={() => pick({ order: key })}
              data-testid={`terminal-accum-order-${key}`}>{o.chip}</button>
          ))}
        </div>
        {date ? (
          <div className={styles.group} role="group" aria-label="Day">
            <span className={styles.muted} data-testid="terminal-accum-day">Showing {unbroken(date)}, a past session.</span>
            <button type="button" className={styles.chip} onClick={() => pick({ date: null })} data-testid="terminal-accum-today">Back to today</button>
          </div>
        ) : null}
      </div>
      {/* "Alert me when a stock I follow appears here" (a new repeat-hit contract). Draws nothing until the server says the alerts are on. */}
      <ListAlertSwitch kind="repeat_contracts" />
      {/* Keyed by day: a new day is a new read, so one day's numbers are never drawn under another day's date. */}
      <DayRead key={`read-${date || 'today'}`} date={date} />
      <Contracts key={`list-${date || 'today'}`} code={code} date={date} order={order} onDate={(d) => pick({ date: d })} />
    </div>
  )
}
