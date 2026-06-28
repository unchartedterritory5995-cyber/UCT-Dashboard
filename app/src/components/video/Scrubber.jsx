// Custom seek bar for the UCT player. Click or drag anywhere on the track to
// seek; `onSeek` receives a 0..1 fraction of the duration.
import { useRef } from 'react'
import styles from './Scrubber.module.css'

export default function Scrubber({ current = 0, duration = 0, onSeek, chapters = [] }) {
  const trackRef = useRef(null)
  const pct = duration > 0 ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0
  // Chapter tick marks along the track (skip t=0 — the very start).
  const marks =
    duration > 0 ? (chapters || []).filter((c) => c && c.t > 0 && c.t < duration) : []

  const seekAt = (clientX) => {
    const el = trackRef.current
    if (!el || !duration || !onSeek) return
    const r = el.getBoundingClientRect()
    if (!r.width) return
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    onSeek(frac)
  }

  return (
    <div
      ref={trackRef}
      className={styles.track}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration) || 0}
      aria-valuenow={Math.round(current) || 0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId)
        seekAt(e.clientX)
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) seekAt(e.clientX)
      }}
    >
      <div className={styles.fill} style={{ width: `${pct}%` }}>
        <span className={styles.thumb} />
      </div>
      {marks.map((c, i) => (
        <span
          key={i}
          className={styles.chapterMark}
          style={{ left: `${(c.t / duration) * 100}%` }}
          title={c.title || ''}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}
