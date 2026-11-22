// IPO LOCKUP: the IPO lockups ending in the next 30 days and the past 7 (2026-11-22). `IPO LOCKUP`.
//
// `GET /api/scans/ipo-lockups` (paid; api/services/ipo_lockups.py) answers from what the server already holds: the
// companies of the last-year listings scan (LEAD IPO's list) whose ESTIMATED lockup expiry, the listing date plus
// 180 calendar days rolled to the next session, falls in the window. Each row: the stock (PanelSymbol), its company
// name where the site holds it, its listing date, the estimated expiry with the days to go and the basis in words,
// and the change since listing (the latest held close against the first day's close) where the closes are held.
//
// The IPO calendar (bare IPO) is a different body and is unchanged; this one is reached by `IPO LOCKUP`. Its chip
// back to the calendar writes `IPO` into the command line.
// ⛔ EVERY DATE IS AN ESTIMATE AND SAYS SO, in the header and on every row: the server reads no prospectus.
// ⛔ A failed read is an error with Retry, never "no lockups"; a list being worked out says so and asks again.
// WIDTH. Three columns of two- and three-line cells that wrap between words: they fit a 340px phone.
import { useMemo } from 'react'
import {
  PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { canRetry, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  IPO_LOCKUP_SOURCE, IPO_LOCKUP_URL, IPO_LOCKUP_WHAT, IPO_VIEWS, changeText, changeWhy, countLine, dateText, daysText,
  ipoViewCommandArgs, lockupPollMs, lockupRead, readText,
} from './ipoLockupModel'
import styles from './marketPanels.module.css'

const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)
// The table box contains the screen-reader words of each row (`.sr-only` is absolutely placed): without a containing
// block they could escape the scrolling box and widen the panel body.
const BOX_STYLE = { position: 'relative' }

function Rows({ rows, caption }) {
  return (
    <tbody>
      <tr>
        <th scope="rowgroup" colSpan={3}>{caption}</th>
      </tr>
      {rows.map((r) => (
        <tr key={r.key} data-testid={`terminal-ipo-lockup-row-${r.sym}`} data-basis={r.basis}>
          <td className={`${styles.wrapCell} ${styles.snugTight} ${styles.phoneTight}`}>
            <PanelSymbol sym={r.sym} className={styles.sym} />
            {r.company ? <><br /><span className={styles.muted}>{r.company}</span></> : null}
            <br /><span className={styles.muted} title={r.listingSource ? `Listing date: ${r.listingSource}` : undefined}>{`Listed ${dateText(r.listing)}`}</span>
          </td>
          <td className={`${styles.wrapCell} ${styles.snugTight} ${styles.phoneTight}`} title={r.basisWords}>
            <span data-testid={`terminal-ipo-lockup-expiry-${r.sym}`}>{dateText(r.expiry)}</span>
            <br /><span className={styles.muted}>{daysText(r.days)}</span>
            <br /><span className={styles.muted} data-testid={`terminal-ipo-lockup-basis-${r.sym}`}>
              {r.basis === 'stated' ? 'stated in a filing' : 'estimated: 180 days after listing'}
              {r.basis === 'stated' ? null : <span className="sr-only">; the prospectus sets the actual date</span>}
            </span>
          </td>
          <td className={`${styles.wrapCell} ${styles.snugTight} ${styles.phoneTight}`}>
            {changeText(r.change)
              ? <><span className={tone(r.change.pct)}>{changeText(r.change)}</span><br /><span className={`${styles.muted} ${styles.snugWrap} ${styles.phoneWrap}`}>{changeWhy(r.change)}</span></>
              : <span className={`${styles.muted} ${styles.snugWrap} ${styles.phoneWrap}`}>{changeWhy(r.change)}</span>}
          </td>
        </tr>
      ))}
    </tbody>
  )
}

export default function IpoLockupPanel({ onView = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const read = useMarketRead(IPO_LOCKUP_URL, { refreshInterval: (latest) => lockupPollMs(latest?.body) })
  const view = useMemo(() => lockupRead(read.body), [read.body])
  const rows = useMemo(() => (view.state === 'ok' ? view.rows : []), [view])
  usePanelFreshness(view.state === 'ok' && view.listingsAsOf ? panelAsOf(IPO_LOCKUP_SOURCE, view.listingsAsOf) : null)
  usePanelSymbolRows(rows.map((r) => r.sym), 'IPO lockups ending')

  const toCalendar = () => {
    if (!writeBack(ipoViewCommandArgs({ view: 'calendar' })) && onView) onView('calendar')
  }
  const chips = (
    <div className={styles.toolbar} role="toolbar" aria-label="IPO views">
      <div className={styles.group} role="group" aria-label="Which list">
        <button type="button" className={styles.chip} aria-pressed="false" onClick={toCalendar} data-testid="terminal-ipo-lockup-view-calendar"
          title="Deals from last week to next week (IPO)">{IPO_VIEWS.calendar.label}</button>
        <button type="button" className={styles.chip} aria-pressed="true" data-testid="terminal-ipo-lockup-view-lockup"
          title="Lockups ending in the next 30 days, estimated (IPO LOCKUP)">{IPO_VIEWS.lockup.label}</button>
      </div>
    </div>
  )
  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-ipo-lockup" data-state={state}>
      {chips}
      {body}
    </div>
  )

  if (read.loading) return <PanelSkeleton label="Loading the IPO lockups" testId="terminal-ipo-lockup-loading" />
  if (read.error && !read.body) {
    const locked = !canRetry(read.error)
    return wrap('error', (
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(read.error, IPO_LOCKUP_WHAT)} testId="terminal-ipo-lockup-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : 'That is not the same as no lockups ending. Retry, or run IPO LOCKUP again.'}
      </PanelState>
    ))
  }
  if (view.state === 'computing' || view.state === 'warming') {
    return wrap(view.state, (
      <PanelState kind="empty" role="status" title="Working out the lockups from the listings the site holds." testId="terminal-ipo-lockup-busy">
        {view.state === 'warming'
          ? 'The list of the last year\'s listings has not been read since the server started. This panel asks again in a few seconds.'
          : 'This panel asks again in a few seconds.'}
      </PanelState>
    ))
  }
  if (view.state === 'failed') {
    return wrap('error', (
      <PanelState kind="error" title={`${IPO_LOCKUP_WHAT} could not be worked out just now.`} testId="terminal-ipo-lockup-error"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as no lockups ending.
      </PanelState>
    ))
  }

  const notes = (
    <>
      <p className={styles.muted} data-testid="terminal-ipo-lockup-read">{readText(view)}</p>
      <p className={styles.muted} data-testid="terminal-ipo-lockup-method">
        A lockup usually lets insiders sell about 180 days after a company lists; the exact term is in its prospectus and
        varies, and the site reads no prospectus. So each date here is the listing date plus 180 days, moved to the next
        trading day. The change since listing is the latest close the site holds against the first day&apos;s close; the IPO
        price is not held. Source: the site&apos;s last-year listings scan (LEAD IPO), its daily closes and its company names.
      </p>
    </>
  )
  if (!rows.length) {
    return wrap('none', (
      <>
        {read.error && <p className={styles.note} role="status">{failureText(read.error, IPO_LOCKUP_WHAT)} Showing the last read.</p>}
        <PanelState kind="empty" role="status" title={countLine(view)} testId="terminal-ipo-lockup-none">
          {`Every date would be ${view.basisWords}.`}
        </PanelState>
        {notes}
      </>
    ))
  }
  return wrap('ok', (
    <>
      {read.error && <p className={styles.note} role="status">{failureText(read.error, IPO_LOCKUP_WHAT)} Showing the last read.</p>}
      <p className={styles.lede} data-testid="terminal-ipo-lockup-count">{countLine(view)}</p>
      <p className={styles.note} data-testid="terminal-ipo-lockup-basis">{`Every date is ${view.basisWords}.`}</p>
      <div className={styles.tableBox} style={BOX_STYLE}>
        <table className={styles.table} data-testid="terminal-ipo-lockup-table"
          aria-label={`IPO lockups ending, estimated, soonest first, ${rows.length} stocks`}>
          <thead>
            <tr>
              <th scope="col">Stock</th>
              <th scope="col" className={styles.wrapCell} title={view.basisWords}>Lockup ends</th>
              <th scope="col" className={styles.wrapCell} title="The latest close the site holds against the first day's close">Since listing</th>
            </tr>
          </thead>
          {view.behind.length ? <Rows rows={view.behind} caption={`Ended in the past ${view.behindDays} days`} /> : null}
          {view.ahead.length ? <Rows rows={view.ahead} caption={`Today and the next ${view.aheadDays} days`} /> : null}
        </table>
      </div>
      {view.dropped ? (
        <p className={styles.note} role="status" data-testid="terminal-ipo-lockup-dropped">
          {view.dropped} {view.dropped === 1 ? 'row' : 'rows'} in the answer had no symbol or no date and {view.dropped === 1 ? 'is' : 'are'} not shown.
        </p>
      ) : null}
      {notes}
    </>
  ))
}
