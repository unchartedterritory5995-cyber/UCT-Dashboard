// GRPS CROWDING (2026-11-22): one group's stocks, each with its own figures (short interest as a share of float
// and days to cover, the change since the previous report, open-market insider purchases, and what its funds did),
// opened from a row of the positioning table. Each symbol is the kit's symbol cell (it loads the linked panels, and
// its row number works). One read: GET /api/research/group-stats?kind=&name=&part=positioning
// (groupPositioningModel.js says what it answers). Sortable by any column; the most shorted first.
import { useMemo, useState } from 'react'
import { PanelSkeleton, PanelState, PanelSymbol, usePanelSymbolRows } from '../../../components/terminal'
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'
import { ariaSortFor, nextSort, sortCaretFor } from '../../../lib/presentation/dataGrid'
import SidewaysScroll from '../../../components/research/fmpDepth/SidewaysScroll'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { GROUP_STATS_KINDS, GROUP_STATS_POLL_MS, groupStatsUrl } from './groupStatsModel'
import {
  DEFAULT_MEMBERS_SORT, MEMBER_COLUMNS, POSITIONING_PART, POSITIONING_WHAT, memberCell, memberFirstDir, membersSortWords,
  readMembers, sortMembers,
} from './groupPositioningModel'
import styles from './marketPanels.module.css'
import local from './groupStats.module.css'
import pos from './groupPositioning.module.css'

const count = (n) => formatNumber(n, { decimals: 0 })

function MemberCell({ cell }) {
  if (!cell.text) return <td><span className="sr-only">{cell.words}</span></td>
  return (
    <td title={cell.words}>
      <span className={cell.few ? local.few : local.main} aria-hidden="true">{cell.text}</span>
      {cell.sub ? <span className={local.sub} aria-hidden="true">{cell.sub}</span> : null}
      <span className="sr-only">{cell.words}</span>
    </td>
  )
}

export default function GroupPositioningMembers({ kind, name, onBack }) {
  const k = GROUP_STATS_KINDS[kind] || GROUP_STATS_KINDS.sector
  const read = useMarketRead(groupStatsUrl(kind, name, POSITIONING_PART), { refreshInterval: GROUP_STATS_POLL_MS })
  const view = useMemo(() => readMembers(read.body), [read.body])
  const [sort, setSort] = useState(DEFAULT_MEMBERS_SORT)
  const rows = useMemo(() => (view.state === 'ok' ? sortMembers(view.rows, sort, view.sources) : []), [view, sort])
  usePanelSymbolRows(rows.map((r) => r.sym), `GRPS ${name}`, { total: view.state === 'ok' ? view.total : null })

  const head = (
    <div className={pos.membersHead}>
      <button type="button" className={styles.chip} onClick={onBack} data-testid="terminal-grps-members-back">
        {`Back to every ${k.one}`}
      </button>
      <span className={pos.membersTitle} data-testid="terminal-grps-members-title">{name}</span>
    </div>
  )
  const wrap = (state, body) => (
    <div className={pos.members} data-testid="terminal-grps-members" data-state={state} data-name={name}>
      {head}
      {body}
    </div>
  )

  if (read.loading) return wrap('loading', <PanelSkeleton label={`Loading the stocks of ${name}`} testId="terminal-grps-members-loading" />)
  if (!read.body) {
    const locked = !canRetry(read.error)
    return wrap('error', (
      <PanelState kind={failureKind(read.error)} testId="terminal-grps-members-error" title={failureText(read.error, POSITIONING_WHAT)}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>} />
    ))
  }
  if (view.state === 'not_built' || view.state === 'computing') {
    return wrap(view.state, (
      <PanelState kind="empty" role="status" testId="terminal-grps-members-not-built"
        title="The group figures have not been worked out on this server yet.">
        They are worked out once each evening after the close; the stocks appear after the next evening build.
      </PanelState>
    ))
  }
  if (view.state === 'not_found') {
    return wrap('not_found', (
      <PanelState kind="empty" role="status" testId="terminal-grps-members-not-found" title={`${name} is not in the evening's figures.`}>
        {`The ${k.one} may have no stocks in UCT's universe tonight. Go back and pick another.`}
      </PanelState>
    ))
  }
  if (view.state !== 'ok') {
    return wrap('error', (
      <PanelState kind="error" testId="terminal-grps-members-error" title={`${POSITIONING_WHAT} came back in a form this panel cannot read.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>} />
    ))
  }
  if (!rows.length) {
    return wrap('empty', (
      <PanelState kind="empty" role="status" testId="terminal-grps-members-empty" title={`${name} lists no stocks tonight.`} />
    ))
  }

  const header = (key, label, title) => (
    <th key={key} scope="col" title={title} aria-sort={ariaSortFor(sort, key, 'none')} className={key === 'sym' ? local.nameCell : undefined}>
      <button type="button" className={`${styles.sortBtn} ${key === 'sym' ? '' : local.headBtn}`}
        onClick={() => setSort(nextSort(sort, key, memberFirstDir))} data-testid={`terminal-grps-members-sort-${key}`}>
        {label}
        {sortCaretFor(sort, key) ? <span aria-hidden="true">{` ${sortCaretFor(sort, key)}`}</span> : null}
      </button>
    </th>
  )
  const words = membersSortWords(sort)
  return wrap('ok', (
    <>
      <p className={styles.lede} data-testid="terminal-grps-members-lede">
        {`${count(view.total)} ${view.total === 1 ? 'stock' : 'stocks'}, ${words}. Click a symbol to load it into the linked panels.`}
      </p>
      {view.cut ? (
        <p className={styles.note} role="status" data-testid="terminal-grps-members-cut">
          {`Showing the ${count(rows.length)} most shorted of ${count(view.total)}; the rest are left off.`}
        </p>
      ) : null}
      <div className={styles.tableBox}>
        <SidewaysScroll label={`The stocks of ${name}, scrolls sideways`}>
          <table className={`${styles.table} ${local.board}`} data-testid="terminal-grps-members-table" data-sort={`${sort.key}:${sort.dir}`}
            aria-label={`The stocks of ${name}, ${words}`}>
            <thead>
              <tr>
                {header('sym', 'Stock', 'Click a symbol to load it into the linked panels')}
                {MEMBER_COLUMNS.map((c) => header(c.key, c.label, c.title))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sym} data-testid={`terminal-grps-member-${r.sym}`}>
                  <td className={local.nameCell}><span className={local.main}><PanelSymbol sym={r.sym} /></span></td>
                  {MEMBER_COLUMNS.map((c) => <MemberCell key={c.key} cell={memberCell(r, c, view.sources)} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </SidewaysScroll>
      </div>
      <p className={styles.muted} data-testid="terminal-grps-members-method">
        Short % float is the stock&apos;s shares short in the latest FINRA report over today&apos;s float, with its days to
        cover; the change is against the report before it. Insider buys are open-market purchases (SEC Form 4, code P) filed
        in the window the server keeps; a purchase with no stated price is counted, never priced. Funds added / cut counts
        the funds (SEC Form N-PORT) that added to or opened a position against those that cut or sold out, since each
        fund&apos;s previous report; fund shares is the change in shares held by the funds with both reports. Each part&apos;s
        date is on the table this opened from.
      </p>
    </>
  ))
}
