// ANLG: days like today. The past sessions whose breadth looked most like the newest stored
// session, and what the S&P 500 did after each. `ANLG`, `ANLG 8`.
//
//   ANLG        the 5 closest sessions (the route's default)      ANLG 3 ... ANLG 10     that many
//
// One read: GET /api/breadth-monitor/analogues?top_n=N (paid). The server searches its own breadth
// history and holds the answer for hours; nothing is computed in the browser but the counts and the
// median of the rows on screen. The pure half is analoguesModel.js, re-exported below.
//
// ⛔ WHAT THIS PANEL NEVER DOES
//   * It never reads as a forecast. The first sentence says it is a record, every statistic carries
//     its count, and a handful of sessions is called a small sample in words.
//   * It never draws a forward window the calendar has not reached as 0: it says "not yet", and
//     that match is left out of that window's count.
//   * It never says what the market will do next, and it never ranks a match as good or bad. Green
//     and red mark the sign of a return only.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import Select from '../../../components/ui/Select'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  ANLG_CODE, ANLG_COUNT_MAX, ANLG_COUNT_MIN, ANLG_POLL_MS, ANLG_RECORD_LINE, ANLG_SOURCE, ANLG_WHAT, ANLG_WINDOWS, anlgCommandArgs, anlgRead, anlgUrl,
  cellFor, countLine, dayWithYear, matchText, normAnlgCount, summaryFor,
} from './analoguesModel'
import { dayWords } from './tideHistoryModel'
import styles from './marketPanels.module.css'

const COUNT_OPTIONS = Array.from({ length: ANLG_COUNT_MAX - ANLG_COUNT_MIN + 1 }, (_, i) => {
  const n = ANLG_COUNT_MIN + i
  return { value: String(n), label: `${n} sessions` }
})

const signClass = (sign) => (sign === 'up' ? styles.up : sign === 'down' ? styles.down : undefined)

function ReturnCell({ row, win, hide }) {
  const cell = cellFor(row, win.key)
  const cls = hide ? styles.phoneHide : undefined
  if (cell.kind === 'value') {
    return <td className={cls} data-testid={`terminal-anlg-${win.key}`} data-kind="value"><span className={signClass(cell.sign)}>{cell.text}</span></td>
  }
  if (cell.kind === 'notyet') {
    return (
      <td className={cls} data-testid={`terminal-anlg-${win.key}`} data-kind="notyet"
        title={`Fewer than ${win.days} trading days have passed since this session`}>
        <span className={styles.muted}>not yet</span>
      </td>
    )
  }
  return (
    <td className={cls} data-testid={`terminal-anlg-${win.key}`} data-kind="none" title="No S&P 500 close is stored to measure from">
      <span className={styles.muted}>n/a</span>
    </td>
  )
}

function AnaloguesRead({ code, count, pick }) {
  const inPanel = useInTerminalPanel()
  const read = useMarketRead(anlgUrl(count), { refreshInterval: ANLG_POLL_MS })
  const view = useMemo(() => anlgRead(read.body), [read.body])
  const dated = !read.loading && !!read.body && (view.state === 'ok' || view.state === 'nomatch')
  usePanelFreshness(dated ? panelAsOf(ANLG_SOURCE, view.reference) : null)

  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-anlg" data-state={state} data-count={count}>{body}</div>
  )
  const picker = (
    <div className={styles.toolbar} role="toolbar" aria-label="Days like today controls">
      <label className={`${styles.muted} ${styles.pick}`}>
        How many{' '}
        <Select value={String(count)} onChange={(e) => pick(e.target.value)} options={COUNT_OPTIONS}
          className={styles.chip} data-testid="terminal-anlg-count" />
      </label>
    </div>
  )

  if (read.loading) return <PanelSkeleton label="Loading days like today" testId="terminal-anlg-loading" />
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    const locked = err ? !canRetry(err) : false
    return (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-anlg-error"
        title={err ? failureText(err, ANLG_WHAT) : `${ANLG_WHAT} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no similar day. Retry, or run ${code} again.`}
      </PanelState>
    )
  }
  if (view.state === 'thin') {
    return wrap('thin', (
      <PanelState kind="empty" role="status" testId="terminal-anlg-thin" title="There is not enough breadth history stored yet to compare days.">
        The comparison needs at least 20 stored sessions. Today&apos;s breadth is on{' '}
        <PanelCommand cmd="BRD" label="Breadth">Breadth (BRD)</PanelCommand>
      </PanelState>
    ))
  }
  if (view.state === 'nomatch') {
    return wrap('nomatch', (
      <>
        <p className={styles.lede} data-testid="terminal-anlg-record">{ANLG_RECORD_LINE}</p>
        {picker}
        <PanelState kind="empty" role="status" testId="terminal-anlg-nomatch"
          title={`No past session came back as similar to ${dayWords(view.reference)}.`}>
          Either too many of that day&apos;s breadth measures are missing to compare it, or nothing in the last 500
          trading days is close enough to report. That is an answer, not a failed read.
        </PanelState>
      </>
    ))
  }

  const sums = summaryFor(view.rows)
  return wrap('ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-anlg-stale-read">{failureText(read.error, ANLG_WHAT)} Showing the last read.</p> : null}
      <p className={styles.lede} data-testid="terminal-anlg-record">{ANLG_RECORD_LINE}</p>
      <p className={styles.muted} data-testid="terminal-anlg-count-line">{countLine(view, count)}</p>
      {picker}
      <dl className={styles.fields} data-testid="terminal-anlg-summary">
        {sums.map((s) => (
          <div key={s.key} style={{ display: 'contents' }}>
            <dt>{s.label}</dt>
            <dd data-testid={`terminal-anlg-sum-${s.key}`} data-n={s.n}>{s.text}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-anlg-table"
          aria-label={`The ${view.rows.length} sessions most like ${dayWords(view.reference)}, closest first, with the S&P 500 return after each`}>
          <thead>
            <tr>
              <th scope="col">Session</th>
              {ANLG_WINDOWS.map((w) => (
                <th key={w.key} scope="col" className={w.days === 10 ? styles.phoneHide : undefined}
                  title={`S&P 500 close, ${w.days} trading days after the session`}>{w.days} days</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.date} data-testid="terminal-anlg-row" data-date={r.date}>
                <td className={styles.phoneWrap}>
                  {dayWithYear(r.date)}
                  <br />
                  <span className={styles.muted} data-testid="terminal-anlg-match">{matchText(r.similarity)}</span>
                </td>
                {ANLG_WINDOWS.map((w) => <ReturnCell key={w.key} row={r} win={w} hide={w.days === 10} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted} data-testid="terminal-anlg-method">
        A match of 100% would be an identical day: closeness is measured over 16 weighted breadth measures. The search
        covers the last 500 trading days of our own breadth history, leaves out the 5 newest sessions and keeps matches
        at least 10 trading days apart. Returns are the S&amp;P 500 close, counted in trading days. &quot;Not yet&quot;
        means the calendar has not reached that window, so that session is left out of that window&apos;s count. Green
        and red mark the sign of a return only. In a narrow panel the 10-day column is hidden; its summary line stays.
      </p>
      <p className={styles.muted} data-testid="terminal-anlg-links">
        Today&apos;s breadth: <PanelCommand cmd="BRD" label="Breadth">Breadth (BRD)</PanelCommand>
      </p>
    </>
  ))
}

function AnaloguesBody({ code, count: countProp }) {
  const writeBack = usePanelWriteBack()
  const [count, setCount] = useState(() => normAnlgCount(countProp))
  // The count writes itself into the command (`ANLG 8`) where the registry takes it; outside the
  // shell it stays in this panel's own state.
  const pick = (raw) => {
    const next = normAnlgCount(raw)
    if (next === count) return
    setCount(next)
    writeBack(anlgCommandArgs({ count: next }))
  }
  // Keyed by the count: the answer carries no count of its own, so a new count is a new read and
  // the last count's rows are never drawn under this one.
  return <AnaloguesRead key={count} code={code} count={count} pick={pick} />
}

export default function AnaloguesPanel({ count }) {
  const code = useInTerminalPanel()?.code || ANLG_CODE
  // Keyed by the command's count: `ANLG 8` typed over `ANLG` is a new read under the right pick.
  return <AnaloguesBody key={normAnlgCount(count)} code={code} count={count} />
}
