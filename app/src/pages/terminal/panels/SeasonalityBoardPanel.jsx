// SEASB: the seasonality board. How the four index funds and the eleven sector funds have done in
// each calendar month, close to close, from the daily bars we hold. `SEASB`.
//
//   SEASB          the median month (the default)      SEASB AVG     the average month
//
// One read: GET /api/research/seasonality-board (paid, behind Seasonality's own switch). The server
// holds one board for the day and answers from it. The pure half is seasonalityBoardModel.js,
// re-exported below.
//
// ⛔ WHAT THIS PANEL NEVER DOES
//   * It never draws a fund without numbers as a row of zeros, and never drops it: the fund is
//     named under the grid with why (its history is still being read, we hold no bars for it, or
//     its read failed).
//   * It never colours a month counted fewer than `min_years` times, and never names a best or a
//     weakest fund from one.
//   * It never forecasts. Green and red mark the sign of a past figure; one sentence says the
//     board is a record.
//
// WIDTH. The grid is one table whose months run from this month forward, so the three a narrow
// panel keeps (this month, the next, the one after) are simply its first three. The other nine
// carry the shared `phoneHide`, which folds on the panel's own width (the shell's one fit
// mechanism; this file never measures anything). The twelve columns were measured to need a 566px
// panel, so the table box names the 590 step: at 590px and under, three months. "All months as a list" turns the grid into one block per fund with its twelve months
// wrapping, which fits any width.
import { useEffect, useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import Select from '../../../components/ui/Select'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  SEASB_CODE, SEASB_POLL_MS, SEASB_SOURCE, SEASB_URL, SEASB_WHAT, SEAS_MEASURES, boardFacts, ledeLine, normSeasMeasure, pollMs,
  seasonalityBoardCommandArgs, seasonalityBoardRead, withoutNote,
} from './seasonalityBoardModel'
import styles from './marketPanels.module.css'
import own from './seasonalityBoard.module.css'

export {
  SEASB_CODE, SEASB_NARROW_MONTHS, SEASB_POLL_MS, SEASB_SETTLED_POLL_MS, SEASB_SOURCE, SEASB_URL, SEASB_WHAT, SEAS_MEASURES,
  SEAS_MEASURE_ARG_WORDS, boardFacts, cellFor, ledeLine, monthLong, monthShort, monthsFrom, narrowMonths, normSeasMeasure,
  parseSeasMeasure, pctText, pollMs, seasonalityBoardCommandArgs, seasonalityBoardRead, signOf, sinceYear, upCount, upWords,
  withoutNote, withoutWords,
} from './seasonalityBoardModel'

const MEASURE_OPTIONS = Object.entries(SEAS_MEASURES).map(([value, spec]) => ({ value, label: spec.label }))
const toneClass = (tone) => (tone === 'up' ? styles.up : tone === 'down' ? styles.down : undefined)
const MARK_WORD = { now: 'now', next: 'next' }

/** A fund's symbol as the door to its own seasonality (SEAS), opened beside this panel. */
function FundDoor({ row }) {
  return (
    <PanelCommand cmd={`${row.symbol} SEAS`} label={`Seasonality by month and weekday for ${row.symbol}`} className={own.fundSym}>
      {row.symbol}
    </PanelCommand>
  )
}

function Figure({ cell }) {
  return (
    <>
      <span className={`${own.figure} ${toneClass(cell.tone) || ''}`} data-testid="terminal-seasb-figure">{cell.text}</span>
      {cell.sub ? <span className={own.sub} data-testid="terminal-seasb-sub">{cell.sub}</span> : null}
    </>
  )
}

function Grid({ view }) {
  const spec = SEAS_MEASURES[view.measure]
  return (
    <div className={styles.tableBox} data-fold="590">
      <table className={`${styles.table} ${own.grid}`} data-testid="terminal-seasb-table"
        aria-label={`Seasonality board, ${spec.word} month return by fund, from ${view.months[0].long} forward`}>
        <thead>
          <tr>
            <th scope="col" className={own.fundHead}>Fund</th>
            {view.months.map((m) => (
              <th key={m.month} scope="col" data-testid="terminal-seasb-month" data-month={m.month} data-mark={m.mark || undefined}
                className={`${own.month} ${m.mark === 'now' ? own.now : ''} ${m.narrow ? '' : styles.phoneHide}`}
                title={m.mark === 'now' ? `${m.long}, this month` : m.mark === 'next' ? `${m.long}, next month` : m.long}>
                {m.label}
                {m.mark ? <span className={`${own.mark} ${m.mark === 'now' ? own.markNow : ''}`}>{MARK_WORD[m.mark]}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <tr key={row.symbol} data-testid="terminal-seasb-row" data-symbol={row.symbol} data-kind={row.kind}>
              <th scope="row" className={own.fund}>
                <FundDoor row={row} />
                <span className={own.fundMeta} data-testid="terminal-seasb-fund-meta">
                  {row.name ? `${row.name}, ` : ''}{row.since ? `since ${row.since}` : 'start of record unknown'}
                </span>
              </th>
              {row.cells.map((cell, i) => (
                <td key={cell.month} data-testid="terminal-seasb-cell" data-month={cell.month} data-tone={cell.tone} title={cell.title}
                  className={`${own.cell} ${cell.tone === 'thin' ? own.thin : ''} ${view.months[i].mark === 'now' ? own.now : ''} ${view.months[i].narrow ? '' : styles.phoneHide}`}>
                  <Figure cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Stacked({ view }) {
  return (
    <ul className={own.blocks} data-testid="terminal-seasb-list" aria-label="Every month of every fund, one fund per block">
      {view.rows.map((row) => (
        <li key={row.symbol} className={own.block} data-testid="terminal-seasb-block" data-symbol={row.symbol}>
          <p className={own.blockHead}>
            <FundDoor row={row} />
            <span className={own.fundMeta}>{row.name ? `${row.name}, ` : ''}{row.since ? `since ${row.since}` : 'start of record unknown'}</span>
          </p>
          <ul className={own.months}>
            {row.cells.map((cell, i) => (
              <li key={cell.month} title={cell.title} data-testid="terminal-seasb-item" data-month={cell.month} data-tone={cell.tone}
                className={`${own.monthItem} ${cell.tone === 'thin' ? own.thin : ''} ${view.months[i].mark === 'now' ? own.monthItemNow : ''}`}>
                <span className={own.monthName}>
                  {cell.label}{view.months[i].mark ? `, ${MARK_WORD[view.months[i].mark]}` : ''}
                </span>
                <Figure cell={cell} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function SeasonalityBoardBody({ code, measure: measureProp }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const [measure, setMeasure] = useState(() => normSeasMeasure(measureProp))
  const [stacked, setStacked] = useState(false)
  // The pace follows the answer in hand: 30 seconds while a fund is waiting, slow once none is,
  // and never for a read that cannot succeed by asking again (no paid plan, the switch off).
  const [every, setEvery] = useState(SEASB_POLL_MS)
  const read = useMarketRead(SEASB_URL, { refreshInterval: every })
  const want = read.error && !read.body ? (canRetry(read.error) ? SEASB_POLL_MS : 0) : pollMs(read.body)
  useEffect(() => { setEvery(want) }, [want])
  const view = useMemo(() => seasonalityBoardRead(read.body, measure), [read.body, measure])
  const facts = useMemo(() => boardFacts(read.body), [read.body])

  const dated = !read.loading && view.rows.length > 0
  usePanelFreshness(dated ? panelAsOf(SEASB_SOURCE, view.dataThrough, { dataClass: 'end_of_day' }) : null)

  // The measure writes itself into the command (`SEASB AVG`) where the registry takes it; outside
  // the shell it stays in this panel's own state.
  const pick = (next) => {
    const to = normSeasMeasure(next)
    if (to === measure) return
    setMeasure(to)
    writeBack(seasonalityBoardCommandArgs({ measure: to }))
  }

  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-seasb" data-state={state}
      data-measure={measure} data-layout={stacked ? 'list' : 'grid'}>{body}</div>
  )

  if (read.loading) return <PanelSkeleton label="Loading the seasonality board" testId="terminal-seasb-loading" />
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    if (err?.status === 404) {
      return (
        <PanelState kind="locked" role="status" testId="terminal-seasb-error" title="Seasonality isn't switched on yet.">
          That is a setting on our side, not an empty result.
        </PanelState>
      )
    }
    const locked = err ? !canRetry(err) : false
    return (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-seasb-error"
        title={err ? failureText(err, SEASB_WHAT) : `${SEASB_WHAT} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is a gap in what we could read, not a finding about any fund. Retry, or run ${code} again.`}
      </PanelState>
    )
  }

  const note = withoutNote(view)
  const stale = read.error ? (
    <p className={styles.note} role="status" data-testid="terminal-seasb-stale-read">{failureText(read.error, SEASB_WHAT)} Showing the last read.</p>
  ) : null
  const lede = <p className={styles.lede} data-testid="terminal-seasb-lede">{ledeLine(view)}</p>
  const without = note ? (
    <div className={styles.note} role="status" data-testid="terminal-seasb-without">
      {note.one ? note.one : (
        <ul className={own.withoutList}>
          {note.lines.map((l) => (
            <li key={l.symbol} data-testid="terminal-seasb-without-fund" data-symbol={l.symbol} data-status={l.status}
              data-reason={l.reason || undefined}>{l.text}</li>
          ))}
        </ul>
      )}
    </div>
  ) : null

  if (!view.rows.length) {
    const waiting = view.state === 'waiting'
    return wrap(waiting ? 'waiting' : 'none', (
      <>
        {stale}
        {lede}
        <PanelState kind="empty" role="status" testId={waiting ? 'terminal-seasb-waiting' : 'terminal-seasb-none'}
          title={waiting ? 'The full daily history of these funds is still being read.' : 'No fund has numbers to show.'}>
          {waiting
            ? 'This happens on the first read after a restart. The panel asks again every 30 seconds and fills in on its own; nothing is shown until a fund’s whole record is in.'
            : 'That is a gap in the daily bars we hold, not a finding about any fund.'}
        </PanelState>
        {without}
      </>
    ))
  }

  return wrap(view.state, (
    <>
      {stale}
      {lede}
      <div className={styles.toolbar} role="toolbar" aria-label="Seasonality board controls">
        <label className={own.filter}>
          Show
          <Select value={measure} onChange={(e) => pick(e.target.value)} options={MEASURE_OPTIONS} data-testid="terminal-seasb-measure" />
        </label>
        <button type="button" className={styles.chip} aria-pressed={stacked} onClick={() => setStacked((v) => !v)}
          data-testid="terminal-seasb-all-months"
          title="One block per fund with all twelve months. A narrow panel shows three months in the grid.">
          All months as a list
        </button>
      </div>
      {facts.best || facts.why ? (
        <ul className={own.facts} data-testid="terminal-seasb-facts">
          {facts.best ? <li data-testid="terminal-seasb-best">{facts.best}</li> : null}
          {facts.worst ? <li data-testid="terminal-seasb-worst">{facts.worst}</li> : null}
          {facts.leftOut ? <li className={styles.muted} data-testid="terminal-seasb-left-out">{facts.leftOut}</li> : null}
          {facts.why ? <li className={styles.muted} data-testid="terminal-seasb-no-facts">{facts.why}</li> : null}
        </ul>
      ) : null}
      {stacked ? <Stacked view={view} /> : <Grid view={view} />}
      {without}
      <p className={styles.muted} data-testid="terminal-seasb-method">
        Each figure is the {SEAS_MEASURES[measure].word} of that calendar month&apos;s close-to-close return over the years
        counted, with how many of those years the month rose under it. A fund&apos;s record starts where its own daily
        bars start, so a fund listed later has fewer years behind each month. A dimmed figure has fewer
        than {view.minYears} years behind it: too few to lean on, and never coloured. A partial first or last month is
        not counted. Green and red mark the sign of a figure only. A record of what happened, not a forecast.
        Source: the UCT daily bar store. Click a fund to open its own seasonality (SEAS) beside this panel.
      </p>
    </>
  ))
}

export default function SeasonalityBoardPanel({ measure }) {
  const code = useInTerminalPanel()?.code || SEASB_CODE
  // Keyed by the command's measure: `SEASB AVG` typed over `SEASB` opens under the right choice.
  return <SeasonalityBoardBody key={normSeasMeasure(measure)} code={code} measure={measure} />
}
