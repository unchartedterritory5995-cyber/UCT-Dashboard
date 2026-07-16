import { useEffect, useState, useRef, useCallback } from 'react'
import useRealtimeSession from '../../hooks/useRealtimeSession'
import { useVoice } from '../../context/VoiceContext'
import styles from './AgentPicker.module.css'

/**
 * Small button next to FloatingOrb that opens a popover listing the 4
 * specialist agents (Analyst, Risk Officer, Coach, Scout). Click an
 * agent → ends current session if any and starts a fresh one in that
 * agent's context.
 *
 * Hidden while in a session — orb is the disconnect control then.
 */
export default function AgentPicker({ onMinimize }) {
  const voice = useVoice()
  const { connect, disconnect } = useRealtimeSession()
  const [agents, setAgents] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const popRef = useRef(null)

  const status = voice.status
  const inSession = voice.mode === 'c' && status !== 'idle' && status !== 'error'

  // Lazy-fetch on first open
  useEffect(() => {
    if (!open || agents.length > 0) return
    let cancelled = false
    setLoading(true)
    fetch('/api/voice/agents', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { agents: [] })
      .then((j) => { if (!cancelled) setAgents(j.agents || []) })
      .catch((e) => console.error('[agents] fetch failed', e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, agents.length])

  // Click outside / Escape to close
  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pickAgent = useCallback(async (agent) => {
    setOpen(false)
    try {
      if (inSession) {
        await disconnect()
      }
      // Tiny delay so disconnect completes before mint
      setTimeout(() => connect(agent.id), 200)
    } catch (e) {
      console.error('[agents] pick failed', e)
    }
  }, [inSession, disconnect, connect])

  // Hide picker entirely during a session to avoid double-click hazards
  if (inSession) return null

  return (
    <div className={styles.wrap} ref={popRef}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-label="Choose a specialist agent"
        title="Choose a specialist (Analyst, Risk Officer, Coach, Scout)"
        aria-expanded={open}
      >
        <span aria-hidden="true">⋮</span>
      </button>
      {open && (
        <div className={styles.popover} role="menu">
          <div className={styles.header}>Pick a specialist</div>
          {loading && <div className={styles.loading}>Loading…</div>}
          {!loading && agents.length === 0 && (
            <div className={styles.empty}>No agents available.</div>
          )}
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              className={styles.agentRow}
              style={{ borderLeftColor: a.color || '#888' }}
              onClick={() => pickAgent(a)}
              title={a.description}
            >
              <span className={styles.emoji} aria-hidden="true">{a.emoji}</span>
              <span className={styles.body}>
                <span className={styles.name}>{a.display_name}</span>
                <span className={styles.desc}>{a.description}</span>
              </span>
            </button>
          ))}
          {onMinimize && (
            <button
              type="button"
              role="menuitem"
              className={styles.agentRow}
              style={{ borderLeftColor: 'transparent', borderTop: '1px solid rgba(255,255,255,0.09)', marginTop: 3, paddingTop: 8 }}
              onClick={() => { setOpen(false); onMinimize() }}
              title="Hide the buttons and shrink Compass to a small dot in the corner"
            >
              <span className={styles.emoji} aria-hidden="true">–</span>
              <span className={styles.body}>
                <span className={styles.name}>Minimize Compass</span>
                <span className={styles.desc}>Shrink to a small dot — tap it to expand</span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
