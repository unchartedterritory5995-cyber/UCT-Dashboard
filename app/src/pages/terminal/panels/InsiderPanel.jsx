// INS: notable insider BUYS from the last 7 days (wave 7, lane C).
//
// ⭐ NO NEW ROUTE. `GET /api/insider/feed` (api/services/insider.py `get_recent_insider_buys`) is the
// read the UCT 20 page already makes: open-market buys from Form 4 filings, largest dollar value
// first, capped at 50. ⚠️ It is NOT the whole market: the server scans the UCT 20 plus about 40
// large caps, and the panel says so rather than letting a short list read as a quiet tape.
//
// A ticker opens its DES beside the list; typing a row number loads the name into the linked group.
// ⛔ A failed read is an error with Retry, never "no insider buys".
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { formatCompactTerminal, formatCurrency, formatNumber } from '../../../lib/presentation/presentationPrimitives'
import { ariaSortFor, nextSort, sortCaretFor, sortRows } from '../../../lib/presentation/dataGrid'
import { failureText, useMarketRead } from './marketRead'
import styles from './marketPanels.module.css'

export const INSIDER_URL = '/api/insider/feed'
const POLL_MS = 30 * 60 * 1000

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** Pure: the buys as rows, in the server's order (largest dollar value first). */
export function insiderRows(body) {
  return (Array.isArray(body) ? body : [])
    .filter((b) => b && b.symbol && (b.type ?? 'buy') === 'buy')
    .map((b, i) => ({
      key: `${b.symbol}-${b.name}-${b.date}-${i}`,
      order: i,
      sym: String(b.symbol).trim().toUpperCase(),
      name: String(b.name || '').trim() || 'Name not given',
      role: String(b.title || '').trim() || 'Role not given',
      amount: num(b.amount),
      shares: num(b.shares),
      price: num(b.price),
      date: String(b.date || '').slice(0, 10) || null,
      filed: String(b.filing_date || '').slice(0, 10) || null,
    }))
}

/** Pure: the newest filing date in the list (the read's as-of), or null. */
export function newestFiling(rows) {
  return rows.reduce((best, r) => {
    const d = r.filed || r.date
    return d && (!best || d > best) ? d : best
  }, null)
}

const COLUMNS = [
  { key: 'sym', label: 'Symbol', title: 'Click a symbol to open its DES' },
  { key: 'name', label: 'Insider' },
  { key: 'role', label: 'Role', phoneHide: true },
  { key: 'amount', label: 'Value', title: 'Shares times price' },
  { key: 'shares', label: 'Shares', phoneHide: true },
  { key: 'price', label: 'Price', phoneHide: true },
  { key: 'date', label: 'Traded' },
]
const TEXT_KEYS = new Set(['sym', 'name', 'role', 'date'])
const valueOf = (key, r) => r[key]
const isNumeric = (key) => !TEXT_KEYS.has(key)
const firstDirFor = (key) => (key === 'sym' || key === 'name' || key === 'role' ? 'asc' : 'desc')
const byOrder = (a, b) => a.order - b.order

export default function InsiderPanel() {
  const inPanel = useInTerminalPanel()
  const read = useMarketRead(INSIDER_URL, { refreshInterval: POLL_MS })
  const base = useMemo(() => insiderRows(read.body), [read.body])
  const [sort, setSort] = useState({ key: 'amount', dir: 'desc' })
  const rows = useMemo(() => sortRows(base, sort, { valueOf, isNumeric, tiebreak: byOrder }), [base, sort])
  const asOf = newestFiling(base)
  usePanelFreshness(base.length ? panelAsOf('SEC Form 4 filings (FMP, Finnhub)', asOf) : null)
  usePanelSymbolRows(rows.map((r) => r.sym), 'insider buys')

  if (read.loading) return <PanelSkeleton label="Loading insider buys" testId="terminal-insider-loading" />
  if (read.error && !read.body) {
    const locked = read.error?.status === 402
    return (
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(read.error, 'Insider buys')} testId="terminal-insider-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : 'That is not the same as no insider buying. Retry, or run INS again.'}
      </PanelState>
    )
  }
  if (!base.length) {
    return (
      <PanelState kind="empty" title="No notable insider buys in the last 7 days." testId="terminal-insider-empty">
        The feed covers the UCT 20 and about 40 large caps.
      </PanelState>
    )
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-insider">
      {read.error && <p className={styles.note} role="status">{failureText(read.error, 'Insider buys')} Showing the last read.</p>}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-insider-table" aria-label="Insider buys, last 7 days, sortable">
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
                  <PanelCommand cmd={`${r.sym} DES`} label={`Open ${r.sym} description`} className={styles.sym}>{r.sym}</PanelCommand>
                </td>
                <td>{r.name}</td>
                <td className={styles.phoneHide}>{r.role}</td>
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
        Open-market buys from Form 4 filings in the last 7 days, largest first, up to 50. The feed covers the UCT 20 and
        about 40 large caps, not every stock. Click a symbol to open its DES; type a row number to load it into the linked panels.
        {asOf ? ` Newest filing ${asOf}.` : ''}
      </p>
    </div>
  )
}
