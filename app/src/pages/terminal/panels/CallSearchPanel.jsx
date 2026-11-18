// TSRC: search every indexed earnings call for a word or a phrase (data wave 4).
//
// ⭐ NO NEW ROUTE. `GET /api/earnings/transcript-search` (which calls said it, with the index's
// own excerpt) and `GET /api/earnings/transcript-trend` (the share of calls saying it, month by
// month), both paid, until now only the search box inside the Calendar's transcript panel. The
// pure half (the query check, the excerpt parsing, the trend read) is callSearchModel.js,
// re-exported below.
//
//   TSRC                  the search box        TSRC pricing power    searches for those words
//
// The search runs when the member submits it, never on a keystroke. A symbol loads that company
// into the linked panels; typing its row number does the same.
//
// ⛔ THE TWO READS FAIL APART. A failed trend never blanks the quotes, and the other way round.
// ⛔ AN EMPTY RESULT IS ONLY A FINDING WHEN THE INDEX HOLDS CALLS. The trend read says how many
// calls the index holds and over which months; with none, the panel says the index is empty.
// ⛔ THE QUOTE IS THE SERVER'S OWN SHORT EXCERPT, shown as text (never as HTML) and never longer.
// The index does not record who was speaking, so no speaker is shown.
//
// CALL ALERTS: on a result the member can save the search as a keyword alert (CallAlertSave.jsx
// over the existing `/api/earnings/keyword-alerts` routes), and is told how an alert reaches them.
//
// The reads go through marketRead.js (the terminal's one bare-SWR reader). Nothing here polls.
import { useId, useMemo, useState } from 'react'
import Input from '../../../components/ui/Input'
import FieldError from '../../../components/ui/FieldError'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import CallAlertSave, { CallAlertNotes } from './CallAlertSave'
import {
  CALL_SEARCH_CODE, MAX_QUERY, MIN_MONTH_CALLS, TREND_WORDS, callQuery, callSearchCommandArgs, callSearchUrl, callTrendUrl,
  monthLabel, quarterText, searchRead, trendRead, trendVerdict,
} from './callSearchModel'
import styles from './marketPanels.module.css'
import bars from './barCells.module.css'
import form from './panelForm.module.css'

export {
  CALL_SEARCH_CODE, MAX_QUERY, MIN_MONTH_CALLS, MIN_QUERY, SEARCH_LIMIT, TREND_MONTHS, TREND_WORDS, callDay, callQuery,
  callSearchCommandArgs, callSearchUrl, callTrendUrl, monthLabel, parseCallQuery, parseSnippet, quarterText, searchRead, trendRead,
  trendVerdict,
} from './callSearchModel'

const SOURCE = 'UCT earnings call index (recent call transcripts)'
const NA = 'n/a'
/** A hyphen that never breaks a line, so a date stays whole in a narrow cell. */
const unbroken = (s) => String(s).replace(/-/g, '‑')
const count = (n) => formatNumber(n, { decimals: 0 })
const share = (v) => formatPercent(v, { decimals: 1, absent: NA })
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')
const plural = (n, one, many) => (n === 1 ? one : many)

/** Pure: the sentence that says whether the theme is rising or fading, with the numbers it stands on. */
export function verdictSentence(verdict) {
  if (!verdict || verdict.kind === 'thin' || !verdict.latest || !verdict.earlier) {
    return `${TREND_WORDS.thin}: fewer than two months have ${MIN_MONTH_CALLS} or more indexed calls to compare.`
  }
  const { latest, earlier } = verdict
  const span = earlier.from === earlier.to ? earlier.from : `${earlier.from} to ${earlier.to}`
  return `${TREND_WORDS[verdict.kind]}: ${share(latest.share)} of calls in ${latest.label} (${count(latest.calls)} calls) `
    + `against ${share(earlier.share)} across ${span} (${count(earlier.calls)} calls).`
}

/** Pure: what the index holds, in a sentence, from the trend read. */
export function indexSpanSentence(trend) {
  if (!trend || trend.state !== 'ok') return ''
  if (!trend.callsIndexed) return 'The index holds no calls right now.'
  const from = monthLabel(trend.firstMonth)
  const to = monthLabel(trend.lastMonth)
  return `The index holds ${count(trend.callsIndexed)} ${plural(trend.callsIndexed, 'call', 'calls')} from ${from === to ? from : `${from} to ${to}`}.`
}

function Trend({ q, read, view, code }) {
  if (read.loading) return <p className={styles.lede} role="status" data-testid="terminal-tsrc-trend-loading">Reading how often calls say it, month by month.</p>
  if ((read.error && !read.body) || view.state !== 'ok') {
    const err = read.body ? null : read.error
    return (
      <p className={styles.note} role="status" data-testid="terminal-tsrc-trend-error">
        {err ? failureText(err, 'The month by month count') : 'The month by month count could not be read just now.'} So this panel
        cannot say whether the theme is rising or fading, or how many calls the index holds.{' '}
        {!err || canRetry(err) ? <button type="button" className={styles.linkBtn} onClick={read.retry}>Retry the count</button> : null}
      </p>
    )
  }
  if (!view.months.length) return null   // an empty index: said once, by the results block
  const verdict = trendVerdict(view.months)
  const peak = Math.max(...view.months.map((m) => m.share ?? 0), 0)
  return (
    <>
      <p className={styles.lede} data-testid="terminal-tsrc-verdict" data-trend={verdict.kind}>{verdictSentence(verdict)}</p>
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-tsrc-trend" aria-label={`Share of indexed earnings calls that mention ${q}, by month`}>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col" title="Calls in the index for that month that match, out of all calls in the index for that month">Calls that say it</th>
              <th scope="col" title="Matching calls as a share of the calls indexed that month">Share of calls</th>
            </tr>
          </thead>
          <tbody>
            {view.months.map((m) => (
              <tr key={m.month} data-testid={`terminal-tsrc-month-${m.month}`}>
                <td>{m.label}</td>
                <td>{count(m.mentions)} of {count(m.calls)}</td>
                <td>
                  <div className={bars.barRow}>
                    <span className={bars.track} aria-hidden="true">
                      <span className={`${bars.bar} ${form.barFill}`} style={{ width: `${peak > 0 && m.share ? Math.round((m.share / peak) * 1000) / 10 : 0}%` }} />
                    </span>
                    <span className={bars.value}>{share(m.share)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted} data-testid="terminal-tsrc-trend-method">
        A share, not a count: calls bunch up in earnings season, so a raw count would rise every quarter whatever the
        theme is doing. The bars are drawn against the highest month shown. Rising or fading is worked out in this
        panel from these rows: the latest month with {MIN_MONTH_CALLS} or more indexed calls against the earlier such
        months taken together. A month still in progress can move as more calls are indexed. Run {code} again to
        refresh.
      </p>
    </>
  )
}

function Results({ q, code }) {
  const searchQ = useMarketRead(callSearchUrl(q))
  const trendQ = useMarketRead(callTrendUrl(q))
  const view = useMemo(() => searchRead(searchQ.body), [searchQ.body])
  const trend = useMemo(() => trendRead(trendQ.body), [trendQ.body])
  const listed = view.state === 'ok' ? view.hits : []
  // Neither route sends an as-of of its own, so the header names the source alone (it reads as undated).
  usePanelFreshness(listed.length ? panelAsOf(SOURCE) : null)
  usePanelSymbolRows(listed.map((h) => h.sym), `calls that mention ${q}`, { total: view.total })

  if (searchQ.loading) return <PanelSkeleton label={`Searching every indexed earnings call for ${q}`} testId="terminal-tsrc-loading" />

  const trendBlock = <Trend q={q} read={trendQ} view={trend} code={code} />
  const span = indexSpanSentence(trend)
  const indexEmpty = trend.state === 'ok' && trend.callsIndexed === 0

  let results
  // The month by month block is left out where it could only repeat the problem (a query the server cannot read).
  let withTrend = true
  // Saving the search as a call alert is offered only on a search the index read and answered:
  // above the quotes when there are some, under the finding when no call said it yet.
  let withAlert = false
  const alertSave = <CallAlertSave q={q} />
  if ((searchQ.error && !searchQ.body) || view.state === 'failed' || view.state === 'unavailable') {
    const err = searchQ.body ? null : searchQ.error
    const locked = err ? !canRetry(err) : false
    results = (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-tsrc-error"
        title={err ? failureText(err, 'The call search') : 'The call search could not be read just now.'}
        action={locked ? null : <button type="button" className={styles.chip} onClick={searchQ.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no call saying it. Retry, or run ${code} ${q} again.`}
      </PanelState>
    )
    // A paywall or a signed-out read is the whole answer: the trend read was refused the same way.
    if (err && (locked || err.status === 401)) return results
  } else if (view.state === 'bad-query') {
    withTrend = false
    results = (
      <PanelState kind="input" role="status" testId="terminal-tsrc-bad-query" title="The search could not read that query.">
        {view.message} Change it above and search again.
      </PanelState>
    )
  } else if (view.state === 'syntax' || view.state === 'no-words') {
    withTrend = false
    results = (
      <PanelState kind="input" role="status" testId="terminal-tsrc-bad-query"
        title={view.state === 'syntax' ? 'The index could not read a symbol in that search.' : 'Nothing in that search can be looked up.'}>
        Use plain words, or one exact phrase in double quotes, e.g. <kbd>{code} &quot;pricing power&quot;</kbd>
      </PanelState>
    )
  } else if (!view.hits.length) {
    withAlert = !indexEmpty
    results = indexEmpty ? (
      <PanelState kind="error" role="status" testId="terminal-tsrc-index-empty" title="The call index holds no calls right now."
        action={<button type="button" className={styles.chip} onClick={() => { searchQ.retry(); trendQ.retry() }}>Check again</button>}>
        So nothing can be found in it. That is a gap on our side, not a finding about what companies said.
      </PanelState>
    ) : (
      <PanelState kind="empty" testId="terminal-tsrc-empty" title={`No indexed earnings call mentions ${q}.`}
        action={<button type="button" className={styles.chip} onClick={() => { searchQ.retry(); trendQ.retry() }}>Check again</button>}>
        {span ? `${span} ` : ''}Only recent calls are indexed, so an older call that said it is not counted. The search
        also finds other endings of a word (tariff finds tariffs).
      </PanelState>
    )
  } else {
    withAlert = true
    results = (
      <>
        {searchQ.error && <p className={styles.note} role="status">{failureText(searchQ.error, 'The call search')} Showing the last read.</p>}
        <div className={styles.head}>
          <span className={styles.lede} data-testid="terminal-tsrc-totals">
            {count(view.total)} {plural(view.total, 'call mentions', 'calls mention')} {q}.{span ? ` ${span}` : ''}
          </span>
        </div>
        {view.cut ? (
          <p className={styles.note} role="status" data-testid="terminal-tsrc-cut">
            Showing the {count(view.hits.length)} calls that match best of {count(view.total)}. The server ranks by how much a
            call dwells on the words, so the calls left out are the weakest matches, not the oldest.
          </p>
        ) : null}
        {alertSave}
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-tsrc-table"
            aria-label={`Earnings calls that mention ${q}, best match first, ${view.hits.length} of ${view.total}`}>
            <thead>
              <tr>
                <th scope="col" title="Click a symbol to load it into the linked panels">Symbol</th>
                <th scope="col" className={styles.wrapCell} title="The company's fiscal quarter the call was for, and the date of the call">Call</th>
                <th scope="col" className={styles.wrapCell} title="The index's own short excerpt around the match; the matched words are bold and underlined">Quote</th>
              </tr>
            </thead>
            <tbody>
              {view.hits.map((h, i) => (
                <tr key={h.key} data-testid={`terminal-tsrc-row-${h.sym}`}>
                  <td>
                    <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                    <PanelSymbol sym={h.sym} className={styles.sym} />
                  </td>
                  <td className={styles.wrapCell}>
                    {quarterText(h)}
                    <span className={styles.muted}>{h.day ? `, ${unbroken(h.day)}` : ', date not given'}</span>
                  </td>
                  <td className={styles.wrapCell}>
                    <p className={form.quote}>
                      {h.parts.map((p, j) => (p.hit
                        ? <mark key={j} className={form.mark}>{p.text}</mark>
                        : <span key={j}>{p.text}</span>))}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {view.expanded.length ? (
          <p className={styles.muted} data-testid="terminal-tsrc-expanded">
            Also searched: {view.expanded.map((e) => `${e.word} as ${e.also.join(', ')}`).join('; ')}.
          </p>
        ) : null}
        {view.notes.map((n) => <p key={n} className={styles.muted} data-testid="terminal-tsrc-note">{n}</p>)}
      </>
    )
  }

  return (
    <>
      {results}
      {withAlert && !listed.length ? alertSave : null}
      {withTrend ? trendBlock : null}
      <p className={styles.muted} data-testid="terminal-tsrc-method">
        One row per earnings call, best match first. The quote is the index&apos;s own short excerpt around the match,
        from a third-party transcript; an ellipsis marks where it skips. The transcript is stored as one text, so this
        panel cannot say who was speaking. To read a whole call, run Transcripts on the company, e.g. <kbd>NVDA TRAN</kbd>.
        A quote says what was said, not what the stock will do. Click a symbol to load it into the linked panels; type
        a row number to do the same.
        {searchQ.receivedAt ? ` Read at ${clock(searchQ.receivedAt)}.` : ''}
      </p>
      {withAlert ? <CallAlertNotes /> : null}
    </>
  )
}

export default function CallSearchPanel({ q: qProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const ids = useId()
  const code = inPanel?.code || CALL_SEARCH_CODE
  // A new `TSRC tariff` remounts the panel (the shell keys the body on code + args), so the typed
  // words only ever seed the state.
  // Words typed after the code that cannot be searched (one letter, say) stay in the box with the reason.
  const [seed] = useState(() => ({ typed: String(qProp ?? '').replace(/\s+/g, ' ').trim(), read: callQuery(qProp) }))
  const [q, setQ] = useState(() => (seed.read.ok ? seed.read.q : null))
  const [draft, setDraft] = useState(() => (seed.read.ok ? seed.read.q : seed.typed))
  const [formError, setFormError] = useState(() => (seed.typed && !seed.read.ok ? seed.read.message : null))

  // Search on submit only: one request per search, never one per keystroke. The words are written
  // into the command (`TSRC pricing power`) where the registry takes them, so a reload keeps them.
  const submit = (e) => {
    e.preventDefault()
    const next = callQuery(draft)
    if (!next.ok) { setFormError(next.message); return }
    setFormError(null)
    setDraft(next.q)
    setQ(next.q)
    writeBack(callSearchCommandArgs({ q: next.q }))
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-tsrc" data-query={q || ''}>
      <form className={form.form} onSubmit={submit} noValidate role="search" aria-label="Search every earnings call" data-testid="terminal-tsrc-form">
        <label className={form.field} htmlFor={`${ids}-q`}>Word or phrase</label>
        <Input id={`${ids}-q`} type="search" className={`${form.input} ${form.grow}`} value={draft} maxLength={MAX_QUERY}
          autoComplete="off" spellCheck={false} placeholder="tariff, or &quot;pricing power&quot;" error={formError}
          onChange={(e) => setDraft(e.target.value)} data-testid="terminal-tsrc-input" />
        <button type="submit" className={styles.chip} data-testid="terminal-tsrc-submit">Search</button>
        <FieldError forId={`${ids}-q`} className={form.error} data-testid="terminal-tsrc-form-error">{formError}</FieldError>
      </form>
      {q ? (
        // Keyed by the query: a new search is a new pair of reads, so one word's quotes are never drawn under another's.
        <Results key={q} q={q} code={code} />
      ) : (
        <PanelState kind="input" role="status" testId="terminal-tsrc-idle" title="Type a word or a phrase to search every indexed earnings call.">
          You get the companies whose calls said it, a short quote from each, and whether the theme is rising or fading
          across calls. Or type it after the code, e.g. <kbd>{code} tariff</kbd>. Not sure what to search for? See{' '}
          <PanelCommand cmd="CEOS" label="Open what CEOs are saying">what is rising across calls (CEOS)</PanelCommand>.
        </PanelState>
      )}
    </div>
  )
}
