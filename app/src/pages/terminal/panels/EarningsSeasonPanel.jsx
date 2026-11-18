// ERNS: the earnings season screen. One day's reporters: who reports before the open and after
// the close, the move options priced before each report, how each stock moved on its past
// reports, and the result and the stock's move once it lands.
//
//   ERNS              the first day from today that has a company reporting
//   ERNS TODAY        today (New York)            ERNS TONIGHT    today, after the close only
//   ERNS TOMORROW     the next session            ERNS 11/19      that day (also 2026-11-19)
//   ERNS TODAY BMO    only the reports before the open (AMC: after the close)
//
// ⭐ ONE READ: `GET /api/calendar/earnings-season` (paid, like the Calendar). The server puts the
// day together only from what it already holds and never builds on the request; a day it has not
// put together yet answers "computing" and this panel asks again. The pure half is
// earningsSeasonModel.js, re-exported below.
//
// What it adds to the earnings panels already here: EMOV is the scoreboard of who has reported
// and how each stock moved; CAL is the calendar; EXMV is one stock, report by report. This is
// the day AHEAD as well as the day's results: the priced move and the past moves for every
// reporter in one list. A symbol loads that stock into the linked panels, so EXMV, ERX or EE
// beside it follow.
//
// ⛔ A MISSING NUMBER IS NEVER 0: no stored priced move is a dash (and the reason is said once,
// with how many are priced); a move the server does not hold is said as not held.
// ⛔ A FAILED READ IS NEVER AN EMPTY DAY, and a calendar the server could not read is not "nobody
// reports".
// ⛔ ONE SOURCE FOR THE PRICED MOVE: UCT's own stored option capture, the same record EXMV shows.
// ⛔ ONE DAY'S ROWS ARE NEVER DRAWN UNDER ANOTHER DAY'S NAME: the read is keyed by the day asked for.
//
// The read goes through marketRead.js (the terminal's one bare-SWR reader), and SWR skips ticks
// while the app is hidden.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import {
  ABSENT, formatCompactTerminal, formatCurrency, formatNumber, formatPercent, formatTimeEt,
} from '../../../lib/presentation/presentationPrimitives'
import { formatSessionDate } from '../../../lib/presentation/presentationDates'
import { todayIso } from '../../calendar/earningsModalRow'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  EARNINGS_DAYS, EARNINGS_SEASON_CODE, EARNINGS_SESSIONS, PAST_MOVES_DRAWN, SESSION_HEADINGS, earningsChoice,
  earningsSeasonCommandArgs, earningsSeasonRead, earningsSeasonUrl, isIsoDate, isSessionDay, requestDate, shownGroups,
  stepDay, tallyRows, tomorrowChip, weekdayOf,
} from './earningsSeasonModel'
import styles from './marketPanels.module.css'
import phone from './earningsSeason.module.css'

export {
  DEFAULT_EARNINGS_DAY, DEFAULT_EARNINGS_SESSION, EARNINGS_DAYS, EARNINGS_DAY_ARG_WORDS, EARNINGS_SEASON_CODE,
  EARNINGS_SESSIONS, EARNINGS_SESSION_ARG_WORDS, NEAREST_DAY_REACH, PAST_MOVES_DRAWN, SESSION_HEADINGS, SESSION_ORDER,
  TONIGHT_TOKEN, earningsChoice, earningsSeasonCommandArgs, earningsSeasonRead, earningsSeasonUrl, parseEarningsDay,
  parseEarningsSession, requestDate, shownGroups, stepDay, tallyRows, tomorrowChip, tomorrowOf,
} from './earningsSeasonModel'

/** Rows drawn per group at first; "Show all" draws the rest. */
export const GROUP_ROWS = 15
/** While the server says it is still putting the day together, it is asked again at this pace. */
const COMPUTING_POLL_MS = 3 * 1000
/** Today's results land and today's moves are live; another day changes slowly. */
const TODAY_POLL_MS = 60 * 1000
const OTHER_POLL_MS = 5 * 60 * 1000
const SOURCE = 'UCT earnings calendar, UCT option chain capture, UCT daily bars, Massive prices'
const WHAT = 'The earnings season screen'
const NEXT_DAY_WORDS = 'the next day with reports'
const WHEN = { bmo: 'before the open', amc: 'after the close', tbd: 'with no confirmed time' }

const count = (n) => formatNumber(n, { decimals: 0 })
const plural = (n, one, many) => (n === 1 ? one : many)
const plusMinus = (v) => `±${formatPercent(Math.abs(v), { decimals: 1 })}`
const signedPct = (v) => formatPercent(v, { decimals: 1, signed: true })
/** A past move as a small signed number, the percent sign left to the column heading. */
const signedBare = (v) => signedPct(v).replace(/%$/, '')
const money = (v) => formatCurrency(v, { decimals: 2, grouping: true })
const eps = (v) => formatNumber(v, { decimals: 2 })
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')

/** Pure: `Tue Nov 17, 2026` for a calendar day (never shifted by the viewer's time zone). */
export function dayLabel(iso) {
  const day = formatSessionDate(iso, { absent: '' })
  return day ? `${weekdayOf(iso)} ${day}, ${String(iso).slice(0, 4)}` : String(iso || '')
}
/** Pure: `Aug 18` for a past report's day, with its year when that is not this one. */
export function shortDay(iso, today = null) {
  const day = formatSessionDate(iso, { absent: '' })
  if (!day) return String(iso || '')
  return today && String(iso).slice(0, 4) !== String(today).slice(0, 4) ? `${day}, ${String(iso).slice(0, 4)}` : day
}

/** Pure: the day in one sentence: how many report and when, how many have reported, and how many
 *  carry a priced move and past reports (so a dash is never read as "nothing priced"). */
export function daySentence(view, rows, session = 'all') {
  const t = tallyRows(rows)
  if (!t.total) return ''
  const companies = `${count(t.total)} ${plural(t.total, 'company reports', 'companies report')}`
  const parts = session === 'all'
    ? ['bmo', 'amc', 'tbd'].map((s) => [s, (view.groups[s] || []).length]).filter(([, n]) => n)
    : [[session, t.total]]
  const head = parts.length > 1
    ? `${companies}: ${parts.map(([s, n]) => `${count(n)} ${WHEN[s]}`).join(', ')}.`
    : `${companies} ${WHEN[parts[0][0]]}.`
  const reported = t.reported
    ? ` ${count(t.reported)} ${plural(t.reported, 'has', 'have')} reported.`
    : view.dayKind === 'future' ? '' : ' None has reported yet.'
  const priced = view.pricedState === 'failed' ? '' : ` Priced move stored for ${count(t.priced)} of ${count(t.total)}.`
  return `${head}${reported}${priced} Past reports on file for ${count(t.withPast)} of ${count(t.total)}.`
}

/** Pure: the result in two parts: the verdict (or that there is none yet), and the figures. */
export function resultWords(r) {
  if (!r.reported) return ['Not reported', r.epsEst == null ? 'no EPS estimate' : `EPS est. ${eps(r.epsEst)}`]
  const word = r.verdict === 'beat' ? 'Beat' : r.verdict === 'miss' ? 'Missed' : r.verdict === 'mixed' ? 'Mixed' : 'Reported'
  return [word, r.epsEst == null ? `EPS ${eps(r.epsAct)}, no estimate` : `EPS ${eps(r.epsAct)} vs ${eps(r.epsEst)}`]
}

/**
 * Pure: the words beside a reported stock's move, `[words, detail]`. `detail` is true when the
 * words only add to a number (a phone leaves them out), false when they stand where no move is known.
 */
export function moveWords(r) {
  if (!r.reported) return ['', false]
  if (r.move !== null) {
    const so = r.moveState === 'live' ? ' so far' : ''
    if (r.against === 'beyond') return [`more than priced${so}`, true]
    if (r.against === 'within') return [`within priced${so}`, true]
    return [r.moveState === 'live' ? 'so far today' : 'close to close', true]
  }
  if (r.moveState === 'next_close') return ['move at the next close', false]
  if (r.moveState === 'not_held') return ['move not held', false]
  if (r.moveState === 'failed') return ['move not read', false]
  return ['no move yet', false]
}

/** Pure: every past move with its day, for the cell's tooltip. */
export function pastSentence(r, today = null) {
  if (!r.past) return r.pastState === 'not_held' ? 'No past reports are held for this stock yet' : 'Too few past reports could be measured'
  return `Past reports, newest first: ${r.past.moves.map((m) => `${shortDay(m.day, today)} ${signedPct(m.pct)}`).join(', ')}`
}

function FailedRead({ read, code }) {
  const err = read.body ? null : read.error
  const locked = err ? !canRetry(err) : false
  return (
    <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-erns-error"
      title={err ? failureText(err, WHAT) : `${WHAT} came back in a form this panel cannot read.`}
      action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
      {locked ? null : `That is not the same as nobody reporting. Retry, or run ${code} again.`}
    </PanelState>
  )
}

function ReporterRow({ r, n, today }) {
  const [verdictWord, figures] = resultWords(r)
  const [words, detail] = moveWords(r)
  const cap = r.capB == null ? null : formatCompactTerminal(r.capB * 1e9, { money: true, absent: null })
  const drawn = r.past ? r.past.moves.slice(0, PAST_MOVES_DRAWN) : []
  const verdictTone = !r.reported ? styles.muted : r.verdict === 'beat' ? styles.up : r.verdict === 'miss' ? styles.down : undefined
  return (
    <tr data-testid="terminal-erns-row" data-sym={r.sym} data-session={r.session} data-reported={r.reported ? 'yes' : 'no'}>
      <td className={`${styles.wrapCell} ${phone.symCol}`}>
        <span className={styles.rowNum} aria-hidden="true">{n}</span>
        <PanelSymbol sym={r.sym} className={styles.sym} />
        {r.name || cap ? (
          <span className={styles.phoneHide}>
            <br />
            <span className={styles.muted}>{[r.name, cap].filter(Boolean).join(', ')}</span>
          </span>
        ) : null}
      </td>
      {/* once the result is in, the priced move steps back and the result and the move carry the row */}
      <td className={r.reported ? styles.muted : undefined} data-testid="terminal-erns-priced">
        {r.priced ? (
          <>
            {plusMinus(r.priced.pct)}
            <br />
            <span className={styles.muted}>{r.priced.dollars == null ? 'dollars not stored' : money(r.priced.dollars)}</span>
          </>
        ) : <span title="No priced move is stored for this report">{ABSENT}</span>}
      </td>
      <td title={pastSentence(r, today)} data-testid="terminal-erns-past">
        {r.past ? (
          <>
            <span className={styles.phoneHide}>
              {drawn.map((m, i) => (
                <span key={m.day}>{i ? ' ' : ''}<span className={tone(m.pct)}>{signedBare(m.pct)}</span></span>
              ))}
              <br />
            </span>
            <span className={styles.muted}>avg {plusMinus(r.past.avgAbs)}<span className={styles.phoneHide}> of {count(r.past.n)}</span></span>
          </>
        ) : <span className={styles.muted}>{r.pastState === 'not_held' ? 'not on file' : 'too few'}</span>}
      </td>
      <td className={phone.resultCell} data-testid="terminal-erns-result">
        <span className={verdictTone} data-testid="terminal-erns-verdict">{verdictWord}</span>
        <span className={`${styles.muted} ${styles.phoneHide}`}>, {figures}</span>
        {r.reported ? (
          <>
            <br />
            {r.move !== null ? <span className={tone(r.move)} data-testid="terminal-erns-move">{signedPct(r.move)}</span> : null}
            {words ? <span className={`${styles.muted} ${detail ? styles.phoneHide : ''}`}>{r.move !== null ? ' ' : ''}{words}</span> : null}
          </>
        ) : null}
      </td>
    </tr>
  )
}

function Group({ group, start, limit, onShowAll, label, today }) {
  const { session, rows } = group
  const shown = rows.slice(0, limit)
  const reported = rows.filter((r) => r.reported).length
  return (
    <div data-testid={`terminal-erns-group-${session}`}>
      <div className={styles.tableBox} data-fold="550">
        <table className={styles.table} data-testid={`terminal-erns-table-${session}`}
          aria-label={`${SESSION_HEADINGS[session]}, ${label}: ${count(shown.length)} of ${count(rows.length)} companies, biggest first`}>
          <caption className={styles.caption}>
            {SESSION_HEADINGS[session]} ({count(rows.length)}){reported ? `, ${count(reported)} reported` : ''}
          </caption>
          <thead>
            <tr>
              <th scope="col" className={`${styles.wrapCell} ${phone.symCol}`} title="Click a symbol to load it into the linked panels. Biggest company first, by market cap.">Symbol</th>
              <th scope="col" title="What the at-the-money straddle priced before the report, as a percent of the stock price and in dollars, as stored by UCT's weekday capture">Priced move</th>
              <th scope="col" title="The stock's close-to-close move on its last reports, in percent, newest first, and the average size of every one on file">Past moves, %</th>
              <th scope="col" className={phone.resultCell} title="Earnings and revenue against what was expected once the company has reported, and the stock's move on the result">Result and move</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => <ReporterRow key={r.sym} r={r} n={start + i + 1} today={today} />)}
          </tbody>
        </table>
      </div>
      {shown.length < rows.length ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.chip} onClick={onShowAll} data-testid={`terminal-erns-more-${session}`}>
            Show all {count(rows.length)}
          </button>
          <span className={styles.muted} data-testid={`terminal-erns-cut-${session}`}>
            Showing the {count(shown.length)} biggest of {count(rows.length)}, by market cap.
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** One day's read and everything drawn from it. Keyed by the day asked for (see the panel below),
 *  so one day's rows are never drawn under another day's name while the next read is on its way. */
function SeasonDay({ choice, pick, today, asked, code, inPanel }) {
  const [open, setOpen] = useState({})
  const [pace, setPace] = useState(OTHER_POLL_MS)
  const read = useMarketRead(earningsSeasonUrl(asked), { refreshInterval: pace })
  const view = useMemo(() => earningsSeasonRead(read.body), [read.body])
  // The pace follows the server's own word: still working, today, or another day (adjusted during
  // render from the last answer, so there is no extra pass through an old value).
  const wantPace = view.state === 'computing' ? COMPUTING_POLL_MS
    : view.state === 'ok' && view.dayKind === 'today' ? TODAY_POLL_MS : OTHER_POLL_MS
  if (wantPace !== pace) setPace(wantPace)

  const ok = !read.loading && !!read.body && view.state === 'ok'
  const groups = useMemo(() => shownGroups(view, choice.session), [view, choice.session])
  const visible = useMemo(() => groups.map((g) => ({ ...g, limit: open[g.session] ? g.rows.length : GROUP_ROWS })), [groups, open])
  const allRows = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const drawnSyms = useMemo(() => visible.flatMap((g) => g.rows.slice(0, g.limit).map((r) => r.sym)), [visible])
  // The day on screen: the server's own once it has answered (the bare command's day is its pick).
  const shownDate = (read.body && view.date) || asked || null
  const label = shownDate ? dayLabel(shownDate) : NEXT_DAY_WORDS
  usePanelFreshness(ok && view.total ? panelAsOf(SOURCE, view.calendarAsOf || view.builtAt) : null)
  usePanelSymbolRows(ok ? drawnSyms : [], `earnings reporters for ${shownDate || NEXT_DAY_WORDS}`, { total: allRows.length })

  const range = read.body ? view.range : null
  const prev = stepDay(shownDate || today, -1, range)
  const next = stepDay(shownDate || today, 1, range)
  const toolbar = (
    <div className={styles.toolbar} role="toolbar" aria-label="Earnings season controls">
      <div className={styles.group} role="group" aria-label="Which day">
        {Object.entries(EARNINGS_DAYS).map(([key, d]) => (
          <button key={key} type="button" className={styles.chip} aria-pressed={key === choice.day} onClick={() => pick({ day: key })}
            title={key === 'next' ? 'The first day from today with a company reporting' : undefined}
            data-testid={`terminal-erns-day-${key}`}>{key === 'tomorrow' ? tomorrowChip(today) : d.chip}</button>
        ))}
      </div>
      <div className={styles.group} role="group" aria-label="Step a day">
        {prev ? <button type="button" className={styles.chip} onClick={() => pick({ day: prev })} data-testid="terminal-erns-prev">Previous day</button> : null}
        {next ? <button type="button" className={styles.chip} onClick={() => pick({ day: next })} data-testid="terminal-erns-next">Next day</button> : null}
      </div>
      <div className={styles.group} role="group" aria-label="Part of the day">
        {Object.entries(EARNINGS_SESSIONS).map(([key, s]) => (
          <button key={key} type="button" className={styles.chip} aria-pressed={key === choice.session} onClick={() => pick({ session: key })}
            data-testid={`terminal-erns-session-${key}`}>{s.chip}</button>
        ))}
      </div>
      {shownDate ? <strong data-testid="terminal-erns-date">{label}</strong> : null}
      {shownDate && shownDate === today ? <span className={styles.lede}>Today</span> : null}
    </div>
  )
  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-erns" data-state={state}
      data-day={choice.day} data-session={choice.session} data-date={shownDate || ''}>
      {toolbar}
      {body}
    </div>
  )

  if (read.loading) return frame('loading', <PanelSkeleton label={`Loading the earnings reporters for ${label}`} testId="terminal-erns-loading" />)
  if (!read.body || view.state === 'failed') return frame('error', <FailedRead read={read} code={code} />)
  if (view.state === 'computing') {
    return frame('computing', (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-erns-computing">
        The server is putting this day together from the calendar and the numbers it already holds. That usually takes a
        few seconds. This panel asks again every 3 seconds and fills in on its own. That is not the same as nobody reporting.
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    return frame('unavailable', (
      <PanelState kind="error" testId="terminal-erns-unavailable" title={`The earnings calendar could not be read for ${label} just now.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as nobody reporting. Retry, or pick another day.
      </PanelState>
    ))
  }
  if (view.state === 'out-of-range') {
    return frame('out-of-range', (
      <PanelState kind="empty" role="status" testId="terminal-erns-out-of-range"
        title={`${label} is outside the three weeks this screen covers.`}
        action={<button type="button" className={styles.chip} onClick={() => pick({ day: 'next' })}>Next reports</button>}>
        {range ? `It covers ${dayLabel(range.from)} to ${dayLabel(range.to)}: last week, this week and next week. ` : ''}
        For any other week open the <PanelCommand cmd="CAL" label="Open the earnings calendar">earnings calendar (CAL)</PanelCommand>.
      </PanelState>
    ))
  }
  if (view.state === 'no-day') {
    const closed = view.weekend || (isIsoDate(shownDate) && !isSessionDay(shownDate))
    return frame('no-day', (
      <PanelState kind="empty" role="status" testId={closed ? 'terminal-erns-closed' : 'terminal-erns-no-day'}
        title={closed ? `The market is closed on ${label}.` : `The earnings calendar has no entry for ${label}.`}
        action={choice.day === 'next' ? null : <button type="button" className={styles.chip} onClick={() => pick({ day: 'next' })}>Next reports</button>}>
        {closed ? 'No company reports on a day the market is closed.' : 'Try again later, or pick another day.'}
      </PanelState>
    ))
  }
  if (!view.total) {
    return frame('empty', (
      <PanelState kind="empty" role="status" testId="terminal-erns-empty" title={`No company is on the earnings calendar for ${label}.`}
        action={choice.day === 'next' ? null : <button type="button" className={styles.chip} onClick={() => pick({ day: 'next' })}>Next reports</button>}>
        {choice.day === 'next'
          ? 'No company is on the calendar from today through the next ten days. That is what the calendar holds, not a failed read.'
          : 'That is what the calendar holds, not a failed read.'}
      </PanelState>
    ))
  }

  const tally = tallyRows(allRows)
  let start = 0
  return frame('ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-erns-stale-read">{failureText(read.error, WHAT)} Showing the last read.</p> : null}
      {allRows.length ? <p className={styles.lede} data-testid="terminal-erns-day">{daySentence(view, allRows, choice.session)}</p> : null}
      {view.pricedState === 'failed' ? (
        <p className={styles.note} role="status" data-testid="terminal-erns-priced-failed">
          The stored priced moves could not be read just now, so none is shown. That is not the same as none being priced.
        </p>
      ) : allRows.length && !tally.priced ? (
        <p className={styles.note} role="status" data-testid="terminal-erns-none-priced">
          No priced move is stored for {choice.session === 'all' ? 'this day' : 'these reports'}{view.dayKind === 'future' ? ' yet' : ''}. UCT
          stores it once, in its weekday capture at about {view.captureClock || '4:35 PM'} ET, for reports due that night or
          the next day; a report the capture did not reach, or one whose option chain gave no number that can be trusted,
          has none. For one stock&apos;s live figure, click its symbol with{' '}
          <PanelCommand cmd="EXMV" label="Open the expected move panel">expected move (EXMV)</PanelCommand> open beside this panel.
        </p>
      ) : null}
      {view.movesState === 'failed' && tally.reported ? (
        <p className={styles.note} role="status" data-testid="terminal-erns-moves-failed">
          Today&apos;s moves could not be read just now. That is not the same as no move.
        </p>
      ) : null}
      {view.movesState === 'not_held' && tally.reported ? (
        <p className={styles.note} role="status" data-testid="terminal-erns-moves-not-held">
          The server is not holding the moves for {label} right now, so none is shown; that is not the same as no move. The
          scoreboard works them out: open{' '}
          <PanelCommand cmd={`EMOV ${shownDate}`} label={`Open the earnings movers for ${label}`}>earnings movers (EMOV {shownDate})</PanelCommand>.
        </p>
      ) : null}
      {visible.length ? visible.map((g) => {
        const from = start
        start += Math.min(g.limit, g.rows.length)
        return (
          <Group key={g.session} group={g} start={from} limit={g.limit} label={label} today={today}
            onShowAll={() => setOpen((o) => ({ ...o, [g.session]: true }))} />
        )
      }) : (
        <PanelState kind="empty" compact role="status" testId="terminal-erns-none-match"
          title={`No company reports ${choice.session === 'bmo' ? 'before the open' : 'after the close'} on ${label}.`}
          action={<button type="button" className={styles.chip} onClick={() => pick({ session: 'all' })}>Show the whole day</button>}>
          {count(view.total)} {plural(view.total, 'company reports', 'companies report')} at another time that day.
        </PanelState>
      )}
      {view.unread ? (
        <p className={styles.muted} data-testid="terminal-erns-unread">
          {count(view.unread)} calendar {plural(view.unread, 'entry', 'entries')} came without a symbol and {plural(view.unread, 'is', 'are')} not listed.
        </p>
      ) : null}
      <p className={styles.muted} data-testid="terminal-erns-method">
        Companies on UCT&apos;s earnings calendar for {label}, biggest first by market cap. The priced move is the cost of the
        at-the-money call plus the put as a share of the stock price, through the option expiry: what the options market
        priced before the report, not a forecast. UCT stores it once, in its weekday capture at about{' '}
        {view.captureClock || '4:35 PM'} ET, from its own option chain read, so it does not shrink after the report; a dash
        means none is stored. Past moves are the stock&apos;s close-to-close move on the session that first traded each
        earlier result, from UCT daily bars, shown where the server already holds them: the last {count(PAST_MOVES_DRAWN)},
        newest first, and the average size of every one on file (hover a cell for the dates). The result is earnings per
        share and revenue against what was expected: beat when both met or beat it, missed when both fell short, mixed
        when they split.{' '}
        {view.dayKind === 'today'
          ? 'Today a report before the open, or with no confirmed time, shows the regular session\'s change so far; a report after the close is measured at the next close, so it has no move yet.'
          : view.dayKind === 'past'
            ? 'A report before the open, or with no confirmed time, is measured from the prior close to that day\'s close, and one after the close from that day\'s close to the next.'
            : 'Results and moves fill in as each company reports.'}
        {' '}A sign (+/-) and a word mark every move and result, so color is never the only signal. Click a symbol to load
        it into the linked panels; type a row number to do the same.
        {view.pricedWithheld ? ` ${count(view.pricedWithheld)} stored ${plural(view.pricedWithheld, 'figure was', 'figures were')} left out because ${plural(view.pricedWithheld, 'it', 'they')} did not come from UCT's own option chain read.` : ''}
        {clock(view.builtAt) ? ` Put together at ${clock(view.builtAt)}${view.refreshing ? ', and being updated now' : ''}; this panel reads it again every ${view.dayKind === 'today' ? 'minute' : '5 minutes'}.` : ''}
      </p>
    </>
  ))
}

export default function EarningsSeasonPanel({ day: dayProp = null, session: sessionProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || EARNINGS_SEASON_CODE
  // Read the clock once: "today" must not move under a session's feet.
  const [today] = useState(todayIso)
  // A new `ERNS TOMORROW` remounts the panel (the shell keys the body on code + args), so the
  // typed words only ever seed the state.
  const [choice, setChoice] = useState(() => earningsChoice({ day: dayProp, session: sessionProp }, today))
  const pick = (next) => {
    const now = earningsChoice({ ...choice, ...next }, today)
    setChoice(now)
    writeBack(earningsSeasonCommandArgs(now, today))
  }
  const asked = requestDate(choice, today)
  return <SeasonDay key={asked || 'next'} choice={choice} pick={pick} today={today} asked={asked} code={code} inPanel={inPanel} />
}
