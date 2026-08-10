import useEstimates from '../hooks/useEstimates'
import { RevisionColumns, SeriesChart } from '../../../components/research-kit'
import styles from '../ResearchPage.module.css'

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
function fmtUsd(v) { return v == null ? '—' : `$${v.toFixed(0)}` }

// Sell-side consensus buckets, strong-buy → strong-sell.
const SEG = [
  { key: 'strongBuy', label: 'Strong Buy', color: 'var(--ut-green-bright)' },
  { key: 'buy', label: 'Buy', color: 'var(--ut-green)' },
  { key: 'hold', label: 'Hold', color: 'var(--text-muted)' },
  { key: 'sell', label: 'Sell', color: 'var(--ut-red)' },
  { key: 'strongSell', label: 'Strong Sell', color: 'var(--ut-red-bright)' },
]
function consensusClass(label) {
  const l = (label || '').toLowerCase()
  if (/buy|outperform|overweight/.test(l)) return styles.up
  if (/sell|underperform|underweight/.test(l)) return styles.down
  return ''
}
function ptRecency(pt) {
  for (const w of [['Last month', pt.last_month], ['Last quarter', pt.last_quarter], ['Last year', pt.last_year]]) {
    if (w[1] && w[1].count > 0 && w[1].avg != null) return { label: w[0], avg: w[1].avg, count: w[1].count }
  }
  return null
}

function trendDir(cur, ago) {
  if (cur == null || ago == null) return ''
  if (cur > ago) return styles.up
  if (cur < ago) return styles.down
  return ''
}
function actionClass(a) {
  if (!a) return ''
  if (/up|init|overweight|buy|outperform|positive/.test(a)) return styles.up
  if (/down|underweight|sell|underperform|negative/.test(a)) return styles.down
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
  const rc = e.rating_changes || []
  const con = e.consensus || null
  const pt = e.price_target || null
  const ptr = pt ? ptRecency(pt) : null
  const empty = !fwd.length && !rev.length && !rc.length && !con && !pt

  return (
    <div className={styles.finWrap}>
      {con && (
        <section className={styles.card}>
          <div className={styles.ct}>Analyst consensus</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span className={consensusClass(con.label)} style={{ fontSize: 18, fontWeight: 700 }}>{con.label || '—'}</span>
            <span className={styles.muted}>{con.total} analysts</span>
          </div>
          <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', margin: '10px 0' }}>
            {SEG.map(s => {
              const v = con[s.key] || 0
              const w = con.total ? (v / con.total) * 100 : 0
              return w > 0 ? <div key={s.key} title={`${s.label}: ${v}`} style={{ width: `${w}%`, background: s.color }} /> : null
            })}
          </div>
          <div>
            {SEG.map(s => (
              <span key={s.key} className={styles.muted} style={{ marginRight: 16 }}>
                <b style={{ color: s.color }}>{con[s.key] || 0}</b> {s.label}
              </span>
            ))}
          </div>
        </section>
      )}

      {pt && (
        <section className={styles.card}>
          <div className={styles.ct}>Price target</div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div>
              <div className={styles.muted}>Consensus</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtUsd(pt.consensus ?? pt.median)}</div>
            </div>
            <div>
              <div className={styles.muted}>Range</div>
              <div>{fmtUsd(pt.low)} – {fmtUsd(pt.high)}</div>
            </div>
            {ptr && (
              <div>
                <div className={styles.muted}>{ptr.label} avg</div>
                <div>{fmtUsd(ptr.avg)} <span className={styles.muted}>({ptr.count})</span></div>
              </div>
            )}
          </div>
        </section>
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
              street disagrees, which a single average number hides entirely. */}
          <SeriesChart
            periods={fwd.map(f => f.period)}
            mode="band"
            valueFormatter={(v) => (v == null ? '—' : `$${v.toFixed(2)}`)}
            ariaLabel="Forward EPS consensus low, average and high by period"
            series={[
              { name: 'Low', color: 'var(--text-muted)', values: fwd.map(f => f.eps_low) },
              { name: 'Consensus', color: 'var(--ut-gold, #c9a84c)', values: fwd.map(f => f.eps_avg) },
              { name: 'High', color: 'var(--text-muted)', values: fwd.map(f => f.eps_high) },
            ]}
          />
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

      {!!rc.length && (
        <section className={styles.card}>
          <div className={styles.ct}>Recent rating changes</div>
          <div className={styles.rclist}>
            {rc.map((r, i) => (
              <div key={`${r.date}-${i}`} className={styles.rcrow}>
                <span className={styles.rcdate}>{r.date}</span>
                <span className={styles.rcfirm}>{r.firm}</span>
                <span className={styles.rcgrade}>
                  {r.from_grade ? `${r.from_grade} → ` : ''}<b>{r.to_grade || '—'}</b>
                </span>
                <span className={actionClass(r.action)}>{r.action || ''}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {empty && <div className={styles.fnote}>Estimate data is unavailable for this ticker.</div>}
    </div>
  )
}
