// TOPF: the Top Flow picks, one by one, each with how its contract has done since it was picked
// (data wave 6).
//
// ⭐ NO NEW ROUTE. `GET /api/top-flow/history` (any signed-in session; no flag). Until now only the
// Options Flow page read it. The pure half (the Flow record's own scoring, the filters, the typed
// words) is topFlowModel.js, re-exported below.
//
//   TOPF            every pick, biggest gain now first      TOPF OPEN | EXPIRED
//   TOPF BULL       one direction (also BEAR)               TOPF PEAK | LOSERS | NEW   the order
//
// What it adds to the Flow record (FREC): FREC is the record as a whole (win rates, a grade table,
// 12 recent winners and the last 15 scored picks). This is every pick, expired ones included, with
// its entry, its latest or last daily price and its gain, and the picks that are too new to score.
//
// ⛔ ONE DEFINITION OF A GAIN, THE FLOW RECORD'S (topFlowModel.js `pickStats`), so the two panels
// cannot disagree about a pick.
// ⛔ A PICK WITH FEWER THAN TWO DAILY PRICES IS "TOO NEW TO SCORE", in words. It is never drawn as
// 0% or as a loss, and it never ranks among the gains.
// ⛔ THE DAILY PRICES CAN STOP. They are recorded each weekday after the close from Massive
// (from Schwab before November 2026); when Massive has no price for a contract none is stored.
// The panel says how old the newest one is, and every row carries the date of its own latest
// price.
// ⛔ THE RECORD CAN STOP GROWING TOO. When the newest pick is weeks old the panel says so.
// ⛔ A FAILED READ IS NEVER AN EMPTY LIST, and an empty list says what it cannot tell apart.
//
// The read goes through marketRead.js (the terminal's one bare-SWR reader), and SWR skips ticks
// while the app is hidden. The route returns the tracker's in-memory lists and builds nothing on
// the request, so it is not slow on a cold cache.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { formatCurrency, formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { todayIso } from '../../calendar/earningsModalRow'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  MIN_HISTORY_SNAPSHOTS, SNAPSHOT_PICK_CAP, TOP_FLOW_CODE, TOP_FLOW_DIRECTIONS, TOP_FLOW_SORTS, TOP_FLOW_STATUSES, TOP_FLOW_URL,
  countRows, filterRows, normTopFlowDirection, normTopFlowSort, normTopFlowStatus, priceFreshness, sortRows, topFlowCommandArgs,
  topFlowRead,
} from './topFlowModel'
import styles from './marketPanels.module.css'

export {
  DEFAULT_TOP_FLOW_DIRECTION, DEFAULT_TOP_FLOW_SORT, DEFAULT_TOP_FLOW_STATUS, GRADE_ORDER, MIN_HISTORY_SNAPSHOTS, OI_RISE_FACTOR,
  SNAPSHOT_PICK_CAP, STALE_AFTER_DAYS, TOP_FLOW_CODE, TOP_FLOW_DIRECTIONS, TOP_FLOW_DIRECTION_ARG_WORDS, TOP_FLOW_SORTS,
  TOP_FLOW_SORT_ARG_WORDS, TOP_FLOW_STATUSES, TOP_FLOW_STATUS_ARG_WORDS, TOP_FLOW_URL, cleanGrade, countRows, daysBetween, filterRows,
  normTopFlowDirection, normTopFlowSort, normTopFlowStatus, parsePickDay, parseTopFlowDirection, parseTopFlowSort, parseTopFlowStatus,
  pickStats, priceFreshness, round1, sortRows, topFlowCommandArgs, topFlowRead,
} from './topFlowModel'

/** Rows drawn at first, and added by each "Show more"; the rest are counted, never dropped. */
export const PAGE_ROWS = 50
/** The most rows this panel draws. The chips narrow a longer list. */
export const MAX_ROWS = 250
/** The store changes once a day (the afternoon snapshot) and when the desk posts picks. */
const POLL_MS = 30 * 60 * 1000
const SOURCE = 'UCT options flow tape (picks), daily option prices from Massive'
const WHAT = 'The Top Flow picks'
const NA = 'n/a'
/** A hyphen that never breaks a line, so a date stays whole in a sentence. */
const unbroken = (s) => String(s).replace(/-/g, String.fromCharCode(0x2011))

const count = (n) => formatNumber(n, { decimals: 0 })
const money = (v) => formatCurrency(v, { decimals: 2, grouping: true, absent: NA })
const signedPct = (v) => formatPercent(v, { decimals: 1, signed: true, absent: NA })
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)
const toneOf = (direction) => (direction === 'bullish' ? styles.up : direction === 'bearish' ? styles.down : undefined)
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')
const plural = (n, one, many) => (n === 1 ? one : many)
const DIRECTION_WORDS = { bullish: 'Bullish', bearish: 'Bearish' }

/** Pure: a contract's first line: "$420 call". Parts the pick lacks are left out. */
export function contractText(row) {
  const strike = row?.strike == null ? null : formatCurrency(row.strike, { decimals: Number.isInteger(row.strike) ? 0 : 2, grouping: true })
  return [strike, row?.side].filter(Boolean).join(' ') || 'Contract not given'
}

/** Pure: a contract's second line: "exp 6/20", or "expired 6/20" once the server has filed it as expired. The expiry
 *  is the store's own text. A pick the desk stopped early has not expired: it keeps "exp", and its row adds a line. */
export function expiryText(row) {
  const exp = row?.exp ? unbroken(row.exp) : null
  if (row?.status === 'expired' && !row.stopped) return exp ? `expired ${exp}` : 'expired'
  return exp ? `exp ${exp}` : 'no expiry given'
}

/** Pure: why a pick has no gain, as the two lines its cell shows. Words only: never a 0%. */
export function unscoredWords(row) {
  const n = row?.prices || 0
  if (row?.status === 'expired') {
    const how = row.stopped ? 'stopped' : 'expired'
    return ['Never scored', n ? `${how}, ${count(n)} daily ${plural(n, 'price', 'prices')}` : `${how}, no daily price`]
  }
  return ['Too new to score', n ? `${count(n)} daily ${plural(n, 'price', 'prices')} so far` : 'no price yet']
}

/** Pure: the whole store in one sentence, and the picks that have no score yet. */
export function totalsSentence(c) {
  const head = `${count(c.all)} ${plural(c.all, 'pick', 'picks')} on record: ${count(c.open)} open, ${count(c.expired)} expired`
    + `${c.stopped ? ` (${count(c.stopped)} of them stopped early)` : ''}. ${count(c.scored)} ${plural(c.scored, 'is', 'are')} scored.`
  const tooNew = c.tooNew
    ? ` ${count(c.tooNew)} open ${plural(c.tooNew, 'pick is', 'picks are')} too new to score`
      + `${c.noPrice ? ` (${count(c.noPrice)} with no price yet)` : ''}.`
    : ''
  const never = c.neverScored
    ? ` ${count(c.neverScored)} ended with fewer than ${count(MIN_HISTORY_SNAPSHOTS)} daily prices, so ${plural(c.neverScored, 'it was', 'they were')} never scored.`
    : ''
  return `${head}${tooNew}${never}`
}

function FailedRead({ read, code }) {
  const err = read.body ? null : read.error
  const locked = err ? !canRetry(err) : false
  return (
    <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-topf-error"
      title={err ? failureText(err, WHAT) : `${WHAT} came back in a form this panel cannot read.`}
      action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
      {locked ? null : `That is not the same as no picks. Retry, or run ${code} again.`}
    </PanelState>
  )
}

function PickRow({ r, i }) {
  const [why, detail] = r.scored ? [null, null] : unscoredWords(r)
  return (
    <tr data-testid="terminal-topf-row" data-sym={r.sym} data-status={r.status} data-scored={r.scored ? 'yes' : 'no'}>
      <td>
        <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
        <PanelSymbol sym={r.sym} className={styles.sym} />
      </td>
      <td>
        {contractText(r)}
        <br />
        <span className={styles.muted}>{expiryText(r)}</span>
        {r.stopped ? (
          <>
            <br />
            <span className={styles.muted}>stopped early</span>
          </>
        ) : null}
      </td>
      <td className={styles.phoneHide}>
        {r.grade || 'Not graded'}
        <br />
        <span className={r.direction ? toneOf(r.direction) : styles.muted}>{r.direction ? DIRECTION_WORDS[r.direction] : 'No direction'}</span>
      </td>
      <td className={styles.phoneHide}>
        {r.entry == null ? 'Not recorded' : money(r.entry)}
        {r.entryFromFirstPrice ? <span className={styles.muted}> (first price)</span> : null}
        <br />
        <span className={styles.muted}>{r.savedDay || r.savedText ? `on ${unbroken(r.savedDay || r.savedText)}` : 'pick date not given'}</span>
      </td>
      <td>
        {r.scored ? (
          <>
            {money(r.latestPrice)} <span className={tone(r.currentGainPct)}>{signedPct(r.currentGainPct)}</span>
            <br />
            <span className={styles.muted}>{r.latestDay ? `as of ${unbroken(r.latestDay)}` : 'date not given'}</span>
            {r.laterQuoteNoPrice ? (
              <>
                <br />
                <span className={styles.muted}>later quote had no price</span>
              </>
            ) : null}
          </>
        ) : (
          <>
            {why}
            <br />
            <span className={styles.muted}>{detail}</span>
          </>
        )}
      </td>
      <td className={styles.phoneHide}>
        {r.scored ? (
          <>
            <span className={tone(r.maxGainPct)}>{signedPct(r.maxGainPct)}</span>
            <br />
            <span className={styles.muted}>{count(r.daysTracked)} {plural(r.daysTracked, 'day', 'days')}</span>
          </>
        ) : NA}
      </td>
    </tr>
  )
}

export default function TopFlowPanel({ status: statusProp = null, direction: directionProp = null, sort: sortProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || TOP_FLOW_CODE
  const [today] = useState(todayIso)
  // A new `TOPF OPEN` remounts the panel (the shell keys the body on code + args), so the typed
  // words only ever seed the state.
  const [status, setStatus] = useState(() => normTopFlowStatus(statusProp))
  const [direction, setDirection] = useState(() => normTopFlowDirection(directionProp))
  const [sort, setSort] = useState(() => normTopFlowSort(sortProp))
  const [limit, setLimit] = useState(PAGE_ROWS)
  // A pick writes itself into the command (`TOPF OPEN BULL PEAK`) where the registry takes the
  // words, so a reload keeps it; otherwise it is plain component state (commandWriteBack.js).
  const pick = (next) => {
    const now = { status, direction, sort, ...next }
    setStatus(now.status)
    setDirection(now.direction)
    setSort(now.sort)
    setLimit(PAGE_ROWS)
    writeBack(topFlowCommandArgs(now))
  }

  const read = useMarketRead(TOP_FLOW_URL, { refreshInterval: POLL_MS })
  const view = useMemo(() => topFlowRead(read.body), [read.body])
  const ok = !read.loading && !!read.body && view.state === 'ok'
  const matched = useMemo(() => sortRows(filterRows(view.rows, { status, direction }), sort), [view.rows, status, direction, sort])
  const shown = useMemo(() => matched.slice(0, limit), [matched, limit])
  const totals = useMemo(() => countRows(view.rows), [view.rows])
  const fresh = useMemo(() => priceFreshness(view, today), [view, today])
  usePanelFreshness(ok && view.rows.length ? panelAsOf(SOURCE, view.newestDay) : null)
  usePanelSymbolRows(ok ? shown.map((r) => r.sym) : [], 'the Top Flow picks', { total: matched.length })

  if (read.loading) return <PanelSkeleton label="Loading the Top Flow picks" testId="terminal-topf-loading" />
  if (!read.body || view.state !== 'ok') return <FailedRead read={read} code={code} />

  const wrapCls = `${styles.wrap} ${inPanel ? styles.inPanel : ''}`
  if (!view.rows.length) {
    return (
      <div className={wrapCls} data-testid="terminal-topf" data-state="empty">
        <PanelState kind="empty" role="status" testId="terminal-topf-empty" title="No Top Flow pick is on record."
          action={<button type="button" className={styles.chip} onClick={read.retry}>Check again</button>}>
          The server answered with an empty list. Either no pick has been saved yet, or the server could not read its
          store of picks when it last started; its answer does not say which.
          {view.unread ? ` ${count(view.unread)} ${plural(view.unread, 'entry', 'entries')} came without a symbol and could not be read.` : ''}
        </PanelState>
      </div>
    )
  }

  const filtered = status !== 'all' || direction !== 'any'
  const canShowMore = shown.length < matched.length && shown.length < MAX_ROWS
  return (
    <div className={wrapCls} data-testid="terminal-topf" data-state="ok" data-status={status} data-direction={direction} data-sort={sort}>
      <div className={styles.toolbar} role="toolbar" aria-label="Top Flow picks controls">
        <div className={styles.group} role="group" aria-label="Which picks">
          {Object.entries(TOP_FLOW_STATUSES).map(([key, s]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === status} onClick={() => pick({ status: key })}
              data-testid={`terminal-topf-status-${key}`}>{s.chip}</button>
          ))}
        </div>
        <div className={styles.group} role="group" aria-label="Direction">
          {Object.entries(TOP_FLOW_DIRECTIONS).map(([key, d]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === direction} onClick={() => pick({ direction: key })}
              data-testid={`terminal-topf-direction-${key}`}>{d.chip}</button>
          ))}
        </div>
        <div className={styles.group} role="group" aria-label="Order">
          {Object.entries(TOP_FLOW_SORTS).map(([key, s]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === sort} onClick={() => pick({ sort: key })}
              data-testid={`terminal-topf-sort-${key}`}>{s.chip}</button>
          ))}
        </div>
      </div>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-topf-stale-read">{failureText(read.error, WHAT)} Showing the last read.</p> : null}
      {!fresh.newestDay ? (
        <p className={styles.note} role="status" data-testid="terminal-topf-no-prices">
          No daily price has been stored for any pick yet. Prices are recorded about 4:30 PM ET on weekdays from Massive.
          Until the first one lands every pick reads as too new to score, which is not a gain of 0%.
        </p>
      ) : fresh.stale ? (
        <p className={styles.note} role="status" data-testid="terminal-topf-stale">
          The newest daily price is from {unbroken(fresh.newestDay)}, {count(fresh.ageDays)} days ago. Daily prices are
          recorded from Massive; when it has no price for a contract none is stored, and its
          history stops. Every gain below is as of the date in its own row, not today.
        </p>
      ) : null}
      {fresh.noNewPicks ? (
        <p className={styles.note} role="status" data-testid="terminal-topf-no-new-picks">
          The newest pick on this record is from {unbroken(fresh.newestPickDay)}, {count(fresh.pickAgeDays)} days ago. No
          pick has been added since, so this is a record of older picks, not a list of current ideas.
        </p>
      ) : null}
      <div className={styles.head}>
        <span className={styles.lede} data-testid="terminal-topf-totals">
          {totalsSentence(totals)}
          {filtered ? ` ${count(matched.length)} ${plural(matched.length, 'matches', 'match')} the chips above.` : ''}
        </span>
        {fresh.newestDay && !fresh.stale ? (
          <span className={styles.lede} data-testid="terminal-topf-newest">Newest daily price: {unbroken(fresh.newestDay)}.</span>
        ) : null}
      </div>
      {matched.length ? (
        <div className={styles.tableBox} data-fold="550">
          <table className={styles.table} data-testid="terminal-topf-table"
            aria-label={`Top Flow picks, ${TOP_FLOW_SORTS[sort].words}, ${shown.length} of ${matched.length}`}>
            <thead>
              <tr>
                <th scope="col" title="Click a symbol to load it into the linked panels">Symbol</th>
                <th scope="col" title="The option contract: strike, call or put, and its expiry as the flow tape carried it">Contract</th>
                <th scope="col" className={styles.phoneHide} title="The flow grade when it was picked, A+ best, and which way the pick leans">Grade</th>
                <th scope="col" className={styles.phoneHide} title="The average contract price of the flagged trades, per share, and the day it was picked">Entry</th>
                <th scope="col" title="The newest daily price of the contract and its gain against the entry, with that price's date. For an expired pick, its last daily price.">Latest price</th>
                <th scope="col" className={styles.phoneHide} title="The best daily price against the entry, and the days from the first daily price to the latest">Peak</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => <PickRow key={r.key} r={r} i={i} />)}
            </tbody>
          </table>
        </div>
      ) : (
        <PanelState kind="empty" compact role="status" testId="terminal-topf-none-match" title="No pick on record matches the chips above."
          action={<button type="button" className={styles.chip} onClick={() => pick({ status: 'all', direction: 'any' })}>Show all picks</button>}>
          That is what is on record, not a failed read.
        </PanelState>
      )}
      {shown.length < matched.length ? (
        <div className={styles.toolbar}>
          {canShowMore ? (
            <button type="button" className={styles.chip} data-testid="terminal-topf-more"
              onClick={() => setLimit((n) => Math.min(MAX_ROWS, n + PAGE_ROWS))}>
              Show {count(Math.min(PAGE_ROWS, MAX_ROWS - shown.length, matched.length - shown.length))} more
            </button>
          ) : null}
          <span className={styles.muted} data-testid="terminal-topf-cut">
            Showing the first {count(shown.length)} of {count(matched.length)}, {TOP_FLOW_SORTS[sort].words}.
            {canShowMore ? '' : ` This panel draws ${count(MAX_ROWS)} at most; the chips above narrow the list or change its order.`}
          </span>
        </div>
      ) : null}
      {fresh.newestDay && fresh.behind ? (
        <p className={styles.muted} data-testid="terminal-topf-behind">
          {count(fresh.behind)} open {plural(fresh.behind, 'pick has', 'picks have')} no price from {unbroken(fresh.newestDay)}, the
          newest day on record: the server prices the {count(SNAPSHOT_PICK_CAP)} newest open picks each day and skips a contract
          with no quote. Each row shows the date of its own latest price.
        </p>
      ) : null}
      {view.unread ? (
        <p className={styles.muted} data-testid="terminal-topf-unread">
          {count(view.unread)} {plural(view.unread, 'entry', 'entries')} in the store came without a symbol and {plural(view.unread, 'is', 'are')} not listed.
        </p>
      ) : null}
      <p className={styles.muted} data-testid="terminal-topf-method">
        Picks are the top bullish and bearish contracts on the desk&apos;s options flow watchlist, saved each time the desk
        posts that list. A pick and its entry come from UCT&apos;s options flow tape: the entry is the average price its
        flagged trades paid for the contract. Its daily prices are recorded about 4:30 PM ET on weekdays until the
        contract expires, from Massive (prices recorded before November 2026 came from Schwab and stay as recorded). A gain is the contract&apos;s own price against its entry, not the
        stock&apos;s move: the latest gain uses the newest daily price, the peak the best one, and an expired pick keeps
        the gain of its last daily price. For a bearish pick on a call, or a bullish pick on a put, a falling contract
        price is what the pick wanted, and it still reads as a loss here. A pick needs {count(MIN_HISTORY_SNAPSHOTS)} daily
        prices to be scored; until then it is too new, which is not 0%. A daily quote with no price is skipped, so a
        contract that expired worthless shows its last priced day, not zero. Losing picks are never removed. These are
        the rules of the Flow record; for win rates across every pick, open{' '}
        <PanelCommand cmd="FREC" label="Open the Flow record">Flow record (FREC)</PanelCommand>. Past picks describe the past;
        this is not a forecast or a recommendation. A word and a sign (+/-) mark every gain and direction, so color is
        never the only signal. Click a symbol to load it into the linked panels; type a row number to do the same.
        {read.receivedAt && clock(read.receivedAt) ? ` Read at ${clock(read.receivedAt)}; this panel reads the list again every 30 minutes.` : ''}
      </p>
    </div>
  )
}
