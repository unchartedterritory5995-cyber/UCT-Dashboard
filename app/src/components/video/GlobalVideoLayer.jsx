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
import { subscribe, getSnapshot, next as storeNext, minimize, expand as storeExpand, close as storeClose, setPos, registerTimeGetter, getDockEl } from './videoStore'
import { computeHostStyle, dockPinTransform } from './hostStyle'
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
  // Mobile "audio-primary" playback: on a coarse-pointer device with the flag
  // on, we stream the video's separate audio track through a hidden <audio>
  // element (so it survives screen-lock/background like a podcast) and mute
  // the muted YT iframe underneath. Read inside the component (not true
  // module scope) so tests can flip import.meta.env before rendering — see
  // the identical VITE_GRID_WARM_ENABLED pattern in MultiChartGrid.jsx.
  const bgAudioEnabled = import.meta.env.VITE_DESK_BG_AUDIO_ENABLED === '1'
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
  const audioRef = useRef(null)
  // True only after the audio element's own play() has resolved — the single
  // source of truth for "is the <audio> element actually the clock right now"
  // (vs. merely present-but-not-yet-engaged, or fallen back to the YT iframe
  // after a 404). Set false again on audio error / session close / unmount.
  const audioActiveRef = useRef(false)
  const [ended, setEnded] = useState(false)
  const [countdown, setCountdown] = useState(NEXT_COUNTDOWN)
  const [isPlaying, setIsPlaying] = useState(true)
  const [prog, setProg] = useState({ t: 0, d: 0 })
  const [rate, setRate] = useState(1)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(100)   // 0-100, YouTube scale
  const [cc, setCc] = useState(false)
  const [isFs, setIsFs] = useState(false)
  // iPhone fallback: WebKit has no element-fullscreen API on iPhone, so we
  // "fake" it — pin the host over the whole viewport and let the OS rotation
  // fill landscape, like YouTube's mobile web player does there.
  const [fsFake, setFsFake] = useState(false)
  const [dragPos, setDragPos] = useState(null)
  const [pipOn, setPipOn] = useState(false)
  // True for a beat after any dock<->mini change so the morph still eases
  // top/left (the base .host transition drops them so docked scroll snaps).
  const [morphing, setMorphing] = useState(false)
  const canPip = pipSupported()
  // Refs the per-frame pin loop reads without re-subscribing every render.
  const dockRectRef = useRef(dockRect)
  dockRectRef.current = dockRect
  const fsFakeRef = useRef(fsFake)
  fsFakeRef.current = fsFake

  // True when this device should get the audio-primary treatment: flag on +
  // coarse pointer (phones/tablets). Desktop always plays through the YT
  // iframe as before, flag off is always a no-op.
  const isAudioPrimary = () =>
    bgAudioEnabled && !!window.matchMedia?.('(pointer: coarse)')?.matches

  // The <audio> element is the playback clock only once ITS OWN play() has
  // actually resolved (audioActiveRef) — not merely because isAudioPrimary()
  // is true (that's just "this device wants the audio-primary path"). A 404
  // on the audio track falls back to the muted YT iframe unmuting itself
  // instead, and every control site below must follow that fallback too.
  const audioOn = () => audioActiveRef.current && audioRef.current

  const saveNow = useCallback(() => {
    const p = playerRef.current
    if (!p || !p.getCurrentTime || !p.getDuration) return
    try {
      const t = p.getCurrentTime()
      const d = p.getDuration()
      if (d > 0) recordProgress(curIdRef.current, t, d)
    } catch { /* ignore */ }
  }, [])

  // Shared "video finished" handling — driven by YT onStateChange (state 0)
  // normally, and by the <audio> element's own `ended` event on the
  // audio-primary path (the audio clock decides when playback is over there).
  const handleEnded = useCallback(() => {
    markWatched(curIdRef.current)
    setEnded(true)
    setIsPlaying(false)
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
        // Audio-primary mobile path: born muted so the iframe can never
        // autoplay audibly before onReady fires — the separate <audio>
        // element is the sole audio source. Untouched (no key) otherwise.
        ...(isAudioPrimary() ? { mute: 1 } : {}),
      },
      events: {
        onReady: (e) => {
          try {
            const v = e.target.getVolume?.()
            if (typeof v === 'number') setVolume(v)
            setMuted(!!e.target.isMuted?.())
          } catch { /* ignore */ }
          // Authoritative mute/play: the player is command-ready here. This is
          // the SOLE mute()/playVideo() call site on the audio-primary path —
          // calling it synchronously right after construction (before the
          // player is command-ready) can no-op on a real mobile browser and
          // let the iframe autoplay audibly in parallel with the <audio>
          // track — the double-audio bug this whole path exists to avoid.
          if (isAudioPrimary()) {
            try { e.target.mute(); e.target.playVideo() } catch { /* ignore */ }
          }
        },
        onStateChange: (e) => {
          if (e.data === 0) {
            handleEnded()
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
    if (isAudioPrimary() && audioRef.current) {
      audioRef.current.src = `/api/education/videos/${list[index].id}/audio`
      audioRef.current.play().then(() => { audioActiveRef.current = true }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (isAudioPrimary() && audioRef.current) {
      // Disarm audioOn() for the OLD track immediately — otherwise controls
      // (togglePlay/seek/etc) can act on the audio element mid-load, before
      // the new track's own play() has resolved and re-armed it below.
      audioActiveRef.current = false
      audioRef.current.src = `/api/education/videos/${list[index].id}/audio`
      audioRef.current.play().then(() => { audioActiveRef.current = true }).catch(() => {})
    }
    p.loadVideoById({ videoId: id, startSeconds: resumeSeconds(id) })
    if (isAudioPrimary()) {
      try { p.mute() } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, index, active, saveNow])

  // Tear down when the session closes.
  useEffect(() => {
    if (active) return
    audioActiveRef.current = false
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
    audioActiveRef.current = false
    try { pipRef.current?.pip?.close?.() } catch { /* ignore */ }
    const p = playerRef.current
    if (!p) return
    saveNow()
    try { clearInterval(tickerRef.current) } catch { /* ignore */ }
    try { p.destroy() } catch { /* ignore */ }
  }, [saveNow])

  // Poll playhead for the scrubber + time readout while a video is active.
  // On the audio-primary path this also threshold-gates a periodic drift
  // correction (Task 11): the muted iframe is a passenger, not the clock, and
  // can wander from the <audio> element over time (rate limiting, tab
  // throttling) even while foregrounded — a >0.4s gap gets one authoritative
  // seekTo() back to the audio clock. Never corrects while the tab is hidden
  // (a backgrounded iframe can't seek reliably and there's no point anyway).
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      if (audioOn()) {
        try {
          const t = audioRef.current.currentTime || 0
          const d = audioRef.current.duration || 0
          setProg((prev) => (prev.t === t && prev.d === d ? prev : { t, d }))
        } catch { /* ignore */ }
        if (document.visibilityState === 'visible') {
          try {
            const p = playerRef.current
            if (p && p.getCurrentTime && Math.abs(p.getCurrentTime() - audioRef.current.currentTime) > 0.4) {
              p.seekTo(audioRef.current.currentTime, true)
            }
          } catch { /* ignore */ }
        }
        return
      }
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

  // Task 11: foreground resync — when the audio-primary path is engaged and
  // the app returns to the foreground (screen unlock, tab refocus after the
  // browser throttled/paused the backgrounded iframe), the muted YT player
  // can be arbitrarily far from the <audio> clock. One authoritative seekTo()
  // re-anchors it on every visible transition, and resumes play if the audio
  // clock is still playing (the iframe may have been paused by the browser
  // while backgrounded).
  useEffect(() => {
    if (!bgAudioEnabled) return
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      const p = playerRef.current
      const a = audioRef.current
      if (!p || !a || !audioActiveRef.current) return
      try {
        p.seekTo(a.currentTime, true)
        if (!a.paused) p.playVideo?.()
      } catch { /* ignore */ }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [bgAudioEnabled])

  // Expose the live playhead so other surfaces (e.g. "add note at current time")
  // can read it on demand without re-rendering on every tick.
  useEffect(() => {
    registerTimeGetter(() => {
      if (audioOn()) return audioRef.current.currentTime || 0
      const p = playerRef.current
      return p && p.getCurrentTime ? p.getCurrentTime() : 0
    })
    return () => registerTimeGetter(null)
  }, [])

  // Honor seek requests from chapter rows / ticker-moment chips (videoStore.seekTo).
  useEffect(() => {
    const req = snap.seekReq
    if (!req || !active) return
    const p = playerRef.current
    if (!p || !p.seekTo) return
    try {
      if (audioOn()) {
        audioRef.current.currentTime = req.sec
        audioRef.current.play().catch(() => {})
      }
      p.seekTo(req.sec, true)
      p.playVideo && p.playVideo()
      saveNow()
    } catch { /* ignore */ }
  }, [snap.seekReq, active, saveNow])

  // Track real fullscreen state (Esc, F11, etc). Safari fires the webkit-
  // prefixed event/element. On phones/tablets, entering fullscreen also locks
  // to landscape (like YouTube) — 'landscape' still allows the 180° flip —
  // and exiting releases the lock. Desktop lock attempts reject; ignored.
  useEffect(() => {
    const onFs = () => {
      const fsEl = document.fullscreenElement ?? document.webkitFullscreenElement
      const on = fsEl === hostElRef.current
      setIsFs(on)
      try {
        if (on && window.matchMedia?.('(pointer: coarse)')?.matches) {
          window.screen?.orientation?.lock?.('landscape')?.catch?.(() => {})
        } else if (!fsEl) {
          window.screen?.orientation?.unlock?.()
        }
      } catch { /* ignore */ }
    }
    document.addEventListener('fullscreenchange', onFs)
    document.addEventListener('webkitfullscreenchange', onFs)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      document.removeEventListener('webkitfullscreenchange', onFs)
    }
  }, [])

  // While fake-fullscreen: lock the page behind so it can't scroll/rubber-band.
  useEffect(() => {
    if (!fsFake) return
    const el = document.documentElement
    const prev = el.style.overflow
    el.style.overflow = 'hidden'
    return () => { el.style.overflow = prev }
  }, [fsFake])

  // Leave fake-fullscreen whenever the player leaves the docked theater.
  useEffect(() => {
    if (mode !== 'docked') setFsFake(false)
  }, [mode])

  // Ease top/left only across a dock<->mini change, not during scroll. The base
  // .host transition drops top/left (so docked scroll-follow snaps); this flags
  // a short window where the .morphing class re-adds them for the shrink/grow.
  useEffect(() => {
    setMorphing(true)
    const id = setTimeout(() => setMorphing(false), 380)
    return () => clearTimeout(id)
  }, [mode])

  // While docked, pin the fixed player to the theater slot's LIVE rect every
  // frame via a GPU transform offset — so it tracks native scroll 1:1 instead of
  // trailing a store->React->reflow round-trip. transform is written only here
  // (React drives top/left/width/height), so the two never fight.
  useEffect(() => {
    if (!docked) return
    let raf = 0
    const tick = () => {
      const el = getDockEl()
      const base = dockRectRef.current
      const h = hostElRef.current
      if (h && el && base && !fsFakeRef.current) {
        h.style.transform = dockPinTransform(el.getBoundingClientRect(), base)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      const h = hostElRef.current
      if (h) h.style.transform = ''
    }
  }, [docked])

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

  // Fake-fullscreen pins the host to the live viewport (vw/vh track resize +
  // rotation, so flipping the phone sideways fills the landscape screen).
  const base = fsFake
    ? { top: 0, left: 0, width: vw, height: vh }
    : computeHostStyle(mode, dockRect, vw, vh, pos)
  const hostStyle = mode === 'mini' && dragPos ? { ...base, top: dragPos.y, left: dragPos.x } : base

  const player = () => playerRef.current
  const togglePlay = () => {
    if (audioOn()) {
      // The audio element is the clock here — drive it directly and update
      // isPlaying ourselves. The YT iframe stays muted throughout, but it is
      // still VISIBLE underneath (only the <audio> element is display:none),
      // so its play/pause state must mirror the audio element's or the muted
      // video keeps animating while audio is paused.
      try {
        if (isPlaying) audioRef.current.pause()
        else audioRef.current.play().catch(() => {})
      } catch { /* ignore */ }
      const p = player()
      try {
        if (p) (isPlaying ? p.pauseVideo : p.playVideo)?.call(p)
      } catch { /* ignore */ }
      setIsPlaying(!isPlaying)
      return
    }
    const p = player(); if (!p) return
    try { (isPlaying ? p.pauseVideo : p.playVideo).call(p) } catch { /* ignore */ }
  }
  const seekBy = (delta) => {
    const p = player()
    if (!p || !p.getCurrentTime || !p.seekTo) return
    try {
      if (audioOn()) {
        const ae = audioRef.current
        const ad = ae.duration || 0
        let atarget = (ae.currentTime || 0) + delta
        if (atarget < 0) atarget = 0
        if (ad > 0 && atarget > ad) atarget = ad
        ae.currentTime = atarget
        p.seekTo(atarget, true)
        saveNow()
        return
      }
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
    if (audioOn()) {
      const ae = audioRef.current
      const t = frac * (ae.duration || 0)
      try {
        ae.currentTime = t
        p.seekTo(t, true)
      } catch { /* ignore */ }
      return
    }
    const d = (p.getDuration && p.getDuration()) || prog.d
    if (d > 0) { try { p.seekTo(frac * d, true) } catch { /* ignore */ } }
  }
  const cycleRate = () => {
    const r = nextRate(rate)
    setRate(r)
    if (audioOn()) {
      try { audioRef.current.playbackRate = r } catch { /* ignore */ }
    }
    try { player()?.setPlaybackRate?.(r) } catch { /* ignore */ }
  }
  const toggleMute = () => {
    if (audioOn()) {
      // Never unmute the YT player on this path — the <audio> element is the
      // sole audio source; it stays muted permanently underneath.
      try { audioRef.current.muted = !muted } catch { /* ignore */ }
      setMuted(!muted)
      return
    }
    const p = player(); if (!p) return
    try { (muted ? p.unMute : p.mute).call(p) } catch { /* ignore */ }
    setMuted(!muted)
  }
  // Set the player volume (0-100). Crossing 0 toggles mute so the icon + state
  // stay coherent. Used by the slider AND the scroll-wheel handler.
  const applyVolume = (v) => {
    const nv = Math.round(Math.max(0, Math.min(100, v)))
    if (audioOn()) {
      try {
        audioRef.current.volume = nv / 100
        audioRef.current.muted = nv === 0
      } catch { /* ignore */ }
      setMuted(nv === 0)
      setVolume(nv)
      return
    }
    const p = player()
    try {
      p?.setVolume?.(nv)
      if (nv === 0) { p?.mute?.(); setMuted(true) }
      else { p?.unMute?.(); setMuted(false) }
    } catch { /* ignore */ }
    setVolume(nv)
  }
  // Scroll up/down over the volume control to change volume (like YouTube).
  const onVolWheel = (e) => {
    e.preventDefault()
    applyVolume((muted ? 0 : volume) + (e.deltaY < 0 ? 5 : -5))
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
    const fsEl = document.fullscreenElement ?? document.webkitFullscreenElement
    if (fsEl === el) {
      try { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document) } catch { /* ignore */ }
      return
    }
    if (fsFake) { setFsFake(false); return }
    const req = el.requestFullscreen || el.webkitRequestFullscreen
    if (req) {
      try {
        const r = req.call(el)
        // Chrome/Firefox return a promise that rejects when fullscreen is
        // denied — fall back to the fake mode so the button always works.
        r?.catch?.(() => setFsFake(true))
      } catch { setFsFake(true) }
    } else {
      setFsFake(true) // iPhone: no element-fullscreen API at all
    }
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
    escape: () => {
      if (fsFake) { setFsFake(false); return }
      if (mode === 'docked') minimize()
      else storeClose()
    },
  }

  const cls = [
    styles.host,
    mode === 'mini' ? styles.mini : styles.docked,
    dragPos ? styles.dragging : '',
    fsFake ? styles.fsFake : '',
    morphing ? styles.morphing : '',
  ].filter(Boolean).join(' ')

  return (
    <div ref={hostElRef} className={cls} style={hostStyle} data-mode={mode}>
      <div ref={hostRef} className={styles.frame} />
      {/* Mobile audio-primary track. Inert unless isAudioPrimary() is driving
          it (flag off / desktop pointer => never gets a src). A 404 (no
          separate audio track for this video) falls back to unmuting the
          YT iframe so playback still has sound. */}
      <audio
        ref={audioRef}
        data-uct-video-audio="1"
        preload="metadata"
        style={{ display: 'none' }}
        onEnded={handleEnded}
        onError={() => {
          audioActiveRef.current = false
          try { playerRef.current?.unMute?.() } catch { /* ignore */ }
        }}
      />
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
        className={`${styles.topbar} ${docked ? styles.topbarCenter : ''}`}
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
            <div className={styles.volWrap} onWheel={onVolWheel}>
              <button className={styles.cbtn} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                {muted || volume === 0 ? <MuteIcon /> : <VolumeIcon />}
              </button>
              <div className={styles.volPop}>
                <input
                  className={styles.volSlider}
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={muted ? 0 : volume}
                  onChange={(e) => applyVolume(Number(e.target.value))}
                  aria-label="Volume"
                  title="Scroll or drag to change volume"
                />
              </div>
            </div>
          )}
          {docked && canPip && !pipOn && (
            <button className={styles.cbtn} onClick={popOut} aria-label="Pop out to a window">
              <PopOutIcon />
            </button>
          )}
          {docked && (
            <button className={styles.cbtn} onClick={toggleFs} aria-label={isFs || fsFake ? 'Exit fullscreen' : 'Fullscreen'}>
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
          <img className={styles.endMark} src={brandMark} alt="" aria-hidden="true" />
          <div className={styles.endBrand}>UCT INTELLIGENCE</div>
          <div className={styles.nextLabel}>Next up</div>
          <div className={styles.nextTitle}>{upNext.title}</div>
          <button className={styles.nextPlayBtn} onClick={() => storeNext()}>Play now</button>
          <button className={styles.nextCancelBtn} onClick={() => setEnded(false)}>Cancel ({countdown})</button>
        </div>
      )}
      {ended && !upNext && (
        <div className={styles.nextCard}>
          <img className={styles.endMark} src={brandMark} alt="" aria-hidden="true" />
          <div className={styles.endBrand}>UCT INTELLIGENCE</div>
          <div className={styles.nextLabel}>That’s a wrap</div>
          <div className={styles.endTagline}>Navigate the market, effectively.</div>
          <button className={styles.nextPlayBtn} onClick={() => storeClose()}>Close</button>
        </div>
      )}
    </div>
  )
}
