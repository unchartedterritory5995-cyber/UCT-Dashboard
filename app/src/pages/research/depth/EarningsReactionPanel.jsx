import useSWR from 'swr'
import { depthFetcher, usePendingReask } from './depthFetch'
import styles from './Depth.module.css'
import { useDepthChrome, DepthLoading } from './depthChrome'
import PendingGaveUp from './PendingGaveUp'
import { memberText, memberSentence } from '../../../lib/presentation/memberCopy'
import { usePanelFreshness } from '../../../components/terminal/terminalPanel'
import { formatCurrency, formatNumber, formatPercent, isForeignCurrency, normalizeCurrencyCode } from '../../../lib/presentation/presentationPrimitives'
import { signedPct } from '../researchFormat'

// FT-005 — per-ticker earnings reaction, 8 quarters: the 5-session run-in, the
// opening gap, the reacting session's close-to-close move and the 5-session
// drift after it, beside realized vol and the next print's implied move.
// DARK behind EARNINGS_REACTION_PANEL_ENABLED.
//
// ⛔ A drift whose sessions have not traded yet reads "pending", never 0.
// ⛔ Every summary shows its n; the implied move names its expiry, strike and marks.

const pct = (v) => signedPct(v, 2)
const eps = (v) => formatCurrency(v == null || v === '' ? NaN : Number(v))
// A non-USD filer's EPS (TSM: its sources mix per-share TWD and per-ADR figures)
// carries no symbol rather than a guessed "$". The implied move stays "$": it is
// read off the US-listed option chain. USD and unknown render as before.
const epsIn = (v, ccy) => (isForeignCurrency(ccy) ? n2(v == null || v === '' ? NaN : v) : eps(v))
const n2 = (v) => formatNumber(Number(v), { decimals: 2 })
const tone = (v) => (v == null ? '' : v > 0 ? styles.up : v < 0 ? styles.down : '')
const COLS = [['run_in_pct', 'Run-in (5d)'], ['gap_pct', 'Gap'], ['reaction_pct', 'Reaction'], ['drift_pct', 'Drift (5d)']]
const SUMS = [['run_in', 'Run-in'], ['gap', 'Gap'], ['reaction', 'Reaction'], ['drift', 'Drift']]

function Implied({ im, next }) {
  if (!im || im.state === 'pending') {
    return <p className={styles.muted} data-testid="implied-pending">Implied move for the next print: being read from the option chain.</p>
  }
  if (im.state !== 'ok') {
    return <p className={styles.muted} data-testid="implied-unavailable">Implied move: unavailable ({memberText(im.reason) || 'no reading'}).</p>
  }
  const read = im.read_at ? new Date(im.read_at * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—'
  return (
    <p className={styles.lede} data-testid="implied-move">
      Implied move{next ? ` into ${next}` : ''}: ±{formatPercent(Number(im.pct), { decimals: 1 })} ({formatCurrency(Number(im.dollar))}), the{' '}
      {im.expiry} {im.strike} straddle (call {n2(im.call_mark)} + put {n2(im.put_mark)}),
      read {read}.
    </p>
  )
}

export default function EarningsReactionPanel({ sym }) {
  const chrome = useDepthChrome()
  const s = (sym || '').toUpperCase().trim()
  const { data, error, mutate } = useSWR(s ? `/api/research/earnings-reaction/${encodeURIComponent(s)}` : null,
    depthFetcher, { revalidateOnFocus: false })
  const reask = usePendingReask(data?.state === 'pending' || (data?.state === 'ok' && data?.implied_move?.state === 'pending'), mutate, s)
  // TERM-019: name this panel's source (and its as-of) in the terminal panel header when it is the
  // whole panel (a DPTH stack names "several" itself); a no-op outside the terminal.
  usePanelFreshness(chrome.alone && data && !data.paywalled && !error && data.state === 'ok'
    ? { source: memberText(data.source) || null, age: { dataClass: 'end_of_day', asOfDate: data.bars_through || null } }
    : null)

  let body
  if (error) body = <div className={styles.error} data-testid="earnings-reaction-unavailable">The earnings reaction is unavailable right now. That is a gap in what we could read, not a finding about {s}.{' '}<button type="button" className={styles.retry} onClick={() => mutate()}>Retry</button></div>
  else if (!data) body = <DepthLoading inPanel={chrome.inPanel} label="Loading the earnings reaction" />
  else if (data.paywalled) body = <div className={styles.note}>The earnings reaction requires a paid plan.</div>
  else if (data.state !== 'ok') body = <div className={styles.note} data-testid="earnings-reaction-state">{memberSentence(data.reason)}</div>
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
                  <td>{q.eps_actual == null ? '—' : `${epsIn(q.eps_actual, data.currency)} vs ${q.eps_estimate == null ? '—' : epsIn(q.eps_estimate, data.currency)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.lede} data-testid="earnings-reaction-summary">
          {SUMS.map(([k, l]) => {
            const st = sum[k] || {}
            return `${l}: avg ${pct(st.avg)}, avg size ${formatPercent(st.avg_abs == null ? NaN : st.avg_abs, { decimals: 2 })}, up ${st.pct_up ?? '—'}% (n=${st.n ?? 0})`
          }).join(' · ')}
        </p>
        {data.realized_vol && (
          <p className={styles.muted} data-testid="realized-vol">
            Realized volatility, last {data.realized_vol.sessions} sessions through {data.realized_vol.through}: {data.realized_vol.annualized_pct}% annualized.
          </p>
        )}
        {isForeignCurrency(data.currency) && (
          <p className={styles.muted} data-testid="earnings-reaction-currency" data-currency={normalizeCurrencyCode(data.currency)}>
            {s} reports in {normalizeCurrencyCode(data.currency)}. EPS is shown without a currency symbol because its sources do not all state one; nothing is converted.
          </p>
        )}
        <Implied im={data.implied_move} next={data.next_report_date} />
        <p className={styles.muted}>Bars through {data.bars_through}. Source: {memberText(data.source)}. History describes the past; it is not a forecast.</p>
      </div>
    )
  }
  return (
    <section className={chrome.panelClass} data-testid="earnings-reaction-panel">
      {chrome.showTitle && <h3 className={styles.panelTitle}>Earnings reaction (8 quarters)</h3>}
      <PendingGaveUp exhausted={reask.exhausted} onRetry={reask.retry} what="The earnings-reaction read" />
      {body}
    </section>
  )
}
