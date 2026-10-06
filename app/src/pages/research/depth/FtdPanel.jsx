import useSWR from 'swr'
import { depthFetcher } from './depthFetch'
import styles from './Depth.module.css'
import { useDepthChrome, DepthLoading } from './depthChrome'
import { memberText, memberSentence } from '../../../lib/presentation/memberCopy'
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'

// FT-068 — SEC fails-to-deliver as its own dataset. DARK behind FTD_DATASET_ENABLED.
//
// ⛔ Each figure is a BALANCE on a settlement date, never summed across days.
// ⛔ "No fails reported in the window" and "nothing ingested yet" are different
//    facts and read differently.
// ⛔ The window covered is always stated; SEC data is weeks old by design.

const num = (n) => (n == null ? NaN : Number(n))
const fmt = (n) => formatNumber(num(n))
const usd = (n) => { const t = formatNumber(num(n), { decimals: 0, absent: null }); return t == null ? formatNumber(NaN) : `$${t}` }

export default function FtdPanel({ sym }) {
  const chrome = useDepthChrome()
  const s = (sym || '').toUpperCase().trim()
  const { data, error, mutate } = useSWR(s ? `/api/research/ftd/${encodeURIComponent(s)}` : null,
    depthFetcher, { revalidateOnFocus: false })

  let body
  if (error) body = <div className={styles.error} data-testid="ftd-unavailable">Fails-to-deliver data is unavailable right now. That is a gap in what we could read, not a finding about {s}.{' '}<button type="button" className={styles.retry} onClick={() => mutate()}>Retry</button></div>
  else if (!data) body = <DepthLoading inPanel={chrome.inPanel} label="Loading fails to deliver" />
  else if (data.paywalled) body = <div className={styles.note}>Fails to deliver requires a paid plan.</div>
  else if (data.state === 'not_ingested') body = <div className={styles.note} data-testid="ftd-not-ingested">{memberSentence(data.reason)}</div>
  else if (data.state === 'none_reported') body = <div className={styles.note} data-testid="ftd-none">{memberSentence(data.reason)}</div>
  else {
    const pts = [...(data.points || [])].reverse()
    body = (
      <div data-testid="ftd">
        <p className={styles.lede} data-testid="ftd-summary">
          Latest balance {fmt(data.latest.quantity)} shares ({usd(data.latest.value)}) on {data.latest.settle_date};
          {' '}largest in the window {fmt(data.peak.quantity)} on {data.peak.settle_date}; reported on {data.days_reported} settlement dates
          {' '}between {data.window.from} and {data.window.through}.
        </p>
        {data.mismatched_files?.length > 0 && (
          <p className={styles.warn} data-testid="ftd-mismatch">Files whose row count did not match their trailer: {data.mismatched_files.join(', ')}.</p>
        )}
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <thead><tr><th scope="col">Settlement date</th><th scope="col">Fails (shares)</th><th scope="col">Price</th><th scope="col">Value</th></tr></thead>
            <tbody>
              {pts.slice(0, 60).map((p) => (
                <tr key={p.settle_date} data-testid="ftd-row">
                  <th scope="row">{p.settle_date}</th><td>{fmt(p.quantity)}</td>
                  <td>{formatNumber(num(p.price), { decimals: 2 })}</td><td>{usd(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }
  return (
    <section className={chrome.panelClass} data-testid="ftd-panel">
      {chrome.showTitle && <h3 className={styles.panelTitle}>Fails to deliver (SEC)</h3>}
      {body}
      {data && !data.paywalled && !error && (
        <p className={styles.muted} data-testid="ftd-basis">{data.basis} Source: {memberText(data.source)}.</p>
      )}
    </section>
  )
}
