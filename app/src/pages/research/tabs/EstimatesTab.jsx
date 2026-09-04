import useEstimates from '../hooks/useEstimates'
import { RevisionColumns, SeriesChart } from '../../../components/research-kit'
import styles from '../ResearchPage.module.css'

// 2026-09-03 dedicated Analyst Ratings slice (owner-authorized product-home
// split): this tab is narrowed to its honest scope -- EPS/revenue forward
// estimates and revisions, both from yfinance. Analyst consensus, price
// targets, and recent rating-change actions (previously enriched here from
// FMP, via analyst_grades.py, overriding yfinance's own thinner feed) now
// live in their own dedicated home: AnalystRatingsTab.jsx. Do not re-add
// analyst-grade content here.
function fmtBig(v) {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${v.toFixed(0)}`
}
function fmtEps(v) { return v == null ? '—' : v.toFixed(2) }
function fmtPct(v) { return v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%` }

function trendDir(cur, ago) {
  if (cur == null || ago == null) return ''
  if (cur > ago) return styles.up
  if (cur < ago) return styles.down
  return ''
}

export default function EstimatesTab({ sym }) {
  const { data, isLoading } = useEstimates(sym)

  if (isLoading) {
    return <div className={styles.soon}><div className={styles.soonInner}><div className={styles.soonSub}>Loading estimates…</div></div></div>
  }

  const e = data || {}
  const fwd = e.forward || []
  const rev = e.revisions || []
  const empty = !fwd.length && !rev.length

  return (
    <div className={styles.finWrap}>
      {e.entity && e.entity.status !== 'resolved' && (
        <div className={styles.muted} style={{ fontSize: 11 }} data-testid="entity-unresolved-note">
          Symbol not yet linked to a canonical identity ({e.entity.status}).
        </div>
      )}

      {!!fwd.length && (
        <section className={styles.card}>
          <div className={styles.ct}>Forward estimates (analyst consensus)</div>
          <div className={styles.gridScroll}>
            <table className={styles.fgrid}>
              <thead>
                <tr><th>Period</th><th>EPS avg</th><th>Range</th><th>Analysts</th><th>EPS growth</th><th>Revenue</th></tr>
              </thead>
              <tbody>
                {fwd.map(r => (
                  <tr key={r.period}>
                    <td className={styles.fperiod}>{r.period}</td>
                    <td>{fmtEps(r.eps_avg)}</td>
                    <td className={styles.muted}>{fmtEps(r.eps_low)}–{fmtEps(r.eps_high)}</td>
                    <td>{r.num_analysts ?? '—'}</td>
                    <td className={r.eps_growth > 0 ? styles.up : r.eps_growth < 0 ? styles.down : ''}>{fmtPct(r.eps_growth)}</td>
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
                  valueFormatter={(v) => (v == null ? '—' : `$${v.toFixed(2)}`)}
                  ariaLabel={`Forward EPS consensus low, average and high — ${label}`}
                  series={[
                    { name: 'Low', color: 'var(--text-muted)', values: rows.map(f => f.eps_low) },
                    { name: 'Consensus', color: 'var(--ut-gold, #c9a84c)', values: rows.map(f => f.eps_avg) },
                    { name: 'High', color: 'var(--text-muted)', values: rows.map(f => f.eps_high) },
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
            <table className={styles.fgrid}>
              <thead>
                <tr><th>Period</th><th>Current</th><th>30d ago</th><th>90d ago</th><th>↑ 30d</th><th>↓ 30d</th></tr>
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

      {empty && <div className={styles.fnote}>Estimate data is unavailable for this ticker.</div>}
    </div>
  )
}
