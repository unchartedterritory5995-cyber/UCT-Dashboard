// app/src/components/admin/CompassHealthPanel.jsx
//
// Packet M CP1 (signed 2026-09-22, fingerprint 3f28cd944) -- admin-only
// Compass mentor health: chat volume, active users, tool-failure rate, the
// worst-offending tools, and today's live model spend + circuit-breaker
// state. GET /api/j2/compass-health already computed this -- it is the sole
// input to a real, scheduled weekly owner email, and had zero frontend
// callers until this panel. Modeled directly on AiSearchInsightsPanel.jsx's
// idiom (same Admin.module.css classes, same Stat/BarList shapes, no new
// stylesheet).
import { useState } from 'react'
import useSWR from 'swr'
import styles from '../../pages/Admin.module.css'
import UIcon from '../ui/UIcon'

// Error-swallowing fetcher -- the panel must degrade to empty, never throw.
const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

const pct = (v) => `${((v || 0) * 100).toFixed(1)}%`

function Stat({ n, label }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statNumber}>{n}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

function BarList({ rows, labelKey, valKey, max, color }) {
  if (!rows?.length) return <div className={styles.analyticsBarLabel} style={{ opacity: 0.6 }}>None</div>
  return (
    <div className={styles.analyticsBars}>
      {rows.map((d, i) => (
        <div key={`${d[labelKey]}-${i}`} className={styles.analyticsBarRow}>
          <span className={styles.analyticsBarLabel} title={d[labelKey]}>{d[labelKey]}</span>
          <div className={styles.analyticsBarTrack}>
            <div className={styles.analyticsBar}
              style={{ width: `${max ? (d[valKey] / max) * 100 : 0}%`, background: color }} />
          </div>
          <span className={styles.analyticsBarVal}>{d[valKey]}</span>
        </div>
      ))}
    </div>
  )
}

export default function CompassHealthPanel() {
  const [days, setDays] = useState(7)
  const { data } = useSWR(`/api/j2/compass-health?days=${days}`, fetcher, { refreshInterval: 60000 })

  const maxFail = Math.max(1, ...(data?.top_failing_tools || []).map((t) => t.failures))
  const cost = data?.cost_today || {}

  return (
    <div className={styles.healthSection}>
      <div className={styles.sectionTitle}>
        <UIcon name="compass" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        Compass Health
      </div>

      <div className={styles.analyticsBarLabel} style={{ margin: '4px 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ opacity: 0.7 }}>Last</span>
        {[1, 7, 30].map((d) => (
          <button key={d} onClick={() => setDays(d)}
            className={styles.auditToggle} style={{
              padding: '1px 8px', fontSize: 11,
              color: days === d ? 'var(--ut-gold, #c9a84c)' : 'var(--text-muted)',
              borderColor: days === d ? 'var(--ut-gold, #c9a84c)' : 'var(--border)',
            }}>{d}d</button>
        ))}
      </div>

      <div className={styles.statsGrid}>
        <Stat n={data?.chat_turns ?? '—'} label="Chat turns" />
        <Stat n={data?.active_users ?? '—'} label="Active users" />
        <Stat n={data?.tool_calls ?? '—'} label="Tool calls" />
        <Stat n={data ? pct(data.tool_failure_rate) : '—'} label="Tool failure rate" />
        <Stat n={data?.avg_latency_ms != null ? `${data.avg_latency_ms}ms` : '—'} label="Avg latency" />
      </div>

      <div className={styles.analyticsBarLabel} style={{ margin: '16px 0 8px', opacity: 0.7 }}>
        Top failing tools
      </div>
      <BarList rows={data?.top_failing_tools} labelKey="tool" valKey="failures" max={maxFail} color="#f87171" />

      <div className={styles.analyticsBarLabel} style={{ margin: '16px 0 4px', opacity: 0.7 }}>
        Today's model spend
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
        {cost.spend_usd != null ? `$${Number(cost.spend_usd).toFixed(2)}` : '—'}
        {cost.circuit_open && (
          <span style={{ color: '#f87171', marginLeft: 8 }}>· circuit breaker OPEN</span>
        )}
      </div>
    </div>
  )
}
