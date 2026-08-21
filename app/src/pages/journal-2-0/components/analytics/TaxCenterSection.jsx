/**
 * Tax Center (beta) — the year's Form-8949-style book from
 * GET /api/j2/tax-report: per-trade lines (proceeds/basis/gain, short vs
 * long term), same-symbol wash-sale flags, and a CSV export.
 *
 * HONESTY CONTRACT: the backend payload's `disclaimer` renders verbatim and
 * the coverage counts (reported / notComputable / optionsExcluded) render
 * beside the totals — an options-heavy year must never read as a quiet one.
 * Mounted inside a CollapsibleSection, so the fetch only fires when opened.
 */

import { useMemo, useState } from 'react'
import useMobileSWR from '../../../../hooks/useMobileSWR'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import { downloadBlob } from '../../../../components/chart/chartScreenshot'
import { fmtSignedDollar } from '../../lib/calendar'
import styles from './TaxCenterSection.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

const CURRENT_YEAR = Number(new Date().toISOString().slice(0, 4))
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2]

function csvEscape(v) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildTaxCsv(report) {
  const head = 'Description,Acquired,Sold,Proceeds,Cost Basis,Gain/Loss,Term,Fees,Wash Sale Disallowed (est)'
  const rows = (report?.lines || []).map((l) => [
    l.description, l.acquired, l.sold, l.proceeds, l.basis, l.gain,
    l.term, l.fees, l.washSale ? l.washSale.disallowedEstimate : '',
  ].map(csvEscape).join(','))
  const totals = report?.totals || {}
  const footer = [
    '', `Short-term total,${totals.shortTermGain ?? ''}`,
    `Long-term total,${totals.longTermGain ?? ''}`,
    `Wash-sale disallowed (estimate),${totals.washDisallowedEstimate ?? ''}`,
    `Fees total,${totals.feesTotal ?? ''}`,
    `,"${report?.disclaimer || ''}"`,
  ]
  return [head, ...rows, ...footer].join('\n')
}

export default function TaxCenterSection() {
  const [year, setYear] = useState(CURRENT_YEAR)
  const { accountId } = useJ2SelectedAccount()

  const params = new URLSearchParams({ year: String(year) })
  if (accountId) params.set('account_id', accountId)
  const { data, error, isLoading } = useMobileSWR(
    `/api/j2/tax-report?${params}`, fetcher,
    { revalidateOnFocus: false, refreshInterval: 0 },
  )

  const washLines = useMemo(
    () => (data?.lines || []).filter((l) => l.washSale),
    [data],
  )

  const onCsv = () => {
    const blob = new Blob([buildTaxCsv(data)], { type: 'text/csv' })
    downloadBlob(blob, `tax-book-${year}.csv`)
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <label className={styles.yearLabel}>
          Tax year{' '}
          <select
            className={styles.yearSelect}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <button
          type="button"
          className={styles.csvBtn}
          onClick={onCsv}
          disabled={!data || !data.lines?.length}
        >
          Download CSV (8949-style)
        </button>
      </div>

      {error && <p className={styles.err} role="alert">Couldn't load the tax book.</p>}
      {isLoading && !data && <p className={styles.hint}>Loading…</p>}

      {data && (
        <>
          <div className={styles.totalsRow}>
            <Total label="Short-term" value={data.totals.shortTermGain} signed />
            <Total label="Long-term" value={data.totals.longTermGain} signed />
            <Total label="Wash disallowed (est.)" value={data.totals.washDisallowedEstimate} warn />
            <Total label="Fees" value={data.totals.feesTotal} />
          </div>

          {/* CoverageLine idiom — what the book covers and what it doesn't. */}
          <p className={styles.coverage}>
            {data.coverage.reported} of {data.coverage.eligible} closed equity trades reported
            {data.coverage.notComputable > 0 && ` · ${data.coverage.notComputable} not computable`}
            {data.coverage.optionsExcluded > 0 &&
              ` · ${data.coverage.optionsExcluded} closed option strategies NOT included`}
          </p>

          {washLines.length > 0 && (
            <div className={styles.washBlock}>
              <h5 className={styles.washTitle}>Wash-sale flags ({washLines.length})</h5>
              <table className={styles.washTable}>
                <thead>
                  <tr><th>Symbol</th><th>Sold</th><th>Loss</th><th>Disallowed (est.)</th><th>Replacement buys</th></tr>
                </thead>
                <tbody>
                  {washLines.map((l, i) => (
                    <tr key={`${l.symbol}-${l.sold}-${i}`}>
                      <td>{l.symbol}</td>
                      <td>{l.sold}</td>
                      <td className={styles.neg}>{fmtSignedDollar(l.gain)}</td>
                      <td className={styles.warn}>{fmtSignedDollar(l.washSale.disallowedEstimate)}</td>
                      <td className={styles.repl}>
                        {l.washSale.replacements.map((r) => `${r.shares} sh ${r.date}`).join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className={styles.disclaimer}>{data.disclaimer}</p>
        </>
      )}
    </div>
  )
}

function Total({ label, value, signed, warn }) {
  const cls = warn && value > 0 ? styles.warn
    : signed && value > 0 ? styles.pos
    : signed && value < 0 ? styles.neg : ''
  return (
    <div className={styles.total}>
      <span className={styles.totalLabel}>{label}</span>
      <span className={`${styles.totalValue} ${cls}`}>{fmtSignedDollar(value)}</span>
    </div>
  )
}
