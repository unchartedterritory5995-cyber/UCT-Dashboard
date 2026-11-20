// GRP: one sector, industry or UCT theme and its stocks, ranked by their change over a range, each
// with its RS rank and whether it is on the confluence board.
//
//   GRP XLK                    a sector fund is its sector          GRP TECHNOLOGY       a sector by name
//   GRP SEMICONDUCTORS         an industry, or a UCT theme          GRP THEME AI / GPU CHIPS   a kind word pins it
//   GRP XLK 3M                 MTD | QTD | YTD (the default) | 1M | 3M | 6M | 1Y, PCHG's own ranges
//
// ⭐ NO NEW ROUTE. The group, its stocks and their changes are the two period-change answers PCHG
// reads, which the server keeps built for the seven one-click ranges; RS is the RS ranking and the
// one flow signal is the confluence board, each a cached read of the whole list. The pure half (the
// resolver, the join, the sort) is groupDrillModel.js, re-exported below.
//
// ⛔ A NAME IS RESOLVED, NEVER GUESSED. A name that fits no group says so and offers the nearest;
// one that fits several asks which. A UCT theme with no curated stocks says that, and is never
// drawn as an empty table.
// ⛔ EVERY SIDE READ FAILS APART. The stocks are listed as soon as the group is known. A failed or
// slow stock ranking leaves them with no change (never 0%); a failed RS or confluence read empties
// that one column and says so, and the rest of the table stands.
//
// The reads go through marketRead.js (the terminal's one bare-SWR reader), and SWR skips ticks
// while the app is hidden.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { ariaSortFor, nextSort, sortCaretFor } from '../../../lib/presentation/dataGrid'
import { todayIso } from '../../calendar/earningsModalRow'
import { WARMING_TITLE, canRetry, failureKind, failureText, isWarmingError, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import useWarmingPoll from './warmingPoll'
import { PERIOD_RANGES, breadthOf, periodGroupsRead, periodGroupsUrl, periodRead, periodRequest } from './periodChangeModel'
import { CONFLUENCE_URL, confluenceRead } from './confluenceModel'
import { THEMES_URL, imovCommand } from './imovModel'
import {
  DEFAULT_GROUP_SORT, GROUP_DRILL_CODE, GROUP_KINDS, GROUP_MAX_ROWS, GROUP_PAGE_ROWS, GROUP_RS_URL, GROUP_SORTS, SECTOR_FUNDS,
  combineGroupLists, flowBoard, flowWords, groupDrillCommandArgs, groupDrillRows, groupKindsToRead, groupSortWords, normGroupRange,
  parseGroupQuery, resolveGroup, rsRanks, sortGroupRows, taxonomyTheme,
} from './groupDrillModel'
import styles from './marketPanels.module.css'

export {
  DEFAULT_GROUP_SORT, GROUP_DRILL_CODE, GROUP_KINDS, GROUP_KIND_ARG_WORDS, GROUP_KIND_ORDER, GROUP_MAX_ROWS, GROUP_PAGE_ROWS, GROUP_RS_URL,
  GROUP_SORTS, GROUP_SUGGESTIONS, SECTOR_FUNDS, combineGroupLists, flowBoard, flowWords, groupDrillCommand, groupDrillCommandArgs,
  groupDrillRows, groupKey, groupKindsToRead, groupSortWords, normGroupRange, normGroupSort, parseGroupQuery, resolveGroup, rsRanks,
  sectorFundForName, sectorFundOf, sortGroupRows, taxonomyTheme,
} from './groupDrillModel'

/** While the server says it is still working, it is asked again at this pace. */
const COMPUTING_POLL_MS = 5 * 1000
const RS_POLL_MS = 30 * 60 * 1000
const BOARD_POLL_MS = 5 * 60 * 1000
const BOARD_WARM_POLL_MS = 20 * 1000
const SOURCE = 'UCT whole-market daily closes'
const WHAT = 'The group ranking'
const NA = 'n/a'
const TO_VIEW = Object.freeze({
  sector: (body) => periodGroupsRead(body, 'sector'),
  industry: (body) => periodGroupsRead(body, 'industry'),
  theme: (body) => periodGroupsRead(body, 'theme'),
})

const count = (n) => formatNumber(n, { decimals: 0 })
const signedPct = (v) => formatPercent(v, { decimals: 1, signed: true, absent: NA })
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)
const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')
const plural = (n, one, many) => (n === 1 ? one : many)
const optionKey = (o) => `${o.kind}:${o.name}`

/**
 * One period read, as the model reads it. The pace follows the server's own word that it is still
 * working: `computing` is adjusted during render from the last answer (no effect, so no extra pass
 * through an old value). A null `url` asks for nothing.
 */
function usePeriodRead(url, toView) {
  const [computing, setComputing] = useState(false)
  const read = useMarketRead(url, { refreshInterval: computing ? COMPUTING_POLL_MS : 0 })
  const view = useMemo(() => toView(read.body), [read.body, toView])
  if ((view.state === 'computing') !== computing) setComputing(view.state === 'computing')
  return { read, view }
}

/** The groups a name could mean, as buttons. */
function OptionChips({ options, onPick, testId }) {
  return (
    <span className={styles.group} role="group" aria-label="Groups" data-testid={testId}>
      {options.map((o) => (
        <button key={optionKey(o)} type="button" className={styles.chip} onClick={() => onPick(o)}>
          {o.name} ({GROUP_KINDS[o.kind].one})
        </button>
      ))}
    </span>
  )
}

/** Nothing names a group yet: the 11 sectors as buttons, and what can be typed. */
function Idle({ code, onPick }) {
  return (
    <PanelState kind="input" role="status" testId="terminal-grp-idle" title="Pick a group to see its stocks ranked."
      action={(
        <span className={styles.group} role="group" aria-label="Sectors">
          {SECTOR_FUNDS.map((f) => (
            <button key={f.fund} type="button" className={styles.chip} onClick={() => onPick({ kind: 'sector', name: f.name, fund: f.fund })}
              data-testid={`terminal-grp-sector-${f.fund}`}>{f.name}</button>
          ))}
        </span>
      )}>
      Type a sector fund, a sector, an industry or a UCT theme after the code: <kbd>{code} XLK</kbd>,{' '}
      <kbd>{code} SEMICONDUCTORS</kbd> or <kbd>{code} THEME AI / GPU CHIPS</kbd>. Every group is ranked in{' '}
      <PanelCommand cmd="PCHG SECTORS" label="Open every sector ranked">PCHG SECTORS</PanelCommand>,{' '}
      <PanelCommand cmd="PCHG INDUSTRIES" label="Open every industry ranked">PCHG INDUSTRIES</PanelCommand> and{' '}
      <PanelCommand cmd="PCHG THEMES" label="Open every UCT theme ranked">PCHG THEMES</PanelCommand>.
    </PanelState>
  )
}

/** The RS and confluence reads that failed or are still being prepared, one sentence each. */
function SideNotes({ rs, rsView, rsWarm, conf, confView }) {
  const rsFailed = !rs.loading && !rsWarm.active && ((rs.error && !rs.body) || (rs.body !== undefined && rsView.state !== 'ok'))
  const boardFailed = !conf.loading && ((conf.error && !conf.body) || (conf.body !== undefined && confView.state !== 'ok' && confView.state !== 'warming'))
  return (
    <>
      {rsWarm.active ? (
        <p className={styles.note} role="status" data-testid="terminal-grp-rs-warming">
          {rsWarm.gaveUp
            ? 'The server is still preparing the RS ranks, so the RS column is empty. '
            : 'The server is preparing the RS ranks, so the RS column is empty for now. This panel asks again on its own. '}
          {rsWarm.gaveUp ? <button type="button" className={styles.linkBtn} onClick={rsWarm.retry}>Retry</button> : null}
        </p>
      ) : null}
      {rsFailed ? (
        <p className={styles.note} role="status" data-testid="terminal-grp-rs-failed">
          {rs.error && !rs.body ? failureText(rs.error, 'The RS ranking') : 'RS ranks came back in a form this panel cannot read.'}
          {' '}The RS column is empty; that is not a rank of 0.{' '}
          {!rs.error || canRetry(rs.error) ? <button type="button" className={styles.linkBtn} onClick={rs.retry}>Retry</button> : null}
        </p>
      ) : null}
      {!conf.loading && conf.body !== undefined && confView.state === 'warming' ? (
        <p className={styles.note} role="status" data-testid="terminal-grp-flow-warming">
          The server is putting the confluence board together, so the Flow column is empty for now. This panel asks again
          on its own.
        </p>
      ) : null}
      {boardFailed ? (
        <p className={styles.note} role="status" data-testid="terminal-grp-flow-failed">
          {conf.error && !conf.body ? failureText(conf.error, 'The confluence board') : 'The confluence board could not be read just now.'}
          {' '}The Flow column is empty; that is not the same as no stock being on the board.{' '}
          {!conf.error || canRetry(conf.error) ? <button type="button" className={styles.linkBtn} onClick={conf.retry}>Retry</button> : null}
        </p>
      ) : null}
    </>
  )
}

function Drill({ query, req, code, sort, onSort, onPick, onResolved }) {
  const kinds = groupKindsToRead(query)
  const listUrl = (kind) => (kinds.includes(kind) ? periodGroupsUrl(req.start, req.end, kind) : null)
  const sector = usePeriodRead(listUrl('sector'), TO_VIEW.sector)
  const industry = usePeriodRead(listUrl('industry'), TO_VIEW.industry)
  const theme = usePeriodRead(listUrl('theme'), TO_VIEW.theme)
  const reads = { sector, industry, theme }
  const part = (kind) => ({ kind, loading: reads[kind].read.loading, error: reads[kind].read.body ? null : reads[kind].read.error, view: reads[kind].view })
  const kindsKey = kinds.join(',')
  const lists = useMemo(() => combineGroupLists(kindsKey ? kindsKey.split(',').map(part) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kindsKey, sector.read.loading, sector.read.error, sector.view, industry.read.loading, industry.read.error, industry.view,
      theme.read.loading, theme.read.error, theme.view])
  const resolved = useMemo(() => (lists.state === 'ok' ? resolveGroup(lists.lists, query) : null), [lists, query])

  // A name no ranked list holds may still be a UCT theme (one with no ranked stock is not sent by
  // the ranking). The theme list is read only then, and only for a name that could be a theme.
  const askThemes = resolved?.status === 'unknown' && !resolved.fund && query.kind !== 'sector' && query.kind !== 'industry'
  const themes = useMarketRead(askThemes ? THEMES_URL : null)
  const listed = useMemo(() => (askThemes && themes.body ? taxonomyTheme(themes.body, query) : null), [askThemes, themes.body, query])
  const group = resolved?.status === 'ok' ? resolved.group : listed?.status === 'ok' ? listed.group : null
  const also = resolved?.status === 'ok' ? resolved.also : []

  // Each stock's own change is read alongside the lists; RS and the confluence board only once a
  // group is known. Each of the three fails apart.
  const stocks = usePeriodRead(kinds.length ? req.url : null, periodRead)
  const rs = useMarketRead(group ? GROUP_RS_URL : null, { refreshInterval: RS_POLL_MS })
  const rsView = useMemo(() => rsRanks(rs.body), [rs.body])
  const rsWarming = !!group && !rs.body && isWarmingError(rs.error)
  const rsPoll = useWarmingPoll(rsWarming, rs.retry, { everyMs: 10_000, maxTries: 12 })
  const [boardWarming, setBoardWarming] = useState(false)
  const conf = useMarketRead(group ? CONFLUENCE_URL : null, { refreshInterval: boardWarming ? BOARD_WARM_POLL_MS : BOARD_POLL_MS })
  const confView = useMemo(() => confluenceRead(conf.body), [conf.body])
  if ((conf.body !== undefined && confView.state === 'warming') !== boardWarming) setBoardWarming(!boardWarming)

  const stocksOk = stocks.view.state === 'ok'
  const ranks = rsView.state === 'ok' ? rsView.ranks : null
  const board = useMemo(() => (confView.state === 'ok' ? flowBoard(confView) : null), [confView])
  const built = useMemo(() => groupDrillRows(group, stocksOk ? stocks.view.rows : [], { ranks, board }), [group, stocksOk, stocks.view, ranks, board])
  const ordered = useMemo(() => sortGroupRows(built.rows, sort), [built, sort])
  const [limit, setLimit] = useState(GROUP_PAGE_ROWS)
  const shown = useMemo(() => ordered.slice(0, limit), [ordered, limit])

  usePanelFreshness(group && lists.endDay ? panelAsOf(SOURCE, lists.endDay) : null)
  usePanelSymbolRows(group && !stocks.read.loading ? shown.map((r) => r.sym) : [], `the stocks in ${group?.name || 'this group'}`, { total: built.total })
  // The group on screen, told to the frame above: a range chip then writes the resolved group into
  // the command (`GRP SECTOR TECHNOLOGY 3M`), not the half-typed name.
  const groupKind = group?.kind || null
  const groupName = group?.name || null
  useEffect(() => {
    onResolved(groupName ? { kind: groupKind, name: groupName, fund: query.fund } : null)
    return () => onResolved(null)
  }, [onResolved, groupKind, groupName, query.fund])

  const retryLists = () => kinds.forEach((k) => reads[k].read.retry())
  const range = PERIOD_RANGES[req.range]

  if (lists.state === 'loading') return <PanelSkeleton label={`Looking up ${query.text}`} testId="terminal-grp-loading" />
  if (lists.state === 'error') {
    const locked = !canRetry(lists.error)
    return (
      <PanelState kind={failureKind(lists.error)} testId="terminal-grp-error" title={failureText(lists.error, WHAT)}
        action={locked ? null : <button type="button" className={styles.chip} onClick={retryLists}>Retry</button>}>
        {locked ? null : lists.error?.timedOut
          ? 'The first ranking of a range can take longer than that. The server keeps working on it, so Retry usually has it. That is not the same as a group with no stocks.'
          : `That is not the same as a group with no stocks. Retry, or run ${code} again.`}
      </PanelState>
    )
  }
  if (lists.state === 'computing') {
    return (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-grp-computing">
        The server is ranking the whole market for {range.words}. This panel asks again every 5 seconds and fills in on
        its own. That is not the same as a group with no stocks.
      </PanelState>
    )
  }
  if (lists.state !== 'ok') {
    return (
      <PanelState kind="error" testId="terminal-grp-error" title={`${WHAT} could not be read just now.`}
        action={<button type="button" className={styles.chip} onClick={retryLists}>Retry</button>}>
        {lists.state === 'unavailable'
          ? 'The server has no market-wide prices on hand for this range. That is not the same as a group with no stocks.'
          : `That is not the same as a group with no stocks. Retry, or run ${code} again.`}
      </PanelState>
    )
  }
  if (lists.sameDay) {
    return (
      <PanelState kind="input" role="status" testId="terminal-grp-same-day"
        title={`Both ends of ${range.words} land on one trading day, ${lists.endDay}, so there is no change to rank yet.`}>
        The server uses the last trading day with a published close on or before each date. Pick a longer range above.
      </PanelState>
    )
  }
  if (resolved.status === 'ambiguous') {
    return (
      <PanelState kind="input" compact role="status" testId="terminal-grp-ambiguous"
        title={`"${resolved.query}" fits ${count(resolved.total)} groups. Which one did you mean?`}
        action={<OptionChips options={resolved.options} onPick={onPick} testId="terminal-grp-options" />}>
        {resolved.total > resolved.options.length
          ? `Only the first ${resolved.options.length} are listed here. Type more of the name.`
          : 'Type more of the name, or pick one.'}
      </PanelState>
    )
  }
  if (!group && askThemes && themes.loading) {
    return <PanelSkeleton label={`Looking up ${query.text} in the UCT themes`} testId="terminal-grp-loading" />
  }
  if (!group && listed?.status === 'none') {
    return (
      <PanelState kind="empty" role="status" testId="terminal-grp-no-members" title={`${listed.name} is a UCT theme with no stocks to rank.`}>
        It holds no curated stocks. Suggested members are not counted or listed. That is not the same as a theme whose
        stocks did not move.
      </PanelState>
    )
  }
  if (!group) {
    const kindWords = GROUP_KINDS[query.kind]?.one || 'sector, industry or UCT theme'
    const list = resolved.suggestions || []
    return (
      <PanelState kind="input" compact role="status" testId="terminal-grp-unknown"
        title={resolved.fund
          ? `No sector in the ranking matches the fund ${resolved.fund}.`
          : `No ${kindWords} is called "${resolved.query}".`}
        action={list.length ? <OptionChips options={list} onPick={onPick} testId="terminal-grp-didyoumean" /> : null}>
        {list.length ? 'Did you mean one of these?' : 'Check the name.'} Every group is ranked in{' '}
        <PanelCommand cmd="PCHG SECTORS" label="Open every sector ranked">PCHG SECTORS</PanelCommand>,{' '}
        <PanelCommand cmd="PCHG INDUSTRIES" label="Open every industry ranked">PCHG INDUSTRIES</PanelCommand> and{' '}
        <PanelCommand cmd="PCHG THEMES" label="Open every UCT theme ranked">PCHG THEMES</PanelCommand>.
      </PanelState>
    )
  }

  const kind = GROUP_KINDS[group.kind]
  const startDay = lists.startDay || req.start
  const endDay = lists.endDay || req.end
  const breadth = breadthOf(built.rows.filter((r) => r.pct !== null))
  const stocksFailed = !stocks.read.loading && !stocksOk && stocks.view.state !== 'computing'
  const staleLists = kinds.some((k) => reads[k].read.error && reads[k].read.body)
  const showIndustry = group.kind !== 'industry'
  const sortWords = groupSortWords(sort)
  const header = (key, label, title) => (
    <th scope="col" title={title} aria-sort={ariaSortFor(sort, key, 'none')}>
      <button type="button" className={styles.sortBtn} onClick={() => onSort(nextSort(sort, key, (k) => GROUP_SORTS[k].first))}
        data-testid={`terminal-grp-sort-${key}`}>
        {label}
        {sortCaretFor(sort, key) ? <span aria-hidden="true">{` ${sortCaretFor(sort, key)}`}</span> : null}
      </button>
    </th>
  )
  return (
    <>
      {staleLists ? <p className={styles.note} role="status">{WHAT} could not be read again just now. Showing the last read.</p> : null}
      <div className={styles.head} data-testid="terminal-grp-head" data-kind={group.kind}>
        <strong data-testid="terminal-grp-name">{group.name}</strong>
        <span className={styles.muted}>
          {kind.label}{group.fund ? <>, fund <PanelSymbol sym={group.fund} className={styles.sym} /></> : null}
        </span>
        <span className={tone(group.pct)} data-testid="terminal-grp-change">{signedPct(group.pct)}</span>
      </div>
      <div className={styles.head}>
        <span className={styles.lede} data-testid="terminal-grp-totals">
          {count(built.total)} {plural(built.total, 'stock', 'stocks')}, from the close of {startDay} to the close of {endDay}
          {stocksOk && built.known ? `: ${count(breadth.up)} rose, ${count(breadth.down)} fell${breadth.flat ? `, ${count(breadth.flat)} did not move` : ''}` : ''}.
          {stocksOk && built.known < built.total ? ` ${count(built.total - built.known)} ${plural(built.total - built.known, 'has', 'have')} no close on both days and no change.` : ''}
        </span>
      </div>
      {group.listed ? (
        <p className={styles.note} role="status" data-testid="terminal-grp-listed">
          The ranking for {range.words} has no figure for {group.name}, so the theme&apos;s own change is not shown. Its
          curated stocks are listed from the UCT theme list.
        </p>
      ) : null}
      {also.map((o) => (
        <p key={optionKey(o)} className={styles.muted} data-testid="terminal-grp-also">
          {group.name} is also {GROUP_KINDS[o.kind].a}.{' '}
          <button type="button" className={styles.linkBtn} onClick={() => onPick(o)}>Open the {GROUP_KINDS[o.kind].one}</button>
        </p>
      ))}
      {!stocks.read.loading && stocks.view.state === 'computing' ? (
        <p className={styles.note} role="status" data-testid="terminal-grp-stocks-computing">
          The server is still working out each stock&apos;s own change. This panel asks again every 5 seconds and fills
          them in on its own; until then the stocks are listed without one.
        </p>
      ) : null}
      {stocksFailed ? (
        <p className={styles.note} role="status" data-testid="terminal-grp-stocks-failed">
          {stocks.read.error && !stocks.read.body ? failureText(stocks.read.error, 'Each stock\'s own change') : 'Each stock\'s own change could not be read just now.'}
          {' '}The stocks are listed without it; that is not a change of 0%.{' '}
          {!stocks.read.error || canRetry(stocks.read.error) ? <button type="button" className={styles.linkBtn} onClick={stocks.read.retry}>Retry</button> : null}
        </p>
      ) : null}
      <SideNotes rs={rs} rsView={rsView} rsWarm={{ active: rsWarming, gaveUp: rsPoll.gaveUp, retry: rsPoll.retry }} conf={conf} confView={confView} />
      {stocks.read.loading ? <PanelSkeleton label={`Loading each stock's change in ${group.name}`} testId="terminal-grp-stocks-loading" /> : !built.total ? (
        <PanelState kind="empty" compact role="status" testId="terminal-grp-no-list" title={`The server sent no stock list for ${group.name}.`}>
          Its change above was still worked out from its stocks. That is not the same as a group with no stocks.
        </PanelState>
      ) : (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-grp-table" data-sort={`${sort.key}:${sort.dir}`}
            aria-label={`The stocks in ${group.name} from ${startDay} to ${endDay}, ${sortWords}, ${shown.length} of ${built.total}`}>
            <thead>
              <tr>
                <th scope="col" title="Click a symbol to load it into the linked panels">Symbol</th>
                {header('pct', 'Change', 'Percent change from the start close to the end close')}
                {header('rs', 'RS', 'UCT RS rank, 1 to 99, against the whole ranked universe')}
                <th scope="col" className={styles.phoneHide} title="On the confluence board: large dark pool size with long-dated options flow">Flow</th>
                {showIndustry ? <th scope="col" className={`${styles.phoneHide} ${styles.wrapCell}`}>Industry</th> : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.key} data-testid={`terminal-grp-row-${r.sym}`}>
                  <td>
                    <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                    <PanelSymbol sym={r.sym} className={styles.sym} />
                  </td>
                  <td className={tone(r.pct)}>{signedPct(r.pct)}</td>
                  <td>{r.rs !== null ? count(r.rs) : ranks ? NA : ''}</td>
                  <td className={`${styles.phoneHide} ${r.flow ? tone(r.flow.direction === 'bullish' ? 1 : -1) : ''}`}>{flowWords(r.flow) || ''}</td>
                  {showIndustry ? <td className={`${styles.phoneHide} ${styles.wrapCell}`}>{r.industry || (stocksOk && r.pct !== null ? 'Not given' : '')}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!stocks.read.loading && shown.length < built.total ? (
        <div className={styles.toolbar}>
          {shown.length < GROUP_MAX_ROWS ? (
            <button type="button" className={styles.chip} data-testid="terminal-grp-more" onClick={() => setLimit((n) => Math.min(GROUP_MAX_ROWS, n + GROUP_PAGE_ROWS))}>
              Show {count(Math.min(GROUP_PAGE_ROWS, GROUP_MAX_ROWS - shown.length, built.total - shown.length))} more
            </button>
          ) : null}
          <span className={styles.muted} data-testid="terminal-grp-cut">
            Showing {count(shown.length)} of {count(built.total)} stocks, {sortWords}.
            {shown.length < GROUP_MAX_ROWS ? '' : ` This panel draws ${count(GROUP_MAX_ROWS)} at most; sort the other way to see the other end.`}
          </span>
        </div>
      ) : null}
      <p className={styles.muted} data-testid="terminal-grp-method">
        {group.kind === 'theme'
          ? `The curated stocks of UCT's ${group.name} theme`
          : `Every stock whose company details name ${group.name} as its ${kind.one}`}
        {group.listed ? '.' : ' and that is in the whole-market list: US common stocks (no funds) with a close on both days.'}
        {' '}Change is each stock&apos;s own percent change between the two closes, adjusted for splits.
        {group.listed ? '' : ` The ${kind.one}'s figure above caps its best stocks before averaging, so it is not the plain average of this list.`}
        {' '}RS is the UCT RS rank, 1 to 99, against the whole ranked universe; {NA} means the stock is outside it.
        {' '}Flow says a stock is on the confluence board (large dark pool size with long-dated options flow
        {confView.state === 'ok' && confView.window ? `, ${confView.window}` : ''}) and which way it leans; an empty cell
        means it is not on the board. A word and a sign (+/-) mark every direction, so color is never the only signal.
        A list says which stocks to study; it is not a forecast or a recommendation. Click a symbol to load it into the
        linked panels; type a row number to do the same.
        {group.kind === 'theme' ? <>{' '}<PanelCommand cmd={imovCommand({ theme: { name: group.name } })} label={`Open what drives ${group.name}`}>See which of them drive the theme (IMOV)</PanelCommand>.</> : null}
        {lists.asOf && clock(lists.asOf) ? ` Changes worked out at ${clock(lists.asOf)}.` : ''}
        {rs.receivedAt && ranks && clock(rs.receivedAt) ? ` RS ranks read at ${clock(rs.receivedAt)}.` : ''}
      </p>
    </>
  )
}

export default function GroupDrillPanel({ group: groupProp = null, range: rangeProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || GROUP_DRILL_CODE
  const [today] = useState(todayIso)
  // A new `GRP XLK 3M` remounts the panel (the shell keys the body on code + args), so the typed
  // words only ever seed the state.
  const [query, setQuery] = useState(() => parseGroupQuery(groupProp))
  const [range, setRange] = useState(() => normGroupRange(rangeProp))
  const [sort, setSort] = useState(DEFAULT_GROUP_SORT)
  const req = useMemo(() => periodRequest({ range, today }), [range, today])
  const resolvedRef = useRef(null)
  const onResolved = useCallback((g) => { resolvedRef.current = g }, [])

  // A pick writes itself into the command (`GRP THEME SEMICONDUCTORS 3M`) where the registry takes
  // the words, so a reload keeps it; otherwise it is plain component state (commandWriteBack.js).
  const pickRange = (key) => {
    setRange(key)
    const g = resolvedRef.current
    writeBack(groupDrillCommandArgs(g ? { ...g, range: key } : { kind: query.kind, name: query.text, fund: query.fund, range: key }))
  }
  const pickGroup = (o) => {
    setQuery({ kind: o.kind, text: o.name, fund: null })
    writeBack(groupDrillCommandArgs({ kind: o.kind, name: o.name, range }))
  }
  const pickSector = (o) => {
    setQuery({ kind: 'sector', text: o.fund, fund: o.fund })
    writeBack(groupDrillCommandArgs({ fund: o.fund, range }))
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-grp" data-range={req.ok ? req.range : 'invalid'}
      data-kind={query.kind || 'any'}>
      <div className={styles.toolbar} role="toolbar" aria-label="Group drill-down controls">
        <div className={styles.group} role="group" aria-label="Range">
          {Object.entries(PERIOD_RANGES).map(([key, r]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={req.ok && req.range === key}
              onClick={() => pickRange(key)} data-testid={`terminal-grp-range-${key}`}>{r.chip}</button>
          ))}
        </div>
      </div>
      {!req.ok ? (
        <PanelState kind="error" testId="terminal-grp-bad-dates" title={req.message} />
      ) : !query.text ? (
        <Idle code={code} onPick={pickSector} />
      ) : (
        // Keyed by the group and the range: a new one is a new read, so one group's rows are never drawn under another's name.
        <Drill key={`${query.kind || 'any'}:${query.text}:${req.url}`} query={query} req={req} code={code} sort={sort} onSort={setSort}
          onPick={pickGroup} onResolved={onResolved} />
      )}
    </div>
  )
}
