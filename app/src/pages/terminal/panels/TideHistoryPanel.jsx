// TIDEH: Market Tide by day. Each finished session's net call and net put premium, as the server
// stored it once after that session's close. `TIDEH`.
//
//   TIDEH          stocks and ETFs together      TIDEH STOCKS | ETFS     one side of the tape
//
// One read: GET /api/options/market-tide/history (paid, behind Market Tide's own switch). It reads
// a small store and nothing else: no tide is built and no tape is read on the request. The pure
// half is tideHistoryModel.js, re-exported below.
//
// ⛔ WHAT THIS PANEL NEVER DOES
//   * It never draws a session that was not stored as a zero row: a missing session is named in a
//     note, and a sum that would span one is refused in words.
//   * It never calls a day bullish or bearish. Green and red mark the sign of a number, and the
//     bar's length is that day's share of the largest net among the rows on screen.
//   * It never reads as live or as revised: a session is stored once, and the line above the table
//     says how many are stored and since which day.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  TIDE_HISTORY_CODE, TIDE_HISTORY_SOURCE, TIDE_HISTORY_WHAT, TIDE_ROWS_SHOWN, TIDE_SCOPES, anyUnreadable, barWidth, barsFor,
  countText, cutLine, dayWords, leftOutText, missingNote, normTideScope, premiumText, printsLine, signOf, storedLine, summaryFor, throughWords,
  tideHistoryCommandArgs, tideHistoryRead, tideHistoryUrl,
} from './tideHistoryModel'
import styles from './marketPanels.module.css'
import bars from './barCells.module.css'

export {
  TIDE_HISTORY_CODE, TIDE_HISTORY_SOURCE, TIDE_HISTORY_WHAT, TIDE_MISSING_NAMED, TIDE_ROWS_SHOWN, TIDE_SCOPES, TIDE_SCOPE_ARG_WORDS,
  TIDE_SESSIONS_ASKED, TIDE_SUM_WINDOWS, anyUnreadable, barWidth, barsFor, countText, cutLine, dayWords, leftOutText, missingNote, normTideScope,
  parseTideScope, premiumText, printsLine, signOf, storedLine, sumOver, summaryFor, throughWords, tideHistoryCommandArgs,
  tideHistoryRead, tideHistoryUrl,
} from './tideHistoryModel'

/** The store changes once a day, after the close; the panel asks again this often while it is on screen. */
export const TIDE_HISTORY_POLL_MS = 10 * 60 * 1000

// The day cell's two words each sit in a box as wide as the widest value that word can take
// ("Wed" is 2.2em and "May 28" 3.4em in the panel's font), so every row's day is the SAME width.
// In a narrow panel the day may break after the weekday, and a table gives a column one width for
// all its rows: with words of their own widths "Wed Nov 18" broke and "Tue Nov 17" beside it did
// not, and the rows came out in two heights. With equal widths they all break or none does.
const DAY_WORD = { display: 'inline-block', minWidth: '2.3em' }
const DAY_DATE = { display: 'inline-block', minWidth: '3.5em' }
// "14 left out" moves to the next line as ONE piece where the line is short (never "14" at the end
// of one line and "left out" on the next), and still gives way inside a panel too narrow for it.
const LEFT_OUT = { display: 'inline-block' }

const signClass = (n) => (signOf(n) === 'up' ? styles.up : signOf(n) === 'down' ? styles.down : undefined)

function Row({ row, bar }) {
  const through = throughWords(row.through)
  // "Nov 18" never breaks apart (a no-break space); the one break allowed is after the weekday.
  const [weekday, ...rest] = dayWords(row.session).split(' ')
  const leftOut = leftOutText(row)
  return (
    <tr data-testid="terminal-tideh-row" data-session={row.session}>
      <td className={styles.phoneWrap} title={through ? `Stored through ${through}` : undefined}>
        <span style={DAY_WORD}>{weekday}</span> <span style={DAY_DATE}>{rest.join('\u00a0')}</span>
        <br />
        <span className={styles.muted} data-testid="terminal-tideh-prints">
          {printsLine(row)}{leftOut ? <>, <span style={LEFT_OUT}>{leftOut}</span></> : null}
        </span>
      </td>
      <td data-testid="terminal-tideh-call"><span className={signClass(row.netCall)}>{premiumText(row.netCall)}</span></td>
      <td data-testid="terminal-tideh-put"><span className={signClass(row.netPut)}>{premiumText(row.netPut)}</span></td>
      <td data-testid="terminal-tideh-net">
        <span className={signClass(row.net)}>{premiumText(row.net)}</span>
        {bar ? (
          <div className={bars.barRow}>
            <span className={bars.track} aria-hidden="true">
              <span className={bars.mid} />
              {bar.dir === 'flat' ? null : (
                <span className={`${bars.bar} ${bar.dir === 'down' ? bars.barDown : bars.barUp}`} style={{ width: barWidth(bar.share) }}
                  data-testid="terminal-tideh-bar" data-dir={bar.dir} />
              )}
            </span>
          </div>
        ) : null}
      </td>
    </tr>
  )
}

function TideHistoryBody({ code, scope: scopeProp }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const [scope, setScope] = useState(() => normTideScope(scopeProp))
  const [showAll, setShowAll] = useState(false)
  const read = useMarketRead(tideHistoryUrl(scope), { refreshInterval: TIDE_HISTORY_POLL_MS })
  const view = useMemo(() => tideHistoryRead(read.body), [read.body])

  // While another scope is being read the answer in hand is the last scope's: never drawn under this chip.
  const other = view.state !== 'failed' && view.scope !== scope
  const dated = !read.loading && !!read.body && !other && view.state === 'ok'
  usePanelFreshness(dated ? panelAsOf(TIDE_HISTORY_SOURCE, view.latest) : null)

  // A scope writes itself into the command (`TIDEH ETFS`) where the registry takes it; outside the
  // shell it stays in this panel's own state.
  const pick = (next) => {
    if (next === scope) return
    setScope(next)
    setShowAll(false)
    writeBack(tideHistoryCommandArgs({ scope: next }))
  }

  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-tideh" data-state={state} data-scope={scope}>{body}</div>
  )
  const chips = (
    <div className={styles.toolbar} role="toolbar" aria-label="Market Tide by day controls">
      <div className={styles.group} role="group" aria-label="Which prints">
        {Object.entries(TIDE_SCOPES).map(([key, spec]) => (
          <button key={key} type="button" className={styles.chip} aria-pressed={key === scope} onClick={() => pick(key)}
            title={spec.words} data-testid={`terminal-tideh-scope-${key}`}>{spec.label}</button>
        ))}
      </div>
    </div>
  )

  if (read.loading || (other && !read.error)) return <PanelSkeleton label="Loading Market Tide by day" testId="terminal-tideh-loading" />
  if (!read.body || view.state === 'failed' || other) {
    const err = read.body && !other ? null : read.error
    if (err?.status === 404) {
      return (
        <PanelState kind="locked" role="status" testId="terminal-tideh-error" title="Market Tide isn't switched on yet.">
          That is a setting on our side, not an empty result.
        </PanelState>
      )
    }
    const locked = err ? !canRetry(err) : false
    return (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-tideh-error"
        title={err ? failureText(err, TIDE_HISTORY_WHAT) : `${TIDE_HISTORY_WHAT} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no sessions stored. Retry, or run ${code} again.`}
      </PanelState>
    )
  }
  if (view.state === 'none') {
    return wrap('none', (
      <>
        {chips}
        <PanelState kind="empty" role="status" testId="terminal-tideh-none"
          title={scope === 'all' ? 'No session is stored yet.' : `No session is stored yet for ${TIDE_SCOPES[scope].words}.`}>
          The first is stored after the next close on a weekday, about 4:30 PM ET. Sessions before the first stored day
          were never stored and cannot be recovered. For today&apos;s tide, minute by minute:{' '}
          <PanelCommand cmd="TIDE" label="Market Tide">Market Tide (TIDE)</PanelCommand>
        </PanelState>
      </>
    ))
  }

  const shown = showAll ? view.rows : view.rows.slice(0, TIDE_ROWS_SHOWN)
  const rowBars = barsFor(shown)
  const sums = summaryFor(view)
  const missing = missingNote(view)
  const cut = cutLine(view, shown.length)
  const one = view.rows.length === 1
  return wrap(one ? 'one' : 'ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-tideh-stale-read">{failureText(read.error, TIDE_HISTORY_WHAT)} Showing the last read.</p> : null}
      <p className={styles.lede} data-testid="terminal-tideh-asof">
        {storedLine(view)}{view.filters ? ` ${view.filters}` : ''}
      </p>
      {chips}
      {missing ? <p className={styles.note} role="status" data-testid="terminal-tideh-missing">{missing} A day with no stored tide is left out, not drawn as zero.</p> : null}
      {one ? (
        <p className={styles.muted} role="status" data-testid="terminal-tideh-one">
          Only one session is stored so far, so there is nothing to compare or sum yet. The next is stored after the
          next close on a weekday, about 4:30 PM ET.
        </p>
      ) : (
        <dl className={styles.fields} data-testid="terminal-tideh-summary">
          {sums.map((s) => (
            <div key={s.n} style={{ display: 'contents' }}>
              <dt>{s.label}</dt>
              <dd data-testid={`terminal-tideh-sum-${s.n}`} data-ok={s.ok ? 'yes' : 'no'}>
                {s.ok ? <><span className={signClass(s.sum)}>{s.figure}</span>, {s.range}</> : <span>{s.text}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-tideh-table"
          aria-label={`Market Tide by day, ${TIDE_SCOPES[scope].words}, newest session first`}>
          <thead>
            <tr>
              <th scope="col">Session</th>
              <th scope="col" title="Call premium bought at the ask minus call premium sold at the bid">Net call</th>
              <th scope="col" title="Put premium bought at the ask minus put premium sold at the bid">Net put</th>
              <th scope="col" title="Net call premium minus net put premium. The bar is this day's share of the largest net among the rows shown">Net</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => <Row key={r.session} row={r} bar={rowBars[i]} />)}
          </tbody>
        </table>
      </div>
      {cut ? (
        <p className={styles.muted} role="status" data-testid="terminal-tideh-cut">
          {cut}{' '}
          {!showAll && view.rows.length > TIDE_ROWS_SHOWN ? (
            <button type="button" className={styles.linkBtn} onClick={() => setShowAll(true)} data-testid="terminal-tideh-more">
              Show {countText(view.rows.length - TIDE_ROWS_SHOWN)} more
            </button>
          ) : null}
        </p>
      ) : null}
      <p className={styles.muted} data-testid="terminal-tideh-method">
        {view.storedNote ? `${view.storedNote} ` : ''}
        Net is net call premium minus net put premium. Each bar is that day&apos;s share of the largest net among the
        rows shown. Green and red mark the sign of a number only; this panel does not call a day bullish or bearish.
        {anyUnreadable(shown) ? ' Prints marked left out had no usable time, premium or call/put on the tape, so they are not in that day\u2019s figures.' : ''}
        {view.method ? ` ${view.method}` : ''} Source: UCT&apos;s options flow tape.
      </p>
      <p className={styles.muted} data-testid="terminal-tideh-links">
        Today, minute by minute:{' '}
        <PanelCommand cmd="TIDE" label="Market Tide">Market Tide (TIDE)</PanelCommand>
      </p>
    </>
  ))
}

export default function TideHistoryPanel({ scope }) {
  const code = useInTerminalPanel()?.code || TIDE_HISTORY_CODE
  // Keyed by the command's scope: `TIDEH ETFS` typed over `TIDEH` is a new read under the right chip.
  return <TideHistoryBody key={normTideScope(scope)} code={code} scope={scope} />
}
