// app/src/components/admin/ThemeEngineHealthPanel.jsx
//
// Packet Y CP3 (signed 2026-09-23, fingerprint 4007862bd) — admin-only
// visibility panel for the Theme Membership Engine (api/routers/theme_engine.py
// GET /status), which had zero frontend callers before this. Same
// AiSearchInsightsPanel.jsx idiom: error-swallowing fetcher, one useSWR,
// Admin.module.css classes only, no new stylesheet.
//
// Read-only. Does NOT wire /rollback, /dry-run, /suppress/.../dismiss or
// /clear-decisions — those are write endpoints and explicitly out of this
// checkpoint's scope (see the packet's CP3 "Explicitly deferred" note).
import { useState } from 'react'
import useSWR from 'swr'
import styles from '../../pages/Admin.module.css'
import UIcon from '../ui/UIcon'

// Error-swallowing fetcher — the panel must degrade to empty, never throw.
// /api/theme-engine/status is require_admin-gated, so credentials:'include'
// is load-bearing here (unlike a no-auth CP2 monitor, where it merely costs
// nothing).
const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

// THEME_ENGINE_DAILY_COST_CAP's current default (api/services/theme_engine/orphans.py:177).
// The /status endpoint does not publish the cap itself — keep this literal in
// sync with that default if it ever changes.
const DAY_COST_CAP_USD = 5.0

// A run with no finished_at is shown as "running" while started_at is within
// this window, else flagged "unfinished — check logs". Chosen bound, stated
// here rather than left implicit.
const STALE_RUN_MS = 2 * 60 * 60 * 1000 // 2 hours

function Stat({ n, label, warn }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statNumber} style={warn ? { color: '#f87171' } : undefined}>{n}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

function Badge({ tone, children }) {
  const colors = {
    flagged: '#f87171',
    running: '#5b9bd5',
    clean: '#4ade80',
  }
  const color = colors[tone] || 'var(--text-muted)'
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 8,
      background: `${color}22`, color, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

// SQLite datetime('now') text ("YYYY-MM-DD HH:MM:SS") is UTC with no offset
// marker — treat it as such rather than letting the browser assume local time.
function parseSqliteUtc(text) {
  if (!text) return null
  const d = new Date(`${text.replace(' ', 'T')}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function runBadge(run) {
  if (run.error) return { tone: 'flagged', label: 'error' }
  if (!run.finished_at) {
    const started = parseSqliteUtc(run.started_at)
    const ageMs = started ? Date.now() - started.getTime() : Infinity
    if (ageMs > STALE_RUN_MS) return { tone: 'flagged', label: 'unfinished — check logs' }
    return { tone: 'running', label: 'running' }
  }
  return { tone: 'clean', label: 'done' }
}

export default function ThemeEngineHealthPanel() {
  const { data } = useSWR('/api/theme-engine/status', fetcher, { refreshInterval: 60000 })
  const [showAll, setShowAll] = useState(false)

  const dayCost = data?.day_cost_usd
  const overCap = dayCost != null && dayCost >= DAY_COST_CAP_USD
  const runs = data?.runs || []
  const visibleRuns = showAll ? runs : runs.slice(0, 8)

  return (
    <div className={styles.healthSection}>
      <div className={styles.sectionTitle}>
        <UIcon name="compass" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        Theme Engine
      </div>

      <div className={styles.statsGrid}>
        <Stat
          n={dayCost != null ? `$${Number(dayCost).toFixed(2)} / $${DAY_COST_CAP_USD.toFixed(2)}` : '—'}
          label="Day spend"
          warn={overCap}
        />
        <Stat n={data?.pending_suppressions ?? '—'} label="Pending suppressions" />
        <Stat n={data?.overlay_adds ?? '—'} label="Overlay adds" />
      </div>

      <div className={styles.analyticsBarLabel} style={{ margin: '16px 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ opacity: 0.7 }}>Run ledger (latest 20)</span>
        {runs.length > 8 && (
          <button className={styles.auditToggle} style={{ padding: '1px 8px', fontSize: 11 }}
            onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Show fewer' : `Show all ${runs.length}`}
          </button>
        )}
      </div>

      {!data && <div className={styles.analyticsBarLabel} style={{ opacity: 0.6 }}>No data yet</div>}
      {data && runs.length === 0 && (
        <div className={styles.analyticsBarLabel} style={{ opacity: 0.6 }}>No runs recorded yet</div>
      )}

      {runs.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '4px 8px' }}>Kind</th>
                <th style={{ padding: '4px 8px' }}>Started</th>
                <th style={{ padding: '4px 8px' }}>Finished</th>
                <th style={{ padding: '4px 8px' }}>Examined</th>
                <th style={{ padding: '4px 8px' }}>Added</th>
                <th style={{ padding: '4px 8px' }}>Retiered</th>
                <th style={{ padding: '4px 8px' }}>Dropped</th>
                <th style={{ padding: '4px 8px' }}>Skipped</th>
                <th style={{ padding: '4px 8px' }}>Cost</th>
                <th style={{ padding: '4px 8px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleRuns.map((r) => {
                const badge = runBadge(r)
                return (
                  <tr key={r.run_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 8px' }}>{r.kind}</td>
                    <td style={{ padding: '4px 8px' }}>{r.started_at || '—'}</td>
                    <td style={{ padding: '4px 8px' }}>{r.finished_at || '—'}</td>
                    <td style={{ padding: '4px 8px' }}>{r.examined ?? '—'}</td>
                    <td style={{ padding: '4px 8px' }}>{r.added ?? '—'}</td>
                    <td style={{ padding: '4px 8px' }}>{r.retiered ?? '—'}</td>
                    <td style={{ padding: '4px 8px' }}>{r.dropped ?? '—'}</td>
                    <td style={{ padding: '4px 8px' }}>{r.skipped ?? '—'}</td>
                    <td style={{ padding: '4px 8px' }}>{r.cost_usd != null ? `$${Number(r.cost_usd).toFixed(2)}` : '—'}</td>
                    <td style={{ padding: '4px 8px' }}>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      {r.error && <span title={r.error} style={{ marginLeft: 6, color: '#f87171', cursor: 'help' }}>ⓘ</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
