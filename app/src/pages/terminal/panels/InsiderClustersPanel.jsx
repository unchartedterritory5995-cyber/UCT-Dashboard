// INS CLUSTER: insider cluster buys, built each night from the SEC's own Form 4 filings (2026-11-21).
//
// `GET /api/insider/clusters` (paid; api/services/insider_clusters_sec.py) answers only from what the
// nightly read holds: stocks where three or more insiders bought on the open market within ten
// business days, newest last buy first, at most 50. Each row: the stock (a ticker through
// PanelSymbol; a filer who gave no ticker leaves the company name as plain text), how many insiders
// and their roles, the money bought and the average price, the bar store's latest close and the
// change since that average, and the first and last buy. A row opens to name each insider.
//
// The default INS view (market-wide buys) is a different panel body and is unchanged; this one is
// reached by `INS CLUSTER`. Its chip back to all buys writes `INS` into the command line.
// ⛔ A failed read is an error with Retry, never "no clusters"; a list not built yet says when it
// will be; a read that left filings unread says how many.
import { Fragment, useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { ariaSortFor, nextSort, sortCaretFor, sortRows } from '../../../lib/presentation/dataGrid'
import { canRetry, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  INS_CLUSTERS_SOURCE, INS_CLUSTERS_URL, INS_CLUSTERS_WHAT, INS_VIEWS,
  avgText, changeText, closeWhy, clustersPollMs, clustersRead, cutText, dayText, insiderViewCommandArgs, notBuiltText, readText,
  ruleText, valueText,
} from './insiderClustersModel'
import { formatCurrency } from '../../../lib/presentation/presentationPrimitives'
import styles from './marketPanels.module.css'

const COLUMNS = [
  { key: 'sym', label: 'Stock', title: 'Click a ticker to open its DES' },
  { key: 'insiders', label: 'Insiders', title: 'How many insiders bought, with their roles' },
  { key: 'value', label: 'Bought', title: 'Shares times price, with the average price paid' },
  { key: 'change', label: 'Since', title: 'The latest close the site holds, against the average price paid', phoneHide: true },
  { key: 'lastBuy', label: 'Last buy', title: 'The last purchase in the cluster, with the first' },
]
const TEXT_KEYS = new Set(['sym', 'lastBuy'])
const valueOf = (key, r) => (key === 'sym' ? (r.sym || r.company) : r[key])
const isNumeric = (key) => !TEXT_KEYS.has(key)
const firstDirFor = (key) => (key === 'sym' ? 'asc' : 'desc')
const byOrder = (a, b) => a.order - b.order
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)

export default function InsiderClustersPanel({ onView = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const read = useMarketRead(INS_CLUSTERS_URL, { refreshInterval: (latest) => clustersPollMs(latest?.body) })
  const view = useMemo(() => clustersRead(read.body), [read.body])
  const [sort, setSort] = useState({ key: 'lastBuy', dir: 'desc' })
  const [open, setOpen] = useState(() => new Set())
  const base = useMemo(() => (view.state === 'ok' ? view.rows : []), [view])
  const rows = useMemo(() => sortRows(base, sort, { valueOf, isNumeric, tiebreak: byOrder }), [base, sort])
  usePanelFreshness(view.state === 'ok' && view.asOf ? panelAsOf(INS_CLUSTERS_SOURCE, view.asOf) : null)
  usePanelSymbolRows(rows.map((r) => r.sym).filter(Boolean), 'insider cluster buys')

  const toAllBuys = () => {
    if (!writeBack(insiderViewCommandArgs({ view: 'buys' })) && onView) onView('buys')
  }
  const toggle = (key) => setOpen((s) => {
    const next = new Set(s)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const chips = (
    <div className={styles.toolbar} role="toolbar" aria-label="Insider buying views">
      <div className={styles.group} role="group" aria-label="Which list">
        <button type="button" className={styles.chip} aria-pressed="false" onClick={toAllBuys} data-testid="terminal-insider-cluster-view-buys"
          title="Every market-wide insider purchase of the last 7 days (INS)">{INS_VIEWS.buys.label}</button>
        <button type="button" className={styles.chip} aria-pressed="true" data-testid="terminal-insider-cluster-view-cluster"
          title="Stocks several insiders bought within a few days (INS CLUSTER)">{INS_VIEWS.cluster.label}</button>
      </div>
    </div>
  )
  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-insider-cluster" data-state={state}>
      {chips}
      {body}
    </div>
  )

  if (read.loading) return <PanelSkeleton label="Loading insider cluster buys" testId="terminal-insider-cluster-loading" />
  if (read.error && !read.body) {
    const locked = !canRetry(read.error)
    return wrap('error', (
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(read.error, INS_CLUSTERS_WHAT)} testId="terminal-insider-cluster-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : 'That is not the same as no cluster buying. Retry, or run INS CLUSTER again.'}
      </PanelState>
    ))
  }
  if (view.state === 'failed') {
    return wrap('error', (
      <PanelState kind="error" title={`${INS_CLUSTERS_WHAT} came back in a shape this panel cannot read.`} testId="terminal-insider-cluster-error"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>} />
    ))
  }
  if (view.state === 'not_built') {
    return wrap('not_built', (
      <PanelState kind="empty" role="status" title="The cluster list has not been built yet." testId="terminal-insider-cluster-not-built">
        {notBuiltText(view)} It reads the SEC&apos;s own filings; nothing is built when you open the panel.
      </PanelState>
    ))
  }

  const method = (
    <p className={styles.muted} data-testid="terminal-insider-cluster-method">
      {ruleText(view.rules)} {readText(view)} Source: {INS_CLUSTERS_SOURCE}.
    </p>
  )
  if (!rows.length) {
    return wrap('empty', (
      <>
        <PanelState kind="empty" title="No insider cluster buys in the filings held." testId="terminal-insider-cluster-empty">
          No stock had 3 or more insiders buying on the open market within 10 business days.
        </PanelState>
        {method}
      </>
    ))
  }

  return wrap('ok', (
    <>
      {read.error && <p className={styles.note} role="status">{failureText(read.error, INS_CLUSTERS_WHAT)} Showing the last read.</p>}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-insider-cluster-table" aria-label="Insider cluster buys, sortable">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th scope="col" key={c.key} title={c.title} aria-sort={ariaSortFor(sort, c.key, 'none')}
                  className={c.phoneHide ? styles.phoneHide : undefined}>
                  <button type="button" className={styles.sortBtn} onClick={() => setSort((s) => nextSort(s, c.key, firstDirFor))}
                    data-testid={`terminal-insider-cluster-sort-${c.key}`}>
                    {c.label}
                    {sortCaretFor(sort, c.key) ? <span aria-hidden="true">{` ${sortCaretFor(sort, c.key)}`}</span> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const shown = open.has(r.key)
              const detailId = `insider-cluster-people-${i}`
              return (
                <Fragment key={r.key}>
                  <tr data-testid={`terminal-insider-cluster-row-${r.sym || i}`}>
                    <td className={`${styles.wrapCell} ${styles.snugTight} ${styles.phoneTight}`}>
                      <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                      {r.sym ? <PanelSymbol sym={r.sym} className={styles.sym} /> : <span data-testid={`terminal-insider-cluster-noticker-${i}`}>No ticker</span>}
                      {r.company ? <><br /><span className={styles.muted}>{r.company}</span></> : null}
                    </td>
                    <td className={`${styles.wrapCell} ${styles.snugTight} ${styles.phoneTight}`}>
                      <button type="button" className={styles.rowBtn} aria-expanded={shown} aria-controls={shown ? detailId : undefined}
                        onClick={() => toggle(r.key)} title={shown ? 'Hide who bought' : 'Show who bought'}
                        data-testid={`terminal-insider-cluster-open-${r.sym || i}`}>
                        {`${r.insiders} insiders`}
                      </button>
                      {r.roles ? <><br /><span className={styles.muted} data-testid={`terminal-insider-cluster-roles-${r.sym || i}`}>{r.roles}</span></> : null}
                    </td>
                    <td>
                      <span className={`${styles.snugWrap} ${styles.phoneWrap}`}>{valueText(r.value, r.valueComplete)}</span>
                      {avgText(r.avgPrice) ? <><br /><span className={styles.muted}>{avgText(r.avgPrice)}</span></> : null}
                    </td>
                    <td className={styles.phoneHide}>
                      {r.close !== null
                        ? <><span className={tone(r.change)}>{changeText(r.change) || 'n/a'}</span><br /><span className={`${styles.muted} ${styles.snugWrap} ${styles.phoneWrap}`}>{`${formatCurrency(r.close)} ${dayText(r.closeDate).replace(' ', ' ')}`}</span></>
                        : <span className={`${styles.muted} ${styles.snugWrap} ${styles.phoneWrap}`}>{closeWhy(r.closeReason)}</span>}
                    </td>
                    <td>
                      {r.lastBuy ? dayText(r.lastBuy) : 'not given'}
                      {r.firstBuy && r.firstBuy !== r.lastBuy ? <><br /><span className={styles.muted}>{`from ${dayText(r.firstBuy)}`}</span></> : null}
                    </td>
                  </tr>
                  {shown ? (
                    <tr data-testid={`terminal-insider-cluster-people-${r.sym || i}`}>
                      <td colSpan={COLUMNS.length} className={styles.wrapCell} id={detailId}>
                        <ul className={styles.reasons} aria-label={`Insiders who bought ${r.sym || r.company}`}>
                          {r.people.map((line) => <li key={line}>{line}</li>)}
                        </ul>
                        {r.url ? <a className={styles.linkBtn} href={r.url} target="_blank" rel="noopener noreferrer">The newest filing on sec.gov</a> : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {cutText(view) ? <p className={styles.muted} data-testid="terminal-insider-cluster-cut">{cutText(view)}</p> : null}
      {method}
    </>
  ))
}
