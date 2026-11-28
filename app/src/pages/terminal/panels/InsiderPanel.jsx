// INS: market-wide insider BUYS from the last 7 days (wave 7, lane C; market-wide 2026-10-10).
//
// `GET /api/insider/feed?scope=market` (api/services/insider.py `get_market_insider_buys`): open-market
// purchases from Form 4 filings across the whole market, from FMP's newest-filings feed, largest
// dollar value first, capped at 50. The default `/api/insider/feed` (no scope) is the UCT 20 page's
// read (UCT 20 plus about 40 large caps); large-cap insiders almost only sell, so that list was
// routinely empty here. This panel's SWR key is the stamped market URL, distinct from that page's.
//
// A ticker opens its DES beside the list; typing a row number loads the name into the linked group.
// ⛔ A failed read is an error with Retry, never "no insider buys".
//
// `INS CLUSTER` (2026-11-21, args.js `insView`): the cluster list built each night from the SEC's own
// Form 4 filings, its own panel body (InsiderClustersPanel.jsx).
//
// `INS SELLS`, `INS BOTH`, `INS 30D`, `INS SELLS 90D` (2026-11-27, args.js `insSide` / `insWindow`): the side and
// the window, two dropdowns that write their pick back into the command. Bare `INS` reads exactly what it always
// read; anything else is the server's HELD build (GET /api/insider/feed?scope=market&side=..&days=..), which answers
// `computing` until its first background build (the panel re-asks every 15 seconds) and then says when it was
// built and how far back each side reached. The pure half is insiderMarketModel.js.
import { useEffect, useMemo, useState } from 'react'
import InsiderClustersPanel from './InsiderClustersPanel'
import { normInsView } from './insiderClustersModel'
import Select from '../../../components/ui/Select'
import { usePanelWriteBack } from './commandWriteBack'
import form from './panelForm.module.css'
import {
  INSIDER_URL, INS_COMPUTING_POLL_MS, INS_SIDES, INS_SOURCE, INS_WINDOWS, insCommandArgs, insCutNotes, insWhat,
  insiderRead, insiderUrl, newestFiling, normInsSide, normInsWindow, sideWord,
} from './insiderMarketModel'
import {
  PanelSkeleton, PanelSymbol, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { formatCompactTerminal, formatCurrency, formatNumber } from '../../../lib/presentation/presentationPrimitives'
import { ariaSortFor, nextSort, sortCaretFor, sortRows } from '../../../lib/presentation/dataGrid'
import { canRetry, failureText, useMarketRead } from './marketRead'
import styles from './marketPanels.module.css'

export { INSIDER_URL, newestFiling }
const POLL_MS = 30 * 60 * 1000

/** Pure: the buys as rows, in the server's order (largest dollar value first). */
export const insiderRows = (body) => insiderRead(body).rows

const builtText = (t) => (t ? new Date(t * 1000).toLocaleString('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}) + ' ET' : null)

// The insider's role (director, officer: CFO, 10% owner) is a muted second line under the name, not a column of its
// own: on one line it was the widest cell and pushed Value through Traded out of a 592px desktop panel (part 5,
// 2026-11-21: the table was 911px in a 567px box). The second line wraps; every number column stays in view.
const COLUMNS = [
  { key: 'sym', label: 'Symbol', title: 'Click a symbol to open its DES' },
  { key: 'name', label: 'Insider', title: 'The insider, with their role under the name' },
  { key: 'amount', label: 'Value', title: 'Shares times price' },
  { key: 'shares', label: 'Shares', phoneHide: true },
  { key: 'price', label: 'Price', phoneHide: true },
  { key: 'date', label: 'Traded' },
]
const TEXT_KEYS = new Set(['sym', 'name', 'date'])
const valueOf = (key, r) => r[key]
const isNumeric = (key) => !TEXT_KEYS.has(key)
const firstDirFor = (key) => (key === 'sym' || key === 'name' ? 'asc' : 'desc')
const byOrder = (a, b) => a.order - b.order

/** `INS` (all buys, below) or `INS CLUSTER` (the cluster list). Outside the shell the cluster view's
 *  chip back to all buys switches here, in this panel's own state. */
export default function InsiderPanel({ view: viewProp, side, window } = {}) {
  const [view, setView] = useState(() => normInsView(viewProp))
  return view === 'cluster' ? <InsiderClustersPanel onView={setView} /> : <InsiderBuysView side={side} window={window} />
}

function InsiderBuysView({ side: sideProp, window: windowProp }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const [pick, setPick] = useState(() => ({ side: normInsSide(sideProp), window: normInsWindow(windowProp) }))
  const { side, window } = pick
  const choose = (next) => {
    const want = { ...pick, ...next }
    if (!writeBack(insCommandArgs(want))) setPick(want)
  }
  const url = insiderUrl(pick)
  const held = url !== INSIDER_URL
  const [polling, setPolling] = useState(false)
  const read = useMarketRead(url, { refreshInterval: polling ? INS_COMPUTING_POLL_MS : POLL_MS })
  const answer = useMemo(() => insiderRead(read.body, { side }), [read.body, side])
  const base = answer.rows
  const computing = held && !!read.body && answer.state === 'computing'
  useEffect(() => { setPolling(computing) }, [computing])
  const [sort, setSort] = useState({ key: 'amount', dir: 'desc' })
  const rows = useMemo(() => sortRows(base, sort, { valueOf, isNumeric, tiebreak: byOrder }), [base, sort])
  const asOf = newestFiling(base)
  usePanelFreshness(base.length ? panelAsOf(INS_SOURCE, asOf) : null)
  usePanelSymbolRows(rows.map((r) => r.sym), INS_SIDES[side].noun)
  const what = insWhat(side, window)
  const Name = INS_SIDES[side].label

  const picker = (
    <div className={form.form} data-testid="terminal-insider-form">
      <label className={form.field}>
        Side{' '}
        <Select value={side} onChange={(e) => choose({ side: e.target.value })} data-testid="terminal-insider-side"
          options={Object.entries(INS_SIDES).map(([value, s]) => ({ value, label: s.label }))} />
      </label>
      <label className={form.field}>
        Window{' '}
        <Select value={String(window)} onChange={(e) => choose({ window: Number(e.target.value) })} data-testid="terminal-insider-window"
          options={Object.entries(INS_WINDOWS).map(([value, w]) => ({ value, label: w.label }))} />
      </label>
    </div>
  )
  const framed = (body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-insider-frame">{picker}{body}</div>
  )

  if (read.loading) return <PanelSkeleton label={`Loading ${INS_SIDES[side].noun}`} testId="terminal-insider-loading" />
  if (read.error && !read.body) {
    const locked = !canRetry(read.error)
    return framed(
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(read.error, `Insider ${INS_SIDES[side].short}`)} testId="terminal-insider-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no ${INS_SIDES[side].noun}. Retry, or run INS again.`}
      </PanelState>,
    )
  }
  if (computing) {
    return framed(
      <PanelState kind="empty" role="status" title="Loading, the server is preparing this." testId="terminal-insider-computing">
        {`The server is reading ${what} from the newest Form 4 filings. This panel asks again every 15 seconds.`}
      </PanelState>,
    )
  }
  if (answer.state === 'failed') {
    return framed(
      <PanelState kind="error" title={`The ${INS_SIDES[side].noun} list could not be built just now.`} testId="terminal-insider-failed"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {`The vendor's Form 4 feed could not be read on the last try. That is not the same as no ${INS_SIDES[side].noun}.`}
      </PanelState>,
    )
  }
  if (!base.length) {
    return framed(
      <PanelState kind="empty" title={`No market-wide ${what}.`} testId="terminal-insider-empty">
        {`The feed covers open-market ${side === 'buys' ? 'purchases' : side === 'sells' ? 'sales' : 'purchases and sales'} in Form 4 filings across the whole market.`}
        {insCutNotes(answer.meta).map((n) => ` ${n}`).join('')}
      </PanelState>,
    )
  }
  const notes = insCutNotes(answer.meta)
  const built = builtText(answer.meta.builtAt)

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-insider">
      {picker}
      {read.error && <p className={styles.note} role="status">{failureText(read.error, `Insider ${INS_SIDES[side].short}`)} Showing the last read.</p>}
      {answer.meta.lastFailed && <p className={styles.note} role="status" data-testid="terminal-insider-stale">The newest build could not read the vendor. Showing the last read.</p>}
      {notes.map((n) => <p key={n} className={styles.note} data-testid="terminal-insider-cut">{n}</p>)}
      <div className={styles.tableBox} data-fold="550">
        <table className={styles.table} data-testid="terminal-insider-table" aria-label={`${Name === 'Buys' ? 'Insider buys' : Name === 'Sales' ? 'Insider sales' : 'Insider buys and sales'}, last ${window} days, sortable`}>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th scope="col" key={c.key} title={c.title} aria-sort={ariaSortFor(sort, c.key, 'none')}
                  className={c.phoneHide ? styles.phoneHide : undefined}>
                  <button type="button" className={styles.sortBtn} onClick={() => setSort((s) => nextSort(s, c.key, firstDirFor))}
                    data-testid={`terminal-insider-sort-${c.key}`}>
                    {c.label}
                    {sortCaretFor(sort, c.key) ? <span aria-hidden="true">{` ${sortCaretFor(sort, c.key)}`}</span> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} data-testid={`terminal-insider-row-${r.sym}`}>
                <td>
                  <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                  <PanelSymbol sym={r.sym} className={styles.sym} />
                </td>
                <td className={styles.wrapCell}>
                  {r.name}
                  <br />
                  <span className={styles.muted} data-testid={`terminal-insider-role-${r.sym}`}>{side === 'buys' ? r.role : `${sideWord(r.type)} \u00B7 ${r.role}`}</span>
                </td>
                <td>{formatCompactTerminal(r.amount, { money: true })}</td>
                <td className={styles.phoneHide}>{formatNumber(r.shares, { decimals: 0 })}</td>
                <td className={styles.phoneHide}>{formatCurrency(r.price)}</td>
                <td>{r.date || 'not given'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted} data-testid="terminal-insider-method">
        {`Market-wide open-market ${side === 'buys' ? 'purchases' : side === 'sells' ? 'sales' : 'purchases and sales'} from Form 4 filings in the last ${window} days, largest first, up to 50, from the vendor's Form 4 feed (FMP).`}
        {' '}Click a symbol to open its DES; type a row number to load it into the linked panels.
        {asOf ? ` Newest filing ${asOf}.` : ''}
        {built ? ` Built ${built}${answer.meta.refreshing ? ', a newer build is running' : ''}.` : ''}
      </p>
    </div>
  )
}
