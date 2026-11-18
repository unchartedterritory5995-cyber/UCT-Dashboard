// SHRTS: the newest FINRA short interest report across the stocks UCT follows, ranked.
//
//   SHRTS         most days to cover first        SHRTS UP     biggest increase since the last report
//   SHRTS FLOAT   highest percent of float        SHRTS DOWN   biggest decrease
//
// `GET /api/research/short-interest-list?rank=` (paid; api/services/short_data.py). The server
// holds one list per report and never builds it on the request: with none held it says
// "computing" and this panel asks again. The pure half is shortListModel.js, re-exported below.
//
// What it adds: the terminal had no short list at all. The Screener has one undated short interest
// column from its nightly export; this is FINRA's dated report, each stock beside its previous
// report, so "who is being shorted more" can be asked.
//
// ⛔ A REFUSED DATA PLAN IS AN ANSWER, NOT AN ERROR: plain words, no Retry loop.
// ⛔ THE LIST IS AS OLD AS ITS SETTLEMENT DATE, and the panel says how old above the rows.
// ⛔ A MISSING NUMBER IS NEVER 0. A stock without the number a rank needs is not ranked, and the
// panel says how many are.
// ⛔ THE SERVER CUTS THE LIST (the first 100 of a rank) and the panel says so, and from which end.
// ⛔ NO GREEN OR RED: those are price colors here. A change is a sign (+/-) and a number.
//
// WIDTH. Six short columns at 640px. At 390px four stay: the symbol, the short interest, the
// change, and whichever of days to cover and percent of float is being ranked; a two-word heading
// may take two lines.
//
// The read goes through marketRead.js (the terminal's one bare-SWR reader), and SWR skips ticks
// while the app is hidden.
import { useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { formatCompactTerminal, formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { todayIso } from '../../calendar/earningsModalRow'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import { dayText, daysBetween, etDayOf, unavailableWords } from './shortInterestModel'
import {
  SHORT_LIST_CODE, SHORT_RANKS, SOURCE, changeWay, normShortRank, shortListCommandArgs, shortListRead, shortListUrl,
} from './shortListModel'
import ShortDataNotes from './ShortDataNotes'
import styles from './marketPanels.module.css'

export {
  DEFAULT_SHORT_RANK, SHORT_LIST_CODE, SHORT_RANKS, SHORT_RANK_ARG_WORDS, SOURCE, changeWay, normShortRank, parseShortRank,
  shortListCommandArgs, shortListRead, shortListUrl,
} from './shortListModel'

/** Rows drawn at first, and added by each "Show more"; the rest the server sent are counted, never dropped. */
export const PAGE_ROWS = 25
const WHAT = 'The short interest list'
const NA = 'not given'
const COMPUTING_POLL_MS = 3 * 1000
/** A report changes twice a month; the server looks for a newer one a few times a day. */
const HELD_POLL_MS = 30 * 60 * 1000

const count = (n) => formatNumber(n, { decimals: 0 })
const shares = (v) => formatCompactTerminal(v, { absent: NA })
const signedShares = (v) => (v == null ? NA : `${v > 0 ? '+' : v < 0 ? '-' : ''}${formatCompactTerminal(Math.abs(v))}`)
const signedPct = (v) => formatPercent(v, { decimals: 1, signed: true, absent: NA })
const pct = (v) => formatPercent(v, { decimals: 1, absent: NA })
const days = (v) => (v == null ? NA : formatNumber(v, { decimals: 1 }))
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')
const plural = (n, one, many) => (n === 1 ? one : many)

/** Pure: what the report is and how old it is, in a sentence. */
export function reportSentence(view, today) {
  const age = daysBetween(view.settlementDate, today)
  const old = age != null && age >= 0 ? `, ${count(age)} ${plural(age, 'day', 'days')} ago` : ''
  const cover = view.count != null && view.universe != null
    ? ` ${count(view.count)} of the ${count(view.universe)} stocks UCT follows are in it.`
    : ''
  const against = view.previousDate ? ` Each is set beside its ${dayText(view.previousDate)} report.` : ' There is no earlier report to set it beside.'
  return `FINRA short interest for the ${dayText(view.settlementDate)} settlement date${old}.${cover}${against}`
}

/** Pure: how many stocks the rank covers and how many of them are on screen, in a sentence. */
export function rankSentence(view, shown) {
  const words = SHORT_RANKS[view.rank].words
  const floor = view.floorShares != null && (view.rank === 'up' || view.rank === 'down')
    ? ` Only stocks whose previous report was at least ${count(view.floorShares)} shares are ranked, so a tiny position cannot top the list.`
    : ''
  const sent = view.rows.length
  const all = shown >= sent
  const showing = view.cut
    ? `The server sent the first ${count(sent)}; showing ${all ? 'all of those' : `the first ${count(shown)} of those`}.`
    : `Showing ${all ? (sent === 1 ? 'it' : `all ${count(sent)}`) : `the first ${count(shown)}`}.`
  return `${count(view.ranked)} ${plural(view.ranked, 'stock', 'stocks')} ranked, ${words}. ${showing}${floor}`
}

/** Pure: why a rank has no stock, in a sentence. */
export function emptyRankWords(view) {
  if (view.rank === 'float') return 'No stock in the report has a float on file, so none can be ranked by percent of float.'
  if (view.rank === 'dtc') return 'No stock in the report came with days to cover.'
  if (!view.previousDate) return 'There is no earlier report to measure a change from.'
  return `No stock with a previous report of at least ${count(view.floorShares ?? 0)} shares ${view.rank === 'up' ? 'rose' : 'fell'} in this report.`
}

function FailedRead({ read, code }) {
  const err = read.body ? null : read.error
  const locked = err ? !canRetry(err) : false
  return (
    <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-shorts-error"
      title={err ? failureText(err, WHAT) : `${WHAT} could not be read just now.`}
      action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
      {locked ? null : `That is not the same as an empty list. Retry, or run ${code} again.`}
    </PanelState>
  )
}

function ShortRow({ r, i, rank }) {
  const way = changeWay(r)
  // On a phone the column being ranked always stays: percent of float gives way unless it is the rank.
  const byFloat = rank === 'float'
  return (
    <tr data-testid="terminal-shorts-row" data-sym={r.sym} data-way={way || 'none'}>
      <td>
        <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
        <PanelSymbol sym={r.sym} className={styles.sym} />
      </td>
      <td className={byFloat ? styles.phoneHide : undefined}>{days(r.dtc)}</td>
      <td>{shares(r.short)}</td>
      <td>
        {way == null ? <span className={styles.muted}>No earlier report</span> : (
          <>
            {way === 'flat' ? 'Unchanged' : r.changePct != null ? signedPct(r.changePct) : 'No percent'}
            <br />
            <span className={styles.muted}>{signedShares(r.changeShares)}</span>
          </>
        )}
      </td>
      <td className={byFloat ? undefined : styles.phoneHide}>{r.pctFloat != null ? pct(r.pctFloat) : <span className={styles.muted}>No float</span>}</td>
      <td className={styles.phoneHide}>{shares(r.adv)}</td>
    </tr>
  )
}

/** One rank's read and everything drawn from it. Keyed by the rank (see the panel below), so one
 *  rank's rows are never drawn under another's name while the next read is on its way. */
function ShortList({ rank, pick, code, inPanel }) {
  const [today] = useState(todayIso)
  const [limit, setLimit] = useState(PAGE_ROWS)
  const [pace, setPace] = useState(HELD_POLL_MS)
  const read = useMarketRead(shortListUrl(rank), { refreshInterval: pace })
  const view = useMemo(() => shortListRead(read.body), [read.body])
  // The pace follows the server's own word (adjusted during render from the last answer).
  const wantPace = view.state === 'computing' ? COMPUTING_POLL_MS : HELD_POLL_MS
  if (wantPace !== pace) setPace(wantPace)

  const ok = !read.loading && !!read.body && view.state === 'ok'
  const shown = useMemo(() => (ok ? view.rows.slice(0, limit) : []), [ok, view.rows, limit])
  usePanelFreshness(ok ? panelAsOf(SOURCE, view.settlementDate) : null)
  usePanelSymbolRows(shown.map((r) => r.sym), `short interest, ${SHORT_RANKS[rank].words}`, { total: ok ? view.ranked : null })

  const toolbar = (
    <div className={styles.toolbar} role="toolbar" aria-label="Short interest list controls">
      <div className={styles.group} role="group" aria-label="Rank by">
        {Object.entries(SHORT_RANKS).map(([key, r]) => (
          <button key={key} type="button" className={styles.chip} aria-pressed={key === rank} onClick={() => pick(key)}
            data-testid={`terminal-shorts-rank-${key}`}>{r.chip}</button>
        ))}
      </div>
    </div>
  )
  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-shorts" data-state={state} data-rank={rank}>
      {toolbar}
      {body}
    </div>
  )

  if (read.loading) return frame('loading', <PanelSkeleton label="Loading the short interest list" testId="terminal-shorts-loading" />)
  if (!read.body || view.state === 'failed') return frame('error', <FailedRead read={read} code={code} />)
  if (view.state === 'computing') {
    return frame('computing', (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-shorts-computing">
        The server is reading the newest FINRA report from the data vendor and setting each stock beside its previous
        report. That takes a few seconds the first time. This panel asks again every 3 seconds and fills in on its own.
        That is not the same as an empty list.
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    const plan = view.reason === 'refused' || view.reason === 'not_configured' || !view.reason
    return frame('unavailable', (
      <PanelState kind="locked" role="status" testId="terminal-shorts-unavailable" title={unavailableWords('Short interest', view.reason, view.httpStatus)}>
        {plan
          ? 'The site reads FINRA short interest through its stock-data vendor, Massive, and the vendor did not allow it. '
          : 'The site reads FINRA short interest through its stock-data vendor, Massive. '}
        That is not the same as an empty list. The server asks again by itself; nothing here needs a retry.
      </PanelState>
    ))
  }

  const byFloat = rank === 'float'
  const canShowMore = shown.length < view.rows.length
  return frame('ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-shorts-stale-read">{failureText(read.error, WHAT)} Showing the last read.</p> : null}
      {view.check ? (
        <p className={styles.note} role="status" data-testid="terminal-shorts-check">
          {view.check.state === 'unavailable'
            ? `${unavailableWords('A newer report', view.check.reason, view.check.httpStatus)} `
            : 'The last look for a newer report did not get an answer. '}
          This is the last list the site read, for the {dayText(view.settlementDate)} settlement date.
        </p>
      ) : null}
      {view.landing ? (
        <p className={styles.note} role="status" data-testid="terminal-shorts-landing">
          A newer report, for the {dayText(view.landing)} settlement date, is still arriving at the data vendor. This list
          stays on the last complete report until it has all arrived.
        </p>
      ) : null}
      <div className={styles.head}>
        <span className={styles.lede} data-testid="terminal-shorts-report">{reportSentence(view, today)}</span>
      </div>
      {view.rows.length ? (
        <>
          <p className={styles.lede} data-testid="terminal-shorts-ranked">{rankSentence(view, shown.length)}</p>
          <div className={styles.tableBox} data-fold="510">
            <table className={styles.table} data-testid="terminal-shorts-table"
              aria-label={`Short interest for the ${dayText(view.settlementDate)} settlement date, ${SHORT_RANKS[rank].words}, ${shown.length} of ${view.ranked}`}>
              <thead>
                <tr>
                  <th scope="col" title="Click a symbol to load it into the linked panels">Symbol</th>
                  <th scope="col" className={byFloat ? styles.phoneHide : styles.phoneWrap} title="Short interest divided by the average daily volume, as the data vendor works it out">Days to cover</th>
                  <th scope="col" className={styles.phoneWrap} title="Shares sold short and not yet bought back on the settlement date">Short interest</th>
                  <th scope="col" title="The change from the previous report, in percent and in shares">Change</th>
                  <th scope="col" className={byFloat ? styles.phoneWrap : styles.phoneHide} title="Short interest as a percent of today's float from the nightly screener export">% of float</th>
                  <th scope="col" className={styles.phoneHide} title="The average daily volume the days to cover are worked out from">Avg daily volume</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => <ShortRow key={r.sym} r={r} i={i} rank={rank} />)}
              </tbody>
            </table>
          </div>
          {canShowMore ? (
            <div className={styles.toolbar}>
              <button type="button" className={styles.chip} data-testid="terminal-shorts-more"
                onClick={() => setLimit((n) => n + PAGE_ROWS)}>
                Show {count(Math.min(PAGE_ROWS, view.rows.length - shown.length))} more
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <PanelState kind="empty" compact role="status" testId="terminal-shorts-none" title={emptyRankWords(view)}
          action={rank === 'dtc' ? null : <button type="button" className={styles.chip} onClick={() => pick('dtc')}>Rank by days to cover</button>}>
          That is what the report holds, not a failed read.
        </PanelState>
      )}
      {view.unread ? (
        <p className={styles.muted} data-testid="terminal-shorts-unread">
          {count(view.unread)} {plural(view.unread, 'row', 'rows')} came without a symbol or a short interest and {plural(view.unread, 'is', 'are')} not listed.
        </p>
      ) : null}
      <ShortDataNotes testId="terminal-shorts-method">
        {' '}Percent of float divides FINRA&apos;s short interest by today&apos;s float from the nightly screener export, so a
        split or a share offering since the settlement date makes it wrong; above 150% it is not shown.
        {view.float.state === 'missing' ? ' The screener export could not be read, so no stock has a percent of float right now.' : ''}
        {view.float.state === 'stale' ? ' The screener export is several days old.' : ''}
        {view.publicationEstimate ? ` FINRA's schedule put this report's publication on about ${dayText(view.publicationEstimate)}; the data vendor does not give the day.` : ''}
        {etDayOf(view.readAt) ? ` The site read this report from the data vendor on ${dayText(etDayOf(view.readAt))}${clock(view.readAt) ? ` at ${clock(view.readAt)}` : ''}.` : ''}
        {' '}Click a symbol to load it into the linked panels; type a row number to do the same.
      </ShortDataNotes>
    </>
  ))
}

export default function ShortListPanel({ rank: rankProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || SHORT_LIST_CODE
  // A new `SHRTS UP` remounts the panel (the shell keys the body on code + args), so the typed
  // word only ever seeds the state.
  const [rank, setRank] = useState(() => normShortRank(rankProp))
  // A pick writes itself into the command (`SHRTS FLOAT`) where the registry takes the word, so a
  // reload keeps it; otherwise it is plain component state (commandWriteBack.js).
  const pick = (next) => {
    const key = normShortRank(next)
    setRank(key)
    writeBack(shortListCommandArgs({ rank: key }))
  }
  return <ShortList key={rank} rank={rank} pick={pick} code={code} inPanel={inPanel} />
}
