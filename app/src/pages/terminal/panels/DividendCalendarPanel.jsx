// DVD: the declared dividends and splits ahead, by day. `DVD` for the member's own stocks,
// `NVDA DVD` for one stock.
//
// `GET /api/calendar/dividends[?syms=]` (api/routers/calendar.py, paid; the Calendar page's own
// route, no new route and no switch). The pure half is dividendCalendarModel.js, re-exported below.
//
// What the route is, and so what this panel is: NOT a market-wide dividend calendar. It answers for
// a list of stocks (the caller's own when none is named), one dividend per stock (its next declared
// ex-date) and every declared split ahead. It holds nothing past, so the one-stock view points at
// CACT for history and opens it beside.
//
// A FAILED READ IS NEVER "NO DIVIDENDS". The route answers 200 with a header when its vendor failed;
// calendarEventsRead.js keeps the header. No rows with that label is a failed read; rows with it are
// shown with a note that some stocks could not be read.
// A MISSING AMOUNT IS NEVER $0. It reads "Amount not given".
//
// WIDTH. Three short columns, which fit a 340px panel with nothing folded.
//
// `DVD MARKET` (2026-11-21, args.js `marketView`): every ex-dividend date and split this week and next for
// every stock the site follows, its own panel body (MarketDividendsPanel.jsx). A panel that follows a group's
// stock gets that stock from the shell even for bare `DVD`, so the word, not the missing ticker, asks for the
// market. Both views carry two chips: the panel's stock (or the member's own stocks) and the whole market.
import { useMemo, useState } from 'react'
import MarketDividendsPanel from './MarketDividendsPanel'
import { usePanelWriteBack } from './commandWriteBack'
import { DVD_VIEWS, dvdViewCommandArgs, normDvdView } from './marketDividendsModel'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { todayIso } from '../../calendar/earningsModalRow'
import { useCalendarEventsRead } from './calendarEventsRead'
import { canRetry, failureKind, failureText } from './marketRead'
import {
  DVD_CODE, DVD_HISTORY_CODE, DVD_SOURCE, DVD_SYMBOL_CAP, DVD_WHAT, countLine, dayWords, detailWords, dvdHistoryCommand, dvdRead,
  dvdUrl, eventWords,
} from './dividendCalendarModel'
import styles from './marketPanels.module.css'

export {
  DVD_BUCKETS, DVD_CODE, DVD_HISTORY_CODE, DVD_SOURCE, DVD_SYMBOL_CAP, DVD_WHAT, bucketOf, countLine, dayWords, detailWords,
  dvdHistoryCommand, dvdRead, dvdUrl, eventWords, weekEnd,
} from './dividendCalendarModel'

const FAILED_BEHIND_200 = `${DVD_WHAT} could not be read from the data vendor just now.`

function EventsTable({ bucket, today, whose }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid={`terminal-dvd-${bucket.key}`}
        aria-label={`${bucket.label}: dividends and splits for ${whose}, soonest day first, ${bucket.count} events`}>
        <caption className={styles.caption}>{bucket.label}</caption>
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col" title="Ex-dividend: the first day the stock trades without the dividend. Split: the day the split takes effect.">Event</th>
            <th scope="col" className={styles.phoneWrap} title="The cash amount per share as declared, or the split ratio">Detail</th>
          </tr>
        </thead>
        {bucket.days.map((d) => (
          <tbody key={d.date} data-testid={`terminal-dvd-day-${d.date}`}>
            <tr>
              <th scope="rowgroup" colSpan={3}>{dayWords(d.date, today)}{d.date === today ? ' (today)' : ''}</th>
            </tr>
            {d.rows.map((r) => (
              <tr key={`${r.sym} ${r.type}`} data-testid="terminal-dvd-row" data-type={r.type}>
                <td><PanelSymbol sym={r.sym} className={styles.sym} /></td>
                <td>{eventWords(r)}</td>
                <td className={styles.phoneWrap}>{detailWords(r)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function Notes({ sym, receivedAt }) {
  const time = receivedAt ? formatTimeEt(receivedAt, { zoneSuffix: 'ET', absent: '' }) : ''
  return (
    <>
      {sym ? (
        <p className={styles.muted} data-testid="terminal-dvd-links">
          This list holds declared, future events only. Past dividends and splits for {sym}:{' '}
          <PanelCommand cmd={dvdHistoryCommand(sym)} label={`Corporate actions (${DVD_HISTORY_CODE}) for ${sym}`}>Corporate actions ({DVD_HISTORY_CODE})</PanelCommand>
        </p>
      ) : (
        <p className={styles.muted} data-testid="terminal-dvd-links">
          For one stock, type its symbol first, e.g. <kbd>NVDA {DVD_CODE}</kbd>. Past dividends and splits are on
          Corporate actions, e.g. <kbd>NVDA {DVD_HISTORY_CODE}</kbd>
        </p>
      )}
      <p className={styles.muted} data-testid="terminal-dvd-method">
        Source: Massive reference data, read by the server. One dividend is listed per stock, its next declared ex-date,
        with the cash amount per share as declared. Every declared split ahead is listed on the day it takes effect.
        {sym ? '' : ` Your stocks are the Calendar page's My Stocks set; at most ${DVD_SYMBOL_CAP} are read.`} The feed gives
        no as-of time of its own.{time ? ` This panel read the server at ${time}.` : ''} The server keeps an answer for up
        to 12 hours.
      </p>
    </>
  )
}

/** The two views: the panel's stock or the member's own stocks (pressed), and the whole market (`DVD MARKET`). */
function ViewChips({ sym, onView }) {
  const writeBack = usePanelWriteBack()
  const toMarket = () => {
    if (!writeBack(dvdViewCommandArgs({ view: 'market' }), sym) && onView) onView('market')
  }
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Dividend calendar views">
      <div className={styles.group} role="group" aria-label="Whose stocks">
        <button type="button" className={styles.chip} aria-pressed="true" data-testid="terminal-dvd-view-mine"
          title={sym ? `The declared dividends and splits ahead for ${sym} (${sym} DVD)` : DVD_VIEWS.mine.title}>{sym || DVD_VIEWS.mine.label}</button>
        <button type="button" className={styles.chip} aria-pressed="false" onClick={toMarket} data-testid="terminal-dvd-view-market"
          title={DVD_VIEWS.market.title}>{DVD_VIEWS.market.label}</button>
      </div>
    </div>
  )
}

function DividendCalendarBody({ sym, code, onView }) {
  const inPanel = useInTerminalPanel()
  const [today] = useState(todayIso)
  const read = useCalendarEventsRead(dvdUrl(sym))
  const view = useMemo(() => dvdRead(read.body, read.readStatus, today), [read.body, read.readStatus, today])
  const answered = !read.loading && read.body !== undefined && view.state !== 'failed'
  // The feed carries no as-of, so the header names the source alone and reads "undated".
  usePanelFreshness(answered ? panelAsOf(DVD_SOURCE, null) : null)
  const whose = sym || 'your stocks'
  const run = sym ? `${sym} ${code}` : code

  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-dvd" data-state={state} data-sym={sym || ''}>
      <ViewChips sym={sym} onView={onView} />
      {body}
    </div>
  )
  if (read.loading) return <PanelSkeleton label={`Loading the dividend calendar for ${whose}`} testId="terminal-dvd-loading" />
  if (!answered) {
    const err = read.body === undefined ? read.error : null
    const locked = err ? !canRetry(err) : false
    return (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-dvd-error"
        title={err ? failureText(err, DVD_WHAT) : FAILED_BEHIND_200}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no dividends. Retry, or run ${run} again.`}
      </PanelState>
    )
  }
  const stale = read.error ? (
    <p className={styles.note} role="status" data-testid="terminal-dvd-stale-read">{failureText(read.error, DVD_WHAT)} Showing the last read.</p>
  ) : null
  const partial = view.partial ? (
    <p className={styles.note} role="status" data-testid="terminal-dvd-partial">
      Some stocks could not be read from the data vendor just now, so this list may be missing events. That is not the same as none.{' '}
      <button type="button" className={styles.linkBtn} onClick={read.retry}>Read it again</button>
    </p>
  ) : null
  if (view.state === 'none') {
    return wrap('none', (
      <>
        {stale}
        {partial}
        <PanelState kind="empty" role="status" title={countLine(view, sym)} testId="terminal-dvd-none">
          {sym
            ? `Only declared, future events are listed, so this is not the same as ${sym} paying no dividend.`
            : 'A stock is listed once its next dividend or split is declared. If your My Stocks set is empty, this list is empty for that reason.'}
        </PanelState>
        <Notes sym={sym} receivedAt={read.receivedAt} />
      </>
    ))
  }
  return wrap('ok', (
    <>
      {stale}
      {partial}
      <p className={styles.lede} data-testid="terminal-dvd-count">{countLine(view, sym)}</p>
      {view.buckets.map((b) => <EventsTable key={b.key} bucket={b} today={today} whose={whose} />)}
      {view.dropped ? (
        <p className={styles.note} role="status" data-testid="terminal-dvd-dropped">
          {view.dropped} {view.dropped === 1 ? 'row' : 'rows'} in the answer had no day, no symbol or an unknown kind and {view.dropped === 1 ? 'is' : 'are'} not shown.
        </p>
      ) : null}
      <Notes sym={sym} receivedAt={read.receivedAt} />
    </>
  ))
}

export default function DividendCalendarPanel({ sym, view: viewProp }) {
  const s = String(sym || '').trim().toUpperCase()
  const code = useInTerminalPanel()?.code || DVD_CODE
  // Outside the shell (or when the registry cannot take the word) a view chip switches here, in state.
  const [view, setView] = useState(() => normDvdView(viewProp))
  if (view === 'market') return <MarketDividendsPanel sym={s || null} onView={setView} />
  // Keyed by what is asked: a new stock is a new read, so one stock's events are never drawn under another's name.
  return <DividendCalendarBody key={s || 'mine'} sym={s || null} code={code} onView={setView} />
}
