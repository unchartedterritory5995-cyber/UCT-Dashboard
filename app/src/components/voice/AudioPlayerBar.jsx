import { useEffect, useRef, useState, useCallback } from 'react'
import { useVoice } from '../../context/VoiceContext'
import { setProgress } from '../../utils/readAloudProgress'
import { videoOwnsMediaSession } from '../video/mediaSessionOwner'
import UIcon from '../ui/UIcon'
import styles from './AudioPlayerBar.module.css'

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0]
// OpenAI TTS voices (api/services/voice_settings_service.ALLOWED_VOICES).
const VOICES = [
  ['alloy', 'Alloy'], ['ash', 'Ash'], ['ballad', 'Ballad'], ['coral', 'Coral'],
  ['echo', 'Echo'], ['sage', 'Sage'], ['shimmer', 'Shimmer'], ['verse', 'Verse'],
]
const SKIP = 15
const SPEED_KEY = 'readaloud.speed'
const posKey = (id) => `readaloud.pos.${id}`

function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function AudioPlayerBar() {
  const voice = useVoice()
  const audioRef = useRef(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [voiceName, setVoiceName] = useState('verse')
  const lastSaveRef = useRef(0)

  // Register the shared <audio> element with the voice context exactly once.
  // Halt it BEFORE detaching: once the ref is nulled nothing can reach this
  // element again, so a still-playing clip would be stranded with no control.
  useEffect(() => {
    const el = audioRef.current
    voice.attachAudio(el)
    return () => {
      try { el?.pause() } catch { /* ignore */ }
      voice.attachAudio(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Restore the user's last playback speed.
  useEffect(() => {
    try {
      const s = parseFloat(localStorage.getItem(SPEED_KEY))
      if (Number.isFinite(s) && s >= 0.5 && s <= 2) voice.setSpeed(s)
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load the user's saved reader voice for the picker (best-effort).
  useEffect(() => {
    if (typeof fetch !== 'function') return
    let cancelled = false
    try {
      fetch('/api/voice/settings', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => { if (!cancelled && s && s.voice) setVoiceName(s.voice) })
        .catch(() => {})
    } catch { /* ignore */ }
    return () => { cancelled = true }
  }, [])

  const skip = useCallback((delta) => {
    const el = audioRef.current
    if (!el) return
    const dur = Number.isFinite(el.duration) ? el.duration : el.currentTime + delta
    el.currentTime = Math.max(0, Math.min(dur, el.currentTime + delta))
    setCurrentTime(el.currentTime)
  }, [])

  // Wire <audio> events: drive the seek bar, publish progress for follow-along
  // highlighting, and remember playback position to resume later.
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const id = voice.trackId

    const publish = () => {
      setProgress({
        trackId: voice.trackId,
        currentTime: el.currentTime || 0,
        duration: Number.isFinite(el.duration) ? el.duration : 0,
        playing: !el.paused,
      })
      if ('mediaSession' in navigator && Number.isFinite(el.duration) && el.duration > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: el.duration,
            position: Math.min(el.currentTime, el.duration),
            playbackRate: el.playbackRate || 1,
          })
        } catch { /* ignore */ }
      }
    }
    // A halted element (src removed by haltAudioEl) has no live source, so any
    // event still arriving from it belongs to a track we already tore down.
    // Acting on those events under the CURRENT `id` is how a finished clip
    // cancelled a preparing read and poisoned another track's saved position.
    const detached = () => !el.getAttribute('src') && !el.srcObject

    const reset = (e) => {
      // An 'ended'/'error' from an already-cleared element isn't a real
      // playback event — it's teardown. Treating it as real calls stop(),
      // which cancels a read-aloud that may already be preparing.
      if (e && detached()) return
      try { if (el.srcObject) el.srcObject = null } catch {}
      if (id) { try { localStorage.removeItem(posKey(id)) } catch {} }
      setProgress({ trackId: null, currentTime: 0, duration: 0, playing: false })
      voice.stop()
    }
    const onTime = () => {
      if (detached()) return
      setCurrentTime(el.currentTime || 0)
      publish()
      if (id && Math.abs(el.currentTime - lastSaveRef.current) > 5) {
        lastSaveRef.current = el.currentTime
        try { localStorage.setItem(posKey(id), String(el.currentTime)) } catch {}
      }
    }
    const onMeta = () => {
      const d = Number.isFinite(el.duration) ? el.duration : 0
      setDuration(d)
      if (id && d > 30) { // resume where the user left off
        try {
          const saved = parseFloat(localStorage.getItem(posKey(id)))
          if (Number.isFinite(saved) && saved > 10 && saved < d - 10) el.currentTime = saved
        } catch { /* ignore */ }
      }
      publish()
    }
    const onPauseSave = () => {
      // The 'pause' fired by haltAudioEl() lands AFTER the store has been
      // re-labelled, so saving here would stamp the outgoing clip's position
      // onto the incoming track's key.
      if (detached()) return
      // Something outside the store paused us (e.g. a Desk video calling
      // pauseOtherAudio). The element is the source of truth for playing vs
      // paused, so mirror it — otherwise the bar kept showing a Pause button
      // for audio that was already silent.
      if (voice.status === 'playing') voice.pause()
      publish()
      if (id) { try { localStorage.setItem(posKey(id), String(el.currentTime)) } catch {} }
    }
    el.addEventListener('ended', reset)
    el.addEventListener('error', reset)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('durationchange', onMeta)
    el.addEventListener('play', publish)
    el.addEventListener('pause', onPauseSave)
    return () => {
      el.removeEventListener('ended', reset)
      el.removeEventListener('error', reset)
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('durationchange', onMeta)
      el.removeEventListener('play', publish)
      el.removeEventListener('pause', onPauseSave)
    }
  }, [voice])

  // Lock-screen / headphone-button controls via the Media Session API.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (videoOwnsMediaSession()) return // Desk video owns the lock screen while its audio is live
    if (voice.status === 'idle') {
      try { navigator.mediaSession.metadata = null } catch {}
      return
    }
    try {
      if (window.MediaMetadata) {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: voice.trackLabel || 'Read Aloud',
          artist: 'UCT Intelligence',
          album: 'Morning Wire',
        })
      }
      navigator.mediaSession.setActionHandler('play', () => voice.resume())
      navigator.mediaSession.setActionHandler('pause', () => voice.pause())
      navigator.mediaSession.setActionHandler('seekbackward', () => skip(-SKIP))
      navigator.mediaSession.setActionHandler('seekforward', () => skip(SKIP))
      navigator.mediaSession.setActionHandler('seekto', (d) => {
        const el = audioRef.current
        if (el && d.seekTime != null) { el.currentTime = d.seekTime; setCurrentTime(d.seekTime) }
      })
    } catch { /* ignore */ }
  }, [voice.status, voice.trackLabel, voice, skip])

  // Spacebar pauses/resumes when the player is active and you're not typing.
  useEffect(() => {
    const onKey = (e) => {
      if (voice.status === 'idle' || e.code !== 'Space') return
      const t = e.target
      const tag = t && t.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return
      e.preventDefault()
      if (voice.status === 'playing') voice.pause()
      else voice.resume()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [voice])

  const onSeek = useCallback((e) => {
    const el = audioRef.current
    const t = parseFloat(e.target.value)
    if (el && Number.isFinite(t)) { el.currentTime = t; setCurrentTime(t) }
  }, [])

  const onVoiceChange = useCallback((e) => {
    const v = e.target.value
    setVoiceName(v)
    if (typeof fetch === 'function') {
      try {
        fetch('/api/voice/settings', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice: v }),
        }).catch(() => {})
      } catch { /* ignore */ }
    }
    voice.replayReadAloud({ voice: v }) // re-read the current track in the new voice
  }, [voice])

  const onSpeedChange = useCallback((e) => {
    const v = parseFloat(e.target.value)
    voice.setSpeed(v)
    try { localStorage.setItem(SPEED_KEY, String(v)) } catch { /* ignore */ }
  }, [voice])

  const visible = voice.status !== 'idle'
  const isPlaying = voice.status === 'playing'
  const isLoading = voice.status === 'loading'
  const isError = voice.status === 'error'
  const isReadAloud = voice.mode === 'a'
  const seekable = isReadAloud && Number.isFinite(duration) && duration > 0
  const seekMax = seekable ? duration : 0

  // The <audio> element is rendered ONCE, unconditionally, and never moves in
  // the tree, so an in-flight play() is never interrupted by a re-render
  // removing it from the document. Only the controls bar toggles.
  return (
    <>
      {/* data-uct-voice-audio marks this as voice-owned so VoiceContext's
          stop() can sweep it even if the ref ever goes stale. */}
      <audio ref={audioRef} preload="auto" hidden data-uct-voice-audio="" />
      {visible && (
        <div className={styles.bar} role="region" aria-label="Audio playback">
          {isReadAloud && (
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.skipBtn}`}
              onClick={() => skip(-SKIP)}
              disabled={isLoading || isError}
              aria-label="Back 15 seconds"
              title="Back 15 seconds"
            >
              <UIcon name="skipBack" size={16} />
            </button>
          )}

          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => (isPlaying ? voice.pause() : voice.resume())}
            disabled={isLoading || isError}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isLoading ? '…' : isPlaying ? <UIcon name="pause" size={16} /> : <UIcon name="play" size={16} />}
          </button>

          {isReadAloud && (
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.skipBtn}`}
              onClick={() => skip(SKIP)}
              disabled={isLoading || isError}
              aria-label="Forward 15 seconds"
              title="Forward 15 seconds"
            >
              <UIcon name="skipForward" size={16} />
            </button>
          )}

          <div className={styles.label}>
            {voice.trackLabel || 'Audio'}
            {isLoading && <span className={styles.loadingTag}> · preparing…</span>}
            {isError && <span className={styles.errorTag}> · {voice.errorMessage || 'Error'}</span>}
          </div>

          {isReadAloud && (
            <>
              <span className={styles.time}>{fmtTime(currentTime)}</span>
              <input
                className={styles.seek}
                type="range"
                min={0}
                max={seekMax}
                step="0.1"
                value={Math.min(currentTime, seekMax)}
                onChange={onSeek}
                disabled={!seekable}
                aria-label="Seek"
              />
              <span className={styles.time}>{seekable ? fmtTime(duration) : '--:--'}</span>

              <select
                className={`${styles.speedSel} ${styles.voiceSel}`}
                value={voiceName}
                onChange={onVoiceChange}
                // Re-reading needs a track to re-read; mid-prepare there isn't
                // one yet, so a change here would either no-op or replay the
                // PREVIOUS track and cancel the pending one.
                disabled={isLoading || isError}
                aria-label="Reader voice"
                title="Reader voice"
              >
                {VOICES.map(([val, lbl]) => (
                  <option key={val} value={val}>{lbl}</option>
                ))}
              </select>
            </>
          )}

          <select
            className={styles.speedSel}
            value={voice.speed}
            onChange={onSpeedChange}
            aria-label="Playback speed"
            title="Playback speed"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>{s}×</option>
            ))}
          </select>

          <button
            type="button"
            className={`${styles.iconBtn} ${styles.stopBtn}`}
            onClick={voice.stop}
            aria-label="Stop"
          >
            <UIcon name="x" size={16} />
          </button>
        </div>
      )}
    </>
  )
}
