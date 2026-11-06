// app/src/components/admin/NotebookReturnMetricsPanel.jsx
//
// Audit 2026-11-05, spec S20 -- the Notebook's return metrics, admin only. GET /api/admin/notebook-return-metrics
// (require_admin) computes the six numbers from the telemetry rows the Notebook already writes
// (api/services/journal_two/notebook_return_metrics.py). It lives on the Admin page, which is its own lazy route,
// so it costs the Notebook's first open nothing. Same idiom as CompassHealthPanel: Admin.module.css classes, SWR,
// PanelReadError. Each number shows its n, and its definition is one line under the grid.
import { useState } from 'react'
import useSWR from 'swr'
import styles from '../../pages/Admin.module.css'
import UIcon from '../ui/UIcon'
import { adminFetcher as fetcher } from './adminFetcher'
import PanelReadError from './PanelReadError'

export const RETURN_METRICS_URL = '/api/admin/notebook-return-metrics'

export const pct = (r) => (r == null ? '—' : `${(r * 100).toFixed(1)}%`)

/** Seconds as a short duration: 45s, 3.2m, 5.1h, 2.0d. */
export function fmtSeconds(s) {
  if (s == null || !Number.isFinite(s)) return '—'
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${(s / 60).toFixed(1)}m`
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`
  return `${(s / 86400).toFixed(1)}d`
}

function Stat({ n, label, sub }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statNumber}>{n}</span>
      <span className={styles.statLabel}>{label}</span>
      {sub && <span className={styles.statLabel} style={{ opacity: 0.7 }}>{sub}</span>}
    </div>
  )
}

export default function NotebookReturnMetricsPanel() {
  const [days, setDays] = useState(30)
  // Fix round 1 (review I5): read on open and on Retry only. No polling: the read is the server's, on the prod pod.
  const { data, error, mutate } = useSWR(`${RETURN_METRICS_URL}?days=${days}`, fetcher, { revalidateOnFocus: false })
  const warming = data?.warming === true ? data : null
  const d = data && !warming ? data : null
  const defs = d?.definitions || {}

  return (
    <div className={styles.healthSection} data-admin-panel="notebook-return-metrics">
      <div className={styles.sectionTitle}>
        <UIcon name="journal" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        Notebook return metrics
      </div>

      <div className={styles.analyticsBarLabel} style={{ margin: '4px 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ opacity: 0.7 }}>Last</span>
        {[7, 30, 90].map((n) => (
          <button key={n} type="button" onClick={() => setDays(n)} aria-pressed={days === n}
            className={styles.auditToggle} style={{
              padding: '1px 8px', fontSize: 11,
              color: days === n ? 'var(--ut-gold, #c9a84c)' : 'var(--text-muted)',
              borderColor: days === n ? 'var(--ut-gold, #c9a84c)' : 'var(--border)',
            }}>{n}d</button>
        ))}
      </div>

      <PanelReadError error={!data && error} what="Notebook return metrics" onRetry={mutate} />
      {/* Re-review R4: until its index is built after a deploy, the server reads nothing and says so. */}
      {warming && (
        <div className={styles.analyticsBarLabel} role="status" style={{ margin: '4px 0 8px', whiteSpace: 'normal' }}>
          {warming.message}{' '}
          <button type="button" className={styles.auditToggle} onClick={() => mutate()}>Try again</button>
        </div>
      )}
      <div className={styles.statsGrid}>
        <Stat n={d ? pct(d.day1?.rate) : '—'} label="Day-1 return" sub={d ? `${d.day1.returned} of ${d.day1.of}` : null} />
        <Stat n={d ? pct(d.day7?.rate) : '—'} label="Day-7 return" sub={d ? `${d.day7.returned} of ${d.day7.of}` : null} />
        <Stat n={d ? fmtSeconds(d.aha?.medianS) : '—'} label={'First "aha" (median)'}
          sub={d ? `${pct(d.aha.rate)} reached · p90 ${fmtSeconds(d.aha.p90S)}` : null} />
        <Stat n={d ? pct(d.morning?.rate) : '—'} label="Morning open rate" sub={d ? `${d.morning.days} of ${d.morning.of} days` : null} />
        <Stat n={d ? pct(d.recap?.rate) : '—'} label="Recap rate" sub={d ? `${d.recap.days} of ${d.recap.of} days` : null} />
        <Stat n={d ? d.trust?.total ?? 0 : '—'} label="Trust incidents"
          sub={d ? `${d.trust.publishUndone} publish undone · ${d.trust.widgetRestored} widget restored` : null} />
      </div>
      {d && (
        <div className={styles.analyticsBarLabel} style={{ marginTop: 8, opacity: 0.75, whiteSpace: 'normal' }}>
          {`${d.newMembers} new and ${d.activeMembers} active members · ${d.firstRunCompleted} finished the first run.`}
          {d.capped ? ' The read hit its row cap, so these numbers undercount.' : ''}
        </div>
      )}
      {d && (
        <ul className={styles.analyticsBarLabel} style={{ margin: '6px 0 0', paddingLeft: 16, opacity: 0.7, whiteSpace: 'normal' }}>
          {['day1', 'day7', 'aha', 'morning', 'recap', 'trust', 'tradingDay'].filter((k) => defs[k]).map((k) => (
            <li key={k}>{defs[k]}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
