import useSWR from 'swr'
import { depthFetcher, usePendingReask } from './depthFetch'
import styles from './Depth.module.css'
import { useDepthChrome, DepthLoading } from './depthChrome'
import PendingGaveUp from './PendingGaveUp'
import {
  formatCompactTerminal, formatCurrencyIn, formatNumber, isForeignCurrency, normalizeCurrencyCode,
  relabelDollarText, reportingCurrencyNote,
} from '../../../lib/presentation/presentationPrimitives'
import { memberText, memberSentence } from '../../../lib/presentation/memberCopy'
import { usePanelFreshness } from '../../../components/terminal/terminalPanel'

// FT-071 — estimates with the number of estimates beside the mean, the
// high/low and dispersion, and the firms acting on the stock by name.
// DARK behind BROKER_ESTIMATES_ENABLED.
//
// ⛔ Contributor-level estimates are UNAVAILABLE on this plan and the panel says
//    why; the named firms are labelled as rating actions, never as the people
//    behind the EPS mean.

const n2 = (v) => formatNumber(v == null ? NaN : Number(v), { decimals: 2 })
const big = (v) => {
  if (v == null) return '—'
  return formatCompactTerminal(Number(v))
}
// FMP's consensus is in the company's REPORTING currency (TSM: Taiwan dollars);
// the payload names it (`currency`). A non-USD mean carries its ISO code; USD and
// unknown render exactly as before (bare). Nothing is converted.
const n2In = (v, ccy) => (isForeignCurrency(ccy) && v != null ? formatCurrencyIn(Number(v), ccy) : n2(v))
const bigIn = (v, ccy) => (isForeignCurrency(ccy) && v != null
  ? relabelDollarText(formatCompactTerminal(Number(v), { money: true }), ccy) : big(v))
const headIn = (label, ccy) => (isForeignCurrency(ccy) ? `${label}, ${normalizeCurrencyCode(ccy)}` : label)

export default function BrokerEstimatesPanel({ sym }) {
  const chrome = useDepthChrome()
  const s = (sym || '').toUpperCase().trim()
  const { data, error, mutate } = useSWR(s ? `/api/research/broker-estimates/${encodeURIComponent(s)}` : null,
    depthFetcher, { revalidateOnFocus: false })
  const reask = usePendingReask(data?.state === 'pending', mutate, s)
  // TERM-019: name this panel's source (and its as-of) in the terminal panel header when it is the
  // whole panel (a DPTH stack names "several" itself); a no-op outside the terminal.
  usePanelFreshness(chrome.alone && data && !data.paywalled && !error && data.source ? { source: memberText(data.source) } : null)

  let body
  if (error) body = <div className={styles.error} data-testid="broker-unavailable">Estimates are unavailable right now. That is a gap in what we could read, not a finding about {s}.{' '}<button type="button" className={styles.retry} onClick={() => mutate()}>Retry</button></div>
  else if (!data) body = <DepthLoading inPanel={chrome.inPanel} label="Loading estimates" />
  else if (data.paywalled) body = <div className={styles.note}>Estimates require a paid plan.</div>
  else {
    const firms = data.firms || {}
    body = (
      <div data-testid="broker-estimates">
        {data.state !== 'ok'
          ? <p className={styles.note} data-testid="broker-state">{memberSentence(data.reason)}</p>
          : (
            <div className={styles.scroll}>
              <table className={styles.grid} aria-label="Estimates by contributor">
                <thead>
                  <tr><th scope="col">Quarter ending</th><th scope="col">{headIn('EPS mean', data.currency)}</th><th scope="col"># Ests</th><th scope="col">Low–high</th><th scope="col">Spread</th>
                    <th scope="col">{headIn('Revenue mean', data.currency)}</th><th scope="col"># Ests</th></tr>
                </thead>
                <tbody>
                  {data.periods.map((p) => (
                    <tr key={p.period_end} data-testid="broker-row">
                      <th scope="row">{p.period_end}</th>
                      <td>{n2In(p.eps.mean, data.currency)}</td><td>{p.eps.n ?? '—'}</td>
                      <td>{n2(p.eps.low)}–{n2(p.eps.high)}</td>
                      <td>{p.eps.dispersion_pct == null ? '—' : `${p.eps.dispersion_pct}%`}</td>
                      <td>{bigIn(p.revenue.mean, data.currency)}</td><td>{p.revenue.n ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {data.state === 'ok' && reportingCurrencyNote(data.currency) && (
          <p className={styles.muted} data-testid="broker-currency" data-currency={normalizeCurrencyCode(data.currency)}>{reportingCurrencyNote(data.currency)}</p>
        )}
        <p className={styles.muted} data-testid="broker-contributors">
          Estimates by named analyst: unavailable — {memberText(data.contributors?.reason)}.
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
            : <p className={styles.note}>{memberSentence(firms.reason) || 'No rating actions on file.'}</p>}
        </div>
        <p className={styles.muted}>Source: {memberText(data.source)}; firms: {memberText(firms.source)}.</p>
      </div>
    )
  }
  return (
    <section className={chrome.panelClass} data-testid="broker-panel">
      {chrome.showTitle && <h3 className={styles.panelTitle}>Estimates by contributor</h3>}
      <PendingGaveUp exhausted={reask.exhausted} onRetry={reask.retry} what="The estimate read" />
      {body}
    </section>
  )
}
