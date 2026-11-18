// MYH: "My history on this stock", the member's own Journal record on one name. `NVDA MYH`.
//
// ⭐ NO NEW ROUTE. Five reads the Journal already makes, each for the signed-in member only
// (api/routers/journal_two.py, `Depends(get_current_user)`): the accounts list (the same read PERF
// makes), the closed stock trades filtered to the symbol, the open positions, the option
// strategies on the underlying, and the Notebook notes that carry the ticker. The pure half (the
// URLs, the exact-ticker filter, the row shaping, the sentences) is myHistoryModel.js, re-exported
// below.
//
//   NVDA MYH        the account the Journal is on     NVDA MYH 2     your second account
//   NVDA MYH ALL    all your accounts together
//
// Three sections: what you hold in it now, your closed trades on it (the numbers, then the trades
// newest first) and the newest notes that name it (a title and a date; a note opens in the
// Notebook, its text is never drawn here).
//
// ⛔ PERSONAL DATA. Every read is one of the member's own `/api/j2/` routes; nothing here takes a
// member id, an account is named in the command by its place in the list (never by its id), and
// nothing read here is sent anywhere else.
// ⛔ THE JOURNAL'S OWN NUMBERS. The stats are the Journal's `summaryStats` over the list its Trade
// Journal tab shows for this stock; a trade's R is the row's own; an open position's stop, date
// and unrealized result follow the Journal's Open Positions table (no real stop logged: it says
// so, never a fake stop; a broker import's placeholder date: "estimated"; no price: no result).
// ⛔ HONEST STATES. A failed read is an error with Retry, never "no trades" and never "not held".
// The reads fail apart: one failing never blanks the others. A number from a small sample is
// shown with its sample and marked, in PERF's words.
// ⛔ NO TRADER ARCHIVE. This is the member's own record only: nothing the trading team said or
// called is read here (WHO, HIS and CHK are different panels).
// ⛔ ONLY THE CLOSED-TRADE TABLE IS A TABLE. Share reads a panel's tables, and this code is
// classed as the member's own records (share/shareRule.js). The holding rows carry a live price
// (licensed data), so they are a list, never a table, and can never leave in a shared picture
// or file. MyHistoryPanel.test.jsx pins that.
//
// A record changes when the member logs or closes a trade, so nothing here polls. The one live
// number is an open stock position's price, from the app-wide live-price pool the panel header
// already reads for this name.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import Select from '../../../components/ui/Select'
import useLivePrices from '../../../hooks/useLivePrices'
import { useMarkPreferenceContext } from '../../../hooks/useBrokerMarkPreference'
import {
  dateShort, holdDaysDisplay, percent as journalPercent, preferBrokerMarks, rMultiple as journalR, shares as journalShares,
} from '../../../lib/journal-2-0'
import { formatCurrency, formatNumber, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  ACCOUNTS_URL, CONFIDENCE_MIN, JOURNAL_ACCOUNT_KEY, accountsRead, parsePerformanceAccount, pickAccount, sampleText,
} from './performanceModel'
import {
  MY_HISTORY_CODE, NO_R_TEXT, TRADES_SHOWN, historySentence, historyStats, holdingRows, journalRows, myHistoryCommandArgs,
  notesRead, notesUrl, optionsRead, optionsUrl, positionsRead, positionsUrl, rCoverageSentence, tradeRows, tradesRead, tradesUrl,
} from './myHistoryModel'
import styles from './marketPanels.module.css'
import own from './performancePanel.module.css'

export {
  MY_HISTORY_CODE, NOTES_LIMIT, NOTES_URL, NO_R_TEXT, OPTIONS_URL, POSITIONS_URL, TRADES_SHOWN, TRADES_URL, historySentence,
  historyStats, holdingRows, journalRows, myHistoryCommand, myHistoryCommandArgs, notesRead, notesUrl, optionsRead, optionsUrl,
  positionsRead, positionsUrl, rCoverageSentence, tradeRows, tradesRead, tradesUrl,
} from './myHistoryModel'

const SOURCE = 'Your journal'
const WHAT = 'Your journal'
const NA = 'n/a'
/** One empty list for every read that has not answered, so a memo's input keeps its identity. */
const NO_ROWS = Object.freeze([])

const count = (n) => formatNumber(n, { decimals: 0 })
const usd = (v) => formatCurrency(v, { grouping: true, absent: NA })
const signedUsd = (v) => (v > 0 ? `+${usd(v)}` : usd(v))
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)
/** An average in R, signed, to two places as PERF prints one; a value that rounds to zero is zero. */
const rText = (v) => {
  const x = Math.round(v * 100) / 100 || 0
  return `${x > 0 ? '+' : ''}${formatNumber(x, { decimals: 2 })}R`
}
// The numbers the Journal itself prints go through the Journal's own formatters (lib/journal-2-0
// format.js), so a win rate, a percent, an R and a hold time read digit for digit as they do there.
/** A date as the Journal's tables print one (Eastern time), or null. */
const day = (iso) => (iso ? dateShort(iso) : null)
const sizeText = (n, unit, fractional) => `${journalShares(n, fractional)} ${n === 1 ? unit : `${unit}s`}`

/** Pure: a stat's value as text, or null when it has none (the panel then says why). */
export function historyValueText(s) {
  if (!s || s.value === null || s.value === undefined) return null
  switch (s.kind) {
    case 'count': return count(s.value)
    case 'pct': return journalPercent(s.value, { dp: 1, isRatio: false })
    case 'signedUsd': return signedUsd(s.value)
    case 'r': return rText(s.value)
    case 'days': return holdDaysDisplay(s.value).replace(/d$/, ' days')
    default: return formatNumber(s.value, { decimals: 2 })
  }
}
const isSigned = (s) => s.kind === 'signedUsd' || s.kind === 'r'

/** The Journal's own account pick (an id, `_all_` or null). Read once, never written. */
function readJournalPick() {
  try { return window.localStorage.getItem(JOURNAL_ACCOUNT_KEY) || null } catch { return null }
}

/** One read's outcome: 'loading' | 'http' (the request itself failed) | the model's own state. */
const outcomeOf = (q, parsed) => (!q.body && !q.error ? 'loading' : q.error && !q.body ? 'http' : parsed.state)

/** A failed part of the panel: what could not be read, what that is NOT the same as, and a way back. */
function PartFailed({ id, what, notSame, q, state }) {
  const lower = what.replace(/^Your /, 'your ')
  return (
    <p className={styles.note} role="status" data-testid={`terminal-myh-${id}-error`}>
      {state === 'http' && (q.error?.status === 401 || !canRetry(q.error)) ? failureText(q.error, WHAT)
        : state === 'http' && q.error?.timedOut ? `${what} did not answer within 30 seconds.` : `${what} could not be read just now.`}
      {' '}{notSame}{' '}
      {state === 'http' && !canRetry(q.error) ? null : (
        <button type="button" className={styles.linkBtn} onClick={() => q.retry()}>Retry {lower}</button>
      )}
    </p>
  )
}

function HoldingList({ sym: s, rows, accountNames }) {
  return (
    <ul className={styles.newsList} data-testid="terminal-myh-holding-list">
      {rows.map((h) => {
        const account = accountNames ? accountNames.get(h.accountId) || null : null
        return h.kind === 'stock' ? (
          <li key={h.key} className={styles.newsItem} data-testid="terminal-myh-holding-row" data-kind="stock">
            <span className={styles.callLine}>
              {h.side || 'Position'}, {h.shares === null ? `${s} shares` : sizeText(h.shares, 'share', h.fractional)}
              {account ? <span className={styles.muted}>in {account}</span> : null}
            </span>
            <span className={styles.newsMeta}>
              <span data-testid="terminal-myh-holding-entry">Average entry {h.entry === null ? 'not logged' : usd(h.entry)}</span>
              <span data-testid="terminal-myh-holding-stop">{h.stop === null ? 'No stop logged' : `Stop ${usd(h.stop)}`}</span>
              <span data-testid="terminal-myh-holding-date">
                {h.dateEstimated ? 'Entry date estimated (imported from your broker)' : h.opened ? `Opened ${day(h.opened)}` : 'Entry date not logged'}
              </span>
            </span>
            <span className={styles.newsMeta} data-testid="terminal-myh-holding-result">
              {h.result === null ? (
                <span>No current price to mark it with just now, so no unrealized result is shown.</span>
              ) : (
                <span>
                  Unrealized <span className={tone(h.result)}>{signedUsd(h.result)}</span>
                  {h.resultFraction === null ? '' : ` (${journalPercent(h.resultFraction, { signed: true, dp: 2 })})`}
                  {' '}at {usd(h.price)}, {h.priceFrom === 'broker' ? 'your broker\'s last price' : 'the live price'}
                </span>
              )}
            </span>
          </li>
        ) : (
          <li key={h.key} className={styles.newsItem} data-testid="terminal-myh-holding-row" data-kind="option">
            <span className={styles.callLine}>
              {h.name}
              <span className={styles.muted}>
                {h.side || 'Option'}{h.contracts === null ? '' : `, ${sizeText(h.contracts, 'contract', false)}`}{account ? `, in ${account}` : ''}
              </span>
            </span>
            <span className={styles.newsMeta}>
              {h.entry !== null ? <span>Entry premium {usd(h.entry)}</span> : null}
              {h.net ? <span>{h.net.kind === 'even' ? 'Opened for no net premium' : `Net ${h.net.kind} ${usd(h.net.amount)}`}</span> : null}
              {h.opened ? <span>Opened {day(h.opened)}</span> : null}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function ClosedTrades({ sym: s, list, stats, optionsRead: optionsOk }) {
  const [all, setAll] = useState(false)
  const shown = all ? list : list.slice(0, TRADES_SHOWN)
  const total = stats.summary.totalTrades
  const coverage = rCoverageSentence(stats.r, total, count)
  return (
    <>
      <dl className={own.stats} data-testid="terminal-myh-stats">
        {stats.stats.map((st) => {
          const value = historyValueText(st)
          const under = st.note || sampleText(st, count)
          return (
            <div key={st.key} className={own.stat} data-testid={`terminal-myh-stat-${st.key}`} data-state={st.state}>
              <dt>{st.label}</dt>
              <dd>
                {value !== null ? <span className={`${own.value} ${isSigned(st) ? tone(st.value) || '' : ''}`.trim()}>{value}</span> : null}
                {under ? <span className={value !== null ? own.sample : own.reason}>{under}</span> : null}
              </dd>
            </div>
          )
        })}
      </dl>
      {coverage ? <p className={styles.muted} data-testid="terminal-myh-r-coverage">{coverage}</p> : null}
      {stats.options > 0 ? (
        <p className={styles.muted} data-testid="terminal-myh-mix">
          {count(stats.options)} of the {count(total)} {stats.options === 1 ? 'is an option trade' : 'are option trades'}: the Journal lists
          closed option trades beside stock trades, so they are counted together here too.
        </p>
      ) : null}
      {!optionsOk ? (
        <p className={styles.muted} data-testid="terminal-myh-stock-only">These numbers are your stock trades only: your option trades on {s} could not be read.</p>
      ) : null}

      <div className={styles.tableBox} data-fold="590">
        <table className={styles.table} data-testid="terminal-myh-trades-table"
          aria-label={`Your closed trades on ${s}, newest close first, ${list.length} ${list.length === 1 ? 'trade' : 'trades'}`}>
          <thead>
            <tr>
              <th scope="col" title="The day the trade was closed, and under it the day it was opened">Closed</th>
              <th scope="col" className={`${styles.wrapCell} ${styles.phoneHide}`} title="The side and size, and under them your entry price and your exit price">Trade</th>
              <th scope="col" title="Profit or loss as the Journal's trade list shows it: before fees for a stock trade, after fees for an option trade">Result</th>
              <th scope="col" title="The result against the stop you logged. A trade with no stop logged has no R.">R</th>
              <th scope="col" className={`${styles.wrapCell} ${styles.phoneHide}`}>Setup</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} data-testid="terminal-myh-trade-row" data-kind={r.isOption ? 'option' : 'stock'}>
                <td>
                  {day(r.closed) || 'No close date'}
                  {r.opened ? <><br /><span className={styles.muted}>opened {day(r.opened)}</span></> : null}
                </td>
                <td className={`${styles.wrapCell} ${styles.phoneHide}`}>
                  {r.isOption ? <>{r.name}<br /></> : null}
                  {r.side || 'Trade'}{r.size === null ? '' : `, ${sizeText(r.size, r.sizeUnit, r.fractional)}`}
                  <br />
                  <span className={styles.muted}>
                    {r.several ? 'Several legs' : r.entry === null || r.exit === null ? 'Prices not logged' : `${usd(r.entry)} to ${usd(r.exit)}`}
                  </span>
                </td>
                <td className={tone(r.result)}>{r.result === null ? NA : signedUsd(r.result)}</td>
                <td className={tone(r.r)} data-testid="terminal-myh-trade-r">{r.r === null ? NO_R_TEXT[r.rWhy] : journalR(r.r)}</td>
                <td className={`${styles.wrapCell} ${styles.phoneHide}`}>{r.setup || 'No setup tag'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > TRADES_SHOWN ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.chip} aria-pressed={all} onClick={() => setAll((v) => !v)} data-testid="terminal-myh-trades-all">
            {all ? `Show the newest ${count(TRADES_SHOWN)}` : `Show all ${count(list.length)} trades`}
          </button>
          <span className={styles.muted}>The numbers above count all {count(list.length)}.</span>
        </div>
      ) : null}
      {stats.excluded > 0 ? (
        <p className={styles.muted} data-testid="terminal-myh-excluded">
          {count(stats.excluded)} of these {stats.excluded === 1 ? 'trades is one' : 'trades are ones'} the Journal leaves out of its Analytics
          numbers (and so out of PERF). {stats.excluded === 1 ? 'It is' : 'They are'} listed and counted here, as on the Journal&apos;s Trade Journal tab.
        </p>
      ) : null}
    </>
  )
}

function HistoryBody({ sym: s, code, pick, rawAccount, several, accountNames }) {
  const accountId = pick.mode === 'one' ? pick.account.id : null
  const where = pick.mode === 'one' ? pick.account.name : 'all your accounts'
  const tQ = useMarketRead(tradesUrl({ sym: s, accountId }))
  const pQ = useMarketRead(positionsUrl({ accountId }))
  const oQ = useMarketRead(optionsUrl({ sym: s, accountId }))
  const nQ = useMarketRead(notesUrl({ sym: s }))
  const t = useMemo(() => tradesRead(tQ.body, s), [tQ.body, s])
  const p = useMemo(() => positionsRead(pQ.body, s), [pQ.body, s])
  const o = useMemo(() => optionsRead(oQ.body, s), [oQ.body, s])
  const n = useMemo(() => notesRead(nQ.body), [nQ.body])
  const tState = outcomeOf(tQ, t)
  const pState = outcomeOf(pQ, p)
  const oState = outcomeOf(oQ, o)
  const nState = outcomeOf(nQ, n)
  const reads = [{ q: tQ, state: tState }, { q: pQ, state: pState }, { q: oQ, state: oState }, { q: nQ, state: nState }]
  const answered = reads.filter((r) => r.state === 'ok')

  // The price an open stock position is marked at: the Journal's own order (the live price while
  // the market trades, the broker's mark once the session has closed and its sync covers it). In
  // "all accounts" the Journal's own table never prefers the broker's mark, so neither does this.
  const { sessionClosed, lastClosedSessionET } = useMarkPreferenceContext()
  const preferBroker = pick.mode === 'one' ? preferBrokerMarks(rawAccount, sessionClosed, lastClosedSessionET) : false
  const stockHeld = pState === 'ok' && p.positions.length > 0
  const { prices } = useLivePrices(stockHeld ? [s] : [])

  const openPositions = pState === 'ok' ? p.positions : NO_ROWS
  const openStrategies = oState === 'ok' ? o.open : NO_ROWS
  const closedStrategies = oState === 'ok' ? o.closed : NO_ROWS
  const closedTrades = tState === 'ok' ? t.trades : NO_ROWS
  const held = useMemo(
    () => holdingRows({ positions: openPositions, openStrategies, prices, preferBroker }),
    [openPositions, openStrategies, prices, preferBroker],
  )
  const rows = useMemo(() => journalRows({ trades: closedTrades, closedStrategies }), [closedTrades, closedStrategies])
  const stats = useMemo(() => historyStats(rows), [rows])
  const list = useMemo(() => tradeRows(rows, closedStrategies), [rows, closedStrategies])

  // As of: when the OLDEST of the answers on screen was read (a journal has no market time).
  const readAt = answered.map((r) => r.q.receivedAt).filter(Boolean).sort()[0] || null
  usePanelFreshness(answered.length ? panelAsOf(SOURCE, readAt) : null)

  if (reads.every((r) => r.state === 'loading')) {
    return <PanelSkeleton label={`Loading your history on ${s}`} testId="terminal-myh-loading" />
  }
  const settled = reads.every((r) => r.state !== 'loading')
  if (settled && !answered.length) {
    const http = reads.filter((r) => r.state === 'http')
    const locked = http.length === reads.length && http.every((r) => !canRetry(r.q.error))
    const first = http[0]?.q.error || null
    return (
      <PanelState kind={locked ? failureKind(first) : 'error'} testId="terminal-myh-error"
        title={first ? failureText(first, WHAT) : `Your history on ${s} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={() => reads.forEach((r) => r.q.retry())}>Retry</button>}>
        {locked ? null : `That is not the same as no trades or notes. Retry, or run ${s} ${code} again.`}
      </PanelState>
    )
  }

  const allRead = answered.length === reads.length
  const nothing = allRead && !held.length && !rows.length && !n.total && !o.other && !t.unreadable
  if (nothing) {
    return (
      <PanelState kind="empty" role="status" testId="terminal-myh-empty" title={`You have no trades or notes on ${s} yet.`}>
        Nothing in your Journal names it: no open position, no closed trade, no option trade and no note.
        {several && pick.mode === 'one' ? ` Trades were looked for in ${where} only; pick another account above, or all of them together.` : ''}
        {' '}Log a trade in the <PanelCommand cmd="JRNL" label="Open the Journal">Journal (JRNL)</PanelCommand>, or write a note in
        the <PanelCommand cmd="NB" label="Open the Notebook">Notebook (NB)</PanelCommand>.
      </PanelState>
    )
  }

  const holdingKnown = pState === 'ok' || oState === 'ok'
  const closedSettled = tState !== 'loading' && oState !== 'loading'
  const optionsHeld = held.some((h) => h.kind === 'option')
  const sentence = historySentence(s, {
    held: pState === 'ok' && oState === 'ok' ? held.length : held.length ? held.length : null,
    trades: tState === 'ok' && closedSettled ? rows.length : null,
    notes: nState === 'ok' ? n.total : null,
  }, count)

  return (
    <>
      {tState === 'ok' || tState === 'loading' ? null : (
        <PartFailed id="trades" what="Your closed trades" notSame="That is not the same as no trades." q={tQ} state={tState} />
      )}
      {pState === 'ok' || pState === 'loading' ? null : (
        <PartFailed id="positions" what="Your open positions" notSame={`That is not the same as not holding ${s}.`} q={pQ} state={pState} />
      )}
      {oState === 'ok' || oState === 'loading' ? null : (
        <PartFailed id="options" what="Your option trades" notSame="Nothing below counts them, and that is not the same as having none." q={oQ} state={oState} />
      )}
      {nState === 'ok' || nState === 'loading' ? null : (
        <PartFailed id="notes" what="Your notes" notSame="That is not the same as no notes." q={nQ} state={nState} />
      )}
      {reads.map((r, i) => (r.state === 'ok' && r.q.error ? (
        <p key={['trades', 'positions', 'options', 'notes'][i]} className={styles.note} role="status">{failureText(r.q.error, WHAT)} Showing the last read.</p>
      ) : null))}

      {sentence ? <p className={styles.lede} data-testid="terminal-myh-summary">{sentence}</p> : null}

      <section aria-label={`What you hold in ${s} now`} data-testid="terminal-myh-holding">
        <h3 className={styles.muted}>Holding now</h3>
        {pState === 'loading' || oState === 'loading' ? (
          <p className={styles.lede} role="status" data-testid="terminal-myh-holding-loading">Reading your open positions.</p>
        ) : null}
        {held.length ? <HoldingList sym={s} rows={held} accountNames={pick.mode === 'all' && several ? accountNames : null} /> : null}
        {!held.length && pState === 'ok' && oState === 'ok' ? (
          <p className={styles.muted} data-testid="terminal-myh-holding-none">
            You do not hold {s} now{pick.mode === 'one' && several ? ` in ${where}` : ''}: no open stock position and no open option position.
          </p>
        ) : null}
        {!held.length && holdingKnown && pState === 'ok' && oState !== 'ok' && oState !== 'loading' ? (
          <p className={styles.muted} data-testid="terminal-myh-holding-none">No open stock position in {s}.</p>
        ) : null}
        {!held.length && holdingKnown && oState === 'ok' && pState !== 'ok' && pState !== 'loading' ? (
          <p className={styles.muted} data-testid="terminal-myh-holding-none">No open option position on {s}.</p>
        ) : null}
        {optionsHeld ? (
          <p className={styles.muted} data-testid="terminal-myh-options-result">
            The Journal marks an open option position with live option prices, so its current result is on the Journal&apos;s Open
            Positions tab: <PanelCommand cmd="JRNL" label="Open the Journal">Journal (JRNL)</PanelCommand>.
          </p>
        ) : null}
      </section>

      <section aria-label={`Your closed trades on ${s}`} data-testid="terminal-myh-closed">
        <h3 className={styles.muted}>Closed trades{tState === 'ok' && closedSettled ? ` (${count(rows.length)})` : ''}</h3>
        {!closedSettled ? (
          <p className={styles.lede} role="status" data-testid="terminal-myh-closed-loading">Reading your closed trades.</p>
        ) : tState !== 'ok' ? null : rows.length ? (
          <ClosedTrades sym={s} list={list} stats={stats} optionsRead={oState === 'ok'} />
        ) : (
          <p className={styles.muted} data-testid="terminal-myh-closed-none">
            No closed trades on {s}{pick.mode === 'one' && several ? ` in ${where}` : ''} yet.
            {oState === 'ok' ? '' : ` Your option trades on ${s} could not be read.`}
          </p>
        )}
        {oState === 'ok' && o.other > 0 ? (
          <p className={styles.muted} data-testid="terminal-myh-options-other">
            {count(o.other)} option {o.other === 1 ? 'trade' : 'trades'} on {s} expired, {o.other === 1 ? 'was' : 'were'} assigned or{' '}
            {o.other === 1 ? 'was' : 'were'} rolled. The Journal&apos;s trade list does not include those, so they are not in the numbers
            here; they are in the <PanelCommand cmd="JRNL" label="Open the Journal">Journal (JRNL)</PanelCommand>.
          </p>
        ) : null}
        {tState === 'ok' && t.unreadable > 0 ? (
          <p className={styles.note} role="status" data-testid="terminal-myh-unreadable">
            {count(t.unreadable)} closed {t.unreadable === 1 ? 'trade' : 'trades'} on {s} came back with no result number and{' '}
            {t.unreadable === 1 ? 'is' : 'are'} left out, never counted as zero.
          </p>
        ) : null}
      </section>

      <section aria-label={`Your notes that name ${s}`} data-testid="terminal-myh-notes">
        <h3 className={styles.muted}>Notes{nState === 'ok' ? ` (${count(n.total)})` : ''}</h3>
        {nState === 'loading' ? (
          <p className={styles.lede} role="status" data-testid="terminal-myh-notes-loading">Reading your notes.</p>
        ) : nState !== 'ok' ? null : n.notes.length ? (
          <>
            <ul className={styles.newsList} data-testid="terminal-myh-notes-list">
              {n.notes.map((r) => (
                <li key={r.key} className={styles.newsItem}>
                  <Link className={styles.newsHeadline} to={r.href} title="Open this note in the Notebook">{r.title}</Link>
                  <span className={styles.newsMeta}>
                    {r.updated ? <span>Last edited {day(r.updated)}</span> : r.created ? <span>Written {day(r.created)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {n.total > n.notes.length ? (
              <p className={styles.muted} data-testid="terminal-myh-notes-more">
                Showing the {count(n.notes.length)} edited most recently, of {count(n.total)}. All of them:{' '}
                <PanelCommand cmd={`${s} RSCH`} label={`Your research notes on ${s}`}>My research on {s} (RSCH)</PanelCommand>
              </p>
            ) : null}
          </>
        ) : (
          <p className={styles.muted} data-testid="terminal-myh-notes-none">
            No note names {s} yet. Write one in the <PanelCommand cmd="NB" label="Open the Notebook">Notebook (NB)</PanelCommand>.
          </p>
        )}
      </section>

      <p className={styles.muted} data-testid="terminal-myh-method">
        These are your own records, read from your Journal ({pick.mode === 'one' ? where : 'all your accounts together'}). Closed
        trades are the ones the Journal&apos;s Trade Journal tab lists for {s}, and the numbers are that tab&apos;s own: win rate is wins
        divided by wins and losses, so breakeven trades are left out; a stock trade&apos;s result is before fees and an option
        trade&apos;s is after fees. R is a trade&apos;s result against the stop you logged, so a trade with no stop logged has no R. A
        number from fewer than {count(CONFIDENCE_MIN)} trades is marked a small sample. A sign (+/-) marks every gain and loss, so
        color is never the only signal. Notes are your Notebook notes that carry {s} (as the note&apos;s ticker, in a chart, or
        as a {`$${s}`} mention), whatever the account, with the sample notebook&apos;s examples left out; a note opens in the
        Notebook, outside the terminal. For your trading
        across every stock:{' '}
        <PanelCommand cmd="PERF" label="Open your trading stats">My trading stats (PERF)</PanelCommand>. Before the next trade in {s}:{' '}
        <PanelCommand cmd={`${s} CHK`} label={`Pre-trade check (CHK) for ${s}`}>Pre-trade check (CHK)</PanelCommand>,{' '}
        <PanelCommand cmd={`${s} PLAN`} label={`Trade plan (PLAN) for ${s}`}>Trade plan (PLAN)</PanelCommand>.
        {readAt ? ` Read at ${formatTimeEt(readAt, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </>
  )
}

function MyHistoryForTicker({ sym: s, code, account: accountProp }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const accountsQ = useMarketRead(ACCOUNTS_URL)
  const served = useMemo(() => accountsRead(accountsQ.body), [accountsQ.body])
  // A new `NVDA MYH 2` remounts the panel (the shell keys the body on code + args), so the typed
  // account only ever seeds the state.
  const [choice, setChoice] = useState(() => parsePerformanceAccount(accountProp))
  const [stored] = useState(readJournalPick)
  const pick = useMemo(() => pickAccount(served.accounts, { choice, stored }), [served.accounts, choice, stored])
  const accountNames = useMemo(() => new Map(served.accounts.map((a) => [a.id, a.name])), [served.accounts])
  // The picker writes itself into the command (`NVDA MYH 2`, `NVDA MYH ALL`) where the registry
  // takes the word, so a reload keeps it; otherwise it is plain component state.
  const choose = (raw) => {
    const next = parsePerformanceAccount(raw)
    if (!next) return
    setChoice(next)
    writeBack(myHistoryCommandArgs({ account: next }), s)
  }
  const wrap = (children, attrs = {}) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-myh" data-sym={s} {...attrs}>{children}</div>
  )

  if (!accountsQ.body && !accountsQ.error) return wrap(<PanelSkeleton label={`Loading your history on ${s}`} testId="terminal-myh-loading" />)
  if (!accountsQ.body && accountsQ.error) {
    const locked = !canRetry(accountsQ.error)
    return wrap(
      <PanelState kind={failureKind(accountsQ.error)} title={failureText(accountsQ.error, WHAT)} testId="terminal-myh-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={accountsQ.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no trades or notes. Retry, or run ${s} ${code} again.`}
      </PanelState>,
    )
  }
  if (served.state !== 'ok') {
    return wrap(
      <PanelState kind="error" title={`${WHAT} could not be read just now.`} testId="terminal-myh-error"
        action={<button type="button" className={styles.chip} onClick={accountsQ.retry}>Retry</button>}>
        That is not the same as no trades or notes. Retry, or run {s} {code} again.
      </PanelState>,
    )
  }
  if (!pick.mode) {
    return wrap(
      <PanelState kind="empty" role="status" title="You have no journal account yet." testId="terminal-myh-no-account"
        action={<button type="button" className={styles.chip} onClick={accountsQ.retry}>Check again</button>}>
        Your history on {s} shows here once the Journal has an account. Open the{' '}
        <PanelCommand cmd="JRNL" label="Open the Journal">Journal (JRNL)</PanelCommand> to set one up.
      </PanelState>,
    )
  }

  const several = served.accounts.length > 1
  const shown = pick.mode === 'all' ? 'All accounts together' : pick.account.name
  // The account as the route sent it: the Journal's broker-mark rule reads its balance sync time.
  const rawAccount = pick.mode === 'one' ? (accountsQ.body.accounts.find((a) => String(a?.id) === pick.account.id) || null) : null
  return wrap(
    <>
      <div className={styles.toolbar} role="toolbar" aria-label={`Your history on ${s}: controls`}>
        {several ? (
          <label className={own.filter}>
            Account
            <Select value={pick.mode === 'all' ? 'ALL' : String(pick.ordinal)} onChange={(e) => choose(e.target.value)}
              data-testid="terminal-myh-account-pick"
              options={[...served.accounts.map((acc, i) => ({ value: String(i + 1), label: acc.name })), { value: 'ALL', label: 'All accounts together' }]} />
          </label>
        ) : null}
        <span className={styles.lede} data-testid="terminal-myh-account">
          {several ? `Showing ${shown}.` : `Account: ${shown}.`}
          {pick.mode === 'one' && pick.account.brokerLinked ? ' It is linked to your broker.' : ''}
        </span>
      </div>
      {pick.missing ? (
        <p className={styles.note} role="status" data-testid="terminal-myh-missing">
          You have no account number {count(pick.missing)} ({count(served.accounts.length)} in your Journal), so this shows {shown}.
        </p>
      ) : null}
      {/* Keyed by account: a new account is new reads, so one account's trades are never drawn under another's name. */}
      <HistoryBody key={pick.mode === 'all' ? 'all' : pick.account.id} sym={s} code={code} pick={pick} rawAccount={rawAccount}
        several={several} accountNames={accountNames} />
    </>,
    { 'data-account': pick.mode === 'all' ? 'all' : String(pick.ordinal) },
  )
}

export default function MyHistoryPanel({ sym, account = null }) {
  const s = String(sym || '').trim().toUpperCase()
  const code = useInTerminalPanel()?.code || MY_HISTORY_CODE
  if (!s) {
    return (
      <PanelState kind="input" title={`${code} needs a ticker.`}>
        Type one first, e.g. <kbd>NVDA {code}</kbd>
      </PanelState>
    )
  }
  // Keyed by ticker: a new ticker is new reads, so one stock's record is never drawn under another's name.
  return <MyHistoryForTicker key={s} sym={s} code={code} account={account} />
}
