import { useEffect, useId, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useVoice } from '../../context/VoiceContext'
import { useFirstRunSlot, useFirstRunStageHeld } from '../firstRun/firstRunStage'
import useRealtimeSession from '../../hooks/useRealtimeSession'
import AgentPicker from './AgentPicker'
import CompassOrb from './CompassOrb'
import VisionAttachButton from './VisionAttachButton'
import UIcon from '../ui/UIcon'
import useHideOnScroll from '../../hooks/useHideOnScroll'
import useScrollLocked from '../../hooks/useScrollLocked'
import styles from './FloatingOrb.module.css'

const POS_KEY = 'voice.orb.position'
const COACHMARK_KEY = 'voice.orb.coachmarkSeen'
const DRAG_THRESHOLD_PX = 5
const EDGE_PADDING_PX = 8
const IDLE_TUCK_MS = 4000

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
 * The one-time "Meet Compass" card (wave 10 follow-up F5).
 *
 * ⛔ IT LIVES IN THE PAGE FLOW, NEVER OVER THE PAGE. It used to hang off the orb in the
 * orb's fixed layer, so it sat over whatever was under it: the Notebook's Unfiled /
 * Archived / Trash rows at 390 px, the editor's evidence area at 1200 (proof walk 10E-1
 * 6b, design review D-2). It is portaled into the first-run slot Layout keeps at the top
 * of <main> (components/firstRun/firstRunStage.js), so it takes its own space and pushes
 * the page down -- it cannot cover a control at any width.
 *
 * Its arrival and its dismissal move everything below it, so it says so with a `resize`:
 * a surface that sizes itself to "the viewport below my own top" (the Notebook's panel)
 * measures on resize only, and would otherwise keep a height that no longer fits.
 */
function OrbCoachmark({ onDismiss }) {
  const titleId = useId()
  useLayoutEffect(() => {
    window.dispatchEvent(new Event('resize'))
    return () => { window.dispatchEvent(new Event('resize')) }
  }, [])
  return (
    <div className={styles.coachmark} role="note" aria-labelledby={titleId} data-orb-coachmark="">
      <div className={styles.coachmarkText}>
        <p id={titleId} className={styles.coachmarkTitle}>Meet Compass</p>
        <p className={styles.coachmarkBody}>
          Tap the compass button{' '}
          <UIcon name="compass" size={13} style={{ verticalAlign: '-2px' }} />{' '}
          to talk to your trading coach — markets, setups, and your journal, all by voice.
        </p>
      </div>
      <button type="button" className={styles.coachmarkDismiss} onClick={onDismiss}>
        Got it
      </button>
    </div>
  )
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
  // Minimized: hide every button and shrink to a small compass dot in the corner.
  // Click the dot to expand back to full size. Persisted across reloads.
  const [minimized, setMinimized] = useState(() => {
    try { return localStorage.getItem('voice.orb.minimized') === '1' } catch { return false }
  })
  const setMin = useCallback((v) => {
    setMinimized(v)
    try { localStorage.setItem('voice.orb.minimized', v ? '1' : '0') } catch { /* noop */ }
  }, [])
  // One-time discoverability coach-mark for new (paid) users — the orb is
  // otherwise a mystery. Shown once, dismissed on first tap or "Got it".
  const [showCoachmark, setShowCoachmark] = useState(() => {
    try { return !localStorage.getItem(COACHMARK_KEY) } catch { return false }
  })
  const dismissCoachmark = useCallback(() => {
    setShowCoachmark(false)
    try { localStorage.setItem(COACHMARK_KEY, '1') } catch { /* noop */ }
  }, [])
  // Wave 10 follow-up F5: the card shows only IN the page's first-run slot (never over
  // the page), and only while no first-run tour holds the stage -- the tour goes first,
  // the card after it (firstRunStage.js).
  const firstRunSlot = useFirstRunSlot()
  const firstRunStageHeld = useFirstRunStageHeld()
  const coachmarkOn = showCoachmark && Boolean(firstRunSlot) && !firstRunStageHeld
  const hiddenOnScroll = useHideOnScroll()
  const scrollLocked = useScrollLocked()   // a modal/sheet is open

  // Idle edge-tuck: viewport-locked pages (e.g. /charts) never scroll, so the
  // scroll tuck alone leaves the orb permanently over content. After IDLE_TUCK_MS
  // without the pointer/focus on the cluster, glide it into the nearest edge
  // leaving a small sliver; hover/tap/focus glides it back out.
  const [hovered, setHovered] = useState(false)
  const [idleTucked, setIdleTucked] = useState(false)
  const idleTimerRef = useRef(null)
  // A live session or drag pins the orb out; while the coachmark is up, the button it
  // tells the member to tap stays out where they can see it.
  const inSessionLive = voice.mode === 'c' && voice.status !== 'idle' && voice.status !== 'error'
  const tuckBlocked = hovered || inSessionLive || dragging || coachmarkOn
  useEffect(() => {
    if (tuckBlocked) {
      clearTimeout(idleTimerRef.current)
      setIdleTucked(false)
      return undefined
    }
    idleTimerRef.current = setTimeout(() => setIdleTucked(true), IDLE_TUCK_MS)
    return () => clearTimeout(idleTimerRef.current)
  }, [tuckBlocked])
  // Declared here (above the early returns) — assigned after `tucked` is computed.
  const tuckedRef = useRef(false)
  const tuckTapRef = useRef(false)

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

  // ⛔ THE CARD SHOWS ONLY WHILE THE BUTTON IT NAMES IS ON SCREEN (F5 fix round 1, review
  // Critical). It says "Tap the compass button", so every branch below that renders no
  // orb cluster renders no card either -- audio playback (just below) and an open sheet
  // (`scrollLocked`, further down) -- and the one place the cluster is only CSS-hidden,
  // the phone chart shell, hides the card's slot with the same attribute
  // (FloatingOrb.module.css). Hidden is not dismissed: `showCoachmark` is untouched, so
  // the card comes back with the cluster, and only "Got it" or a first tap writes the key.
  const coachmarkUp = coachmarkOn && !inSessionLive && !minimized
  const coachmarkPortal = coachmarkUp
    ? createPortal(<OrbCoachmark onDismiss={dismissCoachmark} />, firstRunSlot)
    : null

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
  // Tuck the orb away while scrolling or idle — but never during a live call,
  // a drag, or while the pointer/focus is on it (hover always wins the tuck).
  // Nor while the first-run card is up: a tucked orb is a 14 px sliver, and the card
  // tells the member to tap the compass (the idle tuck is already held by `tuckBlocked`).
  const tucked = (hiddenOnScroll || idleTucked) && !inSession && !dragging && !hovered && !coachmarkUp
  // Which edge to tuck into: nearest horizontal edge to the dragged position
  // (default bottom-right placement tucks right).
  const tuckSide = pos && typeof window !== 'undefined' && pos.x < window.innerWidth / 2 ? 'left' : 'right'
  tuckedRef.current = tucked

  const consumeDragClick = () => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false
      return true
    }
    return false
  }

  // A tap that lands while tucked only wakes the orb — it must never
  // start/stop a session. Stamped at pointerdown (before hover-untuck can
  // re-render), consumed by the click handlers.
  const consumeTuckTap = () => {
    if (tuckTapRef.current) {
      tuckTapRef.current = false
      return true
    }
    return false
  }

  const onClick = () => {
    if (consumeDragClick()) return
    if (consumeTuckTap()) return
    if (minimized) { setMin(false); return }   // expand from the minimized compass dot
    if (showCoachmark) dismissCoachmark()
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
    if (tuckedRef.current) {
      // Waking from the sliver: consume this press entirely (no drag init —
      // the rect is mid-transform; no session toggle — see consumeTuckTap).
      tuckTapRef.current = true
      setHovered(true)
      return
    }
    setHovered(true)
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

  // The cluster and the first-run card are SIBLINGS in the React tree: the card is
  // portaled into the page (not the orb's fixed layer), and a portal's events bubble
  // through its React parents -- inside the cluster, a press on the card would start an
  // orb drag and a focus on "Got it" would read as hovering the orb.
  return (
    <>
      <div
        ref={clusterRef}
        className={`${styles.orbCluster} ${dragging ? styles.dragging : ''} ${tucked ? (tuckSide === 'left' ? styles.tuckedLeft : styles.tuckedRight) : ''}`}
        style={clusterStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        <button
          type="button"
          className={`${styles.orb} ${stateClass} ${inTrainMode ? styles.training : ''} ${minimized ? styles.minimized : ''}`}
          onClick={onClick}
          aria-label={minimized ? 'Expand Compass' : label}
          title={minimized ? 'Compass minimized — tap to expand' : (inTrainMode ? 'In Train Me mode — tap to exit' : label)}
        >
          <CompassOrb state={orbState} />
          {errorGlyph && <span className={styles.errorBadge}><UIcon name={errorGlyph} size={12} /></span>}
        </button>
        {!inSession && !minimized && !tucked && (
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
        {!inSession && !minimized && !tucked && <VisionAttachButton />}
        {!inSession && !minimized && !tucked && <AgentPicker onMinimize={() => setMin(true)} />}
        {inTrainMode && (
          <div className={styles.trainBadge}>Training</div>
        )}
        {inSession && voice.sessionContext && voice.sessionContext !== 'global' && voice.sessionContext !== 'train_me' && (
          <div className={styles.agentBadge}>{voice.sessionContext.replace('_', ' ')}</div>
        )}
      </div>
      {coachmarkPortal}
    </>
  )
}
