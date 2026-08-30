/**
 * The scrubber — one control that drags the tab's single date cursor across the
 * loaded window, plus playback so a regime TURN is something you watch rather
 * than something you infer from two screenshots.
 *
 * ⛔ `rows` IS NEWEST-FIRST. A scrubber that reads left-to-right is
 * oldest → newest, so the slider's value is `last - rowIdx`, not `rowIdx`. Heat
 * Ribbon already reverses for the same reason; getting this backwards puts the
 * newest session on the left and makes every drag feel inverted.
 *
 * ⛔ PLAYBACK DOES NOT LOOP. It advances one session per tick toward the newest
 * row and STOPS there. Wrapping back to the oldest would replay history as
 * though it were still arriving.
 */
import { useEffect, useRef, useState } from 'react'
import {
  SPEEDS, DEFAULT_SPEED, REDUCED_MOTION_NOTE, usePrefersReducedMotion,
} from './scrubberPlayback'
import styles from './BreadthScrubber.module.css'

export default function BreadthScrubber({
  rows = [], rowIdx = 0, playing = false, onSeek, onStep, onPlayingChange,
}) {
  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  const reduceMotion = usePrefersReducedMotion()
  const last = rows.length - 1

  // The cursor as the interval sees it. The prop is the AUTHORITY (this effect
  // runs after every render); the tick writes it optimistically so a fast speed
  // cannot issue the same step twice before React has re-rendered.
  const idxRef = useRef(rowIdx)
  useEffect(() => { idxRef.current = rowIdx })

  // A run already under way when the user turns reduced motion on has to stop.
  useEffect(() => {
    if (reduceMotion && playing) onPlayingChange?.(false)
  }, [reduceMotion, playing, onPlayingChange])

  useEffect(() => {
    if (!playing || reduceMotion || last < 1) return undefined
    const id = setInterval(() => {
      const next = idxRef.current - 1
      if (next < 0) { onPlayingChange?.(false); return }  // stops at the newest row
      idxRef.current = next
      onStep?.(next)
    }, Math.max(40, Math.round(1000 / speed)))
    return () => clearInterval(id)
  }, [playing, reduceMotion, speed, last, onStep, onPlayingChange])

  if (!rows.length) return null

  const row = rows[rowIdx] ?? rows[0]
  // ⭐ The refusal and the guard are the SAME value: `disabled` is derived from
  // the reason, so a play button can never be dead without saying why.
  const blockedReason =
    last < 1 ? 'Only one session is loaded — there is nothing to play.'
      : reduceMotion ? REDUCED_MOTION_NOTE
        : (!playing && rowIdx === 0) ? 'Already at the newest session — scrub back to play forward.'
          : null

  return (
    <div className={styles.bar} data-testid="scrubber">
      <button type="button" className={styles.btn} data-testid="scrubber-play"
              disabled={blockedReason != null}
              title={blockedReason ?? (playing ? 'Pause' : 'Play forward one session at a time')}
              aria-label={playing ? 'Pause playback' : 'Play forward through the window'}
              onClick={() => onPlayingChange?.(!playing)}>
        {playing ? '❚❚' : '▶'}
      </button>

      {/* Words, not the end dates: the window's span is already stated by every
          view's own basis line, and a third and fourth date on this row would
          bury the one that moves. */}
      <span className={styles.ends}>oldest</span>
      <input type="range" className={styles.range} data-testid="scrubber-range"
             min={0} max={Math.max(0, last)} step={1}
             value={Math.max(0, last - rowIdx)}
             disabled={last < 1}
             aria-label="Session"
             aria-valuetext={row?.date ?? ''}
             onChange={(e) => onSeek?.(last - Number(e.target.value))} />
      <span className={styles.ends}>newest</span>

      <span className={styles.date} data-testid="scrubber-date">
        {row?.date}{row?._live ? ' · live' : ''}
      </span>
      {/* 🔴 CLAMPED, because the window can shrink under the cursor. Scrub deep
          into a 365-day window, press the 90d pill, and `rowIdx` is briefly
          larger than the new window — this printed "-5 of 5", a position that
          cannot exist. The slider above already clamped (`Math.max(0, …)`); the
          text did not, so the slider looked right while the readout did not.
          ⛔ This is only HALF the fix: `BreadthViews` clamps `rowIdx` itself on
          a window change. Clamping only here would hide an out-of-bounds cursor
          instead of correcting it. */}
      <span className={styles.position} data-testid="scrubber-position">
        {Math.max(1, Math.min(rows.length, last - rowIdx + 1))} of {rows.length}
      </span>

      <select className={styles.speed} data-testid="scrubber-speed" value={speed}
              disabled={reduceMotion} aria-label="Playback speed"
              onChange={(e) => setSpeed(Number(e.target.value))}>
        {SPEEDS.map(s => <option key={s} value={s}>{s}/s</option>)}
      </select>

      {reduceMotion && (
        <span className={styles.note} data-testid="scrubber-note">{REDUCED_MOTION_NOTE}</span>
      )}
    </div>
  )
}
