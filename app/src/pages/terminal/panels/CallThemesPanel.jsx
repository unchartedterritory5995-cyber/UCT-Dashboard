// CEOS: what CEOs are saying. The words and phrases rising fastest across a month of earnings
// calls, so a member sees a new theme without guessing what to search for.
//
// ONE READ: `GET /api/earnings/call-themes` (paid; api/services/call_themes.py). The server works
// the lists out once a day after the call index updates and holds them; a read never computes, so
// a server that holds nothing answers `computing` and this panel asks again by itself. The pure
// half (the words, the URL, the row shaping) is callThemesModel.js, re-exported below.
//
//   CEOS             both lists, the first ten of each      CEOS NEW       everything new this month
//   CEOS RISING      everything rising                      CEOS 2026-10   an earlier month
//
// A phrase opens the call search on it (TSRC) in the panel beside this one, where the quotes are.
// A ticker loads that company into the linked panels. A row number opens that phrase's quotes here.
//
// ⛔ A FAILED READ IS NEVER AN EMPTY LIST, and an index with no calls or too few is said as that.
// ⛔ NO TRANSCRIPT TEXT: a phrase of at most three words, counts and tickers. The quotes stay in TSRC.
// ⛔ A RISE IN TALK HAS NO PRICE DIRECTION, so nothing here takes the up or down color.
//
// The read goes through marketRead.js (the terminal's one bare-SWR reader), and SWR skips ticks
// while the app is hidden.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelRows,
} from '../../../components/terminal'
import { formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  BOTH_ROWS, CALL_SEARCH_CODE, CALL_THEMES_CODE, CALL_THEME_LISTS, callThemesCommandArgs, callThemesRead, callThemesUrl,
  monthLabel, normCallThemesList, parseCallThemesMonth, rowCommands, shownRows,
} from './callThemesModel'
import styles from './marketPanels.module.css'

export {
  BOTH_ROWS, CALL_THEMES_CODE, CALL_THEMES_LIST_ARG_WORDS, CALL_THEMES_URL, CALL_THEME_LISTS, callThemesCommandArgs, callThemesRead,
  callThemesUrl, cleanPhrase, monthLabel, normCallThemesList, parseCallThemesList, parseCallThemesMonth, rowCommands, searchCommand,
  shownRows,
} from './callThemesModel'

/** While the server works the lists out for the first time it is asked again at this pace. */
const BUILD_POLL_MS = 20 * 1000
const SOURCE = 'UCT earnings call index (recent call transcripts)'
const NA = 'n/a'
/** A space that never breaks a line, so "+20.5 pts" and "42 calls" stay whole in a narrow cell. */
const NBSP = ' '
const count = (n) => formatNumber(n, { decimals: 0, absent: NA })
const share = (v) => formatPercent(v, { decimals: 1, absent: NA })
const points = (v) => (v === null ? NA : `${v > 0 ? '+' : ''}${formatNumber(v, { decimals: 1 })}${NBSP}pts`)
const times = (v) => `${formatNumber(v, { decimals: 1 })}×`
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')
const plural = (n, one, many) => (n === 1 ? one : many)
const LIST_TITLE = { new: 'New this month', rising: 'Rising' }

/** Pure: when the lists were worked out, as a day and a time in New York (`Nov 17, 6:52 AM ET`), or ''. */
export function builtText(iso) {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
  return `${day}, ${clock(d.toISOString())}`
}

/** Pure: what the month was compared with, in a sentence. */
export function comparedSentence(view) {
  if (!view || view.state !== 'ok') return ''
  const b = view.baseline
  const span = !b?.from ? 'the months before it' : b.from === b.to ? b.from : `${b.from} to ${b.to}`
  const from = view.companies === null ? '' : ` from ${count(view.companies)} ${plural(view.companies, 'company', 'companies')}`
  const against = b?.calls === null || b?.calls === undefined ? '' : ` (${count(b.calls)} ${plural(b.calls, 'call', 'calls')})`
  return `${view.label}: ${count(view.calls)} indexed earnings ${plural(view.calls, 'call', 'calls')}${from}, compared with ${span}${against}.`
}

/** Pure: what the index holds, month by month, in a sentence ("Aug 2026 40, Sep 2026 62"). */
export function holdsSentence(corpus) {
  const months = corpus?.months || []
  if (!months.length) return ''
  return `The index holds ${months.map((m) => `${count(m.calls)} in ${m.label}`).join(', ')}.`
}

function ChangeCell({ row, name }) {
  if (name === 'new' && row.baseCalls === 0) return <>Not said before</>
  return (
    <>
      {points(row.rise)}
      {row.ratio === null ? null : <><br /><span className={styles.muted}>{` ${times(row.ratio)}`}</span></>}
    </>
  )
}

function ThemeTable({ name, list, rows, startAt, view, code, onAll }) {
  const title = LIST_TITLE[name]
  const lead = name === 'new'
    ? 'Phrases the earlier calls almost never said, most-said first.'
    : 'Phrases said before and clearly more now, biggest rise first.'
  if (!list.rows.length) {
    return (
      <section aria-label={title} data-testid={`terminal-ceos-${name}`}>
        <div className={styles.head}><strong>{title}</strong></div>
        <PanelState kind="empty" compact testId={`terminal-ceos-${name}-empty`}
          title={name === 'new' ? `No phrase is new in ${view.label}.` : `No phrase rose enough in ${view.label}.`}>
          That is what the count found, not a failed read: nothing passed every test below.
        </PanelState>
      </section>
    )
  }
  const hidden = list.rows.length - rows.length
  return (
    <section aria-label={title} data-testid={`terminal-ceos-${name}`}>
      <div className={styles.head}>
        <strong>{title}</strong>
        <span className={styles.lede}>{lead}</span>
      </div>
      {list.cut > 0 ? (
        <p className={styles.note} role="status" data-testid={`terminal-ceos-${name}-cut`}>
          {count(list.qualified)} phrases passed; the server keeps the {count(list.rows.length)}{' '}
          {name === 'new' ? 'said by the most calls' : 'that rose most'}, so the ones left out are the weakest.
        </p>
      ) : null}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid={`terminal-ceos-${name}-table`}
          aria-label={`${title} across earnings calls in ${view.label}, ${rows.length} of ${list.qualified} ${plural(list.qualified, 'phrase', 'phrases')}`}>
          <thead>
            <tr>
              <th scope="col" className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`} title={`Click a phrase to open its quotes in the call search (${CALL_SEARCH_CODE}) beside this panel`}>Phrase</th>
              <th scope="col" title={`Calls in ${view.label} that said it, as a share of the month's calls`}>Share of calls</th>
              <th scope="col" className={styles.phoneHide}
                title="The share of the earlier calls that said it, weighted to this month's mix of industries">Before</th>
              <th scope="col" className={styles.phoneWrap} title="The share now less the share before, in percentage points, and how many times the share before it is">Change</th>
              <th scope="col" className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`}
                title="Different companies whose call said it, and the ones whose call said it most. Click a symbol to load it into the linked panels">Companies</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} data-testid={`terminal-ceos-row-${r.key.replace(/\s+/g, '-')}`}>
                <td className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`}>
                  <span className={styles.rowNum} aria-hidden="true">{startAt + i + 1}</span>
                  <PanelCommand cmd={r.cmd} label={`Open the calls that say ${r.phrase}`}>{r.phrase}</PanelCommand>
                  {r.related.length ? <span className={`${styles.muted} ${styles.phoneHide}`}>{` with ${r.related.join(', ')}`}</span> : null}
                </td>
                <td>
                  {share(r.share)}
                  {/* two lines a cell: the table stays inside a half-width panel and a phone */}
                  <br />
                  <span className={styles.muted}>{` ${count(r.calls)}${NBSP}${plural(r.calls, 'call', 'calls')}`}</span>
                </td>
                <td className={styles.phoneHide}>{share(r.base)}</td>
                <td className={styles.phoneWrap}><ChangeCell row={r} name={name} /></td>
                <td className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`}>
                  {count(r.companies)}
                  {r.examples.length ? (
                    <span className={styles.muted}>
                      {' e.g. '}
                      {r.examples.map((s, j) => (
                        <span key={s}>{j ? ', ' : ''}<PanelSymbol sym={s} className={styles.sym} /></span>
                      ))}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.chip} onClick={onAll} data-testid={`terminal-ceos-${name}-all`}>
            Show all {count(list.rows.length)} ({code} {CALL_THEME_LISTS[name].token})
          </button>
        </div>
      ) : null}
    </section>
  )
}

function Method({ view, read }) {
  const r = view.rules
  const matched = view.baseline?.matched
  const say = (v) => (v === null || v === undefined ? NA : String(v))
  return (
    <p className={styles.muted} data-testid="terminal-ceos-method">
      How this is worked out: every call in the index for {view.label} is read once, and a one-, two- or three-word
      phrase counts once per call however often the call says it. Share of calls is the calls that said it over the
      month&apos;s {count(view.calls)} calls. Before is the same share across the earlier months
      {matched === null || matched === undefined || matched <= 0
        ? ', compared as they are (the industry map could not be read, so a month with more of one industry can look like a theme).'
        : `, weighted to this month's mix of industries so a month with more banks or more biotech reporting does not look like a theme (${share(matched)} of this month's calls were matched to their own industry or sector).`}
      {' '}New means {say(r.new_max_base_pct)}% of the earlier calls or fewer said it. Rising means the share is up
      by {say(r.rise_min_points)} points or more and is {say(r.rise_min_ratio)} times the share before or
      more (a single word, {say(r.rise_min_ratio_one_word)} times). Either way the phrase needs{' '}
      {count(view.floor?.calls)} calls from {count(view.floor?.companies)} different companies this month, and a gap at
      least {say(r.min_z)} times what chance alone would produce. Left out: the
      operator, safe-harbour and call wording, numbers, dates and seasonal phrases, speaker names, and filler words.
      Phrases said by the same calls are folded into one row (&quot;with&quot;). Everyone on the call is counted,
      analysts as well as executives, and the index keeps recent calls only. A month still in progress moves as more
      calls are indexed. The call search counts other endings of a word too and compares months as they are, so its
      numbers can differ a little. A phrase says what companies are talking about, not what a stock will do.
      Click a phrase to open its quotes beside this panel; type its row number to open them here; click a symbol to
      load it into the linked panels.
      {view.builtAt ? ` Worked out ${builtText(view.builtAt)}; updated once a day.` : ''}
      {read.receivedAt ? ` Read at ${clock(read.receivedAt)}.` : ''}
    </p>
  )
}

export default function CallThemesPanel({ list: listProp = null, month: monthProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || CALL_THEMES_CODE
  // A new `CEOS RISING` remounts the panel (the shell keys the body on code + args), so the typed
  // words only ever seed the state.
  const [list, setList] = useState(() => normCallThemesList(listProp))
  const [month, setMonth] = useState(() => parseCallThemesMonth(monthProp))
  // The pace follows the server's own word that it is still working the lists out.
  const [building, setBuilding] = useState(false)
  const read = useMarketRead(callThemesUrl(month), { refreshInterval: building ? BUILD_POLL_MS : 0 })
  const view = useMemo(() => callThemesRead(read.body), [read.body])
  if ((view.state === 'computing') !== building) setBuilding(view.state === 'computing')

  // A choice writes itself into the command (`CEOS RISING 2026-10`) where the registry takes the
  // words, so a reload keeps it; otherwise it is plain component state (commandWriteBack.js). The
  // newest month is the bare command, so it is never written.
  const pick = (next) => {
    const to = { list, month, ...next }
    setList(to.list)
    setMonth(to.month)
    writeBack(callThemesCommandArgs(to))
  }

  const ok = view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(SOURCE, view.builtAt) : null)
  usePanelRows(rowCommands(view, list))

  const chips = (
    <div className={styles.toolbar} role="toolbar" aria-label="What CEOs are saying controls">
      <div className={styles.group} role="group" aria-label="List">
        {Object.entries(CALL_THEME_LISTS).map(([key, l]) => (
          <button key={key} type="button" className={styles.chip} aria-pressed={key === list} onClick={() => pick({ list: key })}
            data-testid={`terminal-ceos-list-${key}`}>{l.chip}</button>
        ))}
      </div>
      {view.months.length > 1 || (month && view.months.length) ? (
        <div className={styles.group} role="group" aria-label="Month">
          {view.months.map((m, i) => (
            <button key={m.month} type="button" className={styles.chip} aria-pressed={ok && m.month === view.month}
              onClick={() => pick({ month: i === 0 ? null : m.month })} data-testid={`terminal-ceos-month-${m.month}`}>{m.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  )

  let body
  if (read.loading) {
    body = <PanelSkeleton label="Loading what companies are saying on earnings calls" testId="terminal-ceos-loading" />
  } else if ((read.error && !read.body) || view.state === 'failed' || view.state === 'error') {
    const err = read.body ? null : read.error
    const locked = err ? !canRetry(err) : false
    body = (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-ceos-error"
        title={err ? failureText(err, 'What CEOs are saying') : 'The lists could not be worked out just now.'}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no theme. Retry, or run ${code} again.`}
      </PanelState>
    )
  } else if (view.state === 'computing') {
    body = (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-ceos-computing">
        The server is reading every indexed earnings call to work these lists out for the first time. That takes a few
        minutes. This panel asks again every 20 seconds and fills in on its own. That is not the same as no theme.
      </PanelState>
    )
  } else if (view.state === 'empty') {
    body = (
      <PanelState kind="error" role="status" testId="terminal-ceos-index-empty" title="The call index holds no calls right now."
        action={<button type="button" className={styles.chip} onClick={read.retry}>Check again</button>}>
        So there is nothing to count. That is a gap on our side, not a finding about what companies said.
      </PanelState>
    )
  } else if (view.state === 'thin') {
    const r = view.rules
    body = (
      <PanelState kind="empty" role="status" testId="terminal-ceos-thin" title="Too few calls are indexed to compare one month with another yet."
        action={<button type="button" className={styles.chip} onClick={read.retry}>Check again</button>}>
        A month needs {count(r.min_month_calls ?? null)} indexed calls, and the months before it {count(r.min_base_calls ?? null)}{' '}
        between them. {holdsSentence(view.corpus)} That is not the same as no theme.
      </PanelState>
    )
  } else if (view.state === 'no-month') {
    body = (
      <PanelState kind="input" role="status" testId="terminal-ceos-no-month"
        title={`There is no list for ${view.label || monthLabel(month) || 'that month'}.`}
        action={view.months.length
          ? <button type="button" className={styles.chip} onClick={() => pick({ month: null })} data-testid="terminal-ceos-newest">Show {view.months[0].label}</button>
          : null}>
        Lists are kept for the newest month with enough indexed calls and the month before it
        {view.months.length ? `: ${view.months.map((m) => m.label).join(' and ')}.` : '.'} {holdsSentence(view.corpus)}
      </PanelState>
    )
  } else {
    const names = list === 'both' ? ['new', 'rising'] : [list]
    let startAt = 0
    body = (
      <>
        {read.error && <p className={styles.note} role="status">{failureText(read.error, 'What CEOs are saying')} Showing the last read.</p>}
        {view.refreshing ? (
          <p className={styles.note} role="status" data-testid="terminal-ceos-refreshing">
            These lists were worked out {builtText(view.builtAt) || 'a while ago'} and the daily update has not replaced them yet.
            The server is working out new ones now; run {code} again in a few minutes.
          </p>
        ) : null}
        <div className={styles.head}>
          <span className={styles.lede} data-testid="terminal-ceos-totals">{comparedSentence(view)}</span>
        </div>
        {names.map((name) => {
          const rows = shownRows(view.lists[name].rows, list)
          const table = (
            <ThemeTable key={name} name={name} list={view.lists[name]} rows={rows} startAt={startAt} view={view} code={code}
              onAll={() => pick({ list: name })} />
          )
          startAt += rows.length
          return table
        })}
        <Method view={view} read={read} />
      </>
    )
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-ceos" data-list={list} data-month={view.month || month || ''}>
      {chips}
      {body}
    </div>
  )
}
