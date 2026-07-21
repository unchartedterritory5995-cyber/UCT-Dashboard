// app/src/components/admin/AiSearchInsightsPanel.jsx
//
// Admin-only "AI Search Insights" — the de-identified analytics view over the
// captured Q&A log (api/services/ai_search_log.py). Mirrors the Admin.jsx
// healthSection idiom (same Admin.module.css classes; no new stylesheet, no
// ECharts). Two lanes: "Today · live" (in-memory /admin/stats) and
// "All-time · window" (persistent /admin/log). No identity is ever shown.
import { useState } from 'react'
import useSWR from 'swr'
import styles from '../../pages/Admin.module.css'
import UIcon from '../ui/UIcon'

// Error-swallowing fetcher — the panel must degrade to empty, never throw.
const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

const pct = (v) => `${Math.round((v || 0) * 100)}%`
const FRESH_COLORS = { evergreen: '#c9a84c', time_sensitive: '#5b9bd5' }

function Stat({ n, label }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statNumber}>{n}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

// Horizontal count bars (Top Questions / Top Tickers), reusing the analyticsBar idiom.
function BarList({ rows, labelKey, valKey, max, color }) {
  if (!rows?.length) return <div className={styles.analyticsBarLabel} style={{ opacity: 0.6 }}>None yet</div>
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

export default function AiSearchInsightsPanel() {
  const [days, setDays] = useState(7)
  const [showRows, setShowRows] = useState(false)
  const { data: live } = useSWR('/api/ai-search/admin/stats', fetcher, { refreshInterval: 60000 })
  const { data: log } = useSWR(`/api/ai-search/admin/log?days=${days}&limit=40`, fetcher, { refreshInterval: 120000 })

  const fresh = log?.by_freshness || {}
  const freshTotal = (fresh.evergreen || 0) + (fresh.time_sensitive || 0)
  const maxQ = Math.max(1, ...(log?.top_questions || []).map((q) => q.count))
  const maxT = Math.max(1, ...(log?.top_tickers || []).map((t) => t.count))

  return (
    <div className={styles.healthSection}>
      <div className={styles.sectionTitle}>
        <UIcon name="compass" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        AI Search Insights
      </div>

      {/* Lane 1 — Today · live (in-memory usage) */}
      <div className={styles.analyticsBarLabel} style={{ margin: '4px 0 8px', opacity: 0.7 }}>Today · live</div>
      <div className={styles.statsGrid}>
        <Stat n={live?.requests ?? '—'} label="Requests" />
        <Stat n={live?.active_users ?? '—'} label="Active users" />
        <Stat n={live ? pct(live.cache_hit_rate) : '—'} label="Cache hit" />
        <Stat n={live ? `${live.billed_units}/${live.global_limit}` : '—'} label="Units / cap" />
      </div>

      {/* Lane 2 — All-time · window (persistent, de-identified log) */}
      <div className={styles.analyticsBarLabel} style={{ margin: '16px 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ opacity: 0.7 }}>All-time · last</span>
        {[1, 7, 30].map((d) => (
          <button key={d} onClick={() => setDays(d)}
            className={styles.auditToggle} style={{
              padding: '1px 8px', fontSize: 11,
              color: days === d ? 'var(--ut-gold, #c9a84c)' : 'var(--text-muted)',
              borderColor: days === d ? 'var(--ut-gold, #c9a84c)' : 'var(--border)',
            }}>{d}d</button>
        ))}
        {log?.enabled === false && <span style={{ color: '#f87171' }}>· capture disabled</span>}
      </div>

      <div className={styles.statsGrid}>
        <Stat n={log?.window_count ?? '—'} label="Questions" />
        <Stat n={log?.answered ?? '—'} label="Answered" />
        <Stat n={log?.total ?? '—'} label="Total logged" />
        <Stat n={log?.distinct_buckets ?? '—'} label="Distinct askers" />
        <Stat n={log ? pct(log.grounded_rate) : '—'} label="Grounded" />
        <Stat n={log ? pct(log.cache_rate) : '—'} label="Cached" />
        <Stat n={log ? pct(log.first_person_rate) : '—'} label="Personal" />
        <Stat n={log ? pct(log.error_rate) : '—'} label="Errors" />
      </div>

      {/* Hero — freshness split (what can ever become durable house knowledge) */}
      <div className={styles.analyticsBarLabel} style={{ margin: '14px 0 6px', opacity: 0.7 }}>
        Freshness split (evergreen can feed the future brain; time-sensitive never does)
      </div>
      <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {freshTotal === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: 'var(--text-muted)' }}>No data yet</div>
        ) : (
          <>
            <div title={`Evergreen ${fresh.evergreen || 0}`}
              style={{ width: `${((fresh.evergreen || 0) / freshTotal) * 100}%`, background: FRESH_COLORS.evergreen }} />
            <div title={`Time-sensitive ${fresh.time_sensitive || 0}`}
              style={{ width: `${((fresh.time_sensitive || 0) / freshTotal) * 100}%`, background: FRESH_COLORS.time_sensitive }} />
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
        <span><span style={{ color: FRESH_COLORS.evergreen }}>■</span> Evergreen {fresh.evergreen || 0}</span>
        <span><span style={{ color: FRESH_COLORS.time_sensitive }}>■</span> Time-sensitive {fresh.time_sensitive || 0}</span>
      </div>

      {/* Top questions + top tickers side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 16 }}>
        <div>
          <div className={styles.analyticsBarLabel} style={{ marginBottom: 6, opacity: 0.7 }}>Top questions</div>
          <BarList rows={(log?.top_questions || []).slice(0, 8)} labelKey="q" valKey="count" max={maxQ} color="var(--ut-gold, #c9a84c)" />
        </div>
        <div>
          <div className={styles.analyticsBarLabel} style={{ marginBottom: 6, opacity: 0.7 }}>Top tickers</div>
          <BarList rows={(log?.top_tickers || []).slice(0, 8)} labelKey="ticker" valKey="count" max={maxT} color="#5b9bd5" />
        </div>
      </div>

      {/* Recent Q&A — collapsible, de-identified, spot-check the freshness labels */}
      <button onClick={() => setShowRows((s) => !s)} className={styles.auditToggle}
        style={{ marginTop: 16, fontSize: 12 }}>
        {showRows ? 'Hide' : 'Show'} recent questions ({log?.recent?.length || 0})
      </button>
      {showRows && (
        <div className={styles.activityList} style={{ marginTop: 8 }}>
          {(log?.recent || []).map((r, i) => (
            <div key={i} className={styles.activityRow}>
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 8, flexShrink: 0,
                background: `${FRESH_COLORS[r.freshness] || '#888'}22`,
                color: FRESH_COLORS[r.freshness] || '#aaa',
              }}>{r.freshness === 'evergreen' ? 'EVG' : 'TS'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.query}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.answer_snip}</div>
              </span>
              <span className={styles.activityTime} style={{ flexShrink: 0 }}>
                {r.question_type} · {r.mode}{r.grounded ? ' · grounded' : ''}{r.first_person ? ' · personal' : ''}
              </span>
            </div>
          ))}
          {!log?.recent?.length && <div className={styles.analyticsBarLabel} style={{ opacity: 0.6 }}>No questions logged yet</div>}
        </div>
      )}
    </div>
  )
}
