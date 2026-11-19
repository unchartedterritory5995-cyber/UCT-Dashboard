// SHINT: one stock's FINRA short interest, report by report, and its daily short volume.
// `NVDA SHINT`.
//
// `GET /api/research/short-data/{sym}` (paid; api/services/short_data.py). The server never builds
// on the request: an answer it has not put together yet says "computing" and this panel asks
// again. The pure half is shortInterestModel.js, re-exported below.
//
// What it adds to the panels already in the terminal: OWN shows the newest report only, and only
// when this panel's service already holds one for the stock (OWN never asks the data vendor
// itself). This is the dated record: every FINRA report for the stock, the change from each
// report to the next, the days to cover, and (a separate thing) the share of each day's
// off-exchange volume that was short sales.
//
// ⛔ A REFUSED DATA PLAN IS AN ANSWER, NOT AN ERROR. When the data vendor refuses the site's key
// the panel says so in plain words, with no Retry loop; the server remembers it for a few hours.
// ⛔ THE TWO DATASETS FAIL APART: one is drawn while the other says why it is missing.
// ⛔ A MISSING NUMBER IS NEVER 0, and a failed read is never "no short interest".
// ⛔ DAILY SHORT VOLUME IS NOT SHORT INTEREST, and the panel says so beside it, always.
// ⛔ NO GREEN OR RED. Those are price colors here, and more shares short is not "up" for anyone
// in particular: a change is a sign (+/-), a word and a number.
//
// WIDTH. Five short columns at 640px. At 390px the average volume folds away, the bars give their
// room back (shortPanels.module.css) and a two-word heading may take two lines, so four columns fit.
//
// The read goes through marketRead.js (the terminal's one bare-SWR reader), and SWR skips ticks
// while the app is hidden.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { formatCompactTerminal, formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { todayIso } from '../../calendar/earningsModalRow'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  REPORTS_MORE, REPORTS_SHOWN, SHORT_INTEREST_CODE, SOURCE, VOLUME_DAYS_SHOWN, barShare, changeWay, dayText, daysBetween, etDayOf,
  floatWords, maxShortOf, ratioSummary, shortDataRead, shortDataUrl, unavailableWords,
} from './shortInterestModel'
import ShortDataNotes from './ShortDataNotes'
import styles from './marketPanels.module.css'
import own from './shortPanels.module.css'

export {
  REPORTS_MORE, REPORTS_SHOWN, SHORT_INTEREST_CODE, SOURCE, VOLUME_DAYS_SHOWN, barShare, changeWay, dayText, daysBetween, etDayOf,
  floatWords, maxShortOf, ratioSummary, shortDataRead, shortDataUrl, unavailableWords,
} from './shortInterestModel'

const WHAT = 'Short interest'
const NA = 'not given'
const COMPUTING_POLL_MS = 3 * 1000
const REFRESHING_POLL_MS = 15 * 1000
/** Short interest changes twice a month and short volume once a day; the server holds an answer four hours. */
const HELD_POLL_MS = 30 * 60 * 1000
/** A hyphen and a space that never break a line, so a date stays whole in a narrow cell. */
const unbroken = (s) => String(s).replace(/-/g, String.fromCharCode(0x2011)).replace(/ /g, String.fromCharCode(0x00a0))
const count = (n) => formatNumber(n, { decimals: 0 })
const shares = (v) => formatCompactTerminal(v, { absent: NA })
const signedShares = (v) => (v == null ? NA : `${v > 0 ? '+' : v < 0 ? '-' : ''}${formatCompactTerminal(Math.abs(v))}`)
const signedPct = (v) => formatPercent(v, { decimals: 1, signed: true, absent: NA })
const pct = (v) => formatPercent(v, { decimals: 1, absent: NA })
const days = (v) => (v == null ? NA : formatNumber(v, { decimals: 1 }))
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')
const plural = (n, one, many) => (n === 1 ? one : many)
const day = (iso) => unbroken(dayText(iso))

/** Pure: the newest report in a sentence. */
export function latestSentence(sym, latest) {
  if (!latest) return ''
  const way = changeWay(latest)
  const change = way == null ? 'There is no earlier report to compare it with'
    : way === 'flat' ? 'That is unchanged from the report before'
      : `That is ${way === 'up' ? 'up' : 'down'} ${shares(Math.abs(latest.changeShares))} shares`
        + `${latest.changePct != null ? ` (${signedPct(latest.changePct)})` : ''} from the report before`
  const cover = latest.dtc != null ? `, ${days(latest.dtc)} days to cover at its average daily volume` : ''
  return `${shares(latest.short)} shares of ${sym} were sold short as of ${dayText(latest.date)}${cover}. ${change}.`
}

/** Pure: how old the newest report is, in a sentence ('' when the dates cannot be compared). */
export function ageSentence(settlementDate, today, publicationEstimate) {
  const age = daysBetween(settlementDate, today)
  if (age == null || age < 0) return ''
  const published = publicationEstimate ? ` FINRA's schedule put its publication on about ${dayText(publicationEstimate)}.` : ''
  return `That settlement date is ${count(age)} ${plural(age, 'day', 'days')} ago.${published}`
}

/** Pure: when the site read the vendor, in words: the time, and the day when it was not today ('' with no time). */
export function readAtWords(readAt, today) {
  const time = clock(readAt)
  if (!time) return ''
  const day = etDayOf(readAt)
  return `${time}${day && day !== today ? ` on ${dayText(day)}` : ''}`
}

function SectionMissing({ what, section, testId, onRetry }) {
  if (section.state === 'none') {
    return <p className={styles.muted} data-testid={testId}>{what} has no rows for this symbol at the data vendor. That is not the same as zero.</p>
  }
  if (section.state === 'unavailable') {
    return <p className={styles.note} role="status" data-testid={testId}>{unavailableWords(what, section.reason, section.httpStatus)} That is not the same as none.</p>
  }
  return (
    <p className={styles.note} role="status" data-testid={testId}>
      {what} could not be read just now. That is not the same as none.{' '}
      <button type="button" className={styles.linkBtn} onClick={onRetry}>Read it again</button>
    </p>
  )
}

function ReportsTable({ sym, rows }) {
  const max = maxShortOf(rows)
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-short-reports"
        aria-label={`${sym} short interest by FINRA settlement date, newest first, ${rows.length} reports`}>
        <caption className={styles.caption}>Short interest by report</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.phoneWrap} title="The settlement date FINRA collected the report for">Settlement date</th>
            <th scope="col" className={styles.phoneWrap} title="Shares sold short and not yet bought back on the settlement date. The bar is the share of the biggest report shown.">Short interest</th>
            <th scope="col" title="The change from the report before, in percent and in shares">Change</th>
            <th scope="col" className={styles.phoneWrap} title="Short interest divided by the average daily volume, as the data vendor works it out">Days to cover</th>
            <th scope="col" className={styles.phoneHide} title="The average daily volume the days to cover are worked out from">Avg daily volume</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const way = changeWay(r)
            const width = barShare(r.short, max)
            return (
              <tr key={r.date} data-testid={`terminal-short-report-${r.date}`} data-way={way || 'none'}>
                <td>{day(r.date)}</td>
                <td>
                  <span className={own.meterCell}>
                    {width != null ? (
                      <span className={own.meter} aria-hidden="true"><span className={own.fill} style={{ width: `${width}%` }} /></span>
                    ) : null}
                    <span className={own.value}>{shares(r.short)}</span>
                  </span>
                </td>
                <td>
                  {way == null ? <span className={styles.muted}>First report</span> : (
                    <>
                      {way === 'flat' ? 'Unchanged' : r.changePct != null ? signedPct(r.changePct) : 'No percent'}
                      <br />
                      <span className={styles.muted}>{signedShares(r.changeShares)}</span>
                    </>
                  )}
                </td>
                <td>{days(r.dtc)}</td>
                <td className={styles.phoneHide}>{shares(r.adv)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function VolumeTable({ sym, rows }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-short-volume"
        aria-label={`${sym} daily off-exchange short volume, newest first, ${rows.length} days`}>
        <caption className={styles.caption}>Daily short volume, off-exchange trades only</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col" className={styles.phoneWrap} title="Short sale volume as a percent of the total volume reported to FINRA from off-exchange venues that day. Not short interest.">Short share of volume</th>
            <th scope="col" className={styles.phoneWrap} title="Shares sold short in off-exchange trades that day">Short volume</th>
            <th scope="col" className={styles.phoneHide} title="Total off-exchange volume reported to FINRA that day">Total volume</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const width = barShare(r.ratio, 100)
            return (
              <tr key={r.date} data-testid={`terminal-short-day-${r.date}`}>
                <td>{day(r.date)}</td>
                <td>
                  <span className={own.meterCell}>
                    {width != null ? (
                      <span className={own.meter} aria-hidden="true"><span className={own.fill} style={{ width: `${width}%` }} /></span>
                    ) : null}
                    <span className={own.value}>{pct(r.ratio)}</span>
                  </span>
                </td>
                <td>{shares(r.short)}</td>
                <td className={styles.phoneHide}>{shares(r.total)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ShortInterestBody({ sym: s, code }) {
  const inPanel = useInTerminalPanel()
  const [today] = useState(todayIso)
  const [moreReports, setMoreReports] = useState(false)
  const [allDays, setAllDays] = useState(false)
  const [pace, setPace] = useState(HELD_POLL_MS)
  const read = useMarketRead(shortDataUrl(s), { refreshInterval: pace })
  const view = useMemo(() => shortDataRead(read.body), [read.body])
  // The pace follows the server's own word: still working, replacing an old answer, or holding one
  // (adjusted during render from the last answer, so there is no extra pass through an old value).
  const wantPace = view.state === 'computing' ? COMPUTING_POLL_MS : view.state === 'ok' && view.refreshing ? REFRESHING_POLL_MS : HELD_POLL_MS
  if (wantPace !== pace) setPace(wantPace)

  const ok = !read.loading && !!read.body && view.state === 'ok'
  const dated = ok && (view.interest.rows.length || view.volume.rows.length)
  usePanelFreshness(dated ? panelAsOf(SOURCE, view.settlementDate || view.volume.rows[0]?.date || null) : null)

  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-short" data-state={state} data-sym={s}>{body}</div>
  )
  if (read.loading) return <PanelSkeleton label={`Loading short interest for ${s}`} testId="terminal-short-loading" />
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    const locked = err ? !canRetry(err) : false
    return (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-short-error"
        title={err ? failureText(err, WHAT) : `${WHAT} for ${s} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no short interest. Retry, or run ${s} ${code} again.`}
      </PanelState>
    )
  }
  if (view.state === 'computing') {
    return wrap('computing', (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-short-computing">
        The server is reading the FINRA reports for {s} from the data vendor. That usually takes a few seconds. This panel
        asks again every 3 seconds and fills in on its own. That is not the same as no short interest.
      </PanelState>
    ))
  }
  if (view.state === 'bad-symbol') {
    return wrap('bad-symbol', (
      <PanelState kind="input" testId="terminal-short-bad-symbol" title={`${s} is not a stock or fund symbol this screen can read.`}>
        Short interest is reported for US stocks and funds. Type one first, e.g. <kbd>NVDA {code}</kbd>
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    return wrap('unavailable', (
      <PanelState kind="locked" role="status" testId="terminal-short-unavailable" title={unavailableWords(WHAT, view.reason, view.httpStatus)}>
        The site reads FINRA short interest and short volume through its stock-data vendor, Massive,{' '}
        {view.reason === 'not_configured' ? 'and this server has no key for it' : 'and the vendor did not allow it'}. That is
        not the same as no short interest. The server asks again by itself in a few hours; nothing here needs a retry.
        Holders, float and insider activity for {s} are on{' '}
        <PanelCommand cmd={`${s} OWN`} label={`Ownership (OWN) for ${s}`}>Ownership (OWN)</PanelCommand>; its short
        interest card reads this same record, so it is not available there either.
      </PanelState>
    ))
  }

  const { interest, volume } = view
  const latest = interest.latest
  const reports = interest.rows.slice(0, moreReports ? REPORTS_MORE : REPORTS_SHOWN)
  const volDays = volume.rows.slice(0, allDays ? volume.rows.length : VOLUME_DAYS_SHOWN)
  const ratios = ratioSummary(volume.rows)
  const noFloat = floatWords(view.float)
  return wrap('ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-short-stale-read">{failureText(read.error, WHAT)} Showing the last read.</p> : null}
      {interest.state === 'ok' ? (
        <>
          <p className={styles.lede} data-testid="terminal-short-headline">
            {latestSentence(s, latest)} {ageSentence(latest.date, today, view.publicationEstimate)}
          </p>
          <dl className={styles.fields} data-testid="terminal-short-fields">
            <div style={{ display: 'contents' }}>
              <dt>Short interest</dt>
              <dd>{count(latest.short)} shares, settlement date {dayText(latest.date)}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>Days to cover</dt>
              <dd>
                {latest.dtc != null ? `${days(latest.dtc)} days` : NA}
                {latest.adv != null ? ` at an average daily volume of ${shares(latest.adv)} shares` : ''}
              </dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>Since the last report</dt>
              <dd data-testid="terminal-short-change">
                {changeWay(latest) == null ? 'No earlier report'
                  : changeWay(latest) === 'flat' ? 'Unchanged'
                    : `${signedShares(latest.changeShares)} shares${latest.changePct != null ? ` (${signedPct(latest.changePct)})` : ''}`}
                {interest.rows[1] ? `, from ${dayText(interest.rows[1].date)}` : ''}
              </dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>Percent of float</dt>
              <dd data-testid="terminal-short-float">
                {noFloat || `${pct(view.float.pct)} of a float of ${shares(view.float.shares)} shares (today's float, from the nightly screener export)`}
              </dd>
            </div>
          </dl>
          <ReportsTable sym={s} rows={reports} />
          <div className={styles.toolbar}>
            {interest.rows.length > REPORTS_SHOWN ? (
              <button type="button" className={styles.chip} aria-pressed={moreReports} onClick={() => setMoreReports((v) => !v)} data-testid="terminal-short-more-reports">
                {moreReports ? `Show ${count(REPORTS_SHOWN)}` : `Show ${count(Math.min(REPORTS_MORE, interest.rows.length))}`}
              </button>
            ) : null}
            <span className={styles.muted} data-testid="terminal-short-reports-count">
              Showing the newest {count(reports.length)} of {count(interest.rows.length)} {plural(interest.rows.length, 'report', 'reports')} on file
              {interest.firstDate ? `, which go back to ${dayText(interest.firstDate)}` : ''}
              {interest.cut ? '. Older reports exist at the data vendor and were not read' : ''}.
            </span>
          </div>
        </>
      ) : <SectionMissing what={WHAT} section={interest} testId="terminal-short-interest-missing" onRetry={read.retry} />}

      {volume.state === 'ok' ? (
        <>
          <p className={styles.note} role="note" data-testid="terminal-short-volume-caution">
            Daily short volume is not short interest. It is the share of each day&apos;s off-exchange volume that was short
            sales; most of it is bought back the same day.
          </p>
          {ratios ? (
            <p className={styles.lede} data-testid="terminal-short-volume-summary">
              Over the last {count(ratios.n)} {plural(ratios.n, 'session', 'sessions')} on file, short sales were {pct(ratios.avg)} of {s}&apos;s
              off-exchange volume on average (lowest {pct(ratios.low)}, highest {pct(ratios.high)}).
            </p>
          ) : null}
          <VolumeTable sym={s} rows={volDays} />
          {volume.rows.length > VOLUME_DAYS_SHOWN ? (
            <div className={styles.toolbar}>
              <button type="button" className={styles.chip} aria-pressed={allDays} onClick={() => setAllDays((v) => !v)} data-testid="terminal-short-more-days">
                {allDays ? `Show ${count(VOLUME_DAYS_SHOWN)}` : `Show all ${count(volume.rows.length)}`}
              </button>
              <span className={styles.muted}>Showing the newest {count(volDays.length)} of {count(volume.rows.length)} trading days read.</span>
            </div>
          ) : null}
        </>
      ) : <SectionMissing what="Daily short volume" section={volume} testId="terminal-short-volume-missing" onRetry={read.retry} />}

      <p className={styles.muted} data-testid="terminal-short-links">
        Also for {s}:{' '}
        <PanelCommand cmd={`${s} OWN`} label={`Ownership (OWN) for ${s}`}>Ownership (OWN)</PanelCommand>. For the whole market:{' '}
        <PanelCommand cmd="SHRTS" label="Open the short interest list">Short interest list (SHRTS)</PanelCommand>
      </p>
      <ShortDataNotes testId="terminal-short-method">
        {readAtWords(view.readAt, today) ? ` Read from the data vendor at ${readAtWords(view.readAt, today)}${view.refreshing ? ', and being read again now' : ''}; the server keeps a stock's answer for four hours.` : ''}
      </ShortDataNotes>
    </>
  ))
}

export default function ShortInterestPanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase()
  const code = useInTerminalPanel()?.code || SHORT_INTEREST_CODE
  if (!s) {
    return (
      <PanelState kind="input" title={`${code} needs a ticker.`}>
        Type one first, e.g. <kbd>NVDA {code}</kbd>
      </PanelState>
    )
  }
  // Keyed by ticker: a new ticker is a new read, so one stock's numbers are never drawn under another's name.
  return <ShortInterestBody key={s} sym={s} code={code} />
}
