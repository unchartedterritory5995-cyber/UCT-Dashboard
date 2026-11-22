// DVD MARKET: every ex-dividend date in this week and next, and every split taking effect in the same
// days, for the stocks the site follows (2026-11-21).
//
// `GET /api/research/market-dividends` (paid; api/services/dividends_market.py). The server holds the
// list (read from Massive's reference dividends and splits endpoints by date range, the feed the
// per-stock calendar already reads) and never builds it on the request: with nothing held it says
// "computing" and this panel asks again every 3 seconds. The pure half is marketDividendsModel.js.
//
// The member's own stocks (bare `DVD`) and one stock (`NVDA DVD`) are DividendCalendarPanel.jsx, which
// renders this body for `DVD MARKET` (with or without the stock the panel follows). Its chip back writes `DVD` (or
// `SYM DVD` on a panel that follows a stock) into the command line.
//
// A FAILED READ IS NEVER "NO DIVIDENDS". A MISSING AMOUNT IS NEVER $0: it reads "Amount not given".
// WIDTH. Three columns, each a two-line cell, which fit a 340px panel with nothing folded; the declared
// day is the pay column's second line and folds away on a phone.
import { useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { todayIso } from '../../calendar/earningsModalRow'
import { usePanelWriteBack } from './commandWriteBack'
import { dayWords } from './dividendCalendarModel'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  DVD_MARKET_SOURCE, DVD_MARKET_URL, DVD_MARKET_WHAT, DVD_VIEWS, cadenceWords, cashWords, cutWords, declaredWords, dvdViewCommandArgs,
  legWords, marketCountLine, marketDividendsRead, marketPollMs, marketSplitWords, notFollowedWords, payWords, windowWords,
} from './marketDividendsModel'
import styles from './marketPanels.module.css'

const FAILED_BEHIND_200 = `${DVD_MARKET_WHAT} came back in a shape this panel cannot read.`
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')

function Stock({ row }) {
  return (
    <td className={styles.wrapCell}>
      <PanelSymbol sym={row.sym} className={styles.sym} />
      {row.name ? <><br /><span className={styles.muted}>{row.name}</span></> : null}
    </td>
  )
}

function DividendTable({ bucket, today }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid={`terminal-dvd-market-${bucket.key}`}
        aria-label={`${bucket.label}: ex-dividend dates across the market, soonest day first, ${bucket.count} ${bucket.count === 1 ? 'dividend' : 'dividends'}`}>
        <caption className={styles.caption}>{bucket.label}: ex-dividend dates</caption>
        <thead>
          <tr>
            <th scope="col">Stock</th>
            <th scope="col" className={styles.wrapCell} title="The cash amount per share as declared, and how often it is paid">Cash</th>
            <th scope="col" className={`${styles.wrapCell} ${styles.phoneWrap}`} title="The day the dividend is paid, and the day it was declared">Paid</th>
          </tr>
        </thead>
        {bucket.days.map((d) => (
          <tbody key={d.date} data-testid={`terminal-dvd-market-day-${d.date}`}>
            <tr>
              <th scope="rowgroup" colSpan={3}>Ex-dividend {dayWords(d.date, today)}{d.date === today ? ' (today)' : ''}</th>
            </tr>
            {d.rows.map((r, i) => (
              <tr key={`${r.sym} ${i}`} data-testid="terminal-dvd-market-row">
                <Stock row={r} />
                <td className={`${styles.wrapCell} ${r.amount == null ? styles.muted : ''}`.trim()}>
                  {cashWords(r)}
                  <br />
                  <span className={styles.muted}>{cadenceWords(r)}</span>
                </td>
                <td className={`${styles.wrapCell} ${styles.phoneWrap}`}>
                  <span className={r.payDate ? undefined : styles.muted}>{payWords(r, today)}</span>
                  {r.declaredDate ? <><br /><span className={`${styles.muted} ${styles.phoneHide}`}>{declaredWords(r, today)}</span></> : null}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function SplitTable({ buckets, count, today }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-dvd-market-splits"
        aria-label={`Splits across the market this week and next, soonest day first, ${count} ${count === 1 ? 'split' : 'splits'}`}>
        <caption className={styles.caption}>Splits</caption>
        <thead>
          <tr>
            <th scope="col">Stock</th>
            <th scope="col" title="Shares after for shares before">Split</th>
          </tr>
        </thead>
        {buckets.flatMap((b) => b.days).map((d) => (
          <tbody key={d.date} data-testid={`terminal-dvd-market-split-day-${d.date}`}>
            <tr>
              <th scope="rowgroup" colSpan={2}>Takes effect {dayWords(d.date, today)}{d.date === today ? ' (today)' : ''}</th>
            </tr>
            {d.rows.map((r) => (
              <tr key={r.sym} data-testid="terminal-dvd-market-split-row">
                <Stock row={r} />
                <td className={r.ratio ? undefined : styles.muted}>{marketSplitWords(r)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function Notes({ view, today }) {
  const time = clock(view.readAt)
  const left = notFollowedWords(view)
  return (
    <>
      <p className={styles.muted} data-testid="terminal-dvd-market-links">
        One stock&apos;s past dividends and splits are on Corporate actions, e.g. <kbd>NVDA CACT</kbd>. A stock&apos;s own
        dividends ahead: <kbd>NVDA DVD</kbd>.
      </p>
      <p className={styles.muted} data-testid="terminal-dvd-market-method">
        Source: {DVD_MARKET_SOURCE}, read by the server for {windowWords(view.window, today)}. Each dividend is listed on its
        ex-dividend day, the first day the stock trades without it, with the cash amount per share as declared. Each split is
        listed on the day it takes effect. Only the stocks the site follows are listed, so every symbol opens its board.
        {left ? ` ${left}` : ''} The feed gives no as-of time of its own.{time ? ` The server read it at ${time}.` : ''} The
        server keeps the list for up to 12 hours.
      </p>
    </>
  )
}

export default function MarketDividendsPanel({ sym = null, onView = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const [today] = useState(todayIso)
  const read = useMarketRead(DVD_MARKET_URL, { refreshInterval: (latest) => marketPollMs(latest?.body) })
  const view = useMemo(() => marketDividendsRead(read.body, today), [read.body, today])
  const answered = !read.loading && !!read.body && (view.state === 'ok' || view.state === 'none')
  usePanelFreshness(answered ? panelAsOf(DVD_MARKET_SOURCE, view.readAt) : null)
  usePanelSymbolRows(view.state === 'ok' ? view.symbols : [], 'ex-dividend dates across the market')

  const toMine = () => {
    if (!writeBack(dvdViewCommandArgs({ view: 'mine' }), sym) && onView) onView('mine')
  }
  const chips = (
    <div className={styles.toolbar} role="toolbar" aria-label="Dividend calendar views">
      <div className={styles.group} role="group" aria-label="Whose stocks">
        <button type="button" className={styles.chip} aria-pressed="false" onClick={toMine} data-testid="terminal-dvd-view-mine"
          title={sym ? `The declared dividends and splits ahead for ${sym} (${sym} DVD)` : DVD_VIEWS.mine.title}>{sym || DVD_VIEWS.mine.label}</button>
        <button type="button" className={styles.chip} aria-pressed="true" data-testid="terminal-dvd-view-market"
          title={DVD_VIEWS.market.title}>{DVD_VIEWS.market.label}</button>
      </div>
    </div>
  )
  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-dvd-market" data-state={state}>
      {chips}
      {body}
    </div>
  )

  if (read.loading) return <PanelSkeleton label="Loading the market dividend calendar" testId="terminal-dvd-market-loading" />
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    const locked = err ? !canRetry(err) : false
    return wrap('error', (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-dvd-market-error"
        title={err ? failureText(err, DVD_MARKET_WHAT) : FAILED_BEHIND_200}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : 'That is not the same as no dividends. Retry, or run DVD MARKET again.'}
      </PanelState>
    ))
  }
  if (view.state === 'computing') {
    return wrap('computing', (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-dvd-market-computing">
        The server is reading this week&apos;s and next week&apos;s dividends and splits from the data vendor. That takes a few
        seconds the first time. This panel asks again every 3 seconds and fills in on its own.
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    return wrap('unavailable', (
      <PanelState kind="error" testId="terminal-dvd-market-unavailable" title={`${DVD_MARKET_WHAT} could not be read from the data vendor just now.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as no dividends. The server asks the vendor again within a few minutes.
      </PanelState>
    ))
  }

  const notes = (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-dvd-market-stale-read">{failureText(read.error, DVD_MARKET_WHAT)} Showing the last read.</p> : null}
      {view.staleWindow ? (
        <p className={styles.note} role="status" data-testid="terminal-dvd-market-stale-window">
          This is the list for {windowWords(view.window, today)}. The list for {windowWords(view.currentWindow, today)} is being read and fills in on its own.
        </p>
      ) : null}
      {view.check ? <p className={styles.note} role="status" data-testid="terminal-dvd-market-check">A later look at the data vendor did not answer, so this is the last list read.</p> : null}
      {legWords(view) ? <p className={styles.note} role="status" data-testid="terminal-dvd-market-leg">{legWords(view)}</p> : null}
    </>
  )
  if (view.state === 'none') {
    return wrap('none', (
      <>
        {notes}
        <PanelState kind="empty" role="status" title={marketCountLine(view, today)} testId="terminal-dvd-market-none">
          The data vendor answered and lists none for these days. That is an answer, not a failed read.
        </PanelState>
        <Notes view={view} today={today} />
      </>
    ))
  }
  return wrap('ok', (
    <>
      {notes}
      <p className={styles.lede} data-testid="terminal-dvd-market-count">{marketCountLine(view, today)}</p>
      {view.dividendBuckets.map((b) => <DividendTable key={b.key} bucket={b} today={today} />)}
      {view.splitCount ? <SplitTable buckets={view.splitBuckets} count={view.splitCount} today={today} /> : (
        view.legs.splits === 'ok'
          ? <p className={styles.muted} data-testid="terminal-dvd-market-splits-none">No split takes effect in these days for the stocks the site follows.</p>
          : null
      )}
      {cutWords(view) ? <p className={styles.note} role="status" data-testid="terminal-dvd-market-cut">{cutWords(view)}</p> : null}
      {view.dropped ? (
        <p className={styles.note} role="status" data-testid="terminal-dvd-market-dropped">
          {view.dropped} {view.dropped === 1 ? 'row' : 'rows'} in the answer had no day or no symbol and {view.dropped === 1 ? 'is' : 'are'} not shown.
        </p>
      ) : null}
      <Notes view={view} today={today} />
    </>
  ))
}
