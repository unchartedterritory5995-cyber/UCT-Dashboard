// PCHG: every US common stock ranked by its percent change between two dates (data wave 4), and
// the sectors, industries and UCT themes ranked over the same two dates (data wave 5).
//
// ⭐ NO NEW ROUTE. `GET /api/scans/period-change` and its sibling `/api/scans/period-change-groups`
// (both paid), until now only the Custom-Period Sort tool on /charts. The pure half (the ranges,
// the date checks, the row shaping) is periodChangeModel.js, re-exported below.
//
//   PCHG                 year to date            PCHG MTD | QTD | 1M | 3M | 6M | 1Y
//   PCHG 2026-01-02      since that day          PCHG 2026-01-02 2026-06-30   between two days
//   PCHG YTD LOSERS      the other end of the list
//   PCHG QTD SECTORS     sectors instead of stocks (also INDUSTRIES, THEMES)
//
// A chip or the two date boxes pick what is ranked, the range and the end of the list, and write it
// back into the panel's command. A symbol loads that name into the linked panels; typing its row
// number does the same. A sector, industry or theme opens the list of its own stocks.
//
// ⛔ THE DATES ARE CHECKED BEFORE ANYTHING IS ASKED (periodRequest): an impossible or future date
// is said so in the panel and never sent.
// ⛔ THE SERVER SNAPS EACH DATE BACK TO A TRADING DAY, AND THE PANEL SAYS WHICH DAYS IT USED. Two
// dates that land on one trading day are said so, never drawn as a market of 0% moves.
// ⛔ A FAILED READ IS NEVER AN EMPTY LIST, and "still working" is its own state: the panel asks
// again by itself while the server says computing.
// ⛔ A GROUP'S STOCKS ARE A SECOND READ THAT FAILS APART. Their own changes come from the stock
// ranking of the same two dates, read only once a group is opened; when that read fails the stocks
// are still listed, with no change beside them and a sentence saying why.
//
// The reads go through marketRead.js (the terminal's one bare-SWR reader), and SWR skips ticks
// while the app is hidden.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Input from '../../../components/ui/Input'
import FieldError from '../../../components/ui/FieldError'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { formatCurrency, formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { todayIso } from '../../calendar/earningsModalRow'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import { groupDrillCommand } from './groupDrillModel'
import {
  DEFAULT_PERIOD_RANGE, PERIOD_CHANGE_CODE, PERIOD_FLOOR, PERIOD_RANGES, PERIOD_SIDES, PERIOD_UNITS, breadthOf, groupMemberRows,
  normPeriodSide, normPeriodUnit, parsePeriodDate, parsePeriodRange, periodChangeCommandArgs, periodGroupsRead, periodGroupsUrl,
  periodRead, periodRequest, sideRows, snapNote,
} from './periodChangeModel'
import styles from './marketPanels.module.css'
import form from './panelForm.module.css'

export {
  DEFAULT_PERIOD_RANGE, DEFAULT_PERIOD_UNIT, PERIOD_CHANGE_CODE, PERIOD_FLOOR, PERIOD_RANGES, PERIOD_RANGE_ARG_WORDS, PERIOD_SIDES,
  PERIOD_SIDE_ARG_WORDS, PERIOD_UNITS, PERIOD_UNIT_ARG_WORDS, breadthOf, dayOfYmd, groupMemberRows, normPeriodSide, normPeriodUnit,
  parsePeriodDate, parsePeriodRange, parsePeriodSide, parsePeriodUnit, periodChangeCommandArgs, periodChangeUrl, periodGroupsRead,
  periodGroupsUrl, periodRead, periodRequest, rangeDates, shiftDay, sideRows, snapNote,
} from './periodChangeModel'

/** Rows drawn at first, and added by each "Show more"; the rest are counted, never dropped. */
export const PAGE_ROWS = 50
/** The most rows this panel draws. The whole market is about 5,000 stocks. */
export const MAX_ROWS = 250
/** While the server says it is still working, it is asked again at this pace. */
const COMPUTING_POLL_MS = 5 * 1000
const SOURCE = 'UCT whole-market daily closes'
const WHAT = 'The ranking'
const NA = 'n/a'

const count = (n) => formatNumber(n, { decimals: 0 })
const money = (v) => formatCurrency(v, { decimals: 2, grouping: true, absent: NA })
const signedMoney = (v) => (v == null ? NA : `${v > 0 ? '+' : v < 0 ? '-' : ''}${formatCurrency(Math.abs(v), { decimals: 2, grouping: true })}`)
const signedPct = (v) => formatPercent(v, { decimals: 1, signed: true, absent: NA })
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')
const plural = (n, one, many) => (n === 1 ? one : many)

/**
 * One period read, as the model reads it. The pace follows the server's own word that it is still
 * working: `computing` is adjusted during render from the last answer (no effect, so no extra pass
 * through an old value). A null `url` asks for nothing.
 */
function usePeriodRead(url, toView) {
  const [computing, setComputing] = useState(false)
  const read = useMarketRead(url, { refreshInterval: computing ? COMPUTING_POLL_MS : 0 })
  const view = useMemo(() => toView(read.body), [read.body, toView])
  if ((view.state === 'computing') !== computing) setComputing(view.state === 'computing')
  return { read, view }
}

/** Every state that is not a drawable list, as the block to show, or null when the list can be drawn. */
function blockedState({ read, view, req, code, today, unit }) {
  const u = PERIOD_UNITS[unit]
  if (read.loading) {
    return <PanelSkeleton label={`Ranking the market from ${req.start} to ${req.end}`} testId="terminal-pchg-loading" />
  }
  if ((read.error && !read.body) || view.state === 'failed') {
    const err = read.body ? null : read.error
    const locked = err ? !canRetry(err) : false
    return (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-pchg-error"
        title={err ? failureText(err, WHAT) : `${WHAT} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : err?.timedOut
          ? `The first ranking of a new range can take longer than that. The server keeps working on it, so Retry usually has it. That is not the same as an empty list.`
          : `That is not the same as an empty list. Retry, or run ${code} again.`}
      </PanelState>
    )
  }
  if (view.state === 'computing') {
    return (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-pchg-computing">
        The server is reading the whole market for {req.start} and {req.end}. A range it has not ranked before can take up
        to a minute, and a start date before 2003 longer. This panel asks again every 5 seconds and fills in on its own.
        That is not the same as no {u.many}.
      </PanelState>
    )
  }
  if (view.state === 'unavailable') {
    return (
      <PanelState kind="empty" role="status" testId="terminal-pchg-unavailable"
        title={`No market-wide prices are on hand for ${req.start} to ${req.end}.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Check again</button>}>
        Whole-market price history starts around 2003, and older ranges depend on what the UCT bar store holds. Pick a
        later start date.
      </PanelState>
    )
  }
  if (view.state === 'refused') {
    return (
      <PanelState kind="input" role="status" testId="terminal-pchg-refused" title="The server did not take those two dates.">
        The start date has to be before the end date. Pick the dates again above.
      </PanelState>
    )
  }
  const startDay = view.startDay || req.start
  const endDay = view.endDay || req.end
  if (view.sameDay) {
    return (
      <PanelState kind="input" role="status" testId="terminal-pchg-same-day"
        title={`Both dates land on one trading day, ${endDay}, so there is no change to rank.`}>
        The server uses the last trading day with a published close on or before each date.
        {req.endIsToday ? ` Today's close (${today}) is not published yet.` : ''} Pick an earlier start date above.
      </PanelState>
    )
  }
  if (!view.rows.length) {
    return (
      <PanelState kind="empty" testId="terminal-pchg-empty" title={`No ${u.one} could be ranked from ${startDay} to ${endDay}.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Check again</button>}>
        That is what the server worked out, not a failed read.
      </PanelState>
    )
  }
  return null
}

/** What the server did with the two dates, and a failed refresh over a list that is still shown. */
function ReadNotes({ read, req, view }) {
  const snap = snapNote({ askedStart: req.start, askedEnd: req.end, startDay: view.startDay, endDay: view.endDay })
  return (
    <>
      {read.error && <p className={styles.note} role="status">{failureText(read.error, WHAT)} Showing the last read.</p>}
      {snap.startMoved || snap.endMoved ? (
        <p className={styles.note} role="status" data-testid="terminal-pchg-snapped">
          {snap.startMoved ? `${req.start} has no published close, so the start is the last trading day before it, ${view.startDay}. ` : ''}
          {snap.endMoved
            ? req.endIsToday
              ? `Today's close (${req.end}) is not published yet, so the list ends at the close of ${view.endDay}.`
              : `${req.end} has no published close, so the end is the last trading day before it, ${view.endDay}.`
            : ''}
        </p>
      ) : null}
    </>
  )
}

function CoverageNote({ cov }) {
  if (!cov) return null
  return (
    <p className={styles.muted} data-testid="terminal-pchg-coverage">
      The server checked {count(cov.evaluated)} common stocks and ranked {count(cov.ranked)}. {count(cov.noPrice)} had
      no close on one of the two days. {count(cov.leftOut)} were left out on purpose: the ticker now belongs to a
      different company, the listing began after the start day, the start price did not hold up against the bar
      history, or the stock no longer trades.
    </p>
  )
}

/** "Show 50 more", and the sentence that counts what is drawn against what there is. */
function CutFooter({ shown, total, losers, many, onMore, testId = 'terminal-pchg' }) {
  if (shown >= total) return null
  const canShowMore = shown < MAX_ROWS
  return (
    <div className={styles.toolbar}>
      {canShowMore ? (
        <button type="button" className={styles.chip} data-testid={`${testId}-more`} onClick={onMore}>
          Show {count(Math.min(PAGE_ROWS, MAX_ROWS - shown, total - shown))} more
        </button>
      ) : null}
      <span className={styles.muted} data-testid={`${testId}-cut`}>
        Showing the {count(shown)} biggest {losers ? 'losers' : 'gainers'} of {count(total)} {many}.
        {canShowMore ? '' : ` This panel draws ${count(MAX_ROWS)} at most; the other end of the list is under ${losers ? 'Biggest gainers' : 'Biggest losers'}.`}
      </span>
    </div>
  )
}

/** Stocks, one per row: the whole-market list, or the stocks of one group. */
function StockTable({ rows, side, label, testId = 'terminal-pchg-table' }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid={testId} data-side={side} aria-label={label}>
        <thead>
          <tr>
            <th scope="col" title="Click a symbol to load it into the linked panels">Symbol</th>
            <th scope="col" title="Percent change from the start close to the end close">Change</th>
            {/* Two closes and the dollar change share one column, so the table fits a half-width panel. */}
            <th scope="col" className={styles.wrapCell} title="The split-adjusted close on the start day, then on the end day, and the change in dollars">Close then and now</th>
            <th scope="col" className={`${styles.phoneHide} ${styles.wrapCell}`}>Industry</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} data-testid={`terminal-pchg-row-${r.sym}`}>
              <td>
                <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                <PanelSymbol sym={r.sym} className={styles.sym} />
              </td>
              <td className={tone(r.pct)}>{signedPct(r.pct)}</td>
              <td className={styles.wrapCell}>
                {r.pct === null ? NA : (
                  <>
                    {money(r.startClose)} to {money(r.endClose)}
                    <span className={styles.muted}>{` (${signedMoney(r.dollars)})`}</span>
                  </>
                )}
              </td>
              <td className={`${styles.phoneHide} ${styles.wrapCell}`}>{r.industry || r.sector || 'Not given'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Results({ req, side, code, today }) {
  const { read, view } = usePeriodRead(req.url, periodRead)
  const [limit, setLimit] = useState(PAGE_ROWS)
  const shown = useMemo(() => sideRows(view.rows, side, limit), [view.rows, side, limit])
  const blocked = blockedState({ read, view, req, code, today, unit: 'stocks' })
  usePanelFreshness(!blocked ? panelAsOf(SOURCE, view.endDay) : null)
  usePanelSymbolRows(!blocked ? shown.rows.map((r) => r.sym) : [],
    `the biggest ${side === 'losers' ? 'losers' : 'gainers'} from ${view.startDay || req.start} to ${view.endDay || req.end}`,
    { total: view.rows.length })
  if (blocked) return blocked

  const startDay = view.startDay || req.start
  const endDay = view.endDay || req.end
  const breadth = breadthOf(view.rows)
  const losers = side === 'losers'
  const total = view.rows.length
  return (
    <>
      <ReadNotes read={read} req={req} view={view} />
      <div className={styles.head}>
        <span className={styles.lede} data-testid="terminal-pchg-totals">
          {count(total)} {plural(total, 'stock', 'stocks')} ranked from the close of {startDay} to the close of {endDay}:{' '}
          {count(breadth.up)} rose, {count(breadth.down)} fell{breadth.flat ? `, ${count(breadth.flat)} did not move` : ''}.
        </span>
      </div>
      {view.partial ? (
        <p className={styles.note} role="status" data-testid="terminal-pchg-partial">
          This range is older than the whole-market price history, so it was ranked from the UCT bar store. Only stocks
          still in that store are ranked: companies that have since stopped trading are missing, which makes the past
          look better than it was.
        </p>
      ) : null}
      <StockTable rows={shown.rows} side={side}
        label={`${losers ? 'Biggest losers' : 'Biggest gainers'} from ${startDay} to ${endDay}, ${shown.rows.length} of ${total} ${plural(total, 'stock', 'stocks')}`} />
      <CutFooter shown={shown.rows.length} total={total} losers={losers} many="stocks"
        onMore={() => setLimit((n) => Math.min(MAX_ROWS, n + PAGE_ROWS))} />
      <CoverageNote cov={view.coverage} />
      <p className={styles.muted} data-testid="terminal-pchg-method">
        Every US common stock (no funds) with a close on both days, ranked by the percent change between the two closes.
        Closes are adjusted for splits.
        {view.partial ? '' : ' A stock that has stopped trading since is not listed, so an old range leaves out the companies that failed.'}
        {' '}A word and a sign (+/-) mark every direction, so color is never the only signal. A list says which stocks
        to study; it is not a forecast or a recommendation. Click a symbol to load it into the linked panels; type a
        row number to do the same.
        {view.asOf && clock(view.asOf) ? ` Worked out at ${clock(view.asOf)}.` : ''}
      </p>
    </>
  )
}

/** The stocks of one sector, industry or theme, each with its own change between the same two closes.
 *  `read` and `view` are the stock ranking's read (GroupResults owns it, with the panel's rows). */
function GroupStocks({ group, unit, side, startDay, endDay, read, view, members, shown, onMore, onBack, backRef, ownPanel = null }) {
  const u = PERIOD_UNITS[unit]
  const losers = side === 'losers'
  const stocksFailed = !read.loading && view.state !== 'ok' && view.state !== 'computing'
  return (
    <>
      <div className={styles.toolbar}>
        <button ref={backRef} type="button" className={styles.chip} onClick={onBack} data-testid="terminal-pchg-back">Back to all {u.many}</button>
        {ownPanel ? <span className={styles.muted}><PanelCommand cmd={ownPanel} label={`Open ${group.name} as its own panel, with RS and flow`}>Open as its own panel</PanelCommand></span> : null}
      </div>
      <div className={styles.head}>
        <span className={styles.lede} data-testid="terminal-pchg-group-head">
          {group.name}: {signedPct(group.pct)} from the close of {startDay} to the close of {endDay},{' '}
          {count(members.total)} {plural(members.total, 'stock', 'stocks')}.
        </span>
      </div>
      {read.loading ? <PanelSkeleton label={`Loading each stock's change in ${group.name}`} testId="terminal-pchg-members-loading" /> : null}
      {!read.loading && view.state === 'computing' ? (
        <p className={styles.note} role="status" data-testid="terminal-pchg-members-computing">
          The server is still working out each stock&apos;s own change. This panel asks again every 5 seconds and fills
          them in on its own; until then the stocks are listed without one.
        </p>
      ) : null}
      {stocksFailed ? (
        <p className={styles.note} role="status" data-testid="terminal-pchg-members-failed">
          {read.error && !read.body ? failureText(read.error, 'Each stock\'s own change') : 'Each stock\'s own change could not be read just now.'}
          {' '}The stocks are listed without it; that is not a change of 0%.{' '}
          {!read.error || canRetry(read.error) ? <button type="button" className={styles.linkBtn} onClick={read.retry}>Retry</button> : null}
        </p>
      ) : null}
      {read.loading ? null : members.total ? (
        <StockTable rows={shown} side={side} testId="terminal-pchg-members"
          label={`The stocks in ${group.name} from ${startDay} to ${endDay}, ${losers ? 'biggest losers' : 'biggest gainers'} first, ${shown.length} of ${members.total}`} />
      ) : (
        <PanelState kind="empty" compact role="status" testId="terminal-pchg-members-empty" title={`The server sent no stock list for ${group.name}.`}>
          Its change above was still worked out from {group.count === null ? 'its stocks' : `${count(group.count)} ${plural(group.count, 'stock', 'stocks')}`}.
        </PanelState>
      )}
      {read.loading ? null : (
        <CutFooter shown={shown.length} total={members.total} losers={losers} many={`stocks in ${group.name}`} testId="terminal-pchg-members"
          onMore={onMore} />
      )}
      <p className={styles.muted} data-testid="terminal-pchg-members-method">
        Each stock&apos;s own percent change between the same two closes, adjusted for splits. The {u.one}&apos;s figure
        above caps its best stocks before averaging, so it is not the plain average of this list. A word and a sign (+/-)
        mark every direction, so color is never the only signal. Click a symbol to load it into the linked panels; type a
        row number to do the same.
      </p>
    </>
  )
}

function GroupResults({ req, unit, side, code, today }) {
  const u = PERIOD_UNITS[unit]
  const toView = useCallback((body) => periodGroupsRead(body, unit), [unit])
  const { read, view } = usePeriodRead(periodGroupsUrl(req.start, req.end, unit), toView)
  const [limit, setLimit] = useState(PAGE_ROWS)
  const [openName, setOpenName] = useState(null)
  const shown = useMemo(() => sideRows(view.rows, side, limit), [view.rows, side, limit])
  const blocked = blockedState({ read, view, req, code, today, unit })
  const openGroup = !blocked && openName ? view.rows.find((r) => r.name === openName) || null : null
  usePanelFreshness(!blocked ? panelAsOf(SOURCE, view.endDay) : null)
  // An open group's stocks take their own changes from the stock ranking of the same two dates. It
  // is read only once a group is opened (a null URL asks for nothing), and it fails apart.
  const stocks = usePeriodRead(openGroup ? req.url : null, periodRead)
  const [memberLimit, setMemberLimit] = useState(PAGE_ROWS)
  const members = useMemo(() => groupMemberRows(openGroup, stocks.view.state === 'ok' ? stocks.view.rows : [], side), [openGroup, stocks.view, side])
  const shownMembers = useMemo(() => members.rows.slice(0, memberLimit), [members, memberLimit])
  // One publisher for the panel's numbered rows: the stocks of the open group, and nothing while
  // the list on screen is a list of groups (a row number must never load a stock that is not shown).
  usePanelSymbolRows(openGroup && !stocks.read.loading ? shownMembers.map((r) => r.sym) : [],
    `the stocks in ${openGroup?.name || `one ${u.one}`}`, { total: members.total })

  // Opening a group swaps the table for its stocks, so the keyboard goes with it: to "Back" on the
  // way in, and back to the group's own row on the way out.
  const backRef = useRef(null)
  const tableRef = useRef(null)
  const returnTo = useRef(null)
  const hasOpen = !!openGroup
  useEffect(() => {
    if (hasOpen) { backRef.current?.focus(); return }
    const name = returnTo.current
    returnTo.current = null
    if (name) [...(tableRef.current?.querySelectorAll('button[data-group]') || [])].find((b) => b.dataset.group === name)?.focus()
  }, [hasOpen])

  if (blocked) return blocked
  const startDay = view.startDay || req.start
  const endDay = view.endDay || req.end
  if (openGroup) {
    return (
      <>
        <ReadNotes read={read} req={req} view={view} />
        <GroupStocks group={openGroup} unit={unit} side={side} startDay={startDay} endDay={endDay} read={stocks.read} view={stocks.view}
          members={members} shown={shownMembers} onMore={() => setMemberLimit((n) => Math.min(MAX_ROWS, n + PAGE_ROWS))}
          ownPanel={req.range ? groupDrillCommand({ kind: unit, name: openGroup.name, range: req.range }) : null}
          backRef={backRef} onBack={() => { returnTo.current = openGroup.name; setOpenName(null) }} />
      </>
    )
  }

  const breadth = breadthOf(view.rows)
  const losers = side === 'losers'
  const total = view.rows.length
  return (
    <>
      <ReadNotes read={read} req={req} view={view} />
      <div className={styles.head}>
        <span className={styles.lede} data-testid="terminal-pchg-totals">
          {count(total)} {plural(total, u.one, u.many)} ranked from the close of {startDay} to the close of {endDay}:{' '}
          {count(breadth.up)} rose, {count(breadth.down)} fell{breadth.flat ? `, ${count(breadth.flat)} did not move` : ''}.
        </span>
      </div>
      {view.mayBePartial ? (
        <p className={styles.note} role="status" data-testid="terminal-pchg-partial">
          This range starts before the whole-market price history (about 2003). A range that old is ranked from the UCT
          bar store, which holds only stocks that still trade, so companies that have since stopped trading are missing
          from every {u.one} and the past looks better than it was. The server does not say when it did this for {u.many}.
        </p>
      ) : null}
      <div className={styles.tableBox} ref={tableRef}>
        <table className={styles.table} data-testid="terminal-pchg-table" data-side={side} data-unit={unit}
          aria-label={`${losers ? 'Biggest losers' : 'Biggest gainers'} from ${startDay} to ${endDay}, ${shown.rows.length} of ${total} ${plural(total, u.one, u.many)}`}>
          <thead>
            <tr>
              <th scope="col" className={styles.wrapCell} title={`Click a ${u.one} to list its stocks`}>{u.head}</th>
              <th scope="col" title={`The ${u.one}'s change: the average of its stocks' changes, with its best stocks capped`}>Change</th>
              <th scope="col" title={`How many of the ${u.one}'s stocks were ranked`}>Stocks</th>
            </tr>
          </thead>
          <tbody>
            {shown.rows.map((r, i) => (
              <tr key={r.key} data-testid="terminal-pchg-group-row" data-name={r.name}>
                <td className={styles.wrapCell}>
                  <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                  <button type="button" className={styles.linkBtn} data-group={r.name} aria-label={`${r.name}: list its stocks`}
                    onClick={() => { setMemberLimit(PAGE_ROWS); setOpenName(r.name) }}>{r.name}</button>
                </td>
                <td className={tone(r.pct)}>{signedPct(r.pct)}</td>
                <td>{r.count === null ? NA : count(r.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CutFooter shown={shown.rows.length} total={total} losers={losers} many={u.many}
        onMore={() => setLimit((n) => Math.min(MAX_ROWS, n + PAGE_ROWS))} />
      <CoverageNote cov={view.coverage} />
      <p className={styles.muted} data-testid="terminal-pchg-method">
        Each {u.one} is ranked from its stocks in the whole-market list: every US common stock (no funds) with a close on
        both days.{' '}
        {unit === 'theme'
          ? 'These are the UCT themes; a theme with none of its stocks in that list is not shown.'
          : `A stock's ${u.one} comes from the company details on file; a stock with none on file is in no ${u.one}.`}
        {' '}A {u.one}&apos;s change is the average of its stocks&apos; changes, each stock counting the same, after its
        best tenth of stocks (at least one) is capped at the next best stock&apos;s change, so one runaway stock cannot
        carry it. Falls are not capped. With only two stocks, the lower change is used when the higher is above 100% and
        more than three times the lower. Closes are adjusted for splits. A stock that has stopped trading since is not
        counted. A word and a sign (+/-) mark every direction, so color is never the only signal. A list says which{' '}
        {u.many} to study; it is not a forecast or a recommendation. Click a {u.one} to list its stocks.
        {view.asOf && clock(view.asOf) ? ` Worked out at ${clock(view.asOf)}.` : ''}
      </p>
    </>
  )
}

export default function PeriodChangePanel({
  range: rangeProp = null, start: startProp = null, end: endProp = null, side: sideProp = null, unit: unitProp = null,
}) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const ids = useId()
  const code = inPanel?.code || PERIOD_CHANGE_CODE
  const [today] = useState(todayIso)
  // A new `PCHG QTD` remounts the panel (the shell keys the body on code + args), so the typed
  // words only ever seed the state.
  const [choice, setChoice] = useState(() => (
    startProp || endProp
      ? { range: null, start: startProp, end: endProp }
      : { range: parsePeriodRange(rangeProp) || DEFAULT_PERIOD_RANGE, start: null, end: null }
  ))
  const [side, setSide] = useState(() => normPeriodSide(sideProp))
  const [unit, setUnit] = useState(() => normPeriodUnit(unitProp))
  const req = useMemo(() => periodRequest({ ...choice, today }), [choice, today])
  const [fromDraft, setFromDraft] = useState(() => parsePeriodDate(startProp) || '')
  const [toDraft, setToDraft] = useState(() => parsePeriodDate(endProp) || '')
  const [formError, setFormError] = useState(null)

  // A pick writes itself into the command (`PCHG QTD SECTORS LOSERS`) where the registry takes the
  // words, so a reload keeps it; otherwise it is plain component state (commandWriteBack.js).
  const apply = (nextChoice, nextSide, nextUnit) => {
    setChoice(nextChoice)
    setSide(nextSide)
    setUnit(nextUnit)
    writeBack(periodChangeCommandArgs({ ...nextChoice, side: nextSide, unit: nextUnit }))
  }
  const pickRange = (key) => { setFormError(null); setFromDraft(''); setToDraft(''); apply({ range: key, start: null, end: null }, side, unit) }
  const submit = (e) => {
    e.preventDefault()
    if (!fromDraft && !toDraft) { setFormError('Pick a start date. The end date is today when it is left empty.'); return }
    const next = periodRequest({ start: fromDraft, end: toDraft, today })
    if (!next.ok) { setFormError(next.message); return }
    setFormError(null)
    apply({ range: null, start: next.start, end: toDraft ? next.end : null }, side, unit)
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-pchg" data-range={req.ok ? req.range || 'dates' : 'invalid'}
      data-side={side} data-unit={unit}>
      <div className={styles.toolbar} role="toolbar" aria-label="Performance between two dates controls">
        <div className={styles.group} role="group" aria-label="What to rank">
          {Object.entries(PERIOD_UNITS).map(([key, u]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === unit}
              onClick={() => apply(choice, side, key)} data-testid={`terminal-pchg-unit-${key}`}>{u.chip}</button>
          ))}
        </div>
        <div className={styles.group} role="group" aria-label="Range">
          {Object.entries(PERIOD_RANGES).map(([key, r]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={req.ok && req.range === key}
              onClick={() => pickRange(key)} data-testid={`terminal-pchg-range-${key}`}>{r.chip}</button>
          ))}
        </div>
        <div className={styles.group} role="group" aria-label="End of the list">
          {Object.entries(PERIOD_SIDES).map(([key, s]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === side}
              onClick={() => apply(choice, key, unit)} data-testid={`terminal-pchg-side-${key}`}>{s.chip}</button>
          ))}
        </div>
      </div>
      <form className={form.form} onSubmit={submit} noValidate aria-label="Rank between two dates" data-testid="terminal-pchg-form">
        <label className={form.field} htmlFor={`${ids}-from`}>From</label>
        <Input id={`${ids}-from`} type="date" className={form.input} value={fromDraft} min={PERIOD_FLOOR} max={today}
          error={formError} onChange={(e) => setFromDraft(e.target.value)} data-testid="terminal-pchg-from" />
        <label className={form.field} htmlFor={`${ids}-to`}>To (empty means today)</label>
        <Input id={`${ids}-to`} type="date" className={form.input} value={toDraft} min={PERIOD_FLOOR} max={today}
          onChange={(e) => setToDraft(e.target.value)} data-testid="terminal-pchg-to" />
        <button type="submit" className={styles.chip} data-testid="terminal-pchg-rank">Rank these dates</button>
        <FieldError forId={`${ids}-from`} className={form.error} data-testid="terminal-pchg-form-error">{formError}</FieldError>
      </form>
      {!req.ok ? (
        <PanelState kind="input" role="status" testId="terminal-pchg-bad-dates" title={req.message}>
          Pick a range above, or type one, e.g. <kbd>{code} YTD</kbd> or <kbd>{code} 2026-01-02 2026-06-30</kbd>
        </PanelState>
      ) : unit === 'stocks' ? (
        // Keyed by the request: a new range is a new read, so one range's rows are never drawn under another's dates.
        <Results key={req.url} req={req} side={side} code={code} today={today} />
      ) : (
        <GroupResults key={`${unit}:${req.url}`} req={req} unit={unit} side={side} code={code} today={today} />
      )}
    </div>
  )
}
