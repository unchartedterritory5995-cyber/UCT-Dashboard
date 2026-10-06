import useSWR from 'swr'
import { depthFetcher, usePendingReask } from './depthFetch'
import styles from './Depth.module.css'
import { formatCompact } from '../../../lib/presentation/presentationPrimitives'

// FT-071 — estimates with the number of estimates beside the mean, the
// high/low and dispersion, and the firms acting on the stock by name.
// DARK behind BROKER_ESTIMATES_ENABLED.
//
// ⛔ Contributor-level estimates are UNAVAILABLE on this plan and the panel says
//    why; the named firms are labelled as rating actions, never as the people
//    behind the EPS mean.

const n2 = (v) => (v == null ? '—' : Number(v).toFixed(2))
const big = (v) => {
  if (v == null) return '—'
  return formatCompact(Number(v), { tiers: [{ at: 1e9, suffix: 'B', decimals: 2 }, { at: 1e6, suffix: 'M', decimals: 1 }] })
}

export default function BrokerEstimatesPanel({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, error, mutate } = useSWR(s ? `/api/research/broker-estimates/${encodeURIComponent(s)}` : null,
    depthFetcher, { revalidateOnFocus: false })
  usePendingReask(data?.state === 'pending', mutate, s)

  let body
  if (error) body = <div className={styles.error} data-testid="broker-unavailable">Estimates are unavailable right now. That is a gap in what we could read, not a finding about {s}.</div>
  else if (!data) body = <div className={styles.note}>Loading estimates…</div>
  else if (data.paywalled) body = <div className={styles.note}>Estimates require a paid plan.</div>
  else {
    const firms = data.firms || {}
    body = (
      <div data-testid="broker-estimates">
        {data.state !== 'ok'
          ? <p className={styles.note} data-testid="broker-state">{data.reason}.</p>
          : (
            <div className={styles.scroll}>
              <table className={styles.grid}>
                <thead>
                  <tr><th scope="col">Quarter ending</th><th scope="col">EPS mean</th><th scope="col"># Ests</th><th scope="col">Low–high</th><th scope="col">Spread</th>
                    <th scope="col">Revenue mean</th><th scope="col"># Ests</th></tr>
                </thead>
                <tbody>
                  {data.periods.map((p) => (
                    <tr key={p.period_end} data-testid="broker-row">
                      <th scope="row">{p.period_end}</th>
                      <td>{n2(p.eps.mean)}</td><td>{p.eps.n ?? '—'}</td>
                      <td>{n2(p.eps.low)}–{n2(p.eps.high)}</td>
                      <td>{p.eps.dispersion_pct == null ? '—' : `${p.eps.dispersion_pct}%`}</td>
                      <td>{big(p.revenue.mean)}</td><td>{p.revenue.n ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <p className={styles.muted} data-testid="broker-contributors">
          Estimates by named analyst: unavailable — {data.contributors?.reason}.
        </p>
        <div data-testid="broker-firms">
          <p className={styles.lede}>Firms acting on {s} (rating actions, not the estimates above):</p>
          {firms.state === 'ok'
            ? (
              <ul className={styles.help}>
                {firms.actions.map((a, i) => (
                  <li key={`${a.date}-${a.firm}-${i}`}>{a.date} {a.firm}: {a.action}{a.to_grade ? ` to ${a.to_grade}` : ''}{a.from_grade ? ` (from ${a.from_grade})` : ''}</li>
                ))}
              </ul>
            )
            : <p className={styles.note}>{firms.reason || 'No rating actions on file.'}</p>}
        </div>
        <p className={styles.muted}>Source: {data.source}; firms: {firms.source}.</p>
      </div>
    )
  }
  return (
    <section className={styles.panel} data-testid="broker-panel">
      <h3 className={styles.panelTitle}>Estimates by contributor</h3>
      {body}
    </section>
  )
}
