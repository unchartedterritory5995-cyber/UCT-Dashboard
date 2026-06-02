import { useEffect, useRef, useState, useCallback } from 'react'
import { useVoice } from '../../context/VoiceContext'
import styles from './AudioPlayerBar.module.css'

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0]
// OpenAI TTS voices (api/services/voice_settings_service.ALLOWED_VOICES).
const VOICES = [
  ['alloy', 'Alloy'], ['ash', 'Ash'], ['ballad', 'Ballad'], ['coral', 'Coral'],
  ['echo', 'Echo'], ['sage', 'Sage'], ['shimmer', 'Shimmer'], ['verse', 'Verse'],
]

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

  // Register the shared <audio> element with the voice context exactly once.
  useEffect(() => {
    voice.attachAudio(audioRef.current)
    return () => voice.attachAudio(null)
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

  // Wire <audio> events: ended/error reset; time + metadata drive the seek bar.
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const reset = () => { try { if (el.srcObject) el.srcObject = null } catch {} ; voice.stop() }
    const onTime = () => setCurrentTime(el.currentTime || 0)
    const onMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0)
    el.addEventListener('ended', reset)
    el.addEventListener('error', reset)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('durationchange', onMeta)
    return () => {
      el.removeEventListener('ended', reset)
      el.removeEventListener('error', reset)
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('durationchange', onMeta)
    }
  }, [voice])

  const onSeek = useCallback((e) => {
    const el = audioRef.current
    const t = parseFloat(e.target.value)
    if (el && Number.isFinite(t)) { el.currentTime = t; setCurrentTime(t) }
  }, [])

  const onVoiceChange = useCallback((e) => {
    const v = e.target.value
    setVoiceName(v)
    // Persist for future reads.
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
    // Re-read the current track in the new voice (needs a fresh synthesis).
    voice.replayReadAloud({ voice: v })
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
      <audio ref={audioRef} preload="auto" hidden />
      {visible && (
        <div className={styles.bar} role="region" aria-label="Audio playback">
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => (isPlaying ? voice.pause() : voice.resume())}
            disabled={isLoading || isError}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isLoading ? '…' : isPlaying ? '❚❚' : '▶'}
          </button>

          <div className={styles.label}>
            {voice.trackLabel || 'Audio'}
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
                className={styles.speedSel}
                value={voiceName}
                onChange={onVoiceChange}
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
            onChange={(e) => voice.setSpeed(parseFloat(e.target.value))}
            aria-label="Playback speed"
            title="Playback speed"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>{s}×</option>
            ))}
          </select>

          <button
            type="button"
            className={styles.iconBtn}
            onClick={voice.stop}
            aria-label="Stop"
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}
