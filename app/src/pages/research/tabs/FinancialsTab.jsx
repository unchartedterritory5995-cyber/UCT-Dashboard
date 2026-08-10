import useFinancials from '../hooks/useFinancials'
import { MetricTrendChart, SeriesChart } from '../../../components/research-kit'
import styles from '../ResearchPage.module.css'

function fmtBig(v) {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${v.toFixed(0)}`
}
function fmtPct(v) { return v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%` }
function fmtMargin(v) { return v == null ? '—' : `${v.toFixed(1)}%` }
function fmtVal(v, suffix = '') { return v == null ? '—' : `${v}${suffix}` }

function heat(v) {
  if (v == null) return ''
  if (v >= 25) return styles.heatPos2
  if (v > 0) return styles.heatPos1
  if (v <= -25) return styles.heatNeg2
  if (v < 0) return styles.heatNeg1
  return ''
}

function GrowthGrid({ title, rows }) {
  if (!rows?.length) return null
  return (
    <section className={styles.card}>
      <div className={styles.ct}>{title}</div>
      <div className={styles.gridScroll}>
        <table className={styles.fgrid}>
          <thead>
            <tr>
              <th>Period</th><th>Revenue</th><th>Rev YoY</th><th>EPS</th><th>EPS YoY</th>
              <th>Gross</th><th>Op</th><th>Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.period}>
                <td className={styles.fperiod}>{r.period}</td>
                <td>{fmtBig(r.revenue)}</td>
                <td className={heat(r.revenue_yoy)}>{fmtPct(r.revenue_yoy)}</td>
                <td>{r.eps != null ? r.eps.toFixed(2) : '—'}</td>
                <td className={heat(r.eps_yoy)}>{fmtPct(r.eps_yoy)}</td>
                <td>{fmtMargin(r.gross_margin)}</td>
                <td>{fmtMargin(r.operating_margin)}</td>
                <td>{fmtMargin(r.net_margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}


const B = (v) => (v == null ? null : v / 1e9)

/**
 * Revenue and EPS as trends, above the grid that carries the exact figures.
 *
 * The rows arrive NEWEST FIRST, which is right for a table and wrong for a
 * chart — plotted as given, time runs backwards and every trend reads inverted.
 * Reversed once, here, rather than in each chart.
 */
function TrendPair({ rows, title }) {
  const list = Array.isArray(rows) ? [...rows].reverse() : []
  if (list.length < 2) return null          // one point is not a trend
  const periods = list.map(r => r.period)
  return (
    <section className={styles.card}>
      <div className={styles.ct}>{title}</div>
      <div className={styles.grid}>
        <MetricTrendChart
          periods={periods}
          values={list.map(r => B(r.revenue))}
          label="Revenue ($B)"
          valueFormatter={(v) => (v == null ? '—' : `$${v.toFixed(1)}B`)}
          ariaLabel="Revenue by period"
        />
        <MetricTrendChart
          periods={periods}
          values={list.map(r => r.eps)}
          label="EPS"
          valueFormatter={(v) => (v == null ? '—' : `$${v.toFixed(2)}`)}
          ariaLabel="Earnings per share by period"
        />
      </div>
      {/* Margins share one axis because the question is whether the SPREAD
          between them is widening — three separate charts would hide exactly
          that. Colours are explicit per series, never PALETTE[i]. */}
      <SeriesChart
        periods={periods}
        mode="line"
        label="Margins"
        valueFormatter={(v) => (v == null ? '—' : `${v.toFixed(1)}%`)}
        ariaLabel="Gross, operating and net margin by period"
        series={[
          { name: 'Gross', color: 'var(--ut-gold, #c9a84c)', values: list.map(r => r.gross_margin) },
          { name: 'Operating', color: '#5aa9e6', values: list.map(r => r.operating_margin) },
          { name: 'Net', color: '#7ed957', values: list.map(r => r.net_margin) },
        ]}
      />
    </section>
  )
}

export default function FinancialsTab({ sym }) {
  const { data, isLoading } = useFinancials(sym)

  if (isLoading) {
    return <div className={styles.soon}><div className={styles.soonInner}><div className={styles.soonSub}>Loading financials…</div></div></div>
  }

  const fin = data || {}
  const bal = fin.balance || {}
  const met = fin.metrics || {}
  const hasGrids = (fin.quarterly?.length || fin.annual?.length)

  return (
    <div className={styles.finWrap}>
      <TrendPair rows={fin.quarterly} title="Quarterly trend" />
      <GrowthGrid title="Quarterly — revenue, EPS & margins (YoY)" rows={fin.quarterly} />
      <GrowthGrid title="Annual — revenue, EPS & margins (YoY)" rows={fin.annual} />
      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.ct}>Balance sheet</div>
          <div className={styles.kv}><span>Cash</span><b>{fmtVal(bal.cash)}</b></div>
          <div className={styles.kv}><span>Total debt</span><b>{fmtVal(bal.total_debt)}</b></div>
          <div className={styles.kv}><span>Debt / equity</span><b>{fmtVal(bal.debt_to_equity)}</b></div>
          <div className={styles.kv}><span>Current ratio</span><b>{fmtVal(bal.current_ratio)}</b></div>
          <div className={styles.kv}><span>Free cash flow</span><b>{fmtVal(bal.fcf)}</b></div>
        </section>
        <section className={styles.card}>
          <div className={styles.ct}>Profitability</div>
          <div className={styles.kv}><span>ROE</span><b>{fmtVal(met.roe, '%')}</b></div>
          <div className={styles.kv}><span>ROA</span><b>{fmtVal(met.roa, '%')}</b></div>
          <div className={styles.kv}><span>Gross margin</span><b>{fmtVal(met.gross_margin, '%')}</b></div>
          <div className={styles.kv}><span>Operating margin</span><b>{fmtVal(met.operating_margin, '%')}</b></div>
          <div className={styles.kv}><span>Net margin</span><b>{fmtVal(met.net_margin, '%')}</b></div>
        </section>
      </div>
      {!hasGrids && <div className={styles.fnote}>Statement history is unavailable for this ticker.</div>}
    </div>
  )
}
