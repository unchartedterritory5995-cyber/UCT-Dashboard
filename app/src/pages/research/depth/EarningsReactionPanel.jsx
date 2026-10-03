import useSWR from 'swr'
import { depthFetcher } from './depthFetch'
import styles from './Depth.module.css'

// FT-005 — per-ticker earnings reaction, 8 quarters: the 5-session run-in, the
// opening gap, the reacting session's close-to-close move and the 5-session
// drift after it, beside realized vol and the next print's implied move.
// DARK behind EARNINGS_REACTION_PANEL_ENABLED.
//
// ⛔ A drift whose sessions have not traded yet reads "pending", never 0.
// ⛔ Every summary shows its n; the implied move names its expiry, strike and marks.

const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`)
const tone = (v) => (v == null ? '' : v > 0 ? styles.up : v < 0 ? styles.down : '')
const COLS = [['run_in_pct', 'Run-in (5d)'], ['gap_pct', 'Gap'], ['reaction_pct', 'Reaction'], ['drift_pct', 'Drift (5d)']]
const SUMS = [['run_in', 'Run-in'], ['gap', 'Gap'], ['reaction', 'Reaction'], ['drift', 'Drift']]

function Implied({ im, next }) {
  if (!im || im.state === 'pending') {
    return <p className={styles.muted} data-testid="implied-pending">Implied move for the next print: being read from the option chain.</p>
  }
  if (im.state !== 'ok') {
    return <p className={styles.muted} data-testid="implied-unavailable">Implied move: unavailable ({im.reason || 'no reading'}).</p>
  }
  const read = im.read_at ? new Date(im.read_at * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—'
  return (
    <p className={styles.lede} data-testid="implied-move">
      Implied move{next ? ` into ${next}` : ''}: ±{Number(im.pct).toFixed(1)}% (${Number(im.dollar).toFixed(2)}), the{' '}
      {im.expiry} {im.strike} straddle (call {Number(im.call_mark).toFixed(2)} + put {Number(im.put_mark).toFixed(2)}),
      read {read}.
    </p>
  )
}

export default function EarningsReactionPanel({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, error } = useSWR(s ? `/api/research/earnings-reaction/${encodeURIComponent(s)}` : null,
    depthFetcher, { revalidateOnFocus: false })

  let body
  if (error) body = <div className={styles.error} data-testid="earnings-reaction-unavailable">The earnings reaction is unavailable right now. That is a gap in what we could read, not a finding about {s}.</div>
  else if (!data) body = <div className={styles.note}>Loading the earnings reaction…</div>
  else if (data.paywalled) body = <div className={styles.note}>The earnings reaction requires a paid plan.</div>
  else if (data.state !== 'ok') body = <div className={styles.note} data-testid="earnings-reaction-state">{data.reason}</div>
  else {
    const sum = data.summary || {}
    body = (
      <div data-testid="earnings-reaction">
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <thead>
              <tr><th scope="col">Quarter</th><th scope="col">Session</th>
                {COLS.map(([, l]) => <th key={l} scope="col">{l}</th>)}
                <th scope="col">EPS vs est.</th></tr>
            </thead>
            <tbody>
              {(data.quarters || []).map((q) => (
                <tr key={q.report_date} data-testid="earnings-reaction-row">
                  <th scope="row">{q.quarter}</th>
                  <td>{q.session || '—'}</td>
                  {COLS.map(([k]) => (
                    <td key={k} className={tone(q[k])}>
                      {k === 'drift_pct' && q.drift_state === 'pending' ? 'pending' : pct(q[k])}
                    </td>
                  ))}
                  <td>{q.eps_actual == null ? '—' : `${q.eps_actual} vs ${q.eps_estimate ?? '—'}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.lede} data-testid="earnings-reaction-summary">
          {SUMS.map(([k, l]) => {
            const st = sum[k] || {}
            return `${l}: avg ${pct(st.avg)}, avg size ${st.avg_abs == null ? '—' : st.avg_abs.toFixed(2) + '%'}, up ${st.pct_up ?? '—'}% (n=${st.n ?? 0})`
          }).join(' · ')}
        </p>
        {data.realized_vol && (
          <p className={styles.muted} data-testid="realized-vol">
            Realized volatility, last {data.realized_vol.sessions} sessions through {data.realized_vol.through}: {data.realized_vol.annualized_pct}% annualized.
          </p>
        )}
        <Implied im={data.implied_move} next={data.next_report_date} />
        <p className={styles.muted}>Bars through {data.bars_through}. Source: {data.source}. History describes the past; it is not a forecast.</p>
      </div>
    )
  }
  return (
    <section className={styles.panel} data-testid="earnings-reaction-panel">
      <h3 className={styles.panelTitle}>Earnings reaction (8 quarters)</h3>
      {body}
    </section>
  )
}
