// The single, app-root-level video player. Mounted once (outside <Routes>),
// it owns one YT.Player and only ever REPOSITIONS its fixed host between the
// Desk theater slot (docked) and a floating corner (mini) — the iframe never
// re-mounts, so playback never restarts across navigation.
import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { useYouTubeApi } from '../../pages/desk/useYouTubeApi'
import { recordProgress, markWatched, resumeSeconds } from '../../pages/desk/videoProgress'
import { subscribe, getSnapshot, next as storeNext, minimize, expand as storeExpand, close as storeClose, setCorner } from './videoStore'
import { computeHostStyle, nearestCorner } from './hostStyle'
import { pauseOtherAudio } from './audioExclusivity'
import { PlayIcon } from '../../pages/education/icons'
import { PauseIcon, CloseIcon, MinimizeIcon, ExpandIcon, NextIcon, DragIcon } from './icons'
import styles from './GlobalVideoLayer.module.css'

const NEXT_COUNTDOWN = 6

function useViewport() {
  const [vp, setVp] = useState(() => ({
    vw: typeof window !== 'undefined' ? window.innerWidth : 1280,
    vh: typeof window !== 'undefined' ? window.innerHeight : 800,
  }))
  useEffect(() => {
    const onResize = () => setVp({ vw: window.innerWidth, vh: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return vp
}

export default function GlobalVideoLayer() {
  const apiReady = useYouTubeApi()
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const { vw, vh } = useViewport()
  const { list, index, mode, corner, dockRect } = snap
  const active = mode !== 'closed' && list.length > 0
  const current = active ? list[index] : null
  const upNext = active && index + 1 < list.length ? list[index + 1] : null

  const navigate = useNavigate()
  const hostRef = useRef(null)
  const playerRef = useRef(null)
  const tickerRef = useRef(null)
  const curIdRef = useRef(null)
  const dragRef = useRef(null)
  const [ended, setEnded] = useState(false)
  const [countdown, setCountdown] = useState(NEXT_COUNTDOWN)
  const [isPlaying, setIsPlaying] = useState(true)

  const saveNow = useCallback(() => {
    const p = playerRef.current
    if (!p || !p.getCurrentTime || !p.getDuration) return
    try {
      const t = p.getCurrentTime()
      const d = p.getDuration()
      if (d > 0) recordProgress(curIdRef.current, t, d)
    } catch { /* ignore */ }
  }, [])

  // Build the player once, when a video first becomes active.
  useEffect(() => {
    if (!apiReady || !active || playerRef.current || !hostRef.current) return
    const startId = list[index].youtube_id
    curIdRef.current = startId
    const mount = document.createElement('div')
    hostRef.current.appendChild(mount)
    const player = new window.YT.Player(mount, {
      videoId: startId,
      playerVars: {
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        autoplay: 1,
        start: resumeSeconds(startId) || undefined,
      },
      events: {
        onStateChange: (e) => {
          if (e.data === 0) {
            markWatched(curIdRef.current)
            setEnded(true)
            setIsPlaying(false)
          } else if (e.data === 1) {
            pauseOtherAudio()
            saveNow()
            setIsPlaying(true)
            setEnded(false)
          } else if (e.data === 2) {
            setIsPlaying(false)
          }
        },
      },
    })
    playerRef.current = player
    tickerRef.current = setInterval(saveNow, 5000)
  }, [apiReady, active, list, index, saveNow])

  // Switch the video in-place when the index/list changes after build.
  useEffect(() => {
    const p = playerRef.current
    if (!p || !active || !p.loadVideoById) return
    const id = list[index].youtube_id
    if (id === curIdRef.current) return
    saveNow()
    setEnded(false)
    curIdRef.current = id
    p.loadVideoById({ videoId: id, startSeconds: resumeSeconds(id) })
  }, [list, index, active, saveNow])

  // Tear down when the session closes.
  useEffect(() => {
    if (active) return
    const p = playerRef.current
    if (!p) return
    saveNow()
    try { clearInterval(tickerRef.current) } catch { /* ignore */ }
    try { p.destroy() } catch { /* ignore */ }
    playerRef.current = null
    curIdRef.current = null
  }, [active, saveNow])

  // Flush + destroy on unmount (full app teardown only — never during routing).
  useEffect(() => () => {
    const p = playerRef.current
    if (!p) return
    saveNow()
    try { clearInterval(tickerRef.current) } catch { /* ignore */ }
    try { p.destroy() } catch { /* ignore */ }
  }, [saveNow])

  // Auto-advance countdown when a video ends and another follows.
  useEffect(() => {
    if (!ended || !upNext) return
    setCountdown(NEXT_COUNTDOWN)
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(id); storeNext(); return 0 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [ended, upNext])

  const onExpand = useCallback(() => {
    navigate('/desk?section=videos')
    storeExpand()
  }, [navigate])

  const onDragStart = useCallback((e) => {
    if (mode !== 'mini') return
    e.preventDefault()
    const move = (ev) => {
      const p = ev.touches ? ev.touches[0] : ev
      dragRef.current = { x: p.clientX, y: p.clientY }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = dragRef.current
      if (d) setCorner(nearestCorner(d.x, d.y, window.innerWidth, window.innerHeight))
      dragRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [mode])

  if (!active) return null

  const hostStyle = computeHostStyle(mode, corner, dockRect, vw, vh)
  const togglePlay = () => {
    const p = playerRef.current
    if (!p) return
    try { (isPlaying ? p.pauseVideo : p.playVideo).call(p) } catch { /* ignore */ }
  }

  return (
    <div
      className={`${styles.host} ${mode === 'mini' ? styles.mini : styles.docked}`}
      style={hostStyle}
      data-mode={mode}
    >
      {mode === 'mini' && (
        <div className={styles.dragHandle} onPointerDown={onDragStart} aria-label="Move player">
          <DragIcon />
        </div>
      )}
      <div ref={hostRef} className={styles.frame} />
      {!apiReady && <div className={styles.loading}>Loading…</div>}

      <div className={styles.controls}>
        <span className={styles.ctitle}>{current.title}</span>
        <button className={styles.cbtn} onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <PauseIcon /> : <PlayIcon size={18} />}
        </button>
        {upNext && (
          <button className={styles.cbtn} onClick={() => storeNext()} aria-label="Next video">
            <NextIcon />
          </button>
        )}
        {mode === 'docked' && (
          <button className={styles.cbtn} onClick={() => minimize()} aria-label="Minimize">
            <MinimizeIcon />
          </button>
        )}
        {mode === 'mini' && (
          <button className={styles.cbtn} onClick={onExpand} aria-label="Expand to Desk">
            <ExpandIcon />
          </button>
        )}
        <button className={styles.cbtn} onClick={() => storeClose()} aria-label="Close player">
          <CloseIcon />
        </button>
      </div>

      {ended && upNext && (
        <div className={styles.nextCard} role="dialog" aria-label="Next up">
          <div className={styles.nextLabel}>Next up</div>
          <div className={styles.nextTitle}>{upNext.title}</div>
          <button className={styles.nextPlayBtn} onClick={() => storeNext()}>Play now</button>
          <button className={styles.nextCancelBtn} onClick={() => setEnded(false)}>Cancel ({countdown})</button>
        </div>
      )}
      {ended && !upNext && (
        <div className={styles.nextCard}>
          <div className={styles.nextLabel}>End of this section</div>
          <button className={styles.nextPlayBtn} onClick={() => storeClose()}>Close</button>
        </div>
      )}
    </div>
  )
}
