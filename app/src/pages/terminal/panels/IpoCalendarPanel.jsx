// IPO: the IPO calendar, day by day. `IPO`.
//
// `GET /api/calendar/ipos?from=&to=` (api/routers/calendar.py; the Calendar page's own IPO route,
// no new route and no switch). One read covers last week's Monday to next week's Friday, so a deal
// priced last week and one expected next week are both on it. The pure half is ipoCalendarModel.js,
// re-exported below.
//
// What it adds: the Calendar page shows these deals as chips on one week. This is the list, with
// each deal's price, shares, value and status, and the days ahead apart from the days behind.
// The stocks listed in the last year are LEAD's own lens (`LEAD IPO`); this panel links to it
// and does not draw that list a second time.
//
// A FAILED READ IS NEVER "NO IPOS". The route answers 200 with an empty list when both vendor
// calendars failed and says so in a header; calendarEventsRead.js keeps that header, and the model
// turns it into a failed read.
// A MISSING FIELD IS NEVER 0. It reads "Not given".
// A SYMBOL THAT DOES NOT TRADE YET IS PLAIN TEXT. Only a priced deal whose day has come is a link.
//
// WIDTH. Five columns at 592px. Where the table folds (a phone, a panel at most 460px wide) the
// share count folds away and the price may take two lines, so four columns fit 340px.
//
// IPO LOCKUP (2026-11-22): the view word swaps this body for the lockups ending in the next 30 days, each an
// estimate (IpoLockupPanel.jsx, its own route). The calendar below is unchanged.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { todayIso } from '../../calendar/earningsModalRow'
import { useCalendarEventsRead } from './calendarEventsRead'
import IpoLockupPanel from './IpoLockupPanel'
import { normIpoView } from './ipoLockupModel'
import { canRetry, failureKind, failureText } from './marketRead'
import {
  IPO_CODE, IPO_EARLIER_SHOWN, IPO_LISTINGS_COMMAND, IPO_SOURCE, IPO_WHAT, countLine, cutDays, dayWords, ipoRead, ipoUrl,
  priceWords, sharesWords, statusWords, tradesNow, valueWords,
} from './ipoCalendarModel'
import styles from './marketPanels.module.css'

export {
  IPO_CODE, IPO_EARLIER_SHOWN, IPO_LISTINGS_COMMAND, IPO_SOURCE, IPO_WHAT, NOT_GIVEN, addDays, countLine, cutDays, dayWords,
  ipoRead, ipoUrl, ipoWindow, priceWords, sharesWords, statusWords, tradesNow, valueWords,
} from './ipoCalendarModel'

const FAILED_BEHIND_200 = `${IPO_WHAT} could not be read from either of its two sources just now.`

function DealsTable({ days, today, caption, label, testId }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid={testId} aria-label={label}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Company</th>
            <th scope="col" className={styles.phoneWrap} title="The price range the deal expects, or the price it priced at">Price</th>
            <th scope="col" className={styles.phoneHide} title="Shares offered">Shares</th>
            <th scope="col" title="The dollar value the calendar gives for the deal. See the note under the table.">Value</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        {days.map((d) => (
          <tbody key={d.date} data-testid={`terminal-ipo-day-${d.date}`}>
            <tr>
              <th scope="rowgroup" colSpan={5}>{dayWords(d.date)}{d.date === today ? ' (today)' : ''}</th>
            </tr>
            {d.rows.map((r) => {
              const symbol = r.sym ? (tradesNow(r, today) ? <PanelSymbol sym={r.sym} /> : r.sym) : null
              // Under the name: the symbol (when the name is the first line) and the exchange.
              const under = [r.name ? symbol : null, r.exchange].filter(Boolean)
              return (
                <tr key={`${r.sym || ''} ${r.name || ''}`} data-testid="terminal-ipo-row" data-status={r.status || 'none'}>
                  <td className={`${styles.wrapCell} ${styles.snugTight}`}>
                    {r.name || symbol}
                    {under.length ? (
                      <>
                        <br />
                        <span className={styles.muted}>{under[0]}{under.length > 1 ? ', ' : ''}{under[1] ?? null}</span>
                      </>
                    ) : null}
                  </td>
                  <td className={`${styles.phoneWrap} ${styles.snugWrap}`}>{priceWords(r.price)}</td>
                  <td className={styles.phoneHide}>{sharesWords(r.shares)}</td>
                  <td>{valueWords(r.value)}</td>
                  <td>{statusWords(r.status)}</td>
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function Notes({ receivedAt }) {
  const time = receivedAt ? formatTimeEt(receivedAt, { zoneSuffix: 'ET', absent: '' }) : ''
  return (
    <>
      <p className={styles.muted} data-testid="terminal-ipo-links">
        Stocks listed in the last year, with their prices:{' '}
        <PanelCommand cmd={IPO_LISTINGS_COMMAND} label="Open the new listings list">New listings ({IPO_LISTINGS_COMMAND})</PanelCommand>
        . Their lockups ending in the next 30 days, estimated:{' '}
        <PanelCommand cmd="IPO LOCKUP" label="Open the IPO lockups ending">Lockups (IPO LOCKUP)</PanelCommand>
      </p>
      <p className={styles.muted} data-testid="terminal-ipo-method">
        Source: the Finnhub and FMP IPO calendars, merged by the server. The calendars give no as-of time of their own.
        {time ? ` This panel read the server at ${time}.` : ''} The server keeps one answer for up to six hours. Value is
        the dollar value of the shares offered where a calendar gives it; for some deals a calendar gives the company&apos;s
        expected market value in its place, and the answer does not say which. A field a calendar leaves empty reads Not
        given, never 0. A symbol becomes a link once its deal has priced and its day has come.
      </p>
    </>
  )
}

/** `IPO` (the calendar, below) or `IPO LOCKUP` (the lockups ending). Outside the shell the lockup view's chip back to
 *  the calendar switches here, in this panel's own state. */
export default function IpoCalendarPanel({ view: viewProp } = {}) {
  const [view, setView] = useState(() => normIpoView(viewProp))
  return view === 'lockup' ? <IpoLockupPanel onView={setView} /> : <IpoCalendarView />
}

function IpoCalendarView() {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || IPO_CODE
  const [today] = useState(todayIso)
  const [allEarlier, setAllEarlier] = useState(false)
  const read = useCalendarEventsRead(ipoUrl(today))
  const view = useMemo(() => ipoRead(read.body, read.readStatus, today), [read.body, read.readStatus, today])
  const answered = !read.loading && read.body !== undefined && view.state !== 'failed'
  // The calendars carry no as-of, so the header names the source alone and reads "undated".
  usePanelFreshness(answered ? panelAsOf(IPO_SOURCE, null) : null)

  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-ipo" data-state={state}>{body}</div>
  )
  if (read.loading) return <PanelSkeleton label="Loading the IPO calendar" testId="terminal-ipo-loading" />
  if (!answered) {
    const err = read.body === undefined ? read.error : null
    const locked = err ? !canRetry(err) : false
    return (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-ipo-error"
        title={err ? failureText(err, IPO_WHAT) : FAILED_BEHIND_200}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no IPOs. Retry, or run ${code} again.`}
      </PanelState>
    )
  }
  const stale = read.error ? (
    <p className={styles.note} role="status" data-testid="terminal-ipo-stale-read">{failureText(read.error, IPO_WHAT)} Showing the last read.</p>
  ) : null
  if (view.state === 'none') {
    return wrap('none', (
      <>
        {stale}
        <PanelState kind="empty" role="status" title={countLine(view, today)} testId="terminal-ipo-none">
          The calendars answered and list no deal for these days. That is an answer, not a failed read.
        </PanelState>
        <Notes receivedAt={read.receivedAt} />
      </>
    ))
  }
  const earlier = allEarlier ? view.earlier : cutDays(view.earlier, IPO_EARLIER_SHOWN)
  return wrap('ok', (
    <>
      {stale}
      <p className={styles.lede} data-testid="terminal-ipo-count">{countLine(view, today)}</p>
      {view.aheadCount ? (
        <DealsTable days={view.ahead} today={today} caption="Today and ahead" testId="terminal-ipo-ahead"
          label={`IPOs today and ahead, soonest day first, ${view.aheadCount} deals`} />
      ) : <p className={styles.muted} data-testid="terminal-ipo-ahead-none">No deal is on the calendar for today or the days ahead.</p>}
      {view.earlierCount ? (
        <>
          <DealsTable days={earlier} today={today} caption="Earlier" testId="terminal-ipo-earlier"
            label={`IPOs before today, newest day first, ${view.earlierCount} deals`} />
          {view.earlierCount > IPO_EARLIER_SHOWN ? (
            <div className={styles.toolbar}>
              <button type="button" className={styles.chip} aria-pressed={allEarlier} onClick={() => setAllEarlier((v) => !v)} data-testid="terminal-ipo-more">
                {allEarlier ? `Show ${IPO_EARLIER_SHOWN}` : `Show all ${view.earlierCount}`}
              </button>
              <span className={styles.muted}>Showing {allEarlier ? view.earlierCount : IPO_EARLIER_SHOWN} of {view.earlierCount} earlier deals.</span>
            </div>
          ) : null}
        </>
      ) : null}
      {view.dropped ? (
        <p className={styles.note} role="status" data-testid="terminal-ipo-dropped">
          {view.dropped} {view.dropped === 1 ? 'row' : 'rows'} in the answer had no day or no name and {view.dropped === 1 ? 'is' : 'are'} not shown.
        </p>
      ) : null}
      <Notes receivedAt={read.receivedAt} />
    </>
  ))
}
