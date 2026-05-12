import { useEffect, useState, useCallback } from 'react'
import styles from './VoiceTelemetryPanel.module.css'

/**
 * Voice telemetry — shows the assistant's tool-call success rate, recent
 * failures, and the corrections that get injected into every future
 * session's system prompt.
 *
 * Reads from /api/voice/tool-call-stats, /api/voice/feedback,
 * /api/voice/feedback/corrections. Lets the user delete a correction
 * (via re-recording a thumbs-up with the same turn_text? — actually we
 * just expose a DELETE endpoint here). For now corrections are
 * read-only — to remove one, you say "forget X" in voice or wait for
 * the 60-day TTL.
 */
export default function VoiceTelemetryPanel() {
  const [stats, setStats] = useState(null)
  const [corrections, setCorrections] = useState([])
  const [recentFeedback, setRecentFeedback] = useState([])
  const [patterns, setPatterns] = useState([])
  const [agentStats, setAgentStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsR, corrR, fbR, patR, agentR] = await Promise.all([
        fetch('/api/voice/tool-call-stats', { credentials: 'include' }),
        fetch('/api/voice/feedback/corrections', { credentials: 'include' }),
        fetch('/api/voice/feedback', { credentials: 'include' }),
        fetch('/api/voice/failure-patterns', { credentials: 'include' }),
        fetch('/api/voice/agents/stats?days=30', { credentials: 'include' }),
      ])
      if (statsR.ok) setStats(await statsR.json())
      if (corrR.ok) {
        const j = await corrR.json()
        setCorrections(j.corrections || [])
      }
      if (fbR.ok) {
        const j = await fbR.json()
        setRecentFeedback((j.feedback || []).slice(0, 15))
      }
      if (patR.ok) {
        const j = await patR.json()
        setPatterns(j.patterns || [])
      }
      if (agentR.ok) {
        const j = await agentR.json()
        setAgentStats(j.rows || [])
      }
    } catch (e) {
      setError(e?.message || 'Failed to load telemetry')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const byTool = stats?.by_tool || []
  const failures = stats?.recent_failures || []

  const totalCalls = byTool.reduce((a, r) => a + (r.total || 0), 0)
  const totalSuccess = byTool.reduce((a, r) => a + (r.success || 0), 0)
  const overallRate = totalCalls > 0
    ? Math.round((totalSuccess / totalCalls) * 100)
    : null

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title} id="voice-telemetry-title">Voice telemetry</h3>
        <div className={styles.headerActions}>
          <a
            href="/api/voice/transcripts/export?format=txt"
            className={styles.exportBtn}
            aria-label="Download all voice transcripts as a plain-text file"
            title="Download all voice transcripts as plain text"
          >
            Download transcripts
          </a>
          <button
            type="button"
            onClick={refresh}
            className={styles.refresh}
            disabled={loading}
            aria-label={loading ? 'Refreshing voice telemetry' : 'Refresh voice telemetry'}
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>
      <p className={styles.subtitle}>
        Tool reliability, recent failures, and durable corrections you've
        taught the assistant. Corrections appear in every new session's
        system prompt.
      </p>

      {error && <div className={styles.error}>{error}</div>}

      {/* Failure patterns banner ── */}
      {patterns.length > 0 && (
        <div className={styles.patternBanner}>
          <div className={styles.patternHeader}>
            ⚠ Pattern{patterns.length === 1 ? '' : 's'} detected — the assistant
            has been told to avoid these tools or ask first
          </div>
          <ul className={styles.patternList}>
            {patterns.map((p) => (
              <li key={p.tool_name} className={styles.patternItem}>
                <span className={styles.patternName}>{p.tool_name}</span>
                <span className={styles.patternRate}>
                  {Math.round(p.failure_rate * 100)}% failing
                </span>
                <span className={styles.patternDetail}>
                  ({p.failures_in_window}/{p.total_in_window} recent calls)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Overall ── */}
      <div className={styles.statRow}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Tool calls</div>
          <div className={styles.statValue}>{totalCalls.toLocaleString()}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Success rate</div>
          <div className={`${styles.statValue} ${overallRate !== null && overallRate < 90 ? styles.statBad : ''}`}>
            {overallRate === null ? '—' : `${overallRate}%`}
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Distinct tools</div>
          <div className={styles.statValue}>{byTool.length}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Recent failures</div>
          <div className={`${styles.statValue} ${failures.length > 0 ? styles.statBad : ''}`}>
            {failures.length}
          </div>
        </div>
      </div>

      {/* Per-agent usage ── */}
      {agentStats.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Agent usage — last 30 days</h4>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Sessions</th>
                <th>Total time</th>
                <th>Avg time</th>
                <th>Extra</th>
              </tr>
            </thead>
            <tbody>
              {agentStats.map((r) => {
                const total = r.total_duration_seconds || 0
                const mins = Math.round(total / 60)
                const avgSec = Math.round(r.avg_duration_seconds || 0)
                return (
                  <tr key={r.context}>
                    <td className={styles.toolName}>
                      {r.context.replace('_', ' ')}
                    </td>
                    <td>{r.session_count}</td>
                    <td>{mins >= 1 ? `${mins}m` : `${total}s`}</td>
                    <td>{avgSec}s</td>
                    <td>
                      {r.context === 'risk_officer' && r.trade_refusals !== undefined
                        ? `${r.trade_refusals} trade refusals`
                        : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-tool breakdown ── */}
      {byTool.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Per-tool success rate</h4>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Calls</th>
                <th>Success</th>
                <th>Rate</th>
                <th>Avg latency</th>
              </tr>
            </thead>
            <tbody>
              {byTool.slice(0, 20).map((r) => {
                const rate = r.total > 0 ? Math.round((r.success / r.total) * 100) : null
                return (
                  <tr key={r.tool_name}>
                    <td className={styles.toolName}>{r.tool_name}</td>
                    <td>{r.total}</td>
                    <td>{r.success || 0}</td>
                    <td className={rate !== null && rate < 80 ? styles.bad : ''}>
                      {rate === null ? '—' : `${rate}%`}
                    </td>
                    <td>{r.avg_latency_ms ? `${Math.round(r.avg_latency_ms)}ms` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent failures ── */}
      {failures.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Recent failures</h4>
          <div className={styles.failureList}>
            {failures.slice(0, 8).map((f, i) => (
              <div key={i} className={styles.failureRow}>
                <div className={styles.failureTool}>{f.tool_name}</div>
                <div className={styles.failureError}>{f.error || '—'}</div>
                <div className={styles.failureTime}>
                  {f.created_at ? new Date(f.created_at).toLocaleString() : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active corrections ── */}
      {corrections.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Active corrections ({corrections.length})</h4>
          <p className={styles.note}>
            These are injected into every new session. They expire after 60 days.
          </p>
          <ul className={styles.corrections}>
            {corrections.map((c) => (
              <li key={c.id} className={styles.correctionItem}>
                <div className={styles.correctionText}>{c.correction_text}</div>
                {c.turn_text && (
                  <div className={styles.correctionContext}>
                    Was wrong about: <i>{c.turn_text}</i>
                  </div>
                )}
                <div className={styles.correctionTime}>
                  {c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recent feedback ── */}
      {recentFeedback.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Recent thumbs</h4>
          <ul className={styles.feedback}>
            {recentFeedback.map((f) => (
              <li key={f.id} className={f.rating === 'up' ? styles.fbUp : styles.fbDown}>
                <span className={styles.fbRating}>{f.rating === 'up' ? '👍' : '👎'}</span>
                <span className={styles.fbText}>{f.turn_text || f.correction_text || '—'}</span>
                <span className={styles.fbTime}>
                  {f.created_at ? new Date(f.created_at).toLocaleDateString() : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && totalCalls === 0 && corrections.length === 0 && recentFeedback.length === 0 && (
        <p className={styles.empty}>
          No voice activity yet. Use voice to ask questions and rate responses to
          start building telemetry.
        </p>
      )}
    </div>
  )
}
