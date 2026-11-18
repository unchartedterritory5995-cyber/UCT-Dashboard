// CONFL: the confluence board in the Terminal (data wave 4).
//
// ⭐ NO NEW ROUTE. `GET /api/confluence?days=30`: stocks where a large dark pool dollar size and
// aligned long-dated options flow line up. Until now only the Confluence tab inside the Options
// Flow page read it. The pure half (the URL, the gate, the row shaping, the typed words) is
// confluenceModel.js, re-exported below.
//
//   CONFL        every direction        CONFL BULL   bullish names        CONFL BEAR   bearish names
//
// A chip filters the direction and writes it back into the panel's command. A symbol loads that
// name into the linked panels; typing its row number does the same.
//
// ⛔ ONLY THE 30-DAY WINDOW IS READ: the one the server keeps warm. Another window with nothing
// cached would start a multi-week scan on the pod that runs the live tape (confluenceModel.js).
// ⛔ A FAILED READ IS NEVER AN EMPTY BOARD. A read that fails is an error with Retry; `ok: false`
// is "warming" (the panel asks again by itself) or "could not build"; only a healthy answer with
// no rows says nothing lines up.
//
// The read goes through marketRead.js (the terminal's one bare-SWR reader), and SWR skips ticks
// while the app is hidden.
import { useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import {
  formatCompactTerminal, formatCurrency, formatNumber, formatPercent, formatTimeEt,
} from '../../../lib/presentation/presentationPrimitives'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  CONFLUENCE_CODE, CONFLUENCE_DAYS, CONFLUENCE_LEANS, CONFLUENCE_URL, bandGroups, confluenceCommandArgs, confluenceRead, leanRows,
  leanWords, normConfluenceLean,
} from './confluenceModel'
import ListAlertSwitch from './ListAlertSwitch'
import styles from './marketPanels.module.css'

export {
  CONFLUENCE_BANDS, CONFLUENCE_CODE, CONFLUENCE_DAYS, CONFLUENCE_LEANS, CONFLUENCE_LEAN_ARG_WORDS, CONFLUENCE_URL, bandGroups,
  confluenceCommandArgs, confluenceRead, expiryDay, leanRows, leanWords, normConfluenceLean, parseConfluenceLean, windowEndDay,
  windowText,
} from './confluenceModel'

/** Rows drawn until the member asks for all of them; the rest are counted, never dropped. */
export const MAX_ROWS = 100
/** The server rebuilds the board every 30 minutes, so the panel asks every 5. */
const BOARD_POLL_MS = 5 * 60 * 1000
/** While the server has no board cached yet it is asked again at this pace. */
const WARM_POLL_MS = 20 * 1000
const SOURCE = 'UCT dark pool and options flow'
const WHAT = 'The confluence board'
const NA = 'n/a'
/** A space that never breaks a line, so "avg $182.40" stays whole in a narrow cell. */
const NBSP = String.fromCharCode(160)
/** A date keeps its hyphens on one line (U+2011), so an expiry stays whole in a narrow cell. */
const unbroken = (s) => String(s).replace(/-/g, String.fromCharCode(0x2011))

const count = (n) => formatNumber(n, { decimals: 0 })
const money = (v) => formatCompactTerminal(v, { money: true, absent: NA })
const signedMoney = (v) => (v > 0 ? `+${money(v)}` : money(v))
const price = (v) => formatCurrency(v, { decimals: 2, absent: NA })
const toneOf = (direction) => (direction === 'bullish' ? styles.up : direction === 'bearish' ? styles.down : undefined)
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')
const plural = (n, one, many) => (n === 1 ? one : many)

/** Pure: a contract in plain words: "$420 call, expires 2027-01-15". Parts the row lacks are left out. */
export function contractText(row) {
  const strike = row?.strike == null ? null : formatCurrency(row.strike, { decimals: Number.isInteger(row.strike) ? 0 : 2 })
  const head = [strike, row?.side].filter(Boolean).join(' ')
  const tail = row?.expiry ? `expires ${row.expiry}` : ''
  return [head, tail].filter(Boolean).join(', ') || 'Not given'
}

function FailedRead({ read, code }) {
  const locked = !canRetry(read.error)
  return (
    <PanelState kind={read.error ? failureKind(read.error) : 'error'} testId="terminal-confl-error"
      title={read.error ? failureText(read.error, WHAT) : `${WHAT} could not be read just now.`}
      action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
      {locked ? null : `That is not the same as an empty board. Retry, or run ${code} again.`}
    </PanelState>
  )
}

function Board({ code, lean, onLean }) {
  // The pace follows the server's own word that it has no board yet. `warming` is adjusted during
  // render from the last answer (no effect, so no extra pass through an old value).
  const [warming, setWarming] = useState(false)
  const read = useMarketRead(CONFLUENCE_URL, { refreshInterval: warming ? WARM_POLL_MS : BOARD_POLL_MS })
  const view = useMemo(() => confluenceRead(read.body), [read.body])
  if ((view.state === 'warming') !== warming) setWarming(view.state === 'warming')
  const [all, setAll] = useState(false)
  const wanted = useMemo(() => leanRows(view.rows, lean), [view.rows, lean])
  // Cut by the server's own rank, then listed by size band: row N is the Nth row on screen.
  const groups = useMemo(() => bandGroups(all ? wanted : wanted.slice(0, MAX_ROWS)), [wanted, all])
  const shown = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  usePanelFreshness(view.state === 'ok' && view.rows.length ? panelAsOf(SOURCE, view.windowEnd) : null)
  usePanelSymbolRows(shown.map((r) => r.sym), 'the confluence board', { total: wanted.length })

  if (read.loading) return <PanelSkeleton label="Loading the confluence board" testId="terminal-confl-loading" />
  if (read.error && !read.body) return <FailedRead read={read} code={code} />
  if (view.state === 'warming') {
    return (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-confl-warming">
        The server is putting the confluence board together. After a restart that can take several minutes. This panel
        asks again every 20 seconds and fills in on its own. That is not the same as nothing lining up.
      </PanelState>
    )
  }
  if (view.state === 'unavailable') {
    return (
      <PanelState kind="error" title="The server could not build the confluence board just now." testId="terminal-confl-error"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as nothing lining up. Retry, or run {code} again.
      </PanelState>
    )
  }
  if (view.state !== 'ok') return <FailedRead read={{ ...read, error: null }} code={code} />

  const days = view.days ?? CONFLUENCE_DAYS
  if (!view.rows.length) {
    return (
      <PanelState kind="empty" testId="terminal-confl-empty"
        title={`No stock has both dark pool size and long-dated options flow lined up over the last ${count(days)} trading days.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Check again</button>}>
        That is what the server worked out, not a failed read.
      </PanelState>
    )
  }

  const { counts } = view
  const rowNumber = new Map(shown.map((r, i) => [r.key, i + 1]))
  return (
    <>
      {read.error && <p className={styles.note} role="status">{failureText(read.error, WHAT)} Showing the last read.</p>}
      <div className={styles.head}>
        <span className={styles.lede} data-testid="terminal-confl-totals">
          {count(counts.all)} {plural(counts.all, 'stock', 'stocks')} where dark pool size and long-dated options flow line up
          over the last {count(days)} trading days: {count(counts.bullish)} bullish, {count(counts.bearish)} bearish,{' '}
          {count(counts.building)} building now.
        </span>
      </div>
      {view.partial ? (
        <p className={styles.note} role="status" data-testid="terminal-confl-partial">
          The server marked this build as incomplete: part of the options flow answered late, so some stocks can be missing
          from this board.
        </p>
      ) : null}
      {!wanted.length ? (
        <PanelState kind="empty" compact testId="terminal-confl-none"
          title={`No ${CONFLUENCE_LEANS[lean].words} on the board right now.`}
          action={<button type="button" className={styles.chip} onClick={() => onLean('all')}>Show every direction</button>}>
          {count(counts.all)} {plural(counts.all, 'stock is', 'stocks are')} on the board in the other direction.
        </PanelState>
      ) : groups.map((g) => (
        <div className={styles.tableBox} data-fold="530" key={g.band}>
          <table className={styles.table} data-testid={`terminal-confl-band-${g.band}`}
            aria-label={`Confluence board, ${view.bands[g.band].name}, ${g.rows.length} ${plural(g.rows.length, 'stock', 'stocks')}`}>
            <caption className={styles.caption}>
              {view.bands[g.band].name} ({view.bands[g.band].range}): {count(g.rows.length)}
            </caption>
            <thead>
              <tr>
                <th scope="col" title="Click a symbol to load it into the linked panels">Symbol</th>
                <th scope="col" className={styles.phoneWrap} title="Which way the open option premium leans, and whether the last 5 trading days are still adding to it">Direction</th>
                <th scope="col" className={styles.phoneWrap}
                  title="Bullish premium less bearish premium on option contracts that are still open, then the part of the open premium that sits in long-dated contracts and its share of all of it">Open option premium</th>
                <th scope="col" className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`}
                  title="Dollars traded in the dark pool over the window, the average price paid there, and the last dark pool session's price against that average">Dark pool</th>
                <th scope="col" className={`${styles.phoneHide} ${styles.wrapCell} ${styles.snugTight}`} title="The stock's largest open contract by premium">Largest contract</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.key} data-testid={`terminal-confl-row-${r.sym}`} data-direction={r.direction} data-status={r.status || ''}>
                  <td>
                    <span className={styles.rowNum} aria-hidden="true">{rowNumber.get(r.key)}</span>
                    <PanelSymbol sym={r.sym} className={styles.sym} />
                  </td>
                  <td className={`${toneOf(r.direction) || ''} ${styles.phoneWrap}`.trim()}>{leanWords(r)}</td>
                  {/* One cell of two fixed lines, not two columns: six columns cut the last one off at a
                      half-width panel, and a wrapping cell broke a word in the middle on a phone. */}
                  <td>
                    <span className={tone(r.net)}>{r.net == null ? NA : `${signedMoney(r.net)} net`}</span>
                    <br />
                    <span className={`${styles.muted} ${styles.phoneWrap}`}>
                      {`${money(r.leapPremium)} long-dated`}
                      {r.leapSharePct == null ? null : ` (${formatPercent(r.leapSharePct, { decimals: 0 })})`}
                    </span>
                  </td>
                  <td className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`}>
                    {money(r.darkPool)}
                    {r.avgPrice == null ? null : <span className={styles.muted}>{` avg${NBSP}${price(r.avgPrice)}`}</span>}
                    {r.lastVsAvgPct == null ? null : (
                      <span className={tone(r.lastVsAvgPct)}>{` last${NBSP}${formatPercent(r.lastVsAvgPct, { decimals: 1, signed: true })}`}</span>
                    )}
                  </td>
                  <td className={`${styles.phoneHide} ${styles.wrapCell} ${styles.snugTight}`}>{unbroken(contractText(r))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {wanted.length > MAX_ROWS ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.chip} aria-pressed={all} onClick={() => setAll((v) => !v)} data-testid="terminal-confl-all">
            {all ? `Show the first ${MAX_ROWS}` : `Show all ${count(wanted.length)} stocks`}
          </button>
        </div>
      ) : null}
      <p className={styles.muted} data-testid="terminal-confl-method">
        {wanted.length > shown.length ? `Showing the ${count(shown.length)} highest ranked of ${count(wanted.length)}. ` : ''}
        A stock is on this board when three things hold over the window: a large dollar size traded in the dark pool, option
        premium on still-open contracts that leans clearly one way, and a real part of that premium in long-dated contracts
        (about six months or more to expiry). The direction comes from the options flow; a dark pool print names a price, not
        a buyer. Building means the last 5 trading days added a large part of the net premium in the same direction; steady
        means they are still adding, more slowly; established means the position is in place and not being added to. In the
        Dark pool column, avg is the average price paid there and last is the last dark pool session&apos;s price against
        that average (not a live quote). Each size band is listed in the server&apos;s own rank. A word and a sign (+/-) mark
        every direction, so color is never the only signal. A board says which stocks to study; it is not a forecast or a
        recommendation. Click a symbol to load it into the linked panels; type a row number to do the same.
        {view.window ? ` Dark pool window: ${view.window}.` : ''}
        {' '}The server rebuilds this board about every 30 minutes and does not send its build time.
        {read.receivedAt ? ` Read at ${clock(read.receivedAt)}.` : ''}
      </p>
    </>
  )
}

export default function ConfluencePanel({ lean: leanProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || CONFLUENCE_CODE
  // A new `CONFL BEAR` remounts the panel (the shell keys the body on code + args), so the typed
  // word only ever seeds the state.
  const [lean, setLean] = useState(() => normConfluenceLean(leanProp))
  // A chip writes itself into the command (`CONFL BEAR`) where the registry takes the word, so a
  // reload keeps it; otherwise it is plain component state (commandWriteBack.js).
  const pick = (next) => { setLean(next); writeBack(confluenceCommandArgs({ lean: next })) }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-confl" data-lean={lean}>
      <div className={styles.toolbar} role="toolbar" aria-label="Confluence board controls">
        <div className={styles.group} role="group" aria-label="Direction">
          {Object.entries(CONFLUENCE_LEANS).map(([key, l]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === lean} onClick={() => pick(key)}
              data-testid={`terminal-confl-lean-${key}`}>{l.chip}</button>
          ))}
        </div>
      </div>
      {/* "Alert me when a stock I follow appears here" (the confluence board). Draws nothing until the server says the alerts are on. */}
      <ListAlertSwitch kind="confluence" />
      <Board code={code} lean={lean} onLean={pick} />
    </div>
  )
}
