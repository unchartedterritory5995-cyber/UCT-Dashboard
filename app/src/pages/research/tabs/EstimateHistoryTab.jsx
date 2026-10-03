import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import styles from './ResearchCov.module.css'

// COV-07 (roadmap RM-L19) — how the consensus EPS and revenue estimate for each
// upcoming quarter has moved, from UCT's own daily snapshots of FMP's consensus
// (FMP's historical-estimates endpoint is not on this plan). DARK behind
// ESTIMATE_HISTORY_ENABLED.
//
// ⛔ History starts on the first snapshot and the tab says which day that was.
// ⛔ A revision is shown only once a quarter has two snapshots; with one it says
//    "collecting", never a flat line that reads as "no revisions".
// ⛔ Days whose read failed are listed as gaps, not skipped.

const eps = (v) => (v == null ? 'unavailable' : v.toFixed(2))
const rev = (v) => (v == null ? 'unavailable' : v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(1)}M`)
const chg = (c) => {
  if (!c || c.pct == null) return { text: 'unavailable', cls: '' }
  return { text: `${c.pct > 0 ? '+' : ''}${c.pct.toFixed(2)}%`, cls: c.pct > 0 ? styles.up : c.pct < 0 ? styles.down : '' }
}

function Period({ p }) {
  const e = chg(p.eps_change)
  const r = chg(p.rev_change)
  return (
    <div className={styles.card} data-testid={`period-${p.period_end}`}>
      <h3 className={styles.title}>Fiscal period ending {p.period_end}</h3>
      {p.state === 'revisions'
        ? <div className={styles.muted} data-testid={`revision-${p.period_end}`}>
            Since {p.first_snapshot} ({p.n} snapshots): EPS <span className={e.cls}>{e.text}</span>, revenue <span className={r.cls}>{r.text}</span>.
          </div>
        : <div className={styles.gap} data-testid={`collecting-${p.period_end}`}>Collecting: {p.reason}.</div>}
      <div className={styles.scroll}>
        <table className={styles.grid}>
          <thead><tr>
            <th scope="col">Snapshot</th><th scope="col" className={styles.num}>EPS (low–high)</th>
            <th scope="col" className={styles.num}># EPS</th><th scope="col" className={styles.num}>Revenue</th>
            <th scope="col" className={styles.num}># Rev</th>
          </tr></thead>
          <tbody>
            {p.points.map((pt) => (
              <tr key={pt.snap_date}>
                <td>{pt.snap_date}</td>
                <td className={styles.num}>{eps(pt.eps_avg)} ({eps(pt.eps_low)}–{eps(pt.eps_high)})</td>
                <td className={styles.num}>{pt.n_eps ?? 'unavailable'}</td>
                <td className={styles.num}>{rev(pt.rev_avg)}</td>
                <td className={styles.num}>{pt.n_rev ?? 'unavailable'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function EstimateHistoryTab({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, error } = useSWR(s ? `/api/research/estimate-history/${encodeURIComponent(s)}` : null,
    sectionFetcher, { revalidateOnFocus: false })

  if (error) {
    return <div className={styles.note} data-testid="esthist-unavailable">
      Estimate history is unavailable right now. That is a gap in what we could read, not a finding about {s}.
    </div>
  }
  if (!data) return <div className={styles.note}>Loading estimate history…</div>
  if (data.paywalled) return <div className={styles.note}>Estimate history requires a paid plan.</div>

  const failed = data.failed_days || []
  return (
    <section className={styles.section} data-testid="esthist">
      <p className={styles.muted} data-testid="esthist-window">
        {data.covers_from
          ? `${s}: daily snapshots since ${data.covers_from} (${data.snapshot_days} days, last ${data.last_snapshot}). History before ${data.covers_from} was not recorded.`
          : `${s}: ${data.reason}.`}
      </p>
      {data.state === 'no_upcoming_periods' && <div className={styles.gap}>{data.reason}.</div>}
      {(data.periods || []).map((p) => <Period key={p.period_end} p={p} />)}
      {failed.length > 0 && (
        <div className={styles.gap} data-testid="esthist-failed">
          Days with no snapshot (the read failed): {failed.map((f) => f.snap_date).join(', ')}.
        </div>
      )}
      <p className={styles.muted} data-testid="esthist-source">Source: {data.source}.</p>
    </section>
  )
}
