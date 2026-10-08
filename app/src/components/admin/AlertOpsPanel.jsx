// app/src/components/admin/AlertOpsPanel.jsx
//
// Alerts PRD AC-7 / AC-8 (TERMINAL-NEXT lane S): the per-trigger ops monitor
// and the channel-health view. Reads GET /api/admin/alerts/ops-monitor, which
// is DARK (ALERT_OPS_MONITOR_ENABLED) -- a 404 renders NOTHING, so the admin
// page is unchanged until the owner arms it.
//
// Per trigger type: evaluated / fired / could-not-evaluate, never one collapsed
// "N alerts" count -- a type whose source failed is NAMED (status degraded),
// and a type that did not run says "no runs", never "clean".
// Per channel kind (the AC-2 registry): ok / failed / skipped + a status.
import useSWR from 'swr'
import styles from '../../pages/Admin.module.css'

// Error-swallowing fetcher -- the panel degrades to absent, never throws.
const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

const TONE = {
  clean: 'var(--color-success, #4ade80)',
  ok: 'var(--color-success, #4ade80)',
  degraded: '#f87171',
  unconfigured: 'var(--text-muted)',
  idle: 'var(--text-muted)',
  'no-runs': '#fbbf24',
}

function Status({ s }) {
  return <span data-status={s} style={{ color: TONE[s] || 'var(--text-muted)', fontWeight: 600 }}>{s}</span>
}

export default function AlertOpsPanel() {
  const { data } = useSWR('/api/admin/alerts/ops-monitor', fetcher, { refreshInterval: 60000 })
  if (!data) return null
  const types = Object.entries(data.trigger_types || {})
  const chans = data.channels || []
  const held = data.withheld || {}

  return (
    <div className={styles.healthSection} data-testid="alert-ops-panel">
      <div className={styles.sectionTitle}>Alert Ops Monitor</div>

      <div className={styles.analyticsBarLabel} style={{ margin: '4px 0 8px', opacity: 0.7 }}>
        Trigger types · last {Math.round((data.window_s || 0) / 3600)}h
      </div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', opacity: 0.7 }}>
            <th>Type</th><th>Runs</th><th>Evaluated</th><th>Fired</th><th>Could not evaluate</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {types.map(([t, r]) => (
            <tr key={t} data-type={t}>
              <td>{t}</td><td>{r.runs}</td><td>{r.evaluated}</td><td>{r.fired}</td>
              <td>{r.could_not_evaluate}</td><td><Status s={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.analyticsBarLabel} style={{ margin: '16px 0 8px', opacity: 0.7 }}>
        Delivery channels
      </div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', opacity: 0.7 }}>
            <th>Channel</th><th>OK</th><th>Failed</th><th>Skipped</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {chans.map((c) => (
            <tr key={c.kind} data-channel={c.kind}>
              <td title={c.owner}>{c.label}</td><td>{c.ok}</td><td>{c.failed}</td><td>{c.skipped}</td>
              <td><Status s={c.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 12, marginTop: 8, opacity: 0.8 }}>
        Withheld: {held.suspended || 0} suspended by the member · {held.capped || 0} over the queue cap
      </div>
    </div>
  )
}
