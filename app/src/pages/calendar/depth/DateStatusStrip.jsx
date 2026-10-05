import useSWR from 'swr'
import { depthFetcher } from '../../research/depth/depthFetch'
import styles from './CalendarDepth.module.css'

// D-1 / D-2 (Lane R): the date STATUS of this week's reporters, and when UCT first
// saw each one confirmed. DARK behind EARNINGS_DATE_STATUS_ENABLED.
//
// ⛔ Every state names the field reading that produced it (`basis`), and the
//    timestamps are when UCT first SAW the fact, never the company's announcement.
// ⛔ A store that could not be read says so; it is never shown as "nothing recorded".

const LABEL = {
  estimated: 'Estimated',
  confirmed: 'Confirmed',
  reported: 'Reported',
  unstated: 'Unstated',
  not_recorded: 'Not recorded',
}
const ORDER = ['confirmed', 'estimated', 'reported', 'unstated', 'not_recorded']
const MOVE = {
  confirmed_date_changed: 'confirmed date changed',
  estimate_revised: 'estimate revised',
  status_not_recorded: 'moved (status not recorded then)',
}

function fmtTs(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
}

export default function DateStatusStrip({ syms }) {
  const list = [...new Set((syms || []).filter(Boolean))].sort().slice(0, 400)
  const key = list.length ? `/api/calendar/date-status?syms=${encodeURIComponent(list.join(','))}` : null
  const { data, error } = useSWR(key, depthFetcher, { revalidateOnFocus: false })

  let body
  if (!list.length) body = <span className={styles.chip}>No reporters on this week.</span>
  else if (error) body = <span className={styles.error} data-testid="date-status-unavailable">Date status could not be read right now. That is a gap in what we could read, not a finding.</span>
  else if (!data) body = <span className={styles.chip}>Reading date status…</span>
  else if (data.paywalled) body = <span className={styles.chip}>Date status requires a paid plan.</span>
  else {
    const rows = Object.entries(data.symbols || {}).sort(([a], [b]) => a.localeCompare(b))
    const counts = {}
    for (const [, r] of rows) counts[r.status] = (counts[r.status] || 0) + 1
    const moved = rows.filter(([, r]) => r.moved)
    return (
      <details className={styles.strip} data-testid="date-status-strip">
        <summary className={styles.summary}>
          <span className={styles.title}>Date status</span>
          {ORDER.filter(s => counts[s]).map(s => (
            <span key={s} className={styles.chip} data-testid={`date-status-count-${s}`}>{counts[s]} {LABEL[s].toLowerCase()}</span>
          ))}
          {moved.length > 0 && <span className={styles.chip}>{moved.length} moved</span>}
          {(data.unknown || []).length > 0 && <span className={styles.chip}>{data.unknown.length} not yet tracked</span>}
        </summary>
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <thead><tr><th scope="col">Symbol</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Since</th><th scope="col">First confirmed</th><th scope="col">Moved</th></tr></thead>
            <tbody>
              {rows.map(([sym, r]) => (
                <tr key={sym} data-testid="date-status-row">
                  <th scope="row">{sym}</th>
                  <td>{r.report_date}</td>
                  <td title={r.basis || undefined}>{LABEL[r.status] || r.status}</td>
                  <td>{fmtTs(r.status_at)}</td>
                  <td>{fmtTs(r.first_confirmed_at)}</td>
                  <td className={styles.wrap}>{r.moved ? `${r.moved.from} → ${r.moved.to} · ${MOVE[r.moved.kind] || r.moved.kind}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.muted}>Times are {data.timestamps_are}. Confirmed means a data provider placed the report in a session; it is not the company&apos;s own confirmation.</p>
        {data.company_signaled?.state === 'unavailable' && (
          <p className={styles.muted} data-testid="date-status-company-signaled">A &ldquo;company signaled&rdquo; stage is not shown: {data.company_signaled.reason}</p>
        )}
      </details>
    )
  }
  return (
    <div className={styles.strip} data-testid="date-status-strip">
      <span className={styles.title}>Date status</span> {body}
    </div>
  )
}
