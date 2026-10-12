// CONG (no ticker): the newest congressional trade disclosures across the market (COV-12 / FT-067).
//
// `GET /api/research/congress-latest` (api/services/congress_trades.py `latest`): FMP's Senate and
// House latest-filings feeds, merged, newest disclosure first, each row labelled with its chamber.
// DARK behind CONGRESS_TRADES_ENABLED; the shell refuses the code while the auth payload carries no
// `researchDepth.congress_trades_enabled`, and a 404 here still reads as "not switched on".
//
// A ticker opens its DES beside the list; typing a row number loads the name into the linked group.
// ⛔ A failed read is an error with Retry, never "no disclosures". One chamber failing says which.
// ⛔ The amount is the disclosed RANGE; it sorts by the range's lower bound and is shown as filed.
import { useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelSymbol, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { ariaSortFor, nextSort, sortCaretFor, sortRows } from '../../../lib/presentation/dataGrid'
import { memberSentence } from '../../../lib/presentation/memberCopy'
import { canRetry, failureText, useMarketRead } from './marketRead'
import styles from './marketPanels.module.css'

export const CONGRESS_LATEST_URL = '/api/research/congress-latest'
const POLL_MS = 60 * 60 * 1000   // disclosures land at most a few times a day; the server caches 3h

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** Pure: the disclosures as rows, in the server's order (newest disclosure first). */
export function congressRows(body) {
  const trades = Array.isArray(body?.trades) ? body.trades : []
  return trades
    .filter((t) => t && t.symbol)
    .map((t, i) => ({
      key: `${t.chamber}-${t.symbol}-${t.member}-${t.transaction_date}-${i}`,
      order: i,
      sym: String(t.symbol).trim().toUpperCase(),
      member: String(t.member || '').trim() || 'Member not named',
      chamber: String(t.chamber_label || t.chamber || '').trim() || 'Chamber not given',
      type: String(t.type || '').trim() || 'Not given',
      side: t.side || 'other',
      amount: String(t.amount || '').trim() || 'Not given',
      amountLow: num(t.amount_low),
      traded: String(t.transaction_date || '').slice(0, 10) || null,
      disclosed: String(t.disclosure_date || '').slice(0, 10) || null,
    }))
}

const COLUMNS = [
  { key: 'sym', label: 'Symbol', title: 'Click a symbol to open its DES' },
  { key: 'member', label: 'Member' },
  { key: 'chamber', label: 'Chamber', phoneHide: true },
  { key: 'type', label: 'Type' },
  { key: 'amount', label: 'Amount', title: 'The disclosed range, as filed' },
  { key: 'traded', label: 'Traded', phoneHide: true },
  { key: 'disclosed', label: 'Disclosed' },
]
const TEXT_KEYS = new Set(['sym', 'member', 'chamber', 'type', 'traded', 'disclosed'])
const valueOf = (key, r) => (key === 'amount' ? r.amountLow : r[key])
const isNumeric = (key) => !TEXT_KEYS.has(key)
const firstDirFor = (key) => (['sym', 'member', 'chamber', 'type'].includes(key) ? 'asc' : 'desc')
const byOrder = (a, b) => a.order - b.order
const sideClass = (side) => (side === 'buy' ? styles.up : side === 'sell' ? styles.down : undefined)

export default function CongressLatestPanel() {
  const inPanel = useInTerminalPanel()
  const read = useMarketRead(CONGRESS_LATEST_URL, { refreshInterval: POLL_MS })
  const body = read.body
  const base = useMemo(() => congressRows(body), [body])
  const [sort, setSort] = useState({ key: 'disclosed', dir: 'desc' })
  const rows = useMemo(() => sortRows(base, sort, { valueOf, isNumeric, tiebreak: byOrder }), [base, sort])
  const asOf = body?.newest_disclosure || null
  usePanelFreshness(base.length ? panelAsOf('STOCK Act disclosures (FMP)', asOf) : null)
  usePanelSymbolRows(rows.map((r) => r.sym), 'congressional trades')

  if (read.loading) return <PanelSkeleton label="Loading congressional trades" testId="terminal-congress-loading" />
  if (read.error && !body) {
    const locked = !canRetry(read.error)
    return (
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(read.error, 'Congressional trades')} testId="terminal-congress-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : 'That is not the same as no disclosures. Retry, or run CONG again.'}
      </PanelState>
    )
  }
  if (body?.state === 'unavailable') {
    return (
      <PanelState kind="error" title="Congressional trades could not be read just now." testId="terminal-congress-error"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {memberSentence(body.reason) || 'Neither chamber answered.'} That is not the same as no disclosures.
      </PanelState>
    )
  }
  if (!base.length) {
    return (
      <PanelState kind="empty" title="No recent congressional trade disclosures with a ticker." testId="terminal-congress-empty">
        {body?.state === 'partial' ? `${memberSentence(body.reason)} ` : ''}
        The feed covers the newest Senate and House periodic transaction reports FMP holds.
      </PanelState>
    )
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-congress">
      {read.error && <p className={styles.note} role="status">{failureText(read.error, 'Congressional trades')} Showing the last read.</p>}
      {body?.state === 'partial' && (
        <p className={styles.note} role="status" data-testid="terminal-congress-partial">{memberSentence(body.reason)}</p>
      )}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-congress-table" aria-label="Congressional trade disclosures, newest first, sortable">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th scope="col" key={c.key} title={c.title} aria-sort={ariaSortFor(sort, c.key, 'none')}
                  className={c.phoneHide ? styles.phoneHide : undefined}>
                  <button type="button" className={styles.sortBtn} onClick={() => setSort((s) => nextSort(s, c.key, firstDirFor))}
                    data-testid={`terminal-congress-sort-${c.key}`}>
                    {c.label}
                    {sortCaretFor(sort, c.key) ? <span aria-hidden="true">{` ${sortCaretFor(sort, c.key)}`}</span> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} data-testid={`terminal-congress-row-${r.sym}`}>
                <td>
                  <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                  <PanelSymbol sym={r.sym} className={styles.sym} />
                </td>
                <td className={styles.wrapCell}>{r.member}</td>
                <td className={styles.phoneHide}>{r.chamber}</td>
                <td className={sideClass(r.side)}>{r.type}</td>
                <td>{r.amount}</td>
                <td className={styles.phoneHide}>{r.traded || 'not given'}</td>
                <td>{r.disclosed || 'not given'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted} data-testid="terminal-congress-method">
        The newest Senate and House trade disclosures (STOCK Act), newest disclosure first. A trade can be disclosed up to
        45 days after it was made, and amounts are the disclosed ranges. Click a symbol to open its DES; type a row number
        to load it into the linked panels.
        {body?.without_symbol ? ` ${body.without_symbol} disclosures with no ticker (bonds, funds, private holdings) are not listed.` : ''}
      </p>
    </div>
  )
}
