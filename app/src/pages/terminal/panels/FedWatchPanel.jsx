// FED: Fed watch. The latest FOMC statement and what changed, live Fed headlines, Fed speeches and
// testimony, this week's Fed speakers, the next meeting and the policy rate, the officials' own rate
// projections, and what market professionals expect. `FED`.
//
// ONE read, `GET /api/research/fed-watch` (paid; api/services/fed_watch.py). The server never
// fetches on the request: it answers what it holds, and a block it is still reading says
// `computing` while this panel asks again every 3 seconds. Otherwise it asks every minute (the
// headlines are live); SWR skips ticks while the app is hidden. The pure half is fedWatchModel.js.
//
// ⛔ EVERY BLOCK FAILS APART and says why in words: a refused source, a page that could not be
// read, a switched-off feed. A failed read is never drawn as "nothing new".
// ⛔ THE REDLINE NEVER LEANS ON COLOUR: added words are underlined, removed words struck through,
// and each run carries hidden words ("added:", "removed:") a screen reader reads.
// ⛔ NOTHING HERE IS A FORECAST BY UCT: the projections are the officials' own, the survey's numbers
// are its respondents', and nothing is summarised by AI.
// ⛔ A MISSING NUMBER IS NEVER 0: "No figure", with the reason.
//
// WIDTH. Lists and two- or three-column tables, which fit a 340px phone with nothing folded.
import { Fragment, useMemo, useState } from 'react'
import { PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  COMPUTING_POLL_MS, FED_CODE, FED_SOURCE, FED_URL, FED_WHAT, HELD_POLL_MS, boardMissingWords, chanceText, fedRead,
  headlineCutWords, headlineDay, holdsToday, instantDay, meetingWords, projectionText, rangeText, rateMissingWords,
  rateText, redlineAlt, redlineParagraphs, redlineSummary, shownBuckets, showsRedline, staleBoardWords, surveyLine, surveyRate,
  weekdayText,
} from './fedWatchModel'
import { dayText } from './ratesModel'
import styles from './marketPanels.module.css'
import own from './fedWatchPanel.module.css'

export { COMPUTING_POLL_MS, FED_CODE, FED_SOURCE, FED_URL, FED_WHAT, HELD_POLL_MS } from './fedWatchModel'

function Ext({ href, children, testId }) {
  if (!href) return null
  return <a className={own.link} href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}>{children}</a>
}

function Section({ title, testId, children, state }) {
  return (
    <section className={own.section} aria-label={title} data-testid={testId} data-state={state}>
      <h3 className={own.title}>{title}</h3>
      {children}
    </section>
  )
}

function Glance({ view }) {
  const { rates, calendar } = view
  const range = rangeText(rates)
  const m = calendar.nextMeeting
  return (
    <Section title="Policy rate and the next meeting" testId="terminal-fed-glance" state={rates.state}>
      <dl className={styles.fields}>
        <dt>Target range</dt>
        <dd data-testid="terminal-fed-range">
          {range
            ? <>{range}{rates.upper.date || rates.lower.date ? <span className={styles.muted}> ({dayText(rates.upper.date || rates.lower.date)})</span> : null}</>
            : <span className={styles.muted}>No figure. {rateMissingWords(rates)}</span>}
        </dd>
        <dt>Effective rate</dt>
        <dd data-testid="terminal-fed-effr">
          {rates.effective.value != null
            ? <>{rateText(rates.effective.value)}{rates.effective.date ? <span className={styles.muted}> ({dayText(rates.effective.date)})</span> : null}</>
            : <span className={styles.muted}>No figure. {rateMissingWords(rates)}</span>}
        </dd>
        <dt>Next FOMC decision</dt>
        <dd data-testid="terminal-fed-next">
          {m.state === 'ok' ? meetingWords(m) : <span className={styles.muted}>{meetingWords(m)}</span>}
        </dd>
      </dl>
      <p className={styles.muted} data-testid="terminal-fed-glance-source">
        Rates: Federal Reserve Bank of New York, through the site&apos;s economic data.
        {m.state === 'ok' && m.source ? ` Next meeting: ${m.source}.` : ''}
        {rates.notice && (rates.effective.value != null || range) ? ` ${rates.notice}` : ''}
      </p>
    </Section>
  )
}

function Redline({ st }) {
  const paras = useMemo(() => redlineParagraphs(st.redline.segments), [st.redline.segments])
  return (
    <div className={own.statement} data-testid="terminal-fed-redline">
      {paras.map((p, i) => (
        <p key={i} className={own.para} data-testid="terminal-fed-redline-para" data-alt={redlineAlt(p)}>
          {p.map((s, j) => {
            const space = j ? ' ' : ''
            if (s.op === 'added') return <span key={j}>{space}<ins className={own.added}><span className="sr-only">added: </span>{s.text}</ins></span>
            if (s.op === 'removed') return <span key={j}>{space}<del className={own.removed}><span className="sr-only">removed: </span>{s.text}</del></span>
            return <span key={j}>{space}{s.text}</span>
          })}
        </p>
      ))}
    </div>
  )
}

function Statement({ st }) {
  let body
  if (st.state === 'ok') {
    body = (
      <>
        <p className={styles.lede} data-testid="terminal-fed-redline-summary">{redlineSummary(st)}</p>
        {showsRedline(st) ? (
          <>
            {st.redline.state === 'ok' ? <p className={own.legend}>Added words are underlined; removed words are struck through.</p> : null}
            <Redline st={st} />
          </>
        ) : (
          <div className={own.statement} data-testid="terminal-fed-statement-text">
            {st.paragraphs.map((p, i) => <p key={i} className={own.para}>{p}</p>)}
          </div>
        )}
      </>
    )
  } else if (st.state === 'none') {
    body = <p className={styles.muted} data-testid="terminal-fed-statement-none">The Board&apos;s monetary policy feed lists no FOMC statement right now.</p>
  } else {
    body = (
      <p className={styles.note} role="status" data-testid="terminal-fed-statement-missing">
        {boardMissingWords(st.state, 'the statement')}{' '}
        {st.url ? <Ext href={st.url}>Read it on the Board&apos;s website</Ext> : null}
      </p>
    )
  }
  const stale = staleBoardWords(st.state, st.check ? [st.check] : [])
  return (
    <Section title={st.date ? `Latest statement: ${dayText(st.date)}` : 'Latest statement'} testId="terminal-fed-statement" state={st.state}>
      {stale ? <p className={styles.note} role="status" data-testid="terminal-fed-statement-stale">{stale}</p> : null}
      {body}
      {st.url || st.implementationNoteUrl || st.minutes ? (
        <div className={own.links} data-testid="terminal-fed-statement-links">
          <Ext href={st.url}>Full statement</Ext>
          <Ext href={st.implementationNoteUrl}>Implementation note</Ext>
          {st.minutes ? <Ext href={st.minutes.url}>{`Minutes${st.minutes.meeting ? ` (${st.minutes.meeting} meeting)` : ''}`}</Ext> : null}
          {st.redline?.previous?.url ? <Ext href={st.redline.previous.url}>{`Statement of ${dayText(st.redline.previous.date) || 'the meeting before'}`}</Ext> : null}
        </div>
      ) : null}
    </Section>
  )
}

function Headlines({ h }) {
  const [today] = useState(() => headlineDay(Date.now()))
  let body
  if (h.state === 'off') body = <p className={styles.muted} data-testid="terminal-fed-headlines-off">The news wire is switched off for this server, so there are no live Fed headlines here.</p>
  else if (h.state === 'not_started') body = <p className={styles.muted} data-testid="terminal-fed-headlines-off">The news wire has not started on the server yet. This fills in once it has.</p>
  else if (h.state !== 'ok') body = <p className={styles.note} role="status" data-testid="terminal-fed-headlines-error">The news wire could not be read just now. That is not the same as no Fed headlines.</p>
  else if (!h.items.length) body = <p className={styles.muted} data-testid="terminal-fed-headlines-none">No headline about the Fed is among the newest on the wire.</p>
  else {
    body = (
      <ul className={styles.newsList} data-testid="terminal-fed-headlines-list">
        {h.items.map((it) => {
          const d = headlineDay(it.receivedAtMs)
          return (
            <li key={it.seq ?? it.text} className={styles.newsItem} data-testid="terminal-fed-headline">
              <span className={styles.newsHeadline}>{it.text}</span>
              <span className={styles.newsMeta}>
                <span title="When UCT received it">{d && d !== today ? `${dayText(d, { short: true })}, ` : ''}{formatTimeEt(it.receivedAtMs, { zoneSuffix: 'ET', absent: 'time not given' })}</span>
                {it.tickers.length ? <span className={own.tickers}>{it.tickers.map((t) => <PanelSymbol key={t} sym={t} className={styles.sym} />)}</span> : null}
              </span>
            </li>
          )
        })}
      </ul>
    )
  }
  const cut = h.state === 'ok' ? headlineCutWords(h) : null
  return (
    <Section title="Fed headlines" testId="terminal-fed-headlines" state={h.state}>
      {body}
      <p className={styles.muted} data-testid="terminal-fed-headlines-source">
        Source: TradeXchange, live. {cut ? `${cut} ` : ''}A headline is listed when it names the Fed, the FOMC, the Federal Reserve or a Fed official.
      </p>
    </Section>
  )
}

function Speeches({ sp }) {
  let body
  if (sp.state !== 'ok') body = <p className={styles.note} role="status" data-testid="terminal-fed-speeches-missing">{boardMissingWords(sp.state, 'the speeches and testimony')}</p>
  else if (!sp.items.length) body = <p className={styles.muted} data-testid="terminal-fed-speeches-none">The Board&apos;s feeds list no speeches or testimony right now.</p>
  else {
    body = (
      <ul className={styles.newsList} data-testid="terminal-fed-speeches-list">
        {sp.items.map((s) => (
          <li key={s.url || `${s.speaker}-${s.title}-${s.published}`} className={styles.newsItem} data-testid="terminal-fed-speech">
            {s.url ? <a className={styles.newsHeadline} href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : <span className={styles.newsHeadline}>{s.title}</span>}
            <span className={styles.newsMeta}>
              {s.speaker ? <span>{s.speaker}</span> : null}
              <span>{s.kind === 'testimony' ? 'Testimony' : 'Speech'}{s.published ? `, ${instantDay(s.published)}` : ''}</span>
              {s.where ? <span>{s.where}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    )
  }
  const stale = sp.missing.length ? null : staleBoardWords(sp.state, sp.checks)
  return (
    <Section title="Speeches and testimony" testId="terminal-fed-speeches" state={sp.state}>
      {stale ? <p className={styles.note} role="status" data-testid="terminal-fed-speeches-stale">{stale}</p> : null}
      {body}
      {sp.state === 'ok' && sp.missing.length ? (
        <p className={styles.note} role="status" data-testid="terminal-fed-speeches-partial">
          {sp.missing.includes('testimony') ? 'Testimony' : 'Speeches'} could not be read just now; the list shows the rest.
        </p>
      ) : null}
      <p className={styles.muted}>
        Source: Federal Reserve Board (the Chair, the Vice Chairs and the Governors). {sp.total > sp.items.length ? `The newest ${sp.items.length} of ${sp.total} are shown. ` : ''}
        Reserve Bank presidents&apos; remarks reach this panel through the headlines and the calendar.
      </p>
    </Section>
  )
}

function ThisWeek({ cal }) {
  const wk = cal.thisWeek
  let body
  if (wk.state !== 'ok') body = <p className={styles.muted} data-testid="terminal-fed-week-not-held">This week&apos;s economic calendar is not held on the server right now. Open CAL to load it.</p>
  else if (!wk.items.length) body = <p className={styles.muted} data-testid="terminal-fed-week-none">The calendar lists no Fed speaker this week.</p>
  else {
    body = (
      <ul className={styles.newsList} data-testid="terminal-fed-week-list">
        {wk.items.map((r, i) => (
          <li key={`${r.date}-${r.time}-${r.event}-${i}`} className={styles.newsItem} data-testid="terminal-fed-week-row">
            <span className={styles.newsHeadline}>{r.event}</span>
            <span className={styles.newsMeta}>{weekdayText(r.date)}{r.time ? `, ${r.time} ET` : ''}</span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <Section title="This week" testId="terminal-fed-week" state={wk.state}>
      {body}
      <p className={styles.muted}>
        Source: the economic calendar, the Fed speakers it flags for {cal.weekStart && cal.weekEnd ? `${dayText(cal.weekStart, { short: true })} to ${dayText(cal.weekEnd)}` : 'this week'}.
        {wk.total > wk.items.length ? ` The first ${wk.items.length} of ${wk.total} are shown.` : ''}
      </p>
    </Section>
  )
}

function Survey({ sv, upper }) {
  let body
  if (sv.state === 'computing') body = <p className={styles.muted} role="status" data-testid="terminal-fed-survey-missing">Reading the survey from the New York Fed&apos;s website. This fills in on its own.</p>
  else if (sv.state !== 'ok') {
    body = (
      <p className={styles.note} role="status" data-testid="terminal-fed-survey-missing">
        The latest survey results could not be read{sv.state === 'unavailable' ? ': the New York Fed’s website did not let the server in' : ''}.{' '}
        <Ext href={sv.fileUrl || sv.pageUrl}>Open the results on the New York Fed&apos;s website</Ext>
      </p>
    )
  } else {
    body = (
      <>
        <p className={styles.lede} data-testid="terminal-fed-survey-line">{surveyLine(sv)}</p>
        {sv.path.length ? (
          <div className={styles.tableBox}>
            <table className={styles.table} data-testid="terminal-fed-survey-path"
              aria-label="The survey respondents' most likely target rate after each coming meeting: the median, and the middle half of answers">
              <caption className={styles.caption}>Most likely target after each meeting (midpoint of the range)</caption>
              <thead>
                <tr>
                  <th scope="col">Meeting</th>
                  <th scope="col" title="The median of the respondents' most likely target">Median</th>
                  <th scope="col" title="The 25th to the 75th percentile of the respondents' answers">Middle half</th>
                </tr>
              </thead>
              <tbody>
                {sv.path.map((p) => (
                  <tr key={p.label} data-testid="terminal-fed-survey-path-row">
                    <td>{p.label}</td>
                    <td>{surveyRate(p.median)}</td>
                    <td>{p.p25 != null && p.p75 != null ? `${surveyRate(p.p25)} to ${surveyRate(p.p75)}` : 'No figure'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {sv.distributions.map((d) => {
          const { shown, hidden } = shownBuckets(d)
          return (
            <div key={d.label} className={styles.tableBox}>
              <table className={styles.table} data-testid="terminal-fed-survey-dist"
                aria-label={`${d.label}: the survey respondents' average probability for each target range`}>
                <caption className={styles.caption}>{`${d.label}: chance of each target range${d.respondents ? ` (${d.respondents} respondents)` : ''}`}</caption>
                <thead>
                  <tr><th scope="col">Target range</th><th scope="col">Probability</th></tr>
                </thead>
                <tbody>
                  {shown.map((b) => {
                    const mine = holdsToday(b, upper)
                    return (
                      <tr key={b.range} data-testid="terminal-fed-survey-bucket" data-today={mine ? 'true' : undefined}>
                        <td className={mine ? own.today : undefined}>{b.range}{mine ? ' (today’s range)' : ''}</td>
                        <td>{chanceText(b.probability)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {hidden ? <p className={styles.muted}>{hidden === 1 ? 'One range with no probability is left out.' : `${hidden} ranges with no probability are left out.`}</p> : null}
            </div>
          )
        })}
        {sv.passed ? <p className={styles.muted} data-testid="terminal-fed-survey-passed">{sv.passed === 1 ? 'One question in the survey is about a meeting already held and is left out.' : `${sv.passed} questions in the survey are about dates already passed and are left out.`}</p> : null}
        <p className={styles.muted} data-testid="terminal-fed-survey-label">
          These are the survey respondents&apos; own answers (primary dealers and market participants), not market prices and not a forecast by UCT.{' '}
          <Ext href={sv.fileUrl || sv.pageUrl}>The results file</Ext>
        </p>
      </>
    )
  }
  return (
    <Section title="What the professionals expect" testId="terminal-fed-survey" state={sv.state}>
      {body}
      <p className={styles.muted} data-testid="terminal-fed-survey-credit">
        {sv.credit || 'Federal Reserve Bank of New York. Content from the New York Fed subject to the Terms of Use at newyorkfed.org.'}
      </p>
    </Section>
  )
}

function Projections({ pr }) {
  let body
  if (pr.state === 'ok' && pr.medians.length) {
    body = (
      <>
        <p className={styles.lede} data-testid="terminal-fed-projections-line">
          The officials&apos; own median projection of the federal funds rate at the end of each year
          {pr.date ? `, from the Summary of Economic Projections released ${dayText(pr.date)}` : ''}
          {pr.meeting ? ` (the ${pr.meeting} meeting)` : ''}. Not a forecast by UCT.
        </p>
        <dl className={styles.fields} data-testid="terminal-fed-projections">
          {pr.medians.map((m) => (
            <Fragment key={m.label}>
              <dt>{m.label}</dt>
              <dd>{projectionText(m.value)}</dd>
            </Fragment>
          ))}
        </dl>
      </>
    )
  } else if (pr.state === 'none') {
    body = <p className={styles.muted} data-testid="terminal-fed-projections-missing">The Board&apos;s monetary policy feed names no recent projections release.</p>
  } else {
    body = (
      <p className={styles.note} role="status" data-testid="terminal-fed-projections-missing">
        {boardMissingWords(pr.state, 'the projections')}{' '}
        <Ext href={pr.pageUrl || pr.releaseUrl}>Open them on the Board&apos;s website</Ext>
      </p>
    )
  }
  return (
    <Section title="Where the Fed sees rates" testId="terminal-fed-projections-section" state={pr.state}>
      {body}
      {pr.state === 'ok' ? <div className={own.links}><Ext href={pr.pageUrl}>The projections</Ext><Ext href={pr.releaseUrl}>The release</Ext></div> : null}
    </Section>
  )
}

function FedWatch({ code, inPanel }) {
  const [pace, setPace] = useState(HELD_POLL_MS)
  const read = useMarketRead(FED_URL, { refreshInterval: pace })
  const view = useMemo(() => fedRead(read.body), [read.body])
  // The pace follows the server's own word (adjusted during render from the last answer).
  const wantPace = view.computing ? COMPUTING_POLL_MS : HELD_POLL_MS
  if (wantPace !== pace) setPace(wantPace)
  const ok = !read.loading && !!read.body && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(FED_SOURCE, view.builtAt) : null)

  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-fed" data-state={state}>{body}</div>
  )
  if (read.loading) return frame('loading', <PanelSkeleton label="Loading Fed watch" testId="terminal-fed-loading" />)
  if (!read.body || view.state !== 'ok') {
    const err = read.body ? null : read.error
    const locked = err ? !canRetry(err) : false
    return frame('error', (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-fed-error"
        title={err ? failureText(err, FED_WHAT) : `${FED_WHAT} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `Retry, or run ${code} again.`}
      </PanelState>
    ))
  }
  return frame('ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-fed-stale-read">{failureText(read.error, FED_WHAT)} Showing the last read.</p> : null}
      {view.computing ? <p className={styles.muted} role="status" data-testid="terminal-fed-computing">{WARMING_TITLE} Some blocks are still being read; they fill in on their own.</p> : null}
      <Glance view={view} />
      <Statement st={view.statement} />
      <Headlines h={view.headlines} />
      <Speeches sp={view.speeches} />
      <ThisWeek cal={view.calendar} />
      <Survey sv={view.survey} upper={view.rates.upper.value} />
      <Projections pr={view.projections} />
      <p className={own.footer} data-testid="terminal-fed-footer">
        {view.boardCite} Statements, speeches, testimony and projections come from the Board&apos;s own website; headlines from
        TradeXchange; the survey and the rates from the Federal Reserve Bank of New York. No text here is summarised by AI.
      </p>
    </>
  ))
}

export default function FedWatchPanel() {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || FED_CODE
  return <FedWatch code={code} inPanel={inPanel} />
}
