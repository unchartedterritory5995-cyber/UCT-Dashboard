// DILU: the dilution watch. What one company has filed with the SEC that bears on selling new
// shares: shelf registrations and when they took effect, prospectus supplements, new
// registrations and unregistered sales, for the last three years. `NVDA DILU`.
//
// `GET /api/research/dilution-watch/{sym}` (paid; api/services/dilution_watch.py). The server reads
// the company's public SEC EDGAR filing index and never builds on the request: an answer it has not
// put together yet says "computing" and this panel asks again. The pure half is dilutionModel.js,
// re-exported below.
//
// What it adds to the panels already in the terminal: CF lists a company's filings and FSRC
// searches their text. Neither answers the trader's question directly: can this company sell
// stock, and has it been? This is that answer, as far as the filing index gives it.
//
// ⛔ NOTHING HERE SAYS MORE THAN THE FILING INDEX DOES. No share counts, no dollar amounts, and
// never that a company "will" sell. Every sentence says what was FILED, and when.
// ⛔ "LIVE" IS AN ESTIMATE FROM DATES, and it is said as one wherever it is used.
// ⛔ WHAT THE PANEL DOES NOT KNOW IS ALWAYS ON SCREEN WITH WHAT IT DOES.
// ⛔ A REFUSAL OR A RATE LIMIT BY THE SEC IS AN ANSWER, in plain words. Neither is "no filings".
// ⛔ NO GREEN OR RED. Whether a filing is good or bad news is the trader's judgement.
//
// WIDTH. Three columns: the day, the form (the link to sec.gov) and what it is, which wraps inside
// its own cell. Nothing folds away at any width, so the table names no fold step.
//
// The read goes through marketRead.js (the terminal's one bare-SWR reader), and SWR skips ticks
// while the app is hidden.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { formatNumber, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { todayIso } from '../../calendar/earningsModalRow'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  DILUTION_CODE, ROWS_SHOWN, SHELVES_SHOWN, SOURCE, dayText, dilutionRead, dilutionUrl, etDayOf, failedWords,
  horizonWords, minorCount, notesFor, rowDetail, rowsFor, shelfSentence, summarySentences, unavailableWords,
} from './dilutionModel'
import styles from './marketPanels.module.css'

export {
  DILUTION_CODE, KIND_NOTES, MINOR_KINDS, ROWS_SHOWN, SHELVES_SHOWN, SOURCE, dayText, dilutionRead, dilutionUrl, etDayOf, failedWords,
  horizonWords, liveShelfSentence, minorCount, notesFor, offeringsSentence, rowDetail, rowsFor, secUrl, shelfSentence,
  summarySentences, unavailableWords,
} from './dilutionModel'

const WHAT = 'SEC filings'
const COMPUTING_POLL_MS = 3 * 1000
const REFRESHING_POLL_MS = 15 * 1000
/** A refusal or a rate limit is held by the server for 15 minutes; the panel looks again by itself. */
const BLOCKED_POLL_MS = 5 * 60 * 1000
/** A filing can arrive at any hour; the server holds a company's answer for an hour. */
const HELD_POLL_MS = 30 * 60 * 1000
/** A hyphen and a space that never break a line, so a date or a form name stays whole in a narrow cell. */
const unbroken = (s) => String(s).replace(/-/g, String.fromCharCode(0x2011)).replace(/ /g, String.fromCharCode(0x00a0))
const count = (n) => formatNumber(n, { decimals: 0 })
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')
const plural = (n, one, many) => (n === 1 ? one : many)
const day = (iso) => unbroken(dayText(iso))
const LEFT = { textAlign: 'left' }

/** Pure: when the site read the SEC, in words: the time, and the day when it was not today ('' with no time). */
export function readAtWords(readAt, today) {
  const time = clock(readAt)
  if (!time) return ''
  const d = etDayOf(readAt)
  return `${time}${d && d !== today ? ` on ${dayText(d)}` : ''}`
}

/** Pure: the shelf registrations in a few words for the facts list. */
export function shelfWords(view) {
  const { liveShelves, pendingShelves } = view.summary
  const pending = pendingShelves ? `${count(pendingShelves)} filed with no SEC notice that it took effect yet` : ''
  if (liveShelves) {
    return `${count(liveShelves)} ${plural(liveShelves, 'appears', 'appear')} to be live (an estimate from the dates)${pending ? `; ${pending}` : ''}`
  }
  if (pending) return `None appears to be live; ${pending}`
  return view.coverage.complete ? `None appears to be live in the last ${view.window.years} years` : 'None appears in the filings read'
}

/** A form's name as the link to its filing on sec.gov (plain text when the row has no address there). */
function FilingLink({ form, url, date }) {
  if (!url) return <span>{unbroken(form)}</span>
  return (
    <a className={styles.linkBtn} href={url} target="_blank" rel="noopener noreferrer"
      aria-label={`${form} filed ${dayText(date)}, opens on sec.gov in a new tab`}>
      {unbroken(form)}
    </a>
  )
}

function Timeline({ sym, rows }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-dilution-table"
        aria-label={`${sym} share-issuance filings with the SEC, newest first, ${rows.length} ${plural(rows.length, 'filing', 'filings')}`}>
        <caption className={styles.caption}>Filings, newest first</caption>
        <thead>
          <tr>
            <th scope="col" title="The day the filing was made with the SEC">Filed</th>
            <th scope="col" style={LEFT} title="The SEC's form type. The link opens the filing on sec.gov.">Form</th>
            <th scope="col" className={styles.wrapCell} title="What the form is, and the registration it was filed under where the index says">What it is</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const detail = rowDetail(r)
            return (
              <tr key={r.accession || `${r.date}-${r.form}`} data-testid="terminal-dilution-row" data-kind={r.kind} data-date={r.date}>
                <td>{day(r.date)}</td>
                <td style={LEFT}><FilingLink form={r.form} url={r.url} date={r.date} /></td>
                <td className={styles.wrapCell}>
                  {r.what}
                  {detail ? (<><br /><span className={styles.muted}>{detail}</span></>) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** What the panel does not know, and where the documents are. Always on screen with the answer. */
function Notes({ sym, view, today }) {
  const read = readAtWords(view.readAt, today)
  return (
    <p className={styles.muted} data-testid="terminal-dilution-notes">
      Source: {SOURCE}, the company&apos;s public filing index.
      {view.newestFiling ? ` The newest filing of any kind in it is dated ${dayText(view.newestFiling)}.` : ''}
      {read ? ` The site read it at ${read}${view.refreshing ? ', and is reading it again now' : ''}; the server keeps a company's answer for an hour.` : ''}
      {' '}What this panel does not know: how many shares or dollars a filing covers, how much of a shelf has been used,
      whether a filing is for common stock, preferred stock, notes or warrants, whether a shelf is for the company or for
      holders who are selling, and what a proxy statement proposes (more authorized shares, a reverse split). The filing
      documents are not read; only the index is. &quot;Live&quot; is worked out from dates alone: a company&apos;s own shelf may
      be used for {view.shelfLifeYears} years after it takes effect (one that only registers holders&apos; sales can run
      longer), and the index does not show a shelf that was used up or replaced sooner. Funds and trusts that issue
      shares all the time file these same forms as routine. For the documents:{' '}
      <PanelCommand cmd={`${sym} CF`} label={`SEC filings (CF) for ${sym}`}>SEC filings (CF)</PanelCommand>,{' '}
      <PanelCommand cmd={`${sym} FSRC`} label={`Filing full-text search (FSRC) for ${sym}`}>Filing search (FSRC)</PanelCommand>.
      A filing is marked by its form and a few words; color is not used.
    </p>
  )
}

function DilutionBody({ sym: s, code }) {
  const inPanel = useInTerminalPanel()
  const [today] = useState(todayIso)
  const [allRows, setAllRows] = useState(false)
  const [withMinor, setWithMinor] = useState(false)
  const [pace, setPace] = useState(HELD_POLL_MS)
  const read = useMarketRead(dilutionUrl(s), { refreshInterval: pace })
  const view = useMemo(() => dilutionRead(read.body), [read.body])
  // The pace follows the server's own word: still working, replacing an old answer, waiting out a
  // refusal, or holding an answer (adjusted during render from the last answer).
  const blocked = view.state === 'unavailable' || (view.state === 'failed' && view.reason === 'rate_limited')
  const wantPace = view.state === 'computing' ? COMPUTING_POLL_MS
    : view.state === 'ok' && view.refreshing ? REFRESHING_POLL_MS : blocked ? BLOCKED_POLL_MS : HELD_POLL_MS
  if (wantPace !== pace) setPace(wantPace)

  const ok = !read.loading && !!read.body && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(SOURCE, view.newestFiling) : null)

  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-dilution" data-state={state} data-sym={s}>{body}</div>
  )
  if (read.loading) return <PanelSkeleton label={`Loading SEC filings for ${s}`} testId="terminal-dilution-loading" />
  if (!read.body) {
    const locked = !canRetry(read.error)
    return (
      <PanelState kind={failureKind(read.error)} testId="terminal-dilution-error" title={failureText(read.error, WHAT)}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no filings. Retry, or run ${s} ${code} again.`}
      </PanelState>
    )
  }
  if (view.state === 'failed') {
    const words = failedWords(view.reason, s, `${s} ${code}`)
    return wrap('failed', (
      <PanelState kind={words.retry ? 'error' : 'locked'} role={words.retry ? undefined : 'status'} testId="terminal-dilution-failed"
        title={words.title} action={words.retry ? <button type="button" className={styles.chip} onClick={read.retry}>Retry</button> : null}>
        {words.hint}
      </PanelState>
    ))
  }
  if (view.state === 'computing') {
    return wrap('computing', (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-dilution-computing">
        The server is reading the SEC&apos;s filing index for {s}. That usually takes a few seconds. This panel asks again
        every 3 seconds and fills in on its own. That is not the same as no filings.
      </PanelState>
    ))
  }
  if (view.state === 'bad-symbol') {
    return wrap('bad-symbol', (
      <PanelState kind="input" testId="terminal-dilution-bad-symbol" title={`${s} is not a stock symbol this screen can read.`}>
        The dilution watch reads the SEC filings of one US-listed company. Type its ticker first, e.g. <kbd>NVDA {code}</kbd>
      </PanelState>
    ))
  }
  if (view.state === 'none') {
    return wrap('none', (
      <PanelState kind="empty" role="status" testId="terminal-dilution-none"
        title={view.reason === 'no_filings' ? `The SEC's filing index lists no filing for ${s}.` : `The SEC's company list has no filer for ${s}.`}>
        {view.reason === 'no_filings'
          ? 'The SEC has a company number for this symbol and no filings under it. '
          : 'That is common for funds, ETFs and some foreign listings. It is not a statement that the company has filed nothing. '}
        This screen is about operating companies that file with the SEC.
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    return wrap('unavailable', (
      <PanelState kind="locked" role="status" testId="terminal-dilution-unavailable" title={unavailableWords(view.reason, view.httpStatus)}>
        The site reads the SEC&apos;s public filing index{view.reason === 'shape' ? '' : ", and the SEC's website did not let the server in"}.
        That is not the same as no filings. The server asks again by itself in about 15 minutes; nothing here needs a
        retry. The filings themselves are on{' '}
        <PanelCommand cmd={`${s} CF`} label={`SEC filings (CF) for ${s}`}>SEC filings (CF)</PanelCommand>.
      </PanelState>
    ))
  }

  const minors = minorCount(view.rows)
  const listed = rowsFor(view.rows, withMinor)
  const rows = listed.slice(0, allRows ? listed.length : ROWS_SHOWN)
  const shelves = view.shelves.slice(0, SHELVES_SHOWN)
  const notes = notesFor(rows)
  const { offerings, unregistered } = view.summary
  return wrap('ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-dilution-stale-read">{failureText(read.error, WHAT)} Showing the last read.</p> : null}
      {view.fundLike ? (
        <p className={styles.note} role="note" data-testid="terminal-dilution-fund">
          The SEC&apos;s index shows {s} files as a fund. This screen is written for operating companies: a fund registers and
          issues shares as routine, so these filings do not mean for it what they mean for a company.
        </p>
      ) : null}
      {!view.coverage.complete ? (
        <p className={styles.note} role="status" data-testid="terminal-dilution-coverage">
          {s} files so often that the server read its filing index back only to{' '}
          {view.coverage.from ? dayText(view.coverage.from) : 'part of the way'}, not the full {view.window.years} years. A count
          it cannot stand behind is left out, and a shelf filed before that day would not show here.
        </p>
      ) : null}
      <p className={styles.lede} data-testid="terminal-dilution-summary">{summarySentences(s, view).join(' ')}</p>
      <dl className={styles.fields} data-testid="terminal-dilution-fields">
        <div style={{ display: 'contents' }}>
          <dt>Company</dt>
          <dd>{view.company ? `${view.company}, as the SEC names the filer` : 'The SEC index gave no name'}</dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt>Shelf registrations</dt>
          <dd data-testid="terminal-dilution-shelf-fact">{shelfWords(view)}</dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt>Offering documents</dt>
          <dd data-testid="terminal-dilution-offerings-fact">
            {horizonWords(offerings, view)}{offerings.latest ? `; latest ${dayText(offerings.latest)}` : ''}
          </dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt>Unregistered sales</dt>
          <dd data-testid="terminal-dilution-unregistered-fact">
            {horizonWords(unregistered, view)}{unregistered.latest ? `; latest ${dayText(unregistered.latest)}` : ''}
          </dd>
        </div>
      </dl>
      {shelves.length ? (
        <ul className={styles.reasons} data-testid="terminal-dilution-shelves" aria-label={`Shelf registrations filed by ${s}, newest first`}>
          {shelves.map((sh) => (
            <li key={`${sh.fileNumber}-${sh.filed}`} data-testid="terminal-dilution-shelf" data-state={sh.state}>
              <FilingLink form={sh.form} url={sh.url} date={sh.filed} /> filed {dayText(sh.filed)}. {shelfSentence(sh, view.shelfLifeYears)}
            </li>
          ))}
          {view.shelves.length > shelves.length ? (
            <li className={styles.muted}>
              And {count(view.shelves.length - shelves.length)} older shelf {plural(view.shelves.length - shelves.length, 'registration', 'registrations')}, in the timeline below.
            </li>
          ) : null}
        </ul>
      ) : null}
      {rows.length ? <Timeline sym={s} rows={rows} /> : (
        <p className={styles.muted} data-testid="terminal-dilution-no-rows">
          {view.rows.length
            ? 'Nothing to list but employee plan registrations and material agreements, which are listed apart.'
            : `No filing of the kinds this screen reads in the last ${view.window.years} years.`}
        </p>
      )}
      <div className={styles.toolbar}>
        {listed.length > ROWS_SHOWN ? (
          <button type="button" className={styles.chip} aria-pressed={allRows} onClick={() => setAllRows((v) => !v)} data-testid="terminal-dilution-more">
            {allRows ? `Show ${count(ROWS_SHOWN)}` : `Show all ${count(listed.length)}`}
          </button>
        ) : null}
        {minors ? (
          <button type="button" className={styles.chip} aria-pressed={withMinor} onClick={() => setWithMinor((v) => !v)} data-testid="terminal-dilution-minor">
            Also list {count(minors)} employee plan and material agreement {plural(minors, 'filing', 'filings')}
          </button>
        ) : null}
        {listed.length ? (
          <span className={styles.muted} data-testid="terminal-dilution-count">
            Showing the newest {count(rows.length)} of {count(listed.length)} {plural(listed.length, 'filing', 'filings')}
            {view.cut ? `. The server sent the newest ${count(view.rows.length)} of ${count(view.rowsTotal)} in the last ${view.window.years} years; the counts above cover all of them` : ''}.
          </span>
        ) : null}
      </div>
      {notes.length ? (
        <ul className={styles.reasons} data-testid="terminal-dilution-kinds" aria-label="What each kind of filing is">
          {notes.map((n) => (
            <li key={n.kind} className={styles.muted} data-kind={n.kind}>{n.name}. {n.note}</li>
          ))}
        </ul>
      ) : null}
      <Notes sym={s} view={view} today={today} />
    </>
  ))
}

export default function DilutionPanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase()
  const code = useInTerminalPanel()?.code || DILUTION_CODE
  if (!s) {
    return (
      <PanelState kind="input" title={`${code} needs a ticker.`}>
        Type one first, e.g. <kbd>NVDA {code}</kbd>
      </PanelState>
    )
  }
  // Keyed by ticker: a new ticker is a new read, so one company's filings are never drawn under another's name.
  return <DilutionBody key={s} sym={s} code={code} />
}
