import useEstimates from '../hooks/useEstimates'
import { RevisionColumns, SeriesChart } from '../../../components/research-kit'
import { CHART_INK } from '../../../components/research-kit/charts/echartsCore'
import { formatCompactTerminal, formatCurrency, formatNumber } from '../../../lib/presentation/presentationPrimitives'
import { signedPct } from '../researchFormat'
import { themeInk } from '../themeInk'
import ResearchLoading from '../ResearchLoading'
import styles from '../ResearchPage.module.css'

// 2026-09-03 dedicated Analyst Ratings slice (owner-authorized product-home
// split): this tab is narrowed to its honest scope -- EPS/revenue forward
// estimates and revisions, both from yfinance. Analyst consensus, price
// targets, and recent rating-change actions (previously enriched here from
// FMP, via analyst_grades.py, overriding yfinance's own thinner feed) now
// live in their own dedicated home: AnalystRatingsTab.jsx. Do not re-add
// analyst-grade content here.
const fmtBig = (v) => formatCompactTerminal(v, { money: true })
const fmtEps = (v) => formatNumber(v, { decimals: 2 })

function trendDir(cur, ago) {
  if (cur == null || ago == null) return ''
  if (cur > ago) return styles.up
  if (cur < ago) return styles.down
  return ''
}

export default function EstimatesTab({ sym }) {
  const { data, isLoading, error, mutate } = useEstimates(sym)

  if (isLoading) {
    return <ResearchLoading label="Loading estimates" />
  }

  // TERM-088 -- a failed read is not an empty estimate set. Render the error
  // distinctly so a backend hiccup never reads as "no estimates available".
  if (error) {
    return (
      <div className={styles.fnote} data-testid="estimates-error">
        Couldn't load estimates for this ticker.
        {' '}
        <button type="button" className={styles.basisBtn} onClick={() => mutate()}>Retry</button>
      </div>
    )
  }

  const e = data || {}
  const fwd = e.forward || []
  const rev = e.revisions || []
  const empty = !fwd.length && !rev.length

  return (
    <div className={styles.finWrap}>
      {e.entity && e.entity.status !== 'resolved' && (
        <div className={styles.entityNote} data-testid="entity-unresolved-note">
          This symbol is not yet linked to a company record, so some sources below may not match it.
        </div>
      )}

      {!!fwd.length && (
        <section className={styles.card}>
          <div className={styles.ct}>Forward estimates (analyst consensus)</div>
          <div className={styles.gridScroll}>
            <table className={styles.fgrid} aria-label="Forward estimates (analyst consensus)">
              <thead>
                <tr><th scope="col">Period</th><th scope="col">EPS avg</th><th scope="col">Range</th><th scope="col">Analysts</th><th scope="col">EPS growth</th><th scope="col">Revenue</th></tr>
              </thead>
              <tbody>
                {fwd.map(r => (
                  <tr key={r.period}>
                    <td className={styles.fperiod}>{r.period}</td>
                    <td>{fmtEps(r.eps_avg)}</td>
                    <td className={styles.muted}>{fmtEps(r.eps_low)}–{fmtEps(r.eps_high)}</td>
                    <td>{r.num_analysts ?? '—'}</td>
                    <td className={r.eps_growth > 0 ? styles.up : r.eps_growth < 0 ? styles.down : ''}>{signedPct(r.eps_growth)}</td>
                    <td>{fmtBig(r.rev_avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!!fwd.length && (
        <section className={styles.card}>
          <div className={styles.ct}>Forward EPS — consensus range</div>
          {/* The SPREAD is the information: a wide low-to-high band means the
              street disagrees, which a single average number hides entirely.

              ⛔ QUARTERS AND YEARS ARE PLOTTED SEPARATELY, ON PURPOSE. The
              forward array is [Current Qtr, Next Qtr, Current Yr, Next Yr] and
              a single axis put AAPL's 1.98 and 2.91 next to 8.80 and 9.55 — a
              steeply rising line that reads as accelerating earnings when the
              jump is only quarterly EPS becoming annual EPS. Two charts, each
              internally comparable, is the honest shape. */}
          <div className={styles.grid}>
            {[['Quarters', /qtr/i], ['Years', /yr/i]].map(([label, re]) => {
              const rows = fwd.filter(f => re.test(f.period || ''))
              if (rows.length < 2) return null
              return (
                <SeriesChart
                  key={label}
                  periods={rows.map(f => f.period)}
                  mode="band"
                  label={label}
                  valueFormatter={(v) => formatCurrency(v)}
                  ariaLabel={`Forward EPS consensus low, average and high — ${label}`}
                  series={[
                    { name: 'Low', color: themeInk('--text-muted', CHART_INK.muted), values: rows.map(f => f.eps_low) },
                    { name: 'Consensus', color: themeInk('--ut-gold', CHART_INK.gold), values: rows.map(f => f.eps_avg) },
                    { name: 'High', color: themeInk('--text-muted', CHART_INK.muted), values: rows.map(f => f.eps_high) },
                  ]}
                />
              )
            })}
          </div>
        </section>
      )}

      {!!rev.length && (
        <section className={styles.card}>
          <div className={styles.ct}>EPS estimate revisions</div>
          {/* The direction is the story here — six numbers a row does not show
              it. RevisionColumns draws ups and downs diverging from a shared
              baseline, so which way the sell side is moving reads at a glance;
              the table below keeps the exact figures. */}
          <RevisionColumns
            buckets={rev.map(r => ({ label: r.period, up: r.up30, down: r.down30 }))}
            label=""
            ariaLabel="EPS estimate revisions by period, upgrades versus downgrades"
          />
          <div className={styles.gridScroll}>
            <table className={styles.fgrid} aria-label="EPS estimate revisions">
              <thead>
                <tr><th scope="col">Period</th><th scope="col">Current</th><th scope="col">30d ago</th><th scope="col">90d ago</th><th scope="col">↑ 30d</th><th scope="col">↓ 30d</th></tr>
              </thead>
              <tbody>
                {rev.map(r => (
                  <tr key={r.period}>
                    <td className={styles.fperiod}>{r.period}</td>
                    <td className={trendDir(r.current, r.ago30)}>{fmtEps(r.current)}</td>
                    <td className={styles.muted}>{fmtEps(r.ago30)}</td>
                    <td className={styles.muted}>{fmtEps(r.ago90)}</td>
                    <td className={styles.up}>{r.up30 ?? '—'}</td>
                    <td className={styles.down}>{r.down30 ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* tq-panels: the route marks a fund (`not_applicable` + `reason`, e910f8ff6). */}
      {empty && e.not_applicable && <div className={styles.fnote} data-testid="estimates-na">Not applicable to funds: {e.reason || `${sym} is a fund`}.</div>}
      {empty && !e.not_applicable && <div className={styles.fnote}>Estimate data is unavailable for this ticker.</div>}
    </div>
  )
}
