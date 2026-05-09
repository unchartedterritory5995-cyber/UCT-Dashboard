import { useEffect, useRef } from 'react'
import { useVoice } from '../../context/VoiceContext'
import styles from './AudioPlayerBar.module.css'

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0]

export default function AudioPlayerBar() {
  const voice = useVoice()
  const audioRef = useRef(null)

  // Register the shared <audio> element with the voice context exactly once.
  useEffect(() => {
    voice.attachAudio(audioRef.current)
    return () => voice.attachAudio(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wire <audio> events back into the reducer
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onEnded = () => voice.stop()
    const onError = () => voice.stop()
    el.addEventListener('ended', onEnded)
    el.addEventListener('error', onError)
    return () => {
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('error', onError)
    }
  }, [voice])

  const visible = voice.status !== 'idle'
  if (!visible) {
    // Still mount the <audio> element so it's ready when needed
    return <audio ref={audioRef} preload="auto" hidden />
  }

  const isPlaying = voice.status === 'playing'
  const isLoading = voice.status === 'loading'
  const isError = voice.status === 'error'

  return (
    <div className={styles.bar} role="region" aria-label="Audio playback">
      <audio ref={audioRef} preload="auto" />
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
      <select
        className={styles.speedSel}
        value={voice.speed}
        onChange={(e) => voice.setSpeed(parseFloat(e.target.value))}
        aria-label="Playback speed"
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
  )
}
