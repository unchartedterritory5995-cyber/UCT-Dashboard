// PUBR: one company's public records (2026-11-22): its federal contract awards, the clinical trials it leads, its
// FDA drug approvals and its lobbying, each from the government agency that publishes it.
//
//   NVDA PUBR            all four, each with its first rows
//   NVDA PUBR CONTRACTS  one section in full (CONTRACTS or AWARDS, TRIALS, FDA or APPROVALS, LOBBYING)
//
// ONE read, `GET /api/research/public-records/{ticker}` (paid; api/services/public_records.py). The server never
// asks an agency on the request: it holds each company's records for a day, and a section it is still reading says
// `computing` while this panel asks again every 3 seconds (else hourly; SWR skips ticks while the app is hidden).
// The pure half is publicRecordsModel.js.
//
// ⛔ HOW THE TICKER WAS MATCHED IS ALWAYS ON SCREEN: the names searched, what each section searched for, the names
// that matched and how, and the names an agency returned that were not counted.
// ⛔ "NO RECORDS MATCHED" IS SAID IN WORDS, NEVER "NONE EXIST"; a section that could not be read says why and is never
// drawn as empty. A missing figure is words, never $0.
// ⛔ EACH SECTION CARRIES ITS AGENCY'S OWN REQUIREMENTS: ClinicalTrials.gov's processing date and the fields shown,
// LDA.gov's access date and its sentence about what it cannot vouch for, D&B's attribution for recipient names.
//
// WIDTH. Three- and four-column tables of two- and three-line cells that wrap between words; on a phone the trials'
// enrollment and the lobbying issue areas fold (phoneHide) and each row keeps its words.
import { useMemo, useState } from 'react'
import { PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { usePanelWriteBack } from './commandWriteBack'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  MATCH_RULE, NOT_NONE, PUBR_CODE, PUBR_SECTIONS, PUBR_VIEWS, PUBR_WHAT, companyLabel, contractsLede, dateWords, enrollmentWords, fdaActionWords,
  fdaLede, issuesWords, lobbyingLede, moneyWords, noMatchWords, normPubrView, notCountedWords, phaseWords, priorityWords,
  pubrCommandArgs, pubrPollMs, pubrRead, pubrUrl, quarterFigureWords, readWhen, sectionFailWords, sectionNoteWords, sectionRows,
  staleWords, statusWords, trialDateWords, trialsLede,
} from './publicRecordsModel'
import styles from './marketPanels.module.css'
import own from './publicRecordsPanel.module.css'

function Ext({ href, children, testId }) {
  if (!href) return children
  return <a className={own.link} href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}>{children}</a>
}

function Names({ s }) {
  const note = notCountedWords(s)
  return (
    <div className={own.names} data-testid={`terminal-pubr-${s.key}-names`}>
      {s.counted.length ? (
        <p className={own.line}>
          <span className={own.label}>Matched names: </span>
          {s.counted.map((n, i) => (
            <span key={n.name} data-testid={`terminal-pubr-${s.key}-matched`}>{i ? '; ' : ''}{n.name}
              <span className={styles.muted}>{` (${(n.howWords || 'matched').toLowerCase()}${n.against && n.against !== n.name ? `: ${n.against}` : ''})`}</span>
            </span>
          ))}
        </p>
      ) : null}
      {note ? (
        <p className={own.line} data-testid={`terminal-pubr-${s.key}-not-counted`}>
          <span className={own.label}>Not counted: </span>
          {note}{s.notCounted.length ? ` ${s.notCounted.map((n) => n.name).join('; ')}.` : ''}
        </p>
      ) : null}
    </div>
  )
}

function SourceLine({ s }) {
  const when = readWhen(s.readAt)
  const read = when ? ` Read by the server ${when}.` : ''
  let words
  if (s.key === 'contracts') {
    words = `Source: ${s.source}.${read} Amounts are obligations in each window (money taken back counts against it). `
      + 'Recipient names come in part from D&B Open Data (Dun & Bradstreet).'
  } else if (s.key === 'trials') {
    const processed = s.dataProcessed ? ` Data processed by ClinicalTrials.gov ${s.dataProcessed.replace('T', ' at ')}.` : ' The date ClinicalTrials.gov processed the data was not given.'
    words = `Source: ${s.source}.${processed}${read} Shown: each study's title, status, phase, conditions, dates and enrollment as `
      + 'registered, and nothing else; no text is changed.'
  } else if (s.key === 'fda') {
    words = `Source: ${s.source}. Data provided by the U.S. Food and Drug Administration${s.dataAsOf ? `, updated ${dateWords(s.dataAsOf)}` : ''}.${read}`
  } else {
    words = `Source: ${s.source}, accessed by the server${when ? ` ${when}` : ''}. Senate Office of Public Records cannot vouch for the data or `
      + 'analyses derived from these data after the data have been retrieved from LDA.gov. A company\'s own figure may already include what it '
      + 'paid outside firms, so the two are shown apart and never added.'
  }
  return (
    <>
      <p className={styles.muted} data-testid={`terminal-pubr-${s.key}-source`}>
        {words}{s.searchedFor ? ` Searched for "${s.searchedFor}".` : ''}
      </p>
      {s.key === 'fda' && s.notice ? <p className={styles.muted} data-testid="terminal-pubr-fda-notice">openFDA&apos;s note: {s.notice}</p> : null}
    </>
  )
}

function Contracts({ rows, sym }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-pubr-contracts-table"
        aria-label={`${sym}: matched new contract awards of the last 12 months, newest first, ${rows.length} shown`}>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col" className={styles.wrapCell}>Award</th>
            <th scope="col" title="The amount obligated on the award so far">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.awardId} data-testid="terminal-pubr-award">
              <td>{dateWords(a.date)}</td>
              <td className={`${styles.wrapCell} ${own.cell}`}>
                <span className={own.strong}><Ext href={a.url}>{[a.agency, a.subAgency].filter(Boolean).join(', ') || a.awardId}</Ext></span>
                {a.description ? <span className={own.sub}>{a.description}{a.descriptionCut ? '...' : ''}</span> : null}
                <span className={own.sub}>{[a.recipient, a.place, a.kind ? a.kind.toLowerCase() : null, a.awardId].filter(Boolean).join(' · ')}</span>
              </td>
              <td className={a.amount == null ? styles.muted : undefined}>{moneyWords(a.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Trials({ rows, sym, closed = false }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid={closed ? 'terminal-pubr-closed-table' : 'terminal-pubr-trials-table'}
        aria-label={closed ? `${sym}: trials closed in the last year, latest update first` : `${sym}: active trials it leads, the next primary completion first`}>
        {closed ? <caption className={styles.caption}>Closed in the last year</caption> : null}
        <thead>
          <tr>
            <th scope="col" className={styles.wrapCell}>Trial</th>
            <th scope="col" className={`${own.cell} ${own.wrap}`}>Phase and status</th>
            <th scope="col" title={closed ? 'When the study record was last updated' : 'When the primary outcome data are expected'}>
              {closed ? 'Updated' : 'Primary completion'}
            </th>
            {closed ? null : <th scope="col" className={styles.phoneHide}>Enrollment</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.nctId} data-testid="terminal-pubr-trial">
              <td className={`${styles.wrapCell} ${own.cell}`}>
                <span className={own.strong}><Ext href={t.url}>{t.title || t.nctId}</Ext></span>
                <span className={own.sub}>{[t.nctId, t.conditions.join(', ') + (t.conditionsMore ? `, and ${t.conditionsMore} more` : '')].filter(Boolean).join(' · ')}</span>
              </td>
              <td className={`${own.cell} ${own.wrap}`}>
                <span>{phaseWords(t.phases)}</span>
                <span className={own.sub}>{statusWords(t.status)}</span>
              </td>
              <td className={`${own.cell} ${own.wrap}`}>{closed ? (dateWords(t.lastUpdate) || 'Not given') : trialDateWords(t.primaryCompletion)}</td>
              {closed ? null : (
                <td className={`${styles.phoneHide} ${t.enrollment == null ? styles.muted : ''}`.trim()}>
                  {enrollmentWords(t.enrollment, t.enrollmentEstimated)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Fda({ rows, sym }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-pubr-fda-table" aria-label={`${sym}: FDA approvals and new uses, newest first`}>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col" className={styles.wrapCell}>Drug</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a, i) => (
            <tr key={`${a.application}-${a.date}-${i}`} data-testid="terminal-pubr-fda-action">
              <td>{dateWords(a.date)}</td>
              <td className={`${styles.wrapCell} ${own.cell}`}>
                <span className={own.strong}><Ext href={a.url}>{a.drug || a.application}</Ext>{a.drugsMore ? ` and ${a.drugsMore} more` : ''}</span>
                <span className={own.sub}>{[a.ingredients, a.application].filter(Boolean).join(' · ')}</span>
              </td>
              <td className={`${own.cell} ${own.wrap}`}>
                <span>{fdaActionWords(a.action)}</span>
                <span className={own.sub}>{[priorityWords(a.priority), a.classWords].filter(Boolean).join(' · ') || a.applicationWords}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Lobbying({ rows, sym }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-pubr-lobbying-table" aria-label={`${sym}: lobbying by quarter, newest first`}>
        <thead>
          <tr>
            <th scope="col">Quarter</th>
            <th scope="col" title="What the company reported spending, in reports it filed for itself">Own reports</th>
            <th scope="col" title="What outside lobbying firms reported being paid by the company">Outside firms</th>
            <th scope="col" className={`${styles.wrapCell} ${styles.phoneHide}`}>Issue areas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => {
            const mine = quarterFigureWords(q.own, q.ownReports, q.ownNoFigure, 'report', 'reports')
            const firms = quarterFigureWords(q.firms, q.firmReports, q.firmsNoFigure, 'firm report', 'firm reports')
            return (
              <tr key={q.label} data-testid="terminal-pubr-quarter">
                <td className={own.cell}>
                  <span>{q.label}</span>
                  {q.reportsDue ? <span className={own.sub}>reports due {dateWords(q.due)}</span> : null}
                </td>
                <td className={own.cell}>
                  <span className={mine.detail ? undefined : styles.muted}>{mine.amount}</span>
                  {mine.detail ? <span className={own.sub}>{mine.detail}</span> : null}
                </td>
                <td className={own.cell}>
                  <span className={firms.detail ? undefined : styles.muted}>{firms.amount}</span>
                  {firms.detail ? <span className={own.sub}>{firms.detail}</span> : null}
                </td>
                <td className={`${styles.wrapCell} ${styles.phoneHide} ${own.cell}`}>
                  {issuesWords(q) ? <span className={own.small}>{issuesWords(q)}</span> : <span className={styles.muted}>None</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const LEDE = { contracts: contractsLede, trials: trialsLede, fda: fdaLede, lobbying: lobbyingLede }

function Section({ s, view, sym, company, onOpen, onRetry }) {
  const title = PUBR_VIEWS[s.key].title
  const open = view === 'all' ? (
    <button type="button" className={styles.chip} onClick={() => onOpen(s.key)} data-testid={`terminal-pubr-open-${s.key}`}
      aria-label={`Show ${title.toLowerCase()} in full`}>Show all</button>
  ) : null
  const head = (
    <div className={own.head}>
      <h3 className={own.title}>{title}</h3>
      {open}
    </div>
  )
  const wrap = (body) => (
    <section className={own.section} aria-label={title} data-testid={`terminal-pubr-${s.key}`} data-state={s.state}>
      {head}
      {body}
    </section>
  )
  if (s.state === 'computing') {
    return wrap(
      <p className={styles.muted} role="status" data-testid={`terminal-pubr-${s.key}-computing`}>
        The server is reading {s.short} for {sym}. The first read of a company takes a little while; this panel asks again every 3 seconds.
      </p>,
    )
  }
  if (s.state === 'failed') {
    const w = sectionFailWords(s)
    return wrap(
      <div className={own.fail} data-testid={`terminal-pubr-${s.key}-failed`} data-reason={s.reason || ''}>
        <p className={styles.note} role="status">{w.title} {w.body}</p>
        <button type="button" className={styles.chip} onClick={onRetry}>Retry</button>
      </div>,
    )
  }
  const stale = staleWords(s)
  const note = sectionNoteWords(s)
  if (s.state !== 'matched') {
    return wrap(
      <>
        {stale ? <p className={styles.note} role="status">{stale}</p> : null}
        <p className={own.empty} role="status" data-testid={`terminal-pubr-${s.key}-none`}>{noMatchWords(s, company)}</p>
        {s.state === 'no_match' ? <p className={styles.muted}>{NOT_NONE}</p> : null}
        <Names s={s} />
        <SourceLine s={s} />
      </>,
    )
  }
  const { rows, more, total } = sectionRows(s, view)
  let table = null
  if (s.key === 'contracts') table = rows.length ? <Contracts rows={rows} sym={sym} /> : <p className={styles.muted}>No new award to the matched names among the largest new awards the search returned for the last 12 months.</p>
  if (s.key === 'trials') {
    table = (
      <>
        {rows.length ? <Trials rows={rows} sym={sym} /> : <p className={styles.muted}>No active trial with the company as lead sponsor.</p>}
        {view !== 'all' && s.closed.length ? <Trials rows={s.closed} sym={sym} closed /> : null}
      </>
    )
  }
  if (s.key === 'fda') table = rows.length ? <Fda rows={rows} sym={sym} /> : <p className={styles.muted}>No approval or new use in the window; only labeling or manufacturing changes.</p>
  if (s.key === 'lobbying') table = <Lobbying rows={rows} sym={sym} />
  return wrap(
    <>
      {stale ? <p className={styles.note} role="status" data-testid={`terminal-pubr-${s.key}-stale`}>{stale}</p> : null}
      <p className={styles.lede} data-testid={`terminal-pubr-${s.key}-lede`}>{LEDE[s.key](s)}</p>
      {table}
      {more ? <p className={styles.muted} data-testid={`terminal-pubr-${s.key}-more`}>{`${total - more} of ${total} shown. `}
        <button type="button" className={styles.linkBtn} onClick={() => onOpen(s.key)}>Show all {total}</button></p> : null}
      {note && view !== 'all' ? <p className={styles.note} role="status" data-testid={`terminal-pubr-${s.key}-note`}>{note}</p> : null}
      <Names s={s} />
      <SourceLine s={s} />
    </>,
  )
}

function Matching({ read, sym }) {
  const c = read.company
  if (c.state !== 'ok') {
    return <p className={styles.muted} role="status" data-testid="terminal-pubr-company-computing">The server is finding {sym}&apos;s company names.</p>
  }
  const names = c.names.map((n) => `${n.name} (${n.sourceWords}${n.until ? `, used until ${dateWords(n.until)}` : ''})`)
  return (
    <details className={own.matching} data-testid="terminal-pubr-company">
      <summary className={own.summary}>
        {names.length ? `Matched by name: ${c.names[0].name}${c.names.length > 1 ? ` and ${c.names.length - 1} more` : ''}` : `No company name held for ${sym}`}
      </summary>
      <p className={styles.muted}>
        {names.length ? `Names searched: ${names.join('; ')}.` : `The server holds no company name for ${sym}, so no agency was searched.`}
        {c.cik ? ` SEC company number (CIK) ${c.cik}.` : ' No SEC company number was found for this ticker.'}
        {c.secState === 'failed' ? ' The SEC record could not be read just now; the site\'s company name was searched on its own.' : ''}
      </p>
      <p className={styles.muted}>{MATCH_RULE}</p>
    </details>
  )
}

function Records({ sym, view, code, inPanel, onPick }) {
  const read = useMarketRead(pubrUrl(sym), { refreshInterval: (latest) => pubrPollMs(latest?.body) })
  const answer = useMemo(() => pubrRead(read.body), [read.body])
  const shown = view === 'all' ? PUBR_SECTIONS : [view]
  const firstOk = answer.state === 'ok' ? shown.map((k) => answer.sections[k]).find((s) => s.readAt) : null
  usePanelFreshness(firstOk ? panelAsOf(view === 'all' ? 'Government records' : firstOk.source, firstOk.readAt) : null)

  const chips = (
    <div className={styles.toolbar} role="toolbar" aria-label="Public records choices">
      <div className={styles.group} role="group" aria-label="Section">
        {Object.entries(PUBR_VIEWS).map(([key, v]) => (
          <button key={key} type="button" className={styles.chip} aria-pressed={view === key} data-testid={`terminal-pubr-view-${key}`}
            onClick={() => (view === key ? null : onPick(key))}>{v.label}</button>
        ))}
      </div>
    </div>
  )
  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-pubr" data-state={state} data-sym={sym} data-view={view}>
      {chips}
      {body}
    </div>
  )
  if (read.loading) return <PanelSkeleton label={`Loading public records for ${sym}`} testId="terminal-pubr-loading" />
  if (!read.body || answer.state === 'failed') {
    const err = read.body ? null : read.error
    const locked = err ? !canRetry(err) : false
    return wrap('error', (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-pubr-error"
        title={err ? failureText(err, PUBR_WHAT) : 'Public records came back in a shape this panel cannot read.'}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no records. Retry, or run ${sym} ${code} again.`}
      </PanelState>
    ))
  }
  const company = companyLabel(answer, sym)
  const allComputing = shown.every((k) => answer.sections[k].state === 'computing')
  return wrap(allComputing ? 'computing' : 'ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-pubr-stale-read">{failureText(read.error, PUBR_WHAT)} Showing the last read.</p> : null}
      {allComputing ? <p className={styles.muted} role="status" data-testid="terminal-pubr-computing">{WARMING_TITLE}</p> : null}
      <Matching read={answer} sym={sym} />
      {shown.map((k) => (
        <Section key={k} s={answer.sections[k]} view={view} sym={sym} company={company} onOpen={onPick} onRetry={read.retry} />
      ))}
      <p className={own.footer} data-testid="terminal-pubr-footer">
        Public records published by U.S. government agencies, matched to {sym} by name by UCT&apos;s server. Each section names its source;
        none of it is a view or a forecast by UCT.
      </p>
    </>
  ))
}

export default function PublicRecordsPanel({ sym, view: viewProp }) {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || PUBR_CODE
  const writeBack = usePanelWriteBack()
  const s = String(sym || '').trim().toUpperCase()
  // Outside the shell (or if the registry cannot take a word) a chip switches here, in state.
  const [pick, setPick] = useState(() => normPubrView(viewProp))
  if (!s) {
    return (
      <PanelState kind="empty" role="status" testId="terminal-pubr-no-sym" title="Public records are for one company.">
        Type a symbol first, e.g. <kbd>NVDA {PUBR_CODE}</kbd>.
      </PanelState>
    )
  }
  const onPick = (next) => {
    if (!writeBack(pubrCommandArgs(next), s)) setPick(normPubrView(next))
  }
  return <Records key={s} sym={s} view={pick} code={code} inPanel={inPanel} onPick={onPick} />
}
