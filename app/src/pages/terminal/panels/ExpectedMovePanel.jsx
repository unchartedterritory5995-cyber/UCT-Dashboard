// EXMV: what options price for one stock's next earnings report, against what the stock actually
// did on its past reports. `NVDA EXMV` (data wave 4).
//
// ⭐ NO NEW ROUTE. `GET /api/research/expected-move/{sym}` (paid: the at-the-money straddle from
// our own option chain read, and the record of what was priced before each past report) and
// `GET /api/earnings-intel/{sym}` (the next report date and the stock's measured move on each past
// report). The pure half is expectedMoveModel.js, re-exported below.
//
// What it adds to the earnings panels already in the terminal: ERX compares the past moves with
// TODAY'S priced move in one sentence, and ERN opens the calendar's earnings window, which draws
// priced against actual as a chart. This panel is the table: report by report, what was priced
// before it and what the stock then did, with the break-even prices for the coming report.
//
// ⛔ THE REPORT DATE IS READ FIRST. The move read prices the first expiry on or after the report
// date it is given; asked without one it prices the nearest expiry, which is not the earnings
// move when the report is weeks away. So the move read waits for the earnings read to settle.
// ⛔ THE TWO READS FAIL APART. A failed earnings read never blanks the priced move, and it is said
// as a failed read, never as "no past moves".
// ⛔ A MISSING NUMBER IS NEVER 0, and nothing is compared unless both sides are real.
//
// The reads go through marketRead.js (the terminal's one bare-SWR reader). Nothing here polls:
// the server keeps a priced move for 15 minutes.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { formatCurrency, formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { todayIso } from '../../calendar/earningsModalRow'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  EXPECTED_MOVE_CODE, earningsIntelUrl, earningsRead, expectedMoveUrl, expiryIsReportDay, moveRead, pairedRecord, recordVsToday,
  reportRows,
} from './expectedMoveModel'
import styles from './marketPanels.module.css'

export {
  EXPECTED_MOVE_CODE, PAIR_WINDOW_DAYS, dayOf, earningsIntelUrl, earningsRead, expectedMoveUrl, expiryIsReportDay, moveRead,
  nextWeekday, pairedRecord, reasonWords, recordVsToday, reportRows, settled,
} from './expectedMoveModel'

const SOURCE = 'UCT option chain read (at-the-money straddle) and UCT daily bars'
const NA = 'n/a'
/** A space and a hyphen that never break a line, so a date stays whole in a narrow cell. */
const NBSP = ' '
const unbroken = (s) => String(s).replace(/-/g, '‑')
const count = (n) => formatNumber(n, { decimals: 0 })
const plusMinus = (v) => (v == null ? NA : `±${formatPercent(Math.abs(v), { decimals: 1 })}`)
const signed = (v) => formatPercent(v, { decimals: 1, signed: true, absent: NA })
const money = (v) => formatCurrency(v, { decimals: 2, grouping: true, absent: NA })
const strikeText = (v) => (v == null ? NA : formatCurrency(v, { decimals: Number.isInteger(v) ? 0 : 2, grouping: true }))
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')
const plural = (n, one, many) => (n === 1 ? one : many)

/** Pure: why there is no priced move, in a sentence. */
export function outcomeSentence(sym, outcome) {
  const why = outcome?.reason ? ` (${outcome.reason})` : ''
  if (!outcome) return `No options read came back for ${sym}.`
  return outcome.kind === 'refused'
    ? `The option chain for ${sym} was read, but it gave no number that can be trusted${why}.`
    : `The option chain for ${sym} could not be read just now${why}.`
}

/** Pure: the past reports against today's priced move, in a sentence ('' with nothing measured). */
export function recordSentence(sym, rec, livePct) {
  if (!rec || !rec.n) return ''
  const reports = rec.n === 1 ? 'its last measured report' : `its last ${count(rec.n)} measured reports`
  const head = `On ${reports} ${sym} moved ${plusMinus(rec.avgAbs)}${rec.n === 1 ? '' : ' on average'}`
  const beyond = rec.beyond == null ? '' : rec.n === 1
    ? `, ${rec.beyond ? 'more' : 'no more'} than the ${plusMinus(livePct)} priced now`
    : `, and more than the ${plusMinus(livePct)} priced now on ${count(rec.beyond)} of them`
  const biggest = rec.n > 1 && rec.biggest != null ? ` The biggest was ${signed(rec.biggest)}.` : ''
  return `${head}${beyond}.${biggest}`
}

/** Pure: the reports where a priced move was on record before them, in a sentence. */
export function pairedSentence(sym, paired, since) {
  if (!paired || !paired.n) {
    return since
      ? `No past report of ${sym} has both a recorded priced move and a measured move yet. The record of priced moves for ${sym} starts with its ${since} report.`
      : `No priced move is on record from before any past report of ${sym}, so past reports cannot be set against what was priced then.`
  }
  const n = paired.n
  return `Before ${count(n)} past ${plural(n, 'report', 'reports')} the priced move is on record: the stock moved more than was priced on ${count(paired.beyond)} `
    + `and stayed within it on ${count(n - paired.beyond)} (priced ${plusMinus(paired.avgImplied)} on average, moved ${plusMinus(paired.avgAbs)}).`
}

const ACTUAL_WORDS = { upcoming: 'Not reported yet', 'too-recent': 'Too recent to measure', 'no-actual': 'Not on file' }
const VERDICT_WORDS = { beyond: 'Moved more than priced', within: 'Stayed within the priced move' }

function Report({ sym: s, code, today, earn, earnState, earnQ, moveUrl }) {
  const inPanel = useInTerminalPanel()
  const moveQ = useMarketRead(moveUrl)
  const move = useMemo(() => moveRead(moveQ.body), [moveQ.body])
  const events = earnState === 'ok' ? earn.events : null
  const rows = useMemo(() => reportRows({ history: move.history, events: events || [], today }), [move.history, events, today])
  const live = move.state === 'ok' ? move.live : null
  const hasAnything = !!live || rows.length > 0
  usePanelFreshness(move.state === 'ok' && hasAnything ? panelAsOf(SOURCE, live ? live.asOf : null) : null)

  if (moveQ.loading) {
    return <PanelSkeleton label={`Reading the option chain for ${s}. This can take up to 20 seconds.`} testId="terminal-exmv-loading" />
  }
  if ((moveQ.error && !moveQ.body) || move.state === 'failed') {
    const err = moveQ.body ? null : moveQ.error
    const locked = err ? !canRetry(err) : false
    return (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-exmv-error"
        title={err ? failureText(err, 'The expected move') : `The expected move for ${s} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={moveQ.retry}>Retry</button>}>
        {locked ? null : `That is not the same as having none. Retry, or run ${s} ${code} again.`}
      </PanelState>
    )
  }

  const retryEarn = <button type="button" className={styles.linkBtn} onClick={earnQ.retry}>Retry the earnings history</button>
  const earnNote = earnState === 'http' ? (
    <p className={styles.note} role="status" data-testid="terminal-exmv-earn-error">
      {failureText(earnQ.error, 'The earnings history')} So the next report date and the past moves are missing, which is
      not the same as having none.{' '}{canRetry(earnQ.error) ? retryEarn : null}
    </p>
  ) : earnState === 'failed' ? (
    <p className={styles.note} role="status" data-testid="terminal-exmv-earn-error">
      The earnings history could not be read just now. So the next report date and the past moves are missing, which is
      not the same as having none.{' '}{retryEarn}
    </p>
  ) : !earn.measured ? (
    <p className={styles.muted} data-testid="terminal-exmv-earn-none">
      Past earnings moves for {s} are not on file: fewer than four of its recent reports could be measured.
    </p>
  ) : null

  const next = earnState === 'ok' ? earn.nextReport : null
  const rec = recordVsToday(rows, live?.pct)
  const paired = pairedRecord(rows)
  const hasPast = rows.some((r) => r.state !== 'upcoming')

  if (!hasAnything) {
    return (
      <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-exmv">
        <PanelState kind="empty" role="status" testId="terminal-exmv-empty" title={`No expected move and no past earnings moves are on hand for ${s}.`}
          action={<button type="button" className={styles.chip} onClick={() => { moveQ.retry(); earnQ.retry() }}>Check again</button>}>
          {outcomeSentence(s, move.outcome)}{' '}
          {next ? `Its next report is ${next}.` : earnState === 'ok' ? 'No next report date is on file.' : ''}
        </PanelState>
        {earnNote}
      </div>
    )
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-exmv">
      {live ? (
        <p className={styles.lede} data-testid="terminal-exmv-headline">
          Options price a {plusMinus(live.pct)} move for {s}{live.dollars != null ? ` (about ${money(live.dollars)} a share either way)` : ''}
          {live.expiry ? ` through ${live.expiry}` : ''}.{' '}
          {next
            ? `The next report is ${next}${live.expiry ? `; ${live.expiry} is the first option expiry on or after it` : ''}.`
            : `${earnState === 'ok' ? 'No next report date is on file' : 'The next report date could not be read'}, so this is the nearest option expiry. `
              + `It only reflects earnings if the report comes on or before ${live.expiry || 'that day'}.`}
        </p>
      ) : (
        <p className={styles.note} role="status" data-testid="terminal-exmv-no-live">
          {outcomeSentence(s, move.outcome)} That is not the same as a small expected move.
          {next ? ` The next report is ${next}.` : ''}{' '}
          <button type="button" className={styles.linkBtn} onClick={moveQ.retry}>Read the options again</button>
        </p>
      )}
      {live && expiryIsReportDay(live, next) ? (
        <p className={styles.note} role="status" data-testid="terminal-exmv-same-day">
          That expiry is the report day itself. If {s} reports after the close, those options stop trading before the
          news, and this number does not hold the earnings move.
        </p>
      ) : null}
      {moveQ.error && moveQ.body ? (
        <p className={styles.note} role="status" data-testid="terminal-exmv-stale">{failureText(moveQ.error, 'The expected move')} Showing the last read.</p>
      ) : null}
      {rec.n ? <p className={styles.lede} data-testid="terminal-exmv-record">{recordSentence(s, rec, live?.pct)}</p> : null}
      {earnNote}

      {live ? (
        <dl className={styles.fields} data-testid="terminal-exmv-fields">
          <div style={{ display: 'contents' }}>
            <dt>Break-even prices</dt>
            <dd>
              {live.low != null && live.high != null
                ? `${money(live.low)} to ${money(live.high)}, around the ${money(live.spot)} price when the options were read`
                : 'Not worked out: the read came without a price or a dollar move.'}
            </dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt>Options used</dt>
            <dd>
              The {strikeText(live.strike)} call{live.callMid != null ? ` (${money(live.callMid)})` : ''} and put
              {live.putMid != null ? ` (${money(live.putMid)})` : ''}{live.expiry ? ` expiring ${live.expiry}` : ''}, each at the
              middle of its bid and ask
            </dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt>Next report</dt>
            <dd>{next || (earnState === 'ok' ? 'No date on file' : 'Could not be read')}</dd>
          </div>
        </dl>
      ) : null}

      {rows.length ? (
        <>
          <div className={styles.tableBox} data-fold="550">
            <table className={styles.table} data-testid="terminal-exmv-table"
              aria-label={`${s} earnings reports, newest first: the move options priced before each and the move the stock made`}>
              <thead>
                <tr>
                  <th scope="col">Report</th>
                  <th scope="col" className={styles.wrapCell} title="What the at-the-money straddle priced before the report, as recorded by the nightly job, and the day it was recorded">Priced before</th>
                  <th scope="col" className={styles.wrapCell} title="The close-to-close move of the session that first traded the result">Actual move</th>
                  <th scope="col" className={`${styles.phoneHide} ${styles.wrapCell}`} title="The size of the actual move against the move that was priced before the report">Against the priced move</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} data-testid={`terminal-exmv-row-${r.day}`} data-state={r.state} data-verdict={r.verdict || undefined}>
                    <td>
                      {unbroken(r.day)}
                      {r.label ? <span className={styles.muted}>{`,${NBSP}${r.label.replace(/ /g, NBSP)}`}</span> : null}
                    </td>
                    <td className={styles.wrapCell}>
                      {r.impliedPct == null ? 'Not recorded' : (
                        <>
                          {plusMinus(r.impliedPct)}
                          <span className={styles.muted}>
                            {r.impliedDollars != null ? ` (${money(r.impliedDollars)})` : ''}
                            {r.capturedDay ? `, recorded${NBSP}${unbroken(r.capturedDay)}` : ''}
                          </span>
                        </>
                      )}
                    </td>
                    <td className={`${styles.wrapCell} ${r.actualPct != null ? tone(r.actualPct) || '' : ''}`}>
                      {r.actualPct != null ? signed(r.actualPct) : ACTUAL_WORDS[r.state] || 'Not on file'}
                    </td>
                    <td className={`${styles.phoneHide} ${styles.wrapCell}`}>{r.verdict ? VERDICT_WORDS[r.verdict] : 'Not compared'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasPast ? <p className={styles.lede} data-testid="terminal-exmv-paired">{pairedSentence(s, paired, move.since)}</p> : null}
        </>
      ) : null}

      <p className={styles.muted} data-testid="terminal-exmv-links">
        Also for {s}:{' '}
        <PanelCommand cmd={`${s} ERX`} label={`Earnings reaction (ERX) for ${s}`}>Earnings reaction (ERX)</PanelCommand>,{' '}
        <PanelCommand cmd={`${s} ERN`} label={`Earnings detail (ERN) for ${s}`}>Earnings detail (ERN)</PanelCommand>,{' '}
        <PanelCommand cmd={`${s} EE`} label={`Earnings estimates (EE) for ${s}`}>Earnings estimates (EE)</PanelCommand>
      </p>
      <p className={styles.muted} data-testid="terminal-exmv-method">
        The priced move is the cost of the at-the-money call plus the put, as a share of the stock price: roughly how
        far the stock has to move by that expiry for buying both to break even. It covers every day up to the expiry,
        not only the report. The actual move is one session: the close-to-close move of the session that first traded
        the result, from UCT daily bars. So the two are close cousins, not the same measure. &quot;Priced before&quot;
        is recorded once, by a nightly job, in the days before a report; a report with no record says so. A move is
        held back as too recent until the session after the report has closed. Past reports describe the past; this is
        not a forecast or a recommendation. A word and a sign (+/-) mark every direction, so color is never the only
        signal.
        {live && clock(live.asOf) ? ` Options read at ${clock(live.asOf)}; the server keeps a read for 15 minutes.` : ''}
      </p>
    </div>
  )
}

function ExpectedMoveBody({ sym: s, code }) {
  const [today] = useState(todayIso)
  const earnQ = useMarketRead(earningsIntelUrl(s))
  const earn = useMemo(() => earningsRead(earnQ.body, today), [earnQ.body, today])
  const earnState = earnQ.loading ? 'loading' : earnQ.error && !earnQ.body ? 'http' : earn.state

  if (earnState === 'loading') return <PanelSkeleton label={`Reading the earnings dates for ${s}`} testId="terminal-exmv-loading" />
  if (earnState === 'fund') {
    return (
      <PanelState kind="empty" role="status" testId="terminal-exmv-fund" title={`${s} is a fund, and funds do not report earnings.`}>
        So there is no earnings move to price. For its option chain, run <kbd>{s} OMON</kbd>
      </PanelState>
    )
  }
  // The move read is asked only now, with the report date when one is known. Keyed by its request:
  // a read made for one report date is never drawn under another.
  const moveUrl = expectedMoveUrl(s, earnState === 'ok' ? earn.nextReport : null)
  return <Report key={moveUrl} sym={s} code={code} today={today} earn={earn} earnState={earnState} earnQ={earnQ} moveUrl={moveUrl} />
}

export default function ExpectedMovePanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase()
  const code = useInTerminalPanel()?.code || EXPECTED_MOVE_CODE
  if (!s) {
    return (
      <PanelState kind="input" title={`${code} needs a ticker.`}>
        Type one first, e.g. <kbd>NVDA {code}</kbd>
      </PanelState>
    )
  }
  // Keyed by ticker: a new ticker is a new pair of reads, so one stock's numbers are never drawn under another's name.
  return <ExpectedMoveBody key={s} sym={s} code={code} />
}
