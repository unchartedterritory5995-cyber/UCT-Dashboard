// app/src/components/research/fmpDepth/StatementTables.jsx
//
// FA depth: the income statement, balance sheet, cash flow and key ratios as
// TABLES over 24 fiscal quarters / 12 fiscal years — the exact figures beside
// the six panels' shapes.
//
// Reads /api/research/financial-history — the SAME key, fetcher and cache the
// panels (StatementPanels) use, so on the default period the two share one
// request. Nothing here fetches a second copy of a statement.
import { useState } from 'react'
import useSWR from 'swr'
import { EmptyState } from '../../research-kit'
import { FETCH_FAILED, sectionFetcher } from '../sections/sectionFetch'
import { STATEMENTS, UNKNOWN_CCY, buildTable, rowLabel } from './depthFormat'
import { reportingCurrencyNote } from '../../../lib/presentation/presentationPrimitives'
import styles from './FmpDepth.module.css'

export const historyKey = (sym, period) => `/api/research/financial-history/${sym}?period=${period}`

function Seg({ label, options, value, onChange }) {
  return (
    <div className={styles.seg} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" className={styles.segBtn} aria-pressed={value === v}
                onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  )
}

export default function StatementTables({ sym }) {
  const [period, setPeriod] = useState('quarter')
  const [statement, setStatement] = useState('income')
  const { data, error, mutate } = useSWR(sym ? historyKey(sym, period) : null, sectionFetcher,
    { revalidateOnFocus: false, keepPreviousData: true })

  if (!sym) return null
  const shownPeriod = data?.period === 'annual' ? 'annual' : 'quarter'
  const table = buildTable(data, statement)
  // FMP states each statement's currency (`currency`: TSM "TWD"); the cells carry it. When it
  // does not, the cells carry no symbol and the card says so — never a guessed "$".
  const hasFigures = !error && data !== undefined && table.columns.length > 0 && table.rows.length > 0
  const currencyNote = hasFigures ? reportingCurrencyNote(data?.currency, UNKNOWN_CCY) : null

  let body
  if (error) {
    body = <EmptyState {...FETCH_FAILED} compact onRetry={() => mutate()} />
  } else if (data === undefined) {
    body = <p className={styles.note} role="status">Loading statements…</p>
  } else if (!table.columns.length || !table.rows.length) {
    body = <p className={styles.note}>FMP holds no {shownPeriod === 'annual' ? 'annual' : 'quarterly'} statements for this ticker.</p>
  } else {
    body = (
      <div className={styles.scroll}>
        <table className={styles.table} aria-label={`${STATEMENTS.find((s) => s.key === statement).label}, ${shownPeriod === 'annual' ? 'annual' : 'quarterly'}, newest first`}>
          <thead>
            <tr>
              <th scope="col">{shownPeriod === 'annual' ? 'Fiscal year' : 'Fiscal quarter'}</th>
              {table.columns.map((c, i) => <th scope="col" key={`${c}-${i}`}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.key} className={r.kind === 'total' ? styles.total : undefined} data-row={r.key}>
                <th scope="row" className={styles.rowHead}>
                  {rowLabel(r.label, r.basis, shownPeriod)}
                </th>
                {r.cells.map((c, i) => <td key={i}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <section className={styles.card} data-testid="statement-tables">
      <div className={styles.head}>
        <span className={styles.title}>Financial statements</span>
        <Seg label="Statement" value={statement} onChange={setStatement}
             options={STATEMENTS.map((s) => [s.key, s.label])} />
        <Seg label="Reporting period" value={period} onChange={setPeriod}
             options={[['quarter', 'Quarterly'], ['annual', 'Annual']]} />
      </div>
      {currencyNote && <p className={styles.note} data-testid="fa-currency" data-currency={data.currency ?? 'unknown'}>{currencyNote}</p>}
      {body}
    </section>
  )
}
