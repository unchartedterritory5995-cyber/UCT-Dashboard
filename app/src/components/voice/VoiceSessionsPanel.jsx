import { useEffect, useState, useCallback } from 'react'
import { formatETFull } from '../../utils/timeAgo'
import UIcon from '../ui/UIcon'
import styles from './VoiceSessionsPanel.module.css'

/**
 * Browse past voice sessions and inspect their full trace.
 *
 * Left column: scrollable session list with variant + agent + counts.
 * Right column: selected session's trace — transcripts, tool calls,
 * feedback, variant, scratchpad.
 */
export default function VoiceSessionsPanel() {
  const [sessions, setSessions] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [trace, setTrace] = useState(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingTrace, setLoadingTrace] = useState(false)
  const [error, setError] = useState(null)

  const loadSessions = useCallback(async () => {
    setLoadingList(true)
    setError(null)
    try {
      const r = await fetch('/api/voice/sessions?limit=50', { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setSessions(j.sessions || [])
    } catch (e) {
      setError(e?.message || 'Failed to load sessions')
    } finally {
      setLoadingList(false)
    }
  }, [])

  const loadTrace = useCallback(async (sid) => {
    setSelectedId(sid)
    setTrace(null)
    setLoadingTrace(true)
    try {
      const r = await fetch(`/api/voice/sessions/${sid}/trace`, { credentials: 'include' })
      if (r.ok) setTrace(await r.json())
    } catch (e) {
      console.error('[voice-sessions] trace fetch failed', e)
    } finally {
      setLoadingTrace(false)
    }
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>Voice session history</h3>
        <button
          type="button"
          onClick={loadSessions}
          className={styles.refresh}
          disabled={loadingList}
          aria-label="Refresh session list"
        >
          {loadingList ? '...' : 'Refresh'}
        </button>
      </div>
      <p className={styles.subtitle}>
        Every Mode C conversation, with the variant that ran, every tool
        called, and every thumbs-vote. Click a row to see the full trace.
      </p>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.split}>
        {/* Left — session list */}
        <div className={styles.list}>
          {sessions.length === 0 && !loadingList && (
            <div className={styles.empty}>No voice sessions yet.</div>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`${styles.row} ${s.id === selectedId ? styles.rowActive : ''}`}
              onClick={() => loadTrace(s.id)}
            >
              <div className={styles.rowHeader}>
                <span className={styles.rowCtx}>{(s.page_context || 'global').replace('_', ' ')}</span>
                <span className={styles.rowDate}>
                  {s.started_at ? formatETFull(s.started_at) : '—'}
                </span>
              </div>
              <div className={styles.rowMeta}>
                {s.variant_id && <span className={styles.tag}>{s.variant_id}</span>}
                <span className={styles.rowDur}>
                  {s.duration_seconds ? `${Math.round(s.duration_seconds)}s` : 'open'}
                </span>
                <span className={styles.rowCount}>{s.transcript_count} turns</span>
                <span className={styles.rowCount}>{s.tool_call_count} tools</span>
              </div>
            </button>
          ))}
        </div>

        {/* Right — selected trace */}
        <div className={styles.detail}>
          {!selectedId && (
            <div className={styles.empty}>
              Pick a session on the left to see its full trace.
            </div>
          )}
          {selectedId && loadingTrace && (
            <div className={styles.empty}>Loading trace…</div>
          )}
          {selectedId && trace && (
            <div>
              {/* Header */}
              <div className={styles.traceHeader}>
                <div className={styles.traceTitle}>
                  Session #{trace.session.id}
                </div>
                <div className={styles.traceMeta}>
                  {trace.variant && (
                    <span className={styles.tag}>variant: {trace.variant.variant_id}</span>
                  )}
                  <span className={styles.tag}>ctx: {trace.session.page_context}</span>
                  <span className={styles.tag}>
                    {trace.counts.transcripts} turns · {trace.counts.tool_calls} tools
                  </span>
                </div>
              </div>

              {/* Transcript timeline */}
              <h4 className={styles.sectionTitle}>Conversation</h4>
              {trace.transcripts.length === 0 ? (
                <div className={styles.empty}>(no turns)</div>
              ) : (
                <div className={styles.timeline}>
                  {trace.transcripts.map((t, i) => (
                    <div key={i} className={`${styles.turn} ${styles[`turn_${t.role}`] || ''}`}>
                      <span className={styles.turnRole}>{t.role}</span>
                      <span className={styles.turnText}>{t.text}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Tool calls */}
              {trace.tool_calls.length > 0 && (
                <>
                  <h4 className={styles.sectionTitle}>Tool calls</h4>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Tool</th>
                        <th>Args</th>
                        <th>OK</th>
                        <th>Latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trace.tool_calls.map((c, i) => (
                        <tr key={i} className={c.ok ? '' : styles.failRow}>
                          <td className={styles.toolName}>{c.tool_name}</td>
                          <td className={styles.args}>
                            <code>{c.args ? JSON.stringify(c.args).slice(0, 60) : '—'}</code>
                          </td>
                          <td>{c.ok ? '✓' : '✗'}</td>
                          <td>{c.latency_ms ? `${c.latency_ms}ms` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {/* Feedback */}
              {trace.feedback.length > 0 && (
                <>
                  <h4 className={styles.sectionTitle}>Feedback</h4>
                  <ul className={styles.feedbackList}>
                    {trace.feedback.map((f, i) => (
                      <li key={i} className={styles[`fb_${f.rating}`] || ''}>
                        <span className={styles.fbRating}>
                          {f.rating === 'up' ? <UIcon name="thumbsUp" size={13} /> : <UIcon name="thumbsDown" size={13} />}
                        </span>
                        <span>{f.turn_text || f.correction_text || '—'}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {/* Why explanation link */}
              <div className={styles.explainCta}>
                <a
                  href={`/api/voice/sessions/${trace.session.id}/trace`}
                  download={`voice-session-${trace.session.id}.json`}
                  className={styles.downloadBtn}
                >
                  Download trace JSON
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
