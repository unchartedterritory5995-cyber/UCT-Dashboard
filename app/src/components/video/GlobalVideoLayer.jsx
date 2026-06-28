// The single, app-root-level video player. Mounted once (outside <Routes>),
// it owns one YT.Player and only ever REPOSITIONS its fixed host between the
// Desk theater slot (docked) and a free-draggable floating mini — the iframe
// never re-mounts, so playback never restarts across navigation.
//
// YouTube's own chrome is hidden (controls:0); we render a fully custom,
// UCT-branded control set (scrubber, time, speed, captions, mute, fullscreen)
// so the player reads as part of our ecosystem, not YouTube's.
import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { useYouTubeApi } from '../../pages/desk/useYouTubeApi'
import { recordProgress, markWatched, resumeSeconds } from '../../pages/desk/videoProgress'
import { subscribe, getSnapshot, next as storeNext, minimize, expand as storeExpand, close as storeClose, setPos } from './videoStore'
import { computeHostStyle } from './hostStyle'
import { useVideoInsights } from '../../hooks/useVideoInsights'
import { fmtTime, nextRate } from './playerUtils'
import { pauseOtherAudio } from './audioExclusivity'
import { pipSupported, openPip } from './documentPip'
import Scrubber from './Scrubber'
import brandMark from '../intro/assets/compass-mark.png'
import { PlayIcon } from '../../pages/education/icons'
import {
  PauseIcon, CloseIcon, MinimizeIcon, ExpandIcon, NextIcon, DragIcon,
  SkipBackIcon, SkipFwdIcon, FullscreenIcon, VolumeIcon, MuteIcon, CcIcon, PopOutIcon,
} from './icons'
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
  const { list, index, mode, pos, dockRect } = snap
  const active = mode !== 'closed' && list.length > 0
  const docked = mode === 'docked'
  const current = active ? list[index] : null
  const upNext = active && index + 1 < list.length ? list[index + 1] : null
  const { chapters } = useVideoInsights(current?.id)

  const navigate = useNavigate()
  const hostElRef = useRef(null)
  const hostRef = useRef(null)
  const playerRef = useRef(null)
  const tickerRef = useRef(null)
  const curIdRef = useRef(null)
  const pipRef = useRef(null)
  const kbRef = useRef({})
  const [ended, setEnded] = useState(false)
  const [countdown, setCountdown] = useState(NEXT_COUNTDOWN)
  const [isPlaying, setIsPlaying] = useState(true)
  const [prog, setProg] = useState({ t: 0, d: 0 })
  const [rate, setRate] = useState(1)
  const [muted, setMuted] = useState(false)
  const [cc, setCc] = useState(false)
  const [isFs, setIsFs] = useState(false)
  const [dragPos, setDragPos] = useState(null)
  const [pipOn, setPipOn] = useState(false)
  const canPip = pipSupported()

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
        controls: 0, // we render our own branded controls
        fs: 0, // our own fullscreen button
        iv_load_policy: 3, // no annotations
        cc_load_policy: 0,
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
    try { pipRef.current?.pip?.close?.() } catch { /* ignore */ }
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
    try { pipRef.current?.pip?.close?.() } catch { /* ignore */ }
    const p = playerRef.current
    if (!p) return
    saveNow()
    try { clearInterval(tickerRef.current) } catch { /* ignore */ }
    try { p.destroy() } catch { /* ignore */ }
  }, [saveNow])

  // Poll playhead for the scrubber + time readout while a video is active.
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      const p = playerRef.current
      if (!p || !p.getCurrentTime) return
      try {
        const t = p.getCurrentTime() || 0
        const d = (p.getDuration && p.getDuration()) || 0
        setProg((prev) => (prev.t === t && prev.d === d ? prev : { t, d }))
      } catch { /* ignore */ }
    }, 300)
    return () => clearInterval(id)
  }, [active])

  // Honor seek requests from chapter rows / ticker-moment chips (videoStore.seekTo).
  useEffect(() => {
    const req = snap.seekReq
    if (!req || !active) return
    const p = playerRef.current
    if (!p || !p.seekTo) return
    try {
      p.seekTo(req.sec, true)
      p.playVideo && p.playVideo()
      saveNow()
    } catch { /* ignore */ }
  }, [snap.seekReq, active, saveNow])

  // Track real fullscreen state (Esc, F11, etc).
  useEffect(() => {
    const onFs = () => setIsFs(document.fullscreenElement === hostElRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

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

  // Keyboard shortcuts while a video is active (ignored while typing in a field).
  // Handlers are read from kbRef (refreshed each render) to avoid stale closures.
  useEffect(() => {
    if (!active) return
    const onKey = (e) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const k = kbRef.current
      switch (e.key) {
        case ' ':
        case 'k': e.preventDefault(); k.togglePlay?.(); break
        case 'ArrowLeft': e.preventDefault(); k.seekBy?.(-15); break
        case 'ArrowRight': e.preventDefault(); k.seekBy?.(15); break
        case 'f': case 'F': k.toggleFs?.(); break
        case 'm': case 'M': k.toggleMute?.(); break
        case 'Escape': k.escape?.(); break
        default: break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const onExpand = useCallback(() => {
    navigate('/desk?section=videos')
    storeExpand()
  }, [navigate])

  // Free-drag the mini anywhere on screen; persists where you drop it.
  const startDrag = useCallback((e) => {
    if (mode !== 'mini' || !hostElRef.current) return
    if (e.target.closest('button')) return // let control buttons click through
    const r = hostElRef.current.getBoundingClientRect()
    const off = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    const move = (ev) => setDragPos({ x: ev.clientX - off.dx, y: ev.clientY - off.dy })
    const up = (ev) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setPos(ev.clientX - off.dx, ev.clientY - off.dy)
      setDragPos(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [mode])

  if (!active) return null

  const base = computeHostStyle(mode, dockRect, vw, vh, pos)
  const hostStyle = mode === 'mini' && dragPos ? { ...base, top: dragPos.y, left: dragPos.x } : base

  const player = () => playerRef.current
  const togglePlay = () => {
    const p = player(); if (!p) return
    try { (isPlaying ? p.pauseVideo : p.playVideo).call(p) } catch { /* ignore */ }
  }
  const seekBy = (delta) => {
    const p = player()
    if (!p || !p.getCurrentTime || !p.seekTo) return
    try {
      const d = p.getDuration ? p.getDuration() : 0
      let target = (p.getCurrentTime() || 0) + delta
      if (target < 0) target = 0
      if (d > 0 && target > d) target = d
      p.seekTo(target, true)
      saveNow()
    } catch { /* ignore */ }
  }
  const seekFrac = (frac) => {
    const p = player()
    if (!p || !p.seekTo) return
    const d = (p.getDuration && p.getDuration()) || prog.d
    if (d > 0) { try { p.seekTo(frac * d, true) } catch { /* ignore */ } }
  }
  const cycleRate = () => {
    const r = nextRate(rate)
    setRate(r)
    try { player()?.setPlaybackRate?.(r) } catch { /* ignore */ }
  }
  const toggleMute = () => {
    const p = player(); if (!p) return
    try { (muted ? p.unMute : p.mute).call(p) } catch { /* ignore */ }
    setMuted(!muted)
  }
  // Captions via the IFrame API. The module is named 'captions' on some videos
  // and 'cc' on others, so we drive both and pick the first available track —
  // the closest we can get to "captions always work" from a custom control set.
  const toggleCc = () => {
    const p = player()
    const want = !cc
    try {
      if (want) {
        p?.loadModule?.('captions')
        p?.loadModule?.('cc')
        let tracks = []
        try { tracks = p?.getOption?.('captions', 'tracklist') || p?.getOption?.('cc', 'tracklist') || [] } catch { /* ignore */ }
        const lang = (tracks[0] && tracks[0].languageCode) || 'en'
        p?.setOption?.('captions', 'track', { languageCode: lang })
        p?.setOption?.('cc', 'track', { languageCode: lang })
      } else {
        p?.setOption?.('captions', 'track', {})
        p?.setOption?.('cc', 'track', {})
        p?.unloadModule?.('captions')
        p?.unloadModule?.('cc')
      }
    } catch { /* ignore */ }
    setCc(want)
  }
  const toggleFs = () => {
    const el = hostElRef.current; if (!el) return
    try {
      if (document.fullscreenElement === el) document.exitFullscreen?.()
      else el.requestFullscreen?.()
    } catch { /* ignore */ }
  }
  // Pop the video into a separate OS window (draggable to another monitor).
  // The in-page player pauses while popped out; we resume it where PiP left off.
  const popOut = async () => {
    const p = player()
    let t = 0
    try { t = (p && p.getCurrentTime && p.getCurrentTime()) || 0 } catch { /* ignore */ }
    try { p && p.pauseVideo && p.pauseVideo() } catch { /* ignore */ }
    const obj = await openPip({ videoId: current.youtube_id, startSeconds: t })
    if (!obj) { try { p && p.playVideo && p.playVideo() } catch { /* ignore */ } return }
    pipRef.current = obj
    setPipOn(true)
    obj.pip.addEventListener('pagehide', () => {
      let pt = t
      try { pt = obj.player.getCurrentTime() || t } catch { /* ignore */ }
      try { obj.player.destroy() } catch { /* ignore */ }
      pipRef.current = null
      setPipOn(false)
      const mp = player()
      try { mp && mp.seekTo && mp.seekTo(pt, true); mp && mp.playVideo && mp.playVideo() } catch { /* ignore */ }
    }, { once: true })
  }
  const bringBack = () => { try { pipRef.current?.pip?.close?.() } catch { /* ignore */ } }

  // Keep the keyboard handlers fresh for the keydown listener.
  kbRef.current = {
    togglePlay,
    seekBy,
    toggleFs,
    toggleMute,
    escape: () => (mode === 'docked' ? minimize() : storeClose()),
  }

  const cls = [styles.host, mode === 'mini' ? styles.mini : styles.docked, dragPos ? styles.dragging : '']
    .filter(Boolean).join(' ')

  return (
    <div ref={hostElRef} className={cls} style={hostStyle} data-mode={mode}>
      <div ref={hostRef} className={styles.frame} />
      {!apiReady && <div className={styles.loading}>Loading…</div>}

      {pipOn && (
        <div className={styles.pipOverlay}>
          <img className={styles.pipBrand} src={brandMark} alt="" />
          <div className={styles.pipLabel}>Playing in a pop-out window</div>
          <button className={styles.nextPlayBtn} onClick={bringBack}>Bring back here</button>
        </div>
      )}

      {/* UCT broadcast watermark — every frame reads as a UCT production and it
          masks the corner where a residual YouTube logo could appear. */}
      {docked && !ended && (
        <div className={styles.watermark} data-testid="brand-watermark" aria-hidden="true">
          <img className={styles.wmMark} src={brandMark} alt="" />
          <span className={styles.wmText}>UCT</span>
        </div>
      )}

      {/* Top bar — UCT brand + title. Doubles as the drag handle in mini. */}
      <div
        className={styles.topbar}
        onPointerDown={mode === 'mini' ? startDrag : undefined}
        style={mode === 'mini' ? { cursor: 'grab' } : undefined}
      >
        <img className={styles.brand} src={brandMark} alt="UCT" />
        <span className={styles.brandWord}>UCT</span>
        <span className={styles.topTitle}>{current.title}</span>
        {mode === 'mini' && <span className={styles.grip} aria-hidden="true"><DragIcon size={16} /></span>}
      </div>

      {/* Bottom control bar — our own scrubber + transport. */}
      <div className={styles.controls}>
        <Scrubber current={prog.t} duration={prog.d} onSeek={seekFrac} chapters={chapters} />
        <div className={styles.btnrow}>
          <button className={styles.cbtn} onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <PauseIcon /> : <PlayIcon size={18} />}
          </button>
          <button className={styles.cbtn} onClick={() => seekBy(-15)} aria-label="Back 15 seconds">
            <SkipBackIcon />
          </button>
          <button className={styles.cbtn} onClick={() => seekBy(15)} aria-label="Forward 15 seconds">
            <SkipFwdIcon />
          </button>
          {docked && (
            <span className={styles.time}>{fmtTime(prog.t)} / {fmtTime(prog.d)}</span>
          )}
          <span className={styles.spacer} />
          {docked && upNext && (
            <button className={styles.cbtn} onClick={() => storeNext()} aria-label="Next video">
              <NextIcon />
            </button>
          )}
          <button className={styles.speedBtn} onClick={cycleRate} aria-label="Playback speed">
            {rate}×
          </button>
          {docked && (
            <button
              className={`${styles.cbtn} ${cc ? styles.cbtnOn : ''}`}
              onClick={toggleCc}
              aria-label={cc ? 'Turn captions off' : 'Turn captions on'}
              aria-pressed={cc}
            >
              <CcIcon />
            </button>
          )}
          {docked && (
            <button className={styles.cbtn} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
              {muted ? <MuteIcon /> : <VolumeIcon />}
            </button>
          )}
          {docked && canPip && !pipOn && (
            <button className={styles.cbtn} onClick={popOut} aria-label="Pop out to a window">
              <PopOutIcon />
            </button>
          )}
          {docked && (
            <button className={styles.cbtn} onClick={toggleFs} aria-label={isFs ? 'Exit fullscreen' : 'Fullscreen'}>
              <FullscreenIcon />
            </button>
          )}
          {docked && (
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
