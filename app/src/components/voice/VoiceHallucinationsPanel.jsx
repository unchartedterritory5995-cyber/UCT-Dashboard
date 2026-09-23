import { useEffect, useState, useCallback } from 'react'
import { formatETFull } from '../../utils/timeAgo'
import styles from './VoiceHallucinationsPanel.module.css'

/**
 * Hallucination-audit inbox (Packet AD CP2).
 *
 * Every Mode C voice session is audited automatically right after it ends
 * (POST /api/voice/session/end schedules a background audit) — numeric
 * claims the assistant made that didn't match its own tool-call evidence
 * get flagged to voice_hallucinations. This panel is the member's window
 * onto that flag list, plus a manual "re-audit this session" trigger for
 * on-demand re-checks (the automatic pass already covers every session; this
 * is only for re-running it).
 */
export default function VoiceHallucinationsPanel() {
  const [flags, setFlags] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [auditing, setAuditing] = useState(false)
  const [auditResult, setAuditResult] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [flagsR, sessR] = await Promise.all([
        fetch('/api/voice/hallucinations?limit=50', { credentials: 'include' }),
        fetch('/api/voice/sessions?limit=50', { credentials: 'include' }),
      ])
      if (!flagsR.ok) throw new Error(`HTTP ${flagsR.status}`)
      const flagsJ = await flagsR.json()
      setFlags(flagsJ.flags || [])
      if (sessR.ok) {
        const sessJ = await sessR.json()
        setSessions(sessJ.sessions || [])
      }
    } catch (e) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const runAudit = useCallback(async () => {
    if (!selectedSessionId) return
    setAuditing(true)
    setError(null)
    setAuditResult(null)
    try {
      const r = await fetch(`/api/voice/hallucinations/audit/${selectedSessionId}`, {
        method: 'POST', credentials: 'include',
      })
      if (r.ok) {
        setAuditResult(await r.json())
      } else {
        setError(`Re-audit failed (HTTP ${r.status})`)
      }
      await load()
    } catch (e) {
      setError(e?.message || 'Re-audit failed')
    } finally {
      setAuditing(false)
    }
  }, [selectedSessionId, load])

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>Hallucination audit</h3>
        <div className={styles.headerActions}>
          <button
            type="button"
            onClick={load}
            className={styles.refresh}
            disabled={loading}
            aria-label={loading ? 'Refreshing hallucination flags' : 'Refresh hallucination flags'}
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>
      <p className={styles.subtitle}>
        Every voice session is audited automatically right after it ends.
        A flag means Compass said a number that didn't match its own
        tool-call evidence. Re-audit a past session on demand below.
      </p>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.auditRow}>
        <select
          className={styles.sessionSelect}
          value={selectedSessionId}
          onChange={(e) => setSelectedSessionId(e.target.value)}
          aria-label="Session to re-audit"
        >
          <option value="">Choose a session…</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              #{s.id} — {s.started_at ? formatETFull(s.started_at) : 'unknown time'}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={runAudit}
          className={styles.auditBtn}
          disabled={!selectedSessionId || auditing}
        >
          {auditing ? 'Auditing…' : 'Re-audit now'}
        </button>
      </div>

      {auditResult && (
        <div className={styles.auditResult}>
          Examined {auditResult.turns_examined} turn{auditResult.turns_examined === 1 ? '' : 's'},
          {' '}flagged {auditResult.suspect_count}.
        </div>
      )}

      {flags.length === 0 && !loading && (
        <div className={styles.empty}>
          No flagged claims — Compass hasn't said anything that didn't match
          its own tool data.
        </div>
      )}

      <div className={styles.list}>
        {flags.map((f) => (
          <div key={f.id} className={styles.row}>
            <div className={styles.rowTop}>
              <span className={styles.rowSession}>Session #{f.session_id}</span>
              <span className={styles.rowConfidence}>
                confidence {Math.round((f.confidence || 0) * 100)}%
              </span>
              <span className={styles.rowDate}>
                {f.created_at ? formatETFull(f.created_at) : '—'}
              </span>
            </div>
            <div className={styles.rowTurn}>{f.turn_text}</div>
            <div className={styles.rowSuspect}>
              Suspect number: <strong>{f.suspect_number}</strong>
              {f.suspect_unit ? ` ${f.suspect_unit}` : ''}
            </div>
            {f.evidence && <div className={styles.rowEvidence}>{f.evidence}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
