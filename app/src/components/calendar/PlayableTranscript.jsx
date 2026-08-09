// app/src/components/calendar/PlayableTranscript.jsx
//
// The Quartr behaviour: the recording plays, the transcript follows it word by
// word, and clicking any word seeks the audio to that moment.
//
// Audio comes from OUR proxy (`/api/earnings/call-audio/{sym}`) — the upstream
// URL carries the provider API key and must never reach the browser. The proxy
// forwards Range, so seeking works.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useTimedTranscript, { buildWordIndex, wordAt } from '../../hooks/useTimedTranscript'
import styles from './PlayableTranscript.module.css'

const SPEEDS = [1, 1.25, 1.5, 1.75, 2]

function fmt(t) {
  if (!Number.isFinite(t) || t < 0) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function PlayableTranscript({ sym }) {
  const { data } = useTimedTranscript(sym)
  const audioRef = useRef(null)
  const activeRef = useRef(null)
  const [now, setNow] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [follow, setFollow] = useState(true)

  const segments = data?.available ? data.segments : null
  const index = useMemo(() => buildWordIndex(segments), [segments])

  // Which word is currently being spoken. -1 before the first word starts.
  const cursor = useMemo(() => wordAt(index.starts, now), [index, now])
  const activeKey = cursor >= 0 ? index.keys[cursor] : null

  // Keep the spoken word on screen, but stop fighting the user: any manual
  // scroll turns following off until they ask for it back.
  useEffect(() => {
    if (!follow || !activeRef.current) return
    activeRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeKey, follow])

  useEffect(() => {
    const el = audioRef.current
    if (el) el.playbackRate = speed
  }, [speed, segments])

  const seekTo = useCallback((t) => {
    const el = audioRef.current
    if (!el) return
    el.currentTime = t
    setNow(t)
    if (el.paused) el.play().catch(() => {})
  }, [])

  if (!data) return null
  if (!data.available) return null

  return (
    <div className={styles.wrap} data-testid="playable-transcript">
      <div className={styles.bar}>
        <audio
          ref={audioRef}
          className={styles.audio}
          controls
          preload="metadata"
          src={data.audio_url}
          onTimeUpdate={e => setNow(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        <div className={styles.controls}>
          <span className={styles.clock}>{fmt(now)}</span>
          <label className={styles.speed}>
            Speed
            <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
              {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
            </select>
          </label>
          <button
            type="button"
            className={follow ? styles.followOn : styles.followOff}
            aria-pressed={follow}
            onClick={() => setFollow(f => !f)}
          >
            {follow ? 'Following' : 'Follow'}
          </button>
        </div>
      </div>

      <p className={styles.hint}>
        {data.company_name || sym} · Q{data.quarter} {data.year} —
        click any word to jump the recording there.
      </p>

      <div className={styles.body} onWheel={() => follow && setFollow(false)}>
        {segments.map((seg, si) => (
          <div key={si} className={styles.turn}>
            <div className={styles.speaker}>
              {seg.name || seg.speaker}
              {seg.title ? <span className={styles.title}> · {seg.title}</span> : null}
              <button
                type="button"
                className={styles.turnJump}
                onClick={() => seekTo(seg.starts[0])}
                title="Play from here"
              >
                ▶ {fmt(seg.starts[0])}
              </button>
            </div>
            <p className={styles.text}>
              {seg.words.map((w, wi) => {
                const key = `${si}:${wi}`
                const isActive = key === activeKey
                return (
                  <span
                    key={key}
                    ref={isActive ? activeRef : null}
                    className={isActive ? styles.wordActive : styles.word}
                    onClick={() => seekTo(seg.starts[wi])}
                    role="button"
                    tabIndex={-1}
                  >
                    {w}{' '}
                  </span>
                )
              })}
            </p>
          </div>
        ))}
      </div>
      {playing && follow ? null : null}
    </div>
  )
}
