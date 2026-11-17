// EMOV: the earnings scoreboard for one day: every company that reported, and how its stock moved.
//
// ⭐ NO NEW ROUTE. Two plain GETs the Calendar page already makes (useCalendarData.js):
// `/api/calendar/reactions?date=` (the move per reporter) and `/api/calendar?week=` (who reported,
// with name, session, EPS reported and expected). The pure half is earningsReactionsModel.js,
// re-exported below.
//
//   EMOV              the latest finished session (Eastern time)
//   EMOV 2026-11-12   that day (also 11/12); the buttons step a session at a time and write the day back
//
// Rows open biggest move first, by size, up or down. A symbol loads that name into the linked
// panels; typing its row number does the same.
//
// ⛔ A failed read is never drawn as empty data, and the two reads fail apart. The reactions route
// answers `{}` for "nobody reported" AND for "the price source did not answer", so an empty map is
// only "no moves yet" when the calendar says who reported; with reporters and no moves the panel
// says the moves are missing, not that nothing moved.
import { useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelSymbol, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelRerun,
  usePanelSymbolRows,
} from '../../../components/terminal'
import { formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { formatSessionDate } from '../../../lib/presentation/presentationDates'
import { ariaSortFor, nextSort, sortCaretFor, sortRows } from '../../../lib/presentation/dataGrid'
import { todayIso } from '../../calendar/earningsModalRow'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  EMOV_CODE, SESSION_TEXT, defaultReactionDate, isSessionDay, newestReactionDate, nextSession, prevSession,
  reactionDateOrDefault, reactionMap, reactionRows, reactionTally, reactionsCommand, reactionsUrl, reportersOf,
  reportersUrl, weekdayOf,
} from './earningsReactionsModel'
import styles from './marketPanels.module.css'

export {
  EMOV_CODE, SESSION_TEXT, defaultReactionDate, epsSurprisePct, isIsoDate, isSessionDay, newestReactionDate,
  nextSession, prevSession, reactionDateOrDefault, reactionMap, reactionRows, reactionTally, reactionsCommand,
  reactionsUrl, reportersOf, reportersUrl, shiftDay, weekdayOf,
} from './earningsReactionsModel'

const SOURCE = 'UCT earnings calendar, Massive prices'
/** Today's moves are live (the server caches them 30 s); the newest finished day still gains its
 *  after-the-close moves. An older day is settled history and is read once. */
const MOVES_POLL_MS = 60 * 1000
const WEEK_POLL_MS = 5 * 60 * 1000
const NA = 'n/a'

/** Pure: `Fri Nov 13, 2026` for a calendar day (never shifted by the viewer's time zone). */
export function dayLabel(iso) {
  const day = formatSessionDate(iso, { absent: '' })
  return day ? `${weekdayOf(iso)} ${day}, ${String(iso).slice(0, 4)}` : String(iso || '')
}

const signedPct = (v, decimals = 2) => formatPercent(v, { decimals, signed: true, absent: NA })

/** Pure: the one-line tally: how many reported, how many moved up and down, and the median move. */
export function tallyText(t) {
  if (!t || !t.reported) return ''
  const parts = [`${t.reported} reported.`]
  if (!t.moved) return `${parts[0]} No moves yet.`
  parts.push(`${t.up} up, ${t.down} down${t.flat ? `, ${t.flat} unchanged` : ''}.`)
  parts.push(`Median move ${signedPct(t.median)}.`)
  if (t.noMove) parts.push(`${t.noMove} ${t.noMove === 1 ? 'has' : 'have'} no move yet.`)
  return parts.join(' ')
}

/** Pure: `1.25 vs 1.10 expected`, or the reported figure alone when no estimate is on file. */
export function epsText(r) {
  if (r?.epsActual == null) return NA
  const actual = formatNumber(r.epsActual, { decimals: 2 })
  return r.epsEstimate == null ? `${actual}, no estimate` : `${actual} vs ${formatNumber(r.epsEstimate, { decimals: 2 })} expected`
}

const COLUMNS = [
  { key: 'sym', label: 'Symbol', title: 'Click a symbol to load it into the linked panels' },
  { key: 'name', label: 'Company', phoneHide: true },
  { key: 'session', label: 'Reported', phoneHide: true, title: 'Before the open or after the close' },
  { key: 'epsActual', label: 'EPS', phoneHide: true, title: 'Earnings per share: reported, and what was expected' },
  { key: 'surprisePct', label: 'EPS surprise', title: 'Reported EPS against expected, as a percent of expected' },
  { key: 'move', label: 'Move', title: 'The stock\'s move around the report' },
]
const TEXT_KEYS = new Set(['sym', 'name', 'session'])
const BY_SIZE = Object.freeze({ key: 'size', dir: 'desc' })
const valueOf = (key, r) => r[key]
const isNumeric = (key) => !TEXT_KEYS.has(key)
const firstDirFor = (key) => (TEXT_KEYS.has(key) ? 'asc' : 'desc')
const byOrder = (a, b) => a.order - b.order
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)

function Scoreboard({ date, today, live }) {
  const week = useMarketRead(reportersUrl(date), { refreshInterval: live ? WEEK_POLL_MS : 0 })
  const moves = useMarketRead(reactionsUrl(date), { refreshInterval: live ? MOVES_POLL_MS : 0 })
  const weekErr = Boolean(week.error) && !week.body
  const movesErr = Boolean(moves.error) && !moves.body
  const cal = useMemo(() => (weekErr ? { state: 'failed', reporters: [], scheduled: 0 } : reportersOf(week.body, date)),
    [weekErr, week.body, date])
  const base = useMemo(() => reactionRows(cal.reporters, movesErr ? {} : reactionMap(moves.body)),
    [cal.reporters, movesErr, moves.body])
  const [sort, setSort] = useState(BY_SIZE)
  const rows = useMemo(() => sortRows(base, sort, { valueOf, isNumeric, tiebreak: byOrder }), [base, sort])
  const tally = useMemo(() => reactionTally(base), [base])
  const label = dayLabel(date)
  usePanelFreshness(base.length
    ? panelAsOf(SOURCE, date === today ? (moves.receivedAt || week.receivedAt) : date)
    : null)
  usePanelSymbolRows(rows.map((r) => r.sym), `earnings reactions for ${date}`)

  const retryAll = () => { week.retry(); moves.retry() }
  const retry = <button type="button" className={styles.chip} onClick={retryAll}>Retry</button>

  if (week.loading || moves.loading) {
    return <PanelSkeleton label={`Loading earnings reactions for ${label}`} testId="terminal-ernr-loading" />
  }
  // The calendar read failed and nothing else names a reporter: an error, never "nobody reported".
  if (cal.state === 'failed' && base.length === 0) {
    const err = week.error || moves.error
    const locked = weekErr && !canRetry(week.error)
    return (
      <PanelState kind={locked ? failureKind(week.error) : 'error'} testId="terminal-ernr-error"
        title={locked ? failureText(err, 'Earnings reactions') : `The companies that reported on ${label} could not be read just now.`}
        action={locked ? null : retry}>
        {locked ? null : 'That is not the same as nobody reporting. Retry, or pick another day.'}
      </PanelState>
    )
  }
  if (cal.state === 'out-of-range') {
    return (
      <PanelState kind="empty" role="status" title={`${label} is outside the year of history the earnings calendar keeps.`}
        testId="terminal-ernr-out-of-range">
        Pick a day within a year of today.
      </PanelState>
    )
  }
  if (cal.state === 'no-day') {
    const closed = !isSessionDay(date)
    return (
      <PanelState kind="empty" role="status" testId={closed ? 'terminal-ernr-closed' : 'terminal-ernr-empty'}
        title={closed ? `The market was closed on ${label}.` : `The earnings calendar has no entry for ${label}.`}
        action={closed ? null : retry}>
        {closed ? 'Use the buttons above to step to a session.' : 'Retry, or pick another day.'}
      </PanelState>
    )
  }
  if (base.length === 0) {
    return (
      <PanelState kind="empty" role="status" testId="terminal-ernr-empty"
        title={cal.scheduled
          ? `None of the ${cal.scheduled} ${cal.scheduled === 1 ? 'company' : 'companies'} on the calendar for ${label} has reported yet.`
          : `No company was on the earnings calendar for ${label}.`}>
        {cal.scheduled ? 'Results appear here as each company reports.' : 'Use the buttons above to step to another session.'}
      </PanelState>
    )
  }

  const noMoves = !movesErr && tally.moved === 0
  return (
    <>
      <p className={styles.lede} data-testid="terminal-ernr-tally">{tallyText(tally)}</p>
      {cal.state === 'failed' ? (
        <p className={styles.note} role="status" data-testid="terminal-ernr-calendar-note">
          Company names, report times and the earnings surprise could not be read just now. The moves are still shown.
        </p>
      ) : null}
      {movesErr ? (
        <p className={styles.note} role="status" data-testid="terminal-ernr-moves-note">
          {failureText(moves.error, 'The move for each stock')} That is not the same as no move.{' '}
          {canRetry(moves.error)
            ? <button type="button" className={styles.linkBtn} onClick={() => moves.retry()}>Retry the moves</button> : null}
        </p>
      ) : null}
      {noMoves ? (
        <p className={styles.note} role="status" data-testid="terminal-ernr-moves-note">
          No move has come back for this day yet. A report after the close is measured at the next close, and the price
          source may not have answered. That is not the same as no move.{' '}
          <button type="button" className={styles.linkBtn} onClick={() => moves.retry()}>Retry the moves</button>
        </p>
      ) : null}
      {sort.key !== 'size' ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.chip} onClick={() => setSort(BY_SIZE)}
            data-testid="terminal-ernr-sort-reset">Biggest move first</button>
        </div>
      ) : null}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-ernr-table" aria-label={`Earnings reactions for ${label}, sortable`}>
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                // The opening order is by the SIZE of the move, which is no column: the Move header says so.
                const bySize = c.key === 'move' && sort.key === 'size'
                return (
                  <th scope="col" key={c.key} aria-sort={bySize ? 'other' : ariaSortFor(sort, c.key, 'none')}
                    title={bySize ? 'Sorted by the size of the move, up or down. Click to sort gains first.' : c.title}
                    className={c.phoneHide ? styles.phoneHide : undefined}>
                    <button type="button" className={styles.sortBtn} onClick={() => setSort((s) => nextSort(s, c.key, firstDirFor))}
                      data-testid={`terminal-ernr-sort-${c.key}`}>
                      {c.label}
                      {sortCaretFor(sort, c.key) ? <span aria-hidden="true">{` ${sortCaretFor(sort, c.key)}`}</span> : null}
                      {bySize ? <><span aria-hidden="true"> ▼</span><span className={styles.lede} data-testid="terminal-ernr-by-size"> by size</span></> : null}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.sym} data-testid={`terminal-ernr-row-${r.sym}`}>
                <td>
                  <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                  <PanelSymbol sym={r.sym} className={styles.sym} />
                </td>
                <td className={`${styles.phoneHide} ${styles.wrapCell}`}>{r.name || NA}</td>
                <td className={styles.phoneHide}>{SESSION_TEXT[r.session] || NA}</td>
                <td className={styles.phoneHide}>{epsText(r)}</td>
                <td className={tone(r.surprisePct)}>{signedPct(r.surprisePct, 1)}</td>
                <td className={tone(r.move)}>{signedPct(r.move)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted} data-testid="terminal-ernr-method">
        Every company on the earnings calendar that has reported results for {label}.{' '}
        {date === today
          ? 'For today the move is the live change so far today.'
          : 'A report before the open, or with no confirmed time, is measured from the prior close to that day\'s close. A report after the close is measured from that day\'s close to the next close.'}
        {' '}EPS surprise is reported earnings per share against what was expected. A sign (+/-) marks every change, so
        color is never the only signal. Click a symbol to load it into the linked panels; type a row number to do the same.
        {date === today && moves.receivedAt ? ` Moves read at ${formatTimeEt(moves.receivedAt, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </>
  )
}

export default function EarningsReactionsPanel({ date: dateProp = null }) {
  const inPanel = useInTerminalPanel()
  const rerun = usePanelRerun()
  // Read the clock once: "today" and the latest finished session must not move under a session's feet.
  const [today] = useState(() => todayIso())
  const [latest] = useState(() => defaultReactionDate())
  const newest = newestReactionDate(today)
  // A new `EMOV <date>` remounts the panel (the shell keys the body on code + args), so the typed
  // day only ever seeds the state.
  const [date, setDate] = useState(() => reactionDateOrDefault(dateProp, { today, fallback: latest }))
  const go = (next) => {
    if (!next || next === date) return
    setDate(next)
    rerun?.(reactionsCommand(next, { code: inPanel?.code || EMOV_CODE, fallback: latest }))
  }
  const next = nextSession(date)

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-ernr" data-date={date}>
      <div className={styles.toolbar} role="toolbar" aria-label="Earnings reactions day">
        <div className={styles.group} role="group" aria-label="Day">
          <button type="button" className={styles.chip} onClick={() => go(prevSession(date))}
            data-testid="terminal-ernr-prev">Previous session</button>
          {next <= newest ? (
            <button type="button" className={styles.chip} onClick={() => go(next)}
              data-testid="terminal-ernr-next">Next session</button>
          ) : null}
          {date !== latest ? (
            <button type="button" className={styles.chip} onClick={() => go(latest)}
              data-testid="terminal-ernr-latest">Latest finished session</button>
          ) : null}
        </div>
        <strong data-testid="terminal-ernr-date">{dayLabel(date)}</strong>
        {date === today ? <span className={styles.lede}>Today, moves are live</span> : null}
      </div>
      {/* Keyed by day: a new day is a new pair of reads, so one day's rows are never drawn under another's date. */}
      <Scoreboard key={date} date={date} today={today} live={date >= latest} />
    </div>
  )
}
