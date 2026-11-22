// H52: stocks at new 52-week highs and new 52-week lows (data wave 2).
//
// ⭐ NO NEW ROUTE. These are the Breadth Monitor's own drill lists (api/routers/breadth_monitor.py,
// paid), until now opened only by clicking a cell of the Monitor table. The pure half (the URLs,
// which session to show, the row shaping, the sentences) is highs52Model.js, re-exported below.
//
//   H52          both lists          H52 HIGHS / H52 LOWS   one list
//
// HILO is highs and lows OF THE DAY. This is the 52-week list.
//
// WHICH SESSION. `GET /api/breadth-monitor/live` says whether the session is under way. While it
// is, the two lists are the live ones (`/live/drill/...`) and re-read once a minute, the pace the
// server rebuilds them at. Otherwise the panel shows the newest FINISHED session's stored lists
// (`/{date}/drill/...`) and says which day that is and why. When the live read itself fails, the
// newest stored date comes from `GET /api/breadth-monitor/latest` instead, and the panel says so.
//
// ⛔ A FAILED READ IS NEVER DRAWN AS "NOTHING AT A NEW HIGH". A list that cannot be read is an
// error with Retry; a live list the server says it cannot give right now says that; only a
// healthy answer with no rows says no stock qualified. The two lists fail apart: one failing
// never blanks the other.
//
// The reads go through marketRead.js (the terminal's one bare-SWR reader), and SWR skips ticks
// while the app is hidden.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import {
  formatCompactTerminal, formatCurrency, formatNumber, formatPercent, formatTimeEt,
} from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  BREADTH_LATEST_URL, BREADTH_LIVE_URL, HIGHS52_CODE, HIGHS52_SIDES, countsSentence, drillRead, highs52CommandArgs, highs52Mode,
  latestSessionDate, liveDrillUrl, normSide52, settledSentence, storedDrillUrl,
} from './highs52Model'
import ListAlertSwitch from './ListAlertSwitch'
import styles from './marketPanels.module.css'
import bars from './barCells.module.css'

export {
  BREADTH_LATEST_URL, BREADTH_LIVE_URL, HIGHS52_CODE, HIGHS52_SIDES, countsSentence, dayOf, drillRead, highs52CommandArgs,
  highs52Mode, latestSessionDate, liveDrillUrl, normSide52, settledSentence, storedDrillUrl,
} from './highs52Model'

/** Rows drawn per list until the member asks for all of them; the rest are counted, never dropped. */
export const MAX_ROWS = 100
/** The server rebuilds the live read about once a minute during the session. */
const LIVE_POLL_MS = 60 * 1000
/** Out of session the answer only changes when the next session starts. */
const IDLE_POLL_MS = 5 * 60 * 1000
const SOURCE = 'UCT Breadth Monitor (52-week highs and lows)'
const NA = 'n/a'
const WHAT = '52-week highs and lows'

const count = (n) => formatNumber(n, { decimals: 0 })
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')

/** One read's outcome: 'loading' | 'http' (the request itself failed) | the model's own state. */
const outcomeOf = (q, parsed) => (!q.body && !q.error ? 'loading' : q.error && !q.body ? 'http' : parsed.state)

/** The one-list view (six columns) was measured to need 488px with its cells wrapped, so it names
 *  step 510 of the fold ladder (see marketPanels.module.css); a paired list (four columns) fits and names none.
 *  `paired`: two lists sit side by side, so each keeps only the columns that fit half a panel
 *  (the company name and the share count are in the one-list view, `H52 HIGHS` / `H52 LOWS`). */
function SideTable({ side, rows, total, offset, live, paired = false }) {
  const words = HIGHS52_SIDES[side]
  return (
    <div className={styles.tableBox} data-fold={paired ? undefined : '510'}>
      <table className={styles.table} data-testid={`terminal-h52-${side}`}>
        <caption className={styles.caption}>{words.caption} ({count(total)})</caption>
        <thead>
          <tr>
            <th scope="col" title="Click a symbol to load it into the linked panels">Symbol</th>
            {paired ? null : <th scope="col" className={`${styles.phoneHide} ${styles.wrapCell}`}>Company</th>}
            <th scope="col" title={live ? 'The latest price' : 'The close of that session'}>{live ? 'Last' : 'Close'}</th>
            <th scope="col" title="Against the prior close">Change</th>
            {paired ? null : <th scope="col" className={styles.phoneHide} title="Shares traded in the session">Volume</th>}
            <th scope="col" className={styles.phoneHide} title="Volume against the 20-day average">{paired ? 'Vs usual volume' : 'Volume vs usual'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} data-testid={`terminal-h52-${side}-row-${r.sym}`}>
              <td>
                <span className={styles.rowNum} aria-hidden="true">{offset + i + 1}</span>
                <PanelSymbol sym={r.sym} className={styles.sym} />
              </td>
              {paired ? null : <td className={`${styles.phoneHide} ${styles.wrapCell}`}>{r.name || NA}</td>}
              <td>{formatCurrency(r.price, { absent: NA })}</td>
              <td className={tone(r.pct)}>{formatPercent(r.pct, { decimals: 2, signed: true, absent: NA })}</td>
              {paired ? null : <td className={styles.phoneHide}>{formatCompactTerminal(r.volume, { absent: NA })}</td>}
              <td className={styles.phoneHide}>{r.rvol == null ? NA : `${formatNumber(r.rvol, { decimals: 1 })}×`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** What one list says when it has no table: waiting, failed (with a way to retry) or not available. */
function SideNote({ side, state, q, live, date }) {
  const words = HIGHS52_SIDES[side]
  const what = `The ${words.caption.replace(/^New /, '')} list`
  const retry = <button type="button" className={styles.linkBtn} onClick={() => q.retry()}>Retry the {words.one}s list</button>
  if (state === 'loading') {
    return <p className={styles.lede} role="status" data-testid={`terminal-h52-${side}-loading`}>Reading the {words.one}s list.</p>
  }
  if (state === 'http' && !live && q.error?.status === 404) {
    return (
      <p className={styles.note} role="status" data-testid={`terminal-h52-${side}-error`}>
        {what} for {date} is not stored on this server. That is not the same as no stock making a new {words.one}.
      </p>
    )
  }
  if (state === 'http') {
    return (
      <p className={styles.note} role="status" data-testid={`terminal-h52-${side}-error`}>
        {failureText(q.error, what)} That is not the same as no stock making a new {words.one}.{' '}
        {canRetry(q.error) ? retry : null}
      </p>
    )
  }
  if (state === 'unavailable') {
    return (
      <p className={styles.note} role="status" data-testid={`terminal-h52-${side}-unavailable`}>
        The server cannot give the live {words.one}s list right now. That is not the same as no stock making a new{' '}
        {words.one}. {retry}
      </p>
    )
  }
  return (
    <p className={styles.note} role="status" data-testid={`terminal-h52-${side}-error`}>
      {what} could not be read just now. That is not the same as no stock making a new {words.one}. {retry}
    </p>
  )
}

function Highs52Board({ side, view, fallback, staleNote }) {
  const live = view.mode === 'live'
  const url = (s) => (live ? liveDrillUrl(s) : storedDrillUrl(view.date, s))
  // Both lists are read whichever chip is pressed (two small reads), so a chip only cuts the view.
  const highsQ = useMarketRead(url('highs'), { refreshInterval: live ? LIVE_POLL_MS : 0 })
  const lowsQ = useMarketRead(url('lows'), { refreshInterval: live ? LIVE_POLL_MS : 0 })
  const highs = useMemo(() => drillRead(highsQ.body, { side: 'highs', live }), [highsQ.body, live])
  const lows = useMemo(() => drillRead(lowsQ.body, { side: 'lows', live }), [lowsQ.body, live])
  const [all, setAll] = useState(false)

  const lists = [
    { side: 'highs', q: highsQ, read: highs, state: outcomeOf(highsQ, highs), shown: side !== 'lows' },
    { side: 'lows', q: lowsQ, read: lows, state: outcomeOf(lowsQ, lows), shown: side !== 'highs' },
  ].filter((l) => l.shown).map((l) => ({ ...l, rows: l.state === 'ok' ? (all ? l.read.rows : l.read.rows.slice(0, MAX_ROWS)) : [] }))
  const okLists = lists.filter((l) => l.state === 'ok')
  const anyRows = okLists.some((l) => l.rows.length > 0)

  // As of: live, the OLDER of the lists on screen; a finished session, its own calendar date.
  const liveStamps = okLists.map((l) => l.read.asOf).filter(Boolean).sort()
  const asOf = live ? liveStamps[0] || null : view.date
  usePanelFreshness(okLists.length ? panelAsOf(SOURCE, asOf) : null)
  // Numbered rows are the rows on screen, highs first.
  usePanelSymbolRows(lists.flatMap((l) => l.rows.map((r) => r.sym)), 'new 52-week highs and lows', {
    total: okLists.reduce((n, l) => n + l.read.rows.length, 0),
  })

  if (lists.every((l) => l.state === 'loading')) {
    return <PanelSkeleton label={`Loading the ${WHAT}`} testId="terminal-h52-loading" />
  }
  if (lists.every((l) => l.state === 'http')) {
    const first = lists[0].q.error
    const locked = lists.every((l) => !canRetry(l.q.error))
    const missing = !live && lists.every((l) => l.q.error?.status === 404)
    return (
      <PanelState kind={missing ? 'error' : locked ? failureKind(first) : 'error'} testId="terminal-h52-error"
        title={missing
          ? `The 52-week lists for ${view.date} are not stored on this server.`
          : locked ? failureText(first, `The ${WHAT}`) : `The ${WHAT} could not be read just now.`}
        action={locked && !missing ? null : <button type="button" className={styles.chip} onClick={() => lists.forEach((l) => l.q.retry())}>Retry</button>}>
        {locked && !missing ? null : 'That is not the same as no stock at a new high or low. Retry, or pick another view.'}
      </PanelState>
    )
  }

  const n = (s) => { const l = okLists.find((x) => x.side === s); return l ? l.read.rows.length : null }
  const nH = n('highs')
  const nL = n('lows')
  const both = nH !== null && nL !== null && nH + nL > 0
  const highShare = both ? Math.round((nH / (nH + nL)) * 1000) / 10 : 0
  const cut = okLists.filter((l) => l.read.rows.length > l.rows.length)
  const hidden = okLists.some((l) => l.read.rows.length > MAX_ROWS)
  const settledAll = lists.every((l) => l.state === 'ok')
  let offset = 0

  return (
    <>
      {staleNote}
      <div className={styles.head}>
        <span className={`${styles.badge} ${styles.badge_flat}`} data-testid="terminal-h52-mode">{live ? 'Live session' : 'Finished session'}</span>
        <span className={styles.lede} data-testid="terminal-h52-totals">
          {countsSentence({ mode: view.mode, date: view.date, highs: nH, lows: nL, count })}
        </span>
      </div>
      {live ? null : (
        <p className={fallback ? styles.note : styles.muted} role={fallback ? 'status' : undefined} data-testid="terminal-h52-day">
          {settledSentence({ why: view.why, date: view.date, fallback })}
        </p>
      )}
      {both ? (
        <div className={bars.splitBar} aria-hidden="true" data-testid="terminal-h52-split">
          <span className={bars.splitUp} style={{ width: `${highShare}%` }} />
          <span className={bars.splitDown} style={{ width: `${Math.round((100 - highShare) * 10) / 10}%` }} />
        </div>
      ) : null}
      {settledAll && !anyRows ? (
        <PanelState kind="empty" compact testId="terminal-h52-empty"
          title={live
            ? `No stock is at a new 52-week ${side === 'both' ? 'high or low' : HIGHS52_SIDES[side].one} so far today.`
            : `No stock made a new 52-week ${side === 'both' ? 'high or low' : HIGHS52_SIDES[side].one} on ${view.date}.`}>
          {live ? 'The lists fill as prices move.' : 'That is what the Breadth Monitor recorded for that session.'}
        </PanelState>
      ) : (
        <>
          <div className={`${styles.split} ${styles.splitFair}`}>
            {lists.map((l) => {
              if (l.state !== 'ok' || !l.rows.length) return null
              const table = <SideTable key={l.side} side={l.side} rows={l.rows} total={l.read.rows.length} offset={offset} live={live}
                paired={lists.filter((x) => x.state === 'ok' && x.rows.length).length > 1} />
              offset += l.rows.length
              return table
            })}
          </div>
          {lists.map((l) => (l.state === 'ok'
            ? (l.rows.length ? null : (
              <p key={l.side} className={styles.muted} data-testid={`terminal-h52-no-${l.side}`}>
                {live ? `No new 52-week ${HIGHS52_SIDES[l.side].one}s so far today.` : `No new 52-week ${HIGHS52_SIDES[l.side].one}s on ${view.date}.`}
              </p>
            ))
            : <SideNote key={l.side} side={l.side} state={l.state} q={l.q} live={live} date={view.date} />))}
          {lists.map((l) => (l.state === 'ok' && l.q.error ? (
            <p key={l.side} className={styles.note} role="status" data-testid={`terminal-h52-${l.side}-stale`}>
              {failureText(l.q.error, `The ${HIGHS52_SIDES[l.side].caption.replace(/^New /, '')} list`)} Showing the last read.
            </p>
          ) : null))}
        </>
      )}
      {hidden ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.chip} aria-pressed={all} onClick={() => setAll((v) => !v)} data-testid="terminal-h52-all">
            {all ? `Show the first ${MAX_ROWS} of each list` : 'Show every stock'}
          </button>
        </div>
      ) : null}
      <p className={styles.muted} data-testid="terminal-h52-method">
        {cut.map((l) => `Showing the ${count(l.rows.length)} biggest moves of ${count(l.read.rows.length)} new ${HIGHS52_SIDES[l.side].one}s. `).join('')}
        These are 52-week highs and lows, the lists behind the Breadth Monitor&apos;s New 52-week highs and lows cells, over
        the stocks the Monitor tracks.{' '}
        {live && view.basis === 'intraday'
          ? 'A stock is listed once it trades above its highest price of the prior 52 weeks, or below its lowest. '
          : ''}
        Highs are ordered biggest gain first and lows biggest fall first. Change is against the prior close; Volume vs usual
        is the session&apos;s volume against the 20-day average. A sign (+/-) marks every change, so color is never the only
        signal. Click a symbol to load it into the linked panels; type a row number to do the same. For highs and lows of
        the day, run <PanelCommand cmd="HILO" label="New highs and lows of the day">HILO</PanelCommand>.
        {live && asOf ? ` Lists worked out at ${clock(asOf)}.` : ''}
      </p>
    </>
  )
}

export default function Highs52Panel({ side: sideProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  // A new `H52 LOWS` remounts the panel (the shell keys the body on code + args), so the typed
  // word only ever seeds the state.
  const [side, setSide] = useState(() => normSide52(sideProp))
  // The poll follows the server's own word that the session is live. `liveNow` is adjusted during
  // render from the last answer (no effect, so no extra pass through an old value).
  const [liveNow, setLiveNow] = useState(false)
  const status = useMarketRead(BREADTH_LIVE_URL, { refreshInterval: liveNow ? LIVE_POLL_MS : IDLE_POLL_MS })
  const told = useMemo(() => highs52Mode(status.body), [status.body])
  if ((told.mode === 'live') !== liveNow) setLiveNow(told.mode === 'live')

  // The live read answered nothing usable (an outage, the live path switched off): the newest
  // stored session still exists, so ask for its date. A paywall, a dark route and a signed-out
  // member are not that: no stored list would answer them either.
  const usable = !!status.body && typeof status.body === 'object' && status.body.ok === true
  const pending = !status.body && !status.error
  const locked = !usable && !!status.error && !canRetry(status.error)
  const signedOut = !usable && status.error?.status === 401
  const statusDown = !usable && !pending && !locked && !signedOut
  const latest = useMarketRead(statusDown ? BREADTH_LATEST_URL : null)
  const latestDate = useMemo(() => latestSessionDate(latest.body), [latest.body])
  const fallback = statusDown && !!latestDate
  const view = fallback ? { mode: 'settled', date: latestDate, why: null, basis: null } : told

  // A chip writes itself into the command (`H52 LOWS`) where the registry takes the word, so a
  // reload keeps it; otherwise it is plain component state (commandWriteBack.js).
  const pickSide = (next) => { setSide(next); writeBack(highs52CommandArgs({ side: next })) }
  const retryAll = () => { status.retry(); if (statusDown) latest.retry() }

  let state = null
  if (pending || (statusDown && !latest.body && !latest.error)) {
    state = <PanelSkeleton label={`Loading the ${WHAT}`} testId="terminal-h52-loading" />
  } else if (locked) {
    state = <PanelState kind="locked" title={failureText(status.error, `The ${WHAT}`)} testId="terminal-h52-error" />
  } else if (!usable && !fallback) {
    state = (
      <PanelState kind="error" testId="terminal-h52-error"
        title={status.error ? failureText(status.error, `The ${WHAT}`) : `The ${WHAT} could not be read just now.`}
        action={<button type="button" className={styles.chip} onClick={retryAll}>Retry</button>}>
        That is not the same as no stock at a new high or low. Retry, or run {inPanel?.code || HIGHS52_CODE} again.
      </PanelState>
    )
  } else if (!view.mode) {
    state = (
      <PanelState kind="empty" title="The market is not in session, and no finished session is stored on this server yet." testId="terminal-h52-no-session"
        action={<button type="button" className={styles.chip} onClick={retryAll}>Retry</button>}>
        The 52-week lists fill in once a session is under way.
      </PanelState>
    )
  }

  const staleNote = usable && status.error
    ?<p className={styles.note} role="status" data-testid="terminal-h52-stale">{failureText(status.error, 'Live breadth')} Showing the last read.</p>
    : null

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-h52" data-side={side} data-mode={view.mode || ''}>
      <div className={styles.toolbar} role="toolbar" aria-label="52-week highs and lows controls">
        <div className={styles.group} role="group" aria-label="Lists">
          {Object.entries(HIGHS52_SIDES).map(([key, s]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === side} onClick={() => pickSide(key)}
              data-testid={`terminal-h52-side-${key}`}>{s.chip}</button>
          ))}
        </div>
      </div>
      {/* "Alert me when a stock I follow appears here" (new 52-week highs). Draws nothing until the server says the alerts are on. */}
      <ListAlertSwitch kind="highs52" />
      {/* Keyed by session: a new session is a new pair of reads, so a live list is never drawn under a finished day's date. */}
      {state || <Highs52Board key={`${view.mode}:${view.date}`} side={side} view={view} fallback={fallback} staleNote={staleNote} />}
    </div>
  )
}
