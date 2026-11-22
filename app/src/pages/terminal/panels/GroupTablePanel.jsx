// GRPS: every sector (or industry) one row, sortable by any column: median growth, margins and valuation
// from SEC filings (point in time), and breadth from UCT's stored closes, worked out once each evening.
//
//   GRPS                   every sector, the overview columns        GRPS INDUSTRIES      every industry
//   GRPS VALUATION         a column set: OVERVIEW | GROWTH | MARGINS | VALUATION | BREADTH | ALL
//
// ONE paid route, GET /api/research/group-stats?kind= (groupStatsModel.js says what it answers). A name opens
// GRP on that group beside this panel: its stocks ranked, and its own fundamentals and breadth in full.
//
// WHY A NEW CODE AND NOT A VIEW OF SCTR: SCTR ranks the 11 SPDR sector FUNDS by their price return
// (GET /api/sector-strength) and takes a window (`contribWindow`: 1D, 1W, 1M, 3M) that means nothing for a
// median; this table is the site's own sector map with each sector's MEMBERS measured, and the same table holds
// the ~150 industries, which a fund board cannot. SCTR's method line links here.
//
// WIDTH. The table scrolls sideways inside its own box (SidewaysScroll) with the name column pinned, as FA,
// EE and FUND do; nothing folds. A column set keeps a view to a handful of columns.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'
import { ariaSortFor, nextSort, sortCaretFor } from '../../../lib/presentation/dataGrid'
import SidewaysScroll from '../../../components/research/fmpDepth/SidewaysScroll'
import Select from '../../../components/ui/Select'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import { groupDrillCommand } from './groupDrillModel'
import {
  DEFAULT_GROUPS_SORT, GROUPS_TABLE_CODE, GROUPS_VIEWS, GROUP_STATS_COMPUTING_POLL_MS, GROUP_STATS_KINDS, GROUP_STATS_POLL_MS,
  GROUP_STATS_SOURCE, GROUP_STATS_WHAT, builtWords, columnHead, firstSortDir, fundStateWords, groupStatsUrl, groupsCommandArgs,
  groupsSortWords, normGroupsKind, normGroupsView, readGroupsTable, sortGroupsRows, tableCell, viewColumns,
} from './groupStatsModel'
import styles from './marketPanels.module.css'
import local from './groupStats.module.css'

const count = (n) => formatNumber(n, { decimals: 0 })
const KIND_OPTIONS = Object.entries(GROUP_STATS_KINDS).map(([value, k]) => ({ value, label: k.label }))
const VIEW_OPTIONS = Object.entries(GROUPS_VIEWS).map(([value, v]) => ({ value, label: v.label }))

function Cell({ cell }) {
  if (!cell.text) return <td><span className="sr-only">{cell.words}</span></td>
  return (
    <td title={cell.words}>
      <span className={cell.few ? local.few : local.main} aria-hidden="true">{cell.text}</span>
      {cell.sub ? <span className={local.sub} aria-hidden="true">{cell.sub}</span> : null}
      <span className="sr-only">{cell.words}</span>
    </td>
  )
}

export default function GroupTablePanel({ kind: kindProp = null, view: viewProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || GROUPS_TABLE_CODE
  // A new `GRPS INDUSTRIES` remounts the panel (the shell keys the body on code + args), so the typed words
  // only ever seed the state.
  const [kind, setKind] = useState(() => normGroupsKind(kindProp))
  const [view, setView] = useState(() => normGroupsView(viewProp))
  const [sort, setSort] = useState(DEFAULT_GROUPS_SORT)
  const [computing, setComputing] = useState(false)
  const read = useMarketRead(groupStatsUrl(kind), { refreshInterval: computing ? GROUP_STATS_COMPUTING_POLL_MS : GROUP_STATS_POLL_MS })
  const table = useMemo(() => readGroupsTable(read.body), [read.body])
  // Only an answer for THIS kind is drawn (the previous kind's is kept while this one loads).
  const mine = table.state === 'ok' || table.state === 'empty' ? table.kind === kind : true
  if ((table.state === 'computing') !== computing) setComputing(table.state === 'computing')
  usePanelFreshness(table.state === 'ok' && mine ? panelAsOf(GROUP_STATS_SOURCE, table.session || table.builtFor) : null)

  const pickKind = (next) => { const k = normGroupsKind(next); setKind(k); writeBack(groupsCommandArgs({ kind: k, view })) }
  const pickView = (next) => {
    const v = normGroupsView(next)
    setView(v)
    if (sort.key !== 'name' && !GROUPS_VIEWS[v].columns.some((c) => c.key === sort.key)) setSort(DEFAULT_GROUPS_SORT)
    writeBack(groupsCommandArgs({ kind, view: v }))
  }
  const k = GROUP_STATS_KINDS[kind]
  const columns = useMemo(() => viewColumns(view, table.fundState), [view, table.fundState])
  const ctx = useMemo(() => ({ metaById: table.metrics || new Map(), minMembers: table.minMembers }), [table])
  const rows = useMemo(() => (table.state === 'ok' ? sortGroupsRows(table.rows, sort, ctx) : []), [table, sort, ctx])

  const toolbar = (
    <div className={styles.toolbar} role="toolbar" aria-label="Group table controls">
      <label className={`${styles.muted} ${styles.pick}`}>
        Groups{' '}
        <Select value={kind} onChange={(e) => pickKind(e.target.value)} options={KIND_OPTIONS} className={styles.chip}
          data-testid="terminal-grps-kind" />
      </label>
      <label className={`${styles.muted} ${styles.pick}`}>
        Columns{' '}
        <Select value={view} onChange={(e) => pickView(e.target.value)} options={VIEW_OPTIONS} className={styles.chip}
          data-testid="terminal-grps-view" />
      </label>
    </div>
  )
  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-grps" data-kind={kind} data-view={view} data-state={state}>
      {toolbar}
      {body}
    </div>
  )

  if (read.loading || (!mine && !read.error)) return wrap('loading', <PanelSkeleton label={`Loading every ${k.one}'s figures`} testId="terminal-grps-loading" />)
  if (!read.body || !mine) {
    const locked = !canRetry(read.error)
    return wrap('error', (
      <PanelState kind={failureKind(read.error)} testId="terminal-grps-error" title={failureText(read.error, GROUP_STATS_WHAT)}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as a ${k.one} with no figures. Retry, or run ${code} again.`}
      </PanelState>
    ))
  }
  if (table.state === 'not_built') {
    return wrap('not_built', (
      <PanelState kind="empty" role="status" testId="terminal-grps-not-built" title="The group figures have not been worked out on this server yet.">
        They are worked out once each evening after the close (from 8:15 PM New York time), so the first table appears after
        the next evening build. That is not the same as a {k.one} with no figures.
      </PanelState>
    ))
  }
  if (table.state === 'computing') {
    return wrap('computing', (
      <PanelState kind="empty" role="status" testId="terminal-grps-computing" title="The server is working out the group figures for the first time.">
        It measures every stock in UCT&apos;s universe once, which takes several minutes. This panel asks again every minute
        and fills in on its own.
      </PanelState>
    ))
  }
  if (table.state === 'bad_shape') {
    return wrap('error', (
      <PanelState kind="error" testId="terminal-grps-error" title={`${GROUP_STATS_WHAT} came back in a form this panel cannot read.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>} />
    ))
  }
  if (table.state === 'empty') {
    return wrap('empty', (
      <PanelState kind="empty" role="status" testId="terminal-grps-empty" title={`The evening build found no ${k.many}.`}>
        The company details that name each stock&apos;s sector and industry could not be read that evening. That is not the
        same as a market with no {k.many}. The server tries again the next evening.
      </PanelState>
    ))
  }

  const when = builtWords(table)
  const fundWords = fundStateWords(table.fundState)
  const breadthDown = table.breadthState !== 'ok'
  const header = (key, label, title) => (
    <th key={key} scope="col" title={title} aria-sort={ariaSortFor(sort, key, 'none')} className={key === 'name' ? local.nameCell : undefined}>
      <button type="button" className={`${styles.sortBtn} ${key === 'name' ? '' : local.headBtn}`}
        onClick={() => setSort(nextSort(sort, key, firstSortDir))} data-testid={`terminal-grps-sort-${key}`}>
        {label}
        {sortCaretFor(sort, key) ? <span aria-hidden="true">{` ${sortCaretFor(sort, key)}`}</span> : null}
      </button>
    </th>
  )
  const sortWords = groupsSortWords(sort, ctx.metaById)
  return wrap('ok', (
    <>
      <div className={styles.head}>
        <span className={styles.lede} data-testid="terminal-grps-lede">
          {count(table.rows.length)} {table.rows.length === 1 ? k.one : k.many}{when ? `, ${when}` : ''}.
          {' '}Medians of each {k.one}&apos;s stocks from their SEC filings as known that day; breadth from UCT&apos;s stored closes.
        </span>
      </div>
      {table.refreshing ? <p className={styles.muted} role="status" data-testid="terminal-grps-refreshing">The evening build is running; these are the last figures.</p> : null}
      {fundWords ? <p className={styles.note} role="status" data-testid="terminal-grps-fund-state">{fundWords}</p> : null}
      {breadthDown ? (
        <p className={styles.note} role="status" data-testid="terminal-grps-breadth-down">
          No stored closes could be read at the last evening build, so breadth is not shown.
        </p>
      ) : null}
      {table.lagging.includes('prices') && !breadthDown ? (
        <p className={styles.note} role="status" data-testid="terminal-grps-lagging">
          The stored closes stopped short of the evening&apos;s session, so breadth is measured at the last session most stocks
          have. The server tries again later that evening.
        </p>
      ) : null}
      {columns.length ? (
        <div className={styles.tableBox}>
          <SidewaysScroll label={`Every ${k.one}, scrolls sideways`}>
            <table className={`${styles.table} ${local.board}`} data-testid="terminal-grps-table" data-sort={`${sort.key}:${sort.dir}`}
              aria-label={`Every ${k.one}, ${GROUPS_VIEWS[view].label.toLowerCase()}, ${sortWords}`}>
              <thead>
                <tr>
                  {header('name', k.head, 'Click a name to open its stocks, ranked, with its fundamentals and breadth in full')}
                  {columns.map((c) => { const h = columnHead(c, ctx.metaById); return header(c.key, h.label, h.title) })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} data-testid={`terminal-grps-row-${r.name}`}>
                    <td className={local.nameCell}>
                      <span className={local.main}>
                        <PanelCommand cmd={groupDrillCommand({ kind, name: r.name })} label={`Open the stocks of ${r.name}, ranked`}>{r.name}</PanelCommand>
                      </span>
                      <span className={local.sub}>{count(r.members)} {r.members === 1 ? 'stock' : 'stocks'}</span>
                    </td>
                    {columns.map((c) => <Cell key={c.key} cell={tableCell(r, c, ctx)} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </SidewaysScroll>
        </div>
      ) : (
        <PanelState kind="empty" compact role="status" testId="terminal-grps-no-columns"
          title={`${GROUPS_VIEWS[view].label} shows only fundamentals, which are not on hand.`}
          action={<button type="button" className={styles.chip} onClick={() => pickView('breadth')}>Show breadth</button>} />
      )}
      <p className={styles.muted} data-testid="terminal-grps-method">
        Each {k.one} is every stock in UCT&apos;s universe (US stocks of $300M market value and up, no funds) whose company
        details name it. A figure is the median of its stocks, and the small line under it is how many stocks it rests on; with
        fewer than {count(table.minMembers)} stocks the count is shown and no median. Fundamentals are the values in force at
        that day&apos;s close from 10-Q and 10-K filings (point in time, no look-ahead): revenue and EPS growth are the newest
        quarter against the same quarter a year earlier, margins and ROE are trailing twelve months, and P/E, P/S and FCF yield
        are worked out with UCT&apos;s stored close (a P/E with negative earnings is left out). Accelerating is the share whose
        newest quarter grew faster than the quarter before. Breadth is on closing prices: the share above each average, within
        5% of the 52-week closing high, and new 52-week closing highs minus lows. Click a header to sort; a blank sorts last
        either way. Click a name to open its stocks in GRP.
      </p>
    </>
  ))
}
