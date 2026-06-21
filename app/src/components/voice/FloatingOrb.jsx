import { useEffect, useRef, useState } from 'react'
import { useVoice } from '../../context/VoiceContext'
import useRealtimeSession from '../../hooks/useRealtimeSession'
import AgentPicker from './AgentPicker'
import CompassOrb from './CompassOrb'
import VisionAttachButton from './VisionAttachButton'
import UIcon from '../ui/UIcon'
import useHideOnScroll from '../../hooks/useHideOnScroll'
import useScrollLocked from '../../hooks/useScrollLocked'
import styles from './FloatingOrb.module.css'

const POS_KEY = 'voice.orb.position'
const DRAG_THRESHOLD_PX = 5
const EDGE_PADDING_PX = 8

function loadPos() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (typeof p?.x !== 'number' || typeof p?.y !== 'number') return null
    return p
  } catch { return null }
}

function savePos(p) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)) } catch { /* noop */ }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function clampToViewport(x, y, w, h) {
  if (typeof window === 'undefined') return { x, y }
  return {
    x: clamp(x, EDGE_PADDING_PX, window.innerWidth - w - EDGE_PADDING_PX),
    y: clamp(y, EDGE_PADDING_PX, window.innerHeight - h - EDGE_PADDING_PX),
  }
}

/**
 * Floating brand-mark compass orb. Click → starts a Realtime conversation. Click again → ends it.
 *
 * Visual: glass sphere with the UCT compass rose (red North arm, green
 * South arm, gold E/W). State is communicated by the glow ring around the
 * orb and an optional center-hub glyph.
 *
 * - Idle: soft gold breathing halo
 * - Connecting: bearing-tick ring rotates + gold pulse
 * - Connected (idle in session): green halo, hub shows ◉
 * - User speaking: red pulse rings, hub shows pulsing ●
 * - Assistant speaking: brighter green glow, hub shows ◆
 *
 * The small graduation-cap button next to the orb opens Train Me mode —
 * a restricted session where every utterance becomes a remembered fact
 * or correction.
 */
export default function FloatingOrb({ context = 'global' }) {
  const voice = useVoice()
  const { connect, disconnect } = useRealtimeSession()
  const clusterRef = useRef(null)
  const dragRef = useRef({ active: false, captured: false, moved: false, startX: 0, startY: 0, posX: 0, posY: 0, pointerId: 0 })
  const [pos, setPos] = useState(loadPos)
  const [dragging, setDragging] = useState(false)
  const hiddenOnScroll = useHideOnScroll()
  const scrollLocked = useScrollLocked()   // a modal/sheet is open

  useEffect(() => {
    function onResize() {
      setPos(prev => {
        if (!prev) return prev
        const el = clusterRef.current
        if (!el) return prev
        const r = el.getBoundingClientRect()
        const next = clampToViewport(prev.x, prev.y, r.width, r.height)
        if (next.x === prev.x && next.y === prev.y) return prev
        savePos(next)
        return next
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (voice.mode === 'a' && voice.status === 'playing') return null

  const status = voice.status
  let stateClass = styles.idle
  let orbState = 'idle'
  let errorGlyph = null
  let label = 'Tap to start a conversation'

  if (voice.mode === 'c') {
    if (status === 'connecting') {
      stateClass = styles.thinking
      orbState = 'thinking'
      label = 'Connecting…'
    } else if (status === 'connected') {
      stateClass = styles.responding
      orbState = 'connected'
      label = 'Connected — say something'
    } else if (status === 'speaking_user') {
      stateClass = styles.listening
      orbState = 'listening'
      label = 'Listening…'
    } else if (status === 'speaking_assistant' || status === 'playing' || status === 'loading') {
      stateClass = styles.responding
      orbState = 'responding'
      label = 'Speaking — tap to stop'
    } else if (status === 'error') {
      stateClass = styles.errored
      orbState = 'idle'
      errorGlyph = 'warning'
      label = `Error: ${voice.errorMessage || 'unknown'}`
    }
  }

  const inSession = voice.mode === 'c' && status !== 'idle' && status !== 'error'
  const inTrainMode = inSession && voice.sessionContext === 'train_me'
  // Hide entirely when a modal/sheet is open (so the orb never covers its bottom
  // CTA on mobile) — unless we're mid live call.
  if (scrollLocked && !inSession) return null
  // Tuck the orb away while scrolling — but never during a live call or a drag.
  const tucked = hiddenOnScroll && !inSession && !dragging

  const consumeDragClick = () => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false
      return true
    }
    return false
  }

  const onClick = () => {
    if (consumeDragClick()) return
    inSession ? disconnect() : connect(context)
  }
  const onTrainClick = () => {
    if (consumeDragClick()) return
    if (inSession) {
      disconnect()
    } else {
      connect('train_me')
    }
  }

  const handlePointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const el = clusterRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragRef.current = {
      active: true,
      captured: false,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      posX: rect.left,
      posY: rect.top,
      pointerId: e.pointerId,
    }
    // NOTE: do NOT call setPointerCapture here. Capturing on an ancestor
    // during pointerdown re-targets the subsequent mouseup/click off the
    // button, which swallows the tap. We only capture once we're sure it's
    // a drag (after the threshold trips in handlePointerMove).
  }

  const handlePointerMove = (e) => {
    const d = dragRef.current
    if (!d.active) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    if (!d.moved) {
      setDragging(true)
      const el = clusterRef.current
      if (el) {
        try { el.setPointerCapture(e.pointerId); d.captured = true } catch { /* noop */ }
      }
    }
    d.moved = true
    const el = clusterRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos(clampToViewport(d.posX + dx, d.posY + dy, r.width, r.height))
  }

  const handlePointerUp = (e) => {
    const d = dragRef.current
    if (!d.active) return
    d.active = false
    const el = clusterRef.current
    if (d.captured) {
      try { el?.releasePointerCapture(e.pointerId) } catch { /* noop */ }
      d.captured = false
    }
    if (d.moved) {
      setDragging(false)
      if (el) {
        const r = el.getBoundingClientRect()
        savePos({ x: r.left, y: r.top })
      }
    }
  }

  const clusterStyle = pos
    ? { top: `${pos.y}px`, left: `${pos.x}px`, right: 'auto', bottom: 'auto' }
    : undefined

  return (
    <div
      ref={clusterRef}
      className={`${styles.orbCluster} ${dragging ? styles.dragging : ''} ${tucked ? styles.hidden : ''}`}
      style={clusterStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <button
        type="button"
        className={`${styles.orb} ${stateClass} ${inTrainMode ? styles.training : ''}`}
        onClick={onClick}
        aria-label={label}
        title={inTrainMode ? 'In Train Me mode — tap to exit' : label}
      >
        <CompassOrb state={orbState} />
        {errorGlyph && <span className={styles.errorBadge}><UIcon name={errorGlyph} size={12} /></span>}
      </button>
      {!inSession && (
        <button
          type="button"
          className={styles.trainBtn}
          onClick={onTrainClick}
          aria-label="Train Me — teach the assistant a preference"
          title="Train Me — teach me a preference or correction"
        >
          <UIcon name="education" size={16} />
        </button>
      )}
      {!inSession && <VisionAttachButton />}
      {!inSession && <AgentPicker />}
      {inTrainMode && (
        <div className={styles.trainBadge}>Training</div>
      )}
      {inSession && voice.sessionContext && voice.sessionContext !== 'global' && voice.sessionContext !== 'train_me' && (
        <div className={styles.agentBadge}>{voice.sessionContext.replace('_', ' ')}</div>
      )}
    </div>
  )
}
