// AUCT: Treasury auctions, upcoming and recent results. `AUCT`.
//
//   AUCT   what the Treasury is about to sell (security, auction day, issue day, amount offered) and
//          how its recent sales went (the high yield or rate, the bid-to-cover ratio, and who took
//          the paper: indirect bidders, direct bidders and primary dealers).
//
// `GET /api/research/treasury-auctions` (paid; api/services/treasury_auctions.py). The server holds
// one answer and never builds it on the request: with none held it says "computing" and this panel
// asks again. The pure half is treasuryAuctionsModel.js (this file exports only the panel, so it
// keeps fast refresh; tests and the agent import the model directly).
//
// What it adds: the terminal had Treasury yields (RATES) and no view of the sales that set them. A
// weak auction (a low bid-to-cover, dealers left holding more of it) moves yields the same afternoon.
//
// A REFUSED SOURCE IS AN ANSWER, NOT AN ERROR: plain words, no Retry loop.
// A FAILED READ IS NEVER "NO AUCTIONS", and a look for newer records that failed is said above the
// last good ones, with their date.
// A MISSING NUMBER IS NEVER 0: it reads "No figure". A sale with no bidder split says so in each cell.
// NO GREEN OR RED: a high yield or a low bid-to-cover is not good or bad by itself.
//
// WIDTH. Results: six columns at 592px; where the table folds (a phone) the direct and dealer
// shares fold away and security, result, bid-to-cover and the indirect share stay. Upcoming: three
// columns, two on a phone (the announcement day folds away).
import { useMemo, useState } from 'react'
import { PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { todayIso } from '../../calendar/earningsModalRow'
import { dayWords } from './ipoCalendarModel'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  AUCT_CODE, AUCT_RESULTS_SHOWN, AUCT_SOURCE, AUCT_URL, AUCT_WHAT, NO_FIGURE, amountWords, asOfSentence, auctionsRead,
  checkWords, countLine, coverWords, cutDays, cutWords, dateCell, rateKindWords, rateWords, securityWords, shareWords,
  tagWords, unavailableWords,
} from './treasuryAuctionsModel'
import styles from './marketPanels.module.css'

const COMPUTING_POLL_MS = 3 * 1000
/** The server looks once a weekday evening; a panel left open picks that up within half an hour. */
const HELD_POLL_MS = 30 * 60 * 1000
const RATES_COMMAND = 'RATES'
const FAILED_BEHIND_200 = `${AUCT_WHAT} could not be read just now.`

const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')
const missing = (words) => words === NO_FIGURE

/** A figure cell: muted when there is none, so an absent number does not read as a quiet one. */
function Fig({ words, className = '' }) {
  return <td className={`${missing(words) ? styles.muted : ''} ${className}`.trim() || undefined}>{words}</td>
}

function Security({ row }) {
  const tags = tagWords(row)
  return (
    <td className={styles.wrapCell}>
      {securityWords(row)}
      <br />
      <span className={styles.muted}>{amountWords(row.amount) === NO_FIGURE ? 'Amount not given' : `${amountWords(row.amount)} offered`}{tags ? `, ${tags}` : ''}</span>
    </td>
  )
}

function DayHead({ date, today, span }) {
  return (
    <tr>
      <th scope="rowgroup" colSpan={span}>{dayWords(date)}{date === today ? ' (today)' : ''}</th>
    </tr>
  )
}

function UpcomingTable({ days, today, count }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-auct-upcoming" aria-label={`Treasury auctions coming up, soonest day first, ${count} ${count === 1 ? 'auction' : 'auctions'}`}>
        <caption className={styles.caption}>Coming up</caption>
        <thead>
          <tr>
            <th scope="col">Security</th>
            <th scope="col" title="The day the security is delivered and paid for">Issues</th>
            <th scope="col" className={styles.phoneHide} title="The day the Treasury announced the auction">Announced</th>
          </tr>
        </thead>
        {days.map((d) => (
          <tbody key={d.date} data-testid={`terminal-auct-upcoming-day-${d.date}`}>
            <DayHead date={d.date} today={today} span={3} />
            {d.rows.map((r) => (
              <tr key={`${r.type} ${r.term || ''}`} data-testid="terminal-auct-upcoming-row">
                <Security row={r} />
                <td>{dateCell(r.issueDate)}</td>
                <td className={styles.phoneHide}>{dateCell(r.announcedDate)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function ResultsTable({ days, today, count }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-auct-results" aria-label={`Treasury auction results, newest day first, ${count} ${count === 1 ? 'auction' : 'auctions'}`}>
        <caption className={styles.caption}>Results</caption>
        <thead>
          <tr>
            <th scope="col">Security</th>
            <th scope="col" title="The highest yield, rate or discount margin the auction accepted, in percent">Result</th>
            <th scope="col" title="Bid-to-cover: the amount bid for, divided by the amount sold">Cover</th>
            <th scope="col" title="Indirect bidders' share of the competitive award, in percent">Indirect</th>
            <th scope="col" className={styles.phoneHide} title="Direct bidders' share of the competitive award, in percent">Direct</th>
            <th scope="col" className={styles.phoneHide} title="Primary dealers' share of the competitive award, in percent">Dealers</th>
          </tr>
        </thead>
        {days.map((d) => (
          <tbody key={d.date} data-testid={`terminal-auct-results-day-${d.date}`}>
            <DayHead date={d.date} today={today} span={6} />
            {d.rows.map((r) => {
              const kind = rateKindWords(r.rateKind)
              return (
                <tr key={`${r.cusip || ''} ${r.type} ${r.term || ''}`} data-testid="terminal-auct-result-row" data-kind={r.rateKind || 'none'}>
                  <Security row={r} />
                  {r.rate == null ? <td className={styles.muted}>{NO_FIGURE}</td> : (
                    <td>
                      {rateWords(r.rate)}
                      <br />
                      <span className={styles.muted}>{kind}</span>
                    </td>
                  )}
                  <Fig words={coverWords(r.cover)} />
                  <Fig words={shareWords(r.bidders?.indirect.share)} />
                  <Fig words={shareWords(r.bidders?.direct.share)} className={styles.phoneHide} />
                  <Fig words={shareWords(r.bidders?.dealers.share)} className={styles.phoneHide} />
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function Notes({ view }) {
  const time = clock(view.readAt)
  return (
    <>
      <p className={styles.muted} data-testid="terminal-auct-links">
        Where Treasury yields are now:{' '}
        <PanelCommand cmd={RATES_COMMAND} label="Open Treasury yields">Treasury yields ({RATES_COMMAND})</PanelCommand>
      </p>
      <p className={styles.muted} data-testid="terminal-auct-method">
        {asOfSentence(view)}{time ? ` The site read it at ${time}.` : ''} The result is the high yield for a note, a bond
        or TIPS, the high rate for a bill and the high discount margin for a floating rate note. Cover is the amount bid
        for divided by the amount sold. Indirect, direct and dealers are each group&apos;s share of the competitive award
        to those three groups, worked out by the server from the Treasury&apos;s dollar figures; indirect bidders include
        foreign central banks. A figure the Treasury has not published reads “No figure”, never 0. The server looks for new
        records once each weekday evening, so an auction held today shows its result tonight.
      </p>
    </>
  )
}

function Auctions({ code, inPanel }) {
  const [today] = useState(todayIso)
  const [all, setAll] = useState(false)
  const [pace, setPace] = useState(HELD_POLL_MS)
  const read = useMarketRead(AUCT_URL, { refreshInterval: pace })
  const view = useMemo(() => auctionsRead(read.body), [read.body])
  // The pace follows the server's own word (adjusted during render from the last answer).
  const wantPace = view.state === 'computing' ? COMPUTING_POLL_MS : HELD_POLL_MS
  if (wantPace !== pace) setPace(wantPace)

  const answered = !read.loading && !!read.body && (view.state === 'ok' || view.state === 'none')
  usePanelFreshness(answered ? panelAsOf(AUCT_SOURCE, view.asOf) : null)

  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-auct" data-state={state}>{body}</div>
  )

  if (read.loading) return frame('loading', <PanelSkeleton label="Loading Treasury auctions" testId="terminal-auct-loading" />)
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    const locked = err ? !canRetry(err) : false
    return frame('error', (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-auct-error"
        title={err ? failureText(err, AUCT_WHAT) : FAILED_BEHIND_200}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no auctions. Retry, or run ${code} again.`}
      </PanelState>
    ))
  }
  if (view.state === 'computing') {
    return frame('computing', (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-auct-computing">
        The server is reading the Treasury&apos;s auction records. That takes a few seconds the first time. This panel asks
        again every 3 seconds and fills in on its own. That is not the same as no auctions.
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    return frame('unavailable', (
      <PanelState kind="locked" role="status" testId="terminal-auct-unavailable" title={unavailableWords(view.reason, view.httpStatus)}>
        The site reads these records from the US Treasury&apos;s Fiscal Data service. That is not the same as no auctions.
        The server asks again by itself; nothing here needs a retry.
      </PanelState>
    ))
  }

  const notes = (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-auct-stale-read">{failureText(read.error, AUCT_WHAT)} Showing the last read.</p> : null}
      {view.check ? <p className={styles.note} role="status" data-testid="terminal-auct-check">{checkWords(view.check, view.asOf)}</p> : null}
    </>
  )
  if (view.state === 'none') {
    return frame('none', (
      <>
        {notes}
        <PanelState kind="empty" role="status" title={countLine(view, today)} testId="terminal-auct-none">
          The Treasury&apos;s data service answered and lists no auction for these days. That is an answer, not a failed read.
        </PanelState>
        <Notes view={view} />
      </>
    ))
  }
  const results = all ? view.results : cutDays(view.results, AUCT_RESULTS_SHOWN)
  return frame('ok', (
    <>
      {notes}
      <p className={styles.lede} data-testid="terminal-auct-count">{countLine(view, today)}</p>
      {view.upcomingCount
        ? <UpcomingTable days={view.upcoming} today={today} count={view.upcomingCount} />
        : <p className={styles.muted} data-testid="terminal-auct-upcoming-none">The Treasury lists no auction from today on. That is its list, not a failed read.</p>}
      {view.resultCount ? (
        <>
          <ResultsTable days={results} today={today} count={view.resultCount} />
          {view.resultCount > AUCT_RESULTS_SHOWN ? (
            <div className={styles.toolbar}>
              <button type="button" className={styles.chip} aria-pressed={all} onClick={() => setAll((v) => !v)} data-testid="terminal-auct-more">
                {all ? `Show ${AUCT_RESULTS_SHOWN}` : `Show all ${view.resultCount}`}
              </button>
              <span className={styles.muted}>Showing {all ? view.resultCount : AUCT_RESULTS_SHOWN} of {view.resultCount} auctions.</span>
            </div>
          ) : null}
        </>
      ) : <p className={styles.muted} data-testid="terminal-auct-results-none">No auction is listed for the last {view.windowDays || 45} days.</p>}
      {cutWords(view.cut) ? <p className={styles.note} role="status" data-testid="terminal-auct-cut">{cutWords(view.cut)}</p> : null}
      {view.dropped ? (
        <p className={styles.note} role="status" data-testid="terminal-auct-dropped">
          {view.dropped} {view.dropped === 1 ? 'row' : 'rows'} in the Treasury&apos;s answer had no auction day or no security and {view.dropped === 1 ? 'is' : 'are'} not shown.
        </p>
      ) : null}
      <Notes view={view} />
    </>
  ))
}

export default function TreasuryAuctionsPanel() {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || AUCT_CODE
  return <Auctions code={code} inPanel={inPanel} />
}
