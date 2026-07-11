// Search-and-seek transcript for a Desk session. A single "Transcript" toggle
// under the video (collapsed by default so it never clogs the theater); when
// opened it lazily loads the timed cues and lets you search + click a line to
// jump the player to that moment.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVideoTranscript } from '../../hooks/useVideoTranscript'
import { getCurrentTime } from './videoStore'
import styles from './TranscriptPanel.module.css'

const fmt = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
           : `${m}:${String(ss).padStart(2, '0')}`
}

// Wrap the matched substring(s) in <mark> for a highlighted result.
function highlight(text, q) {
  if (!q) return text
  const lower = text.toLowerCase()
  const parts = []
  let i = 0
  while (i < text.length) {
    const idx = lower.indexOf(q, i)
    if (idx === -1) { parts.push(text.slice(i)); break }
    if (idx > i) parts.push(text.slice(i, idx))
    parts.push(<mark key={idx} className={styles.mark}>{text.slice(idx, idx + q.length)}</mark>)
    i = idx + q.length
  }
  return parts
}

export default function TranscriptPanel({ videoId, hasTranscript, onSeek }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const { cues, loading } = useVideoTranscript(videoId, open)
  const query = q.trim().toLowerCase()
  const filtered = useMemo(
    () => (query ? cues.filter((c) => c.text.toLowerCase().includes(query)) : cues),
    [cues, query],
  )

  // Follow-along: highlight + auto-scroll the line playing now (only while the
  // panel is open and the user isn't searching, so it never fights a search).
  const listRef = useRef(null)
  const [activeCue, setActiveCue] = useState(-1)
  useEffect(() => {
    if (!open || query || cues.length === 0) { setActiveCue(-1); return }
    const tick = () => {
      const now = getCurrentTime()
      let idx = -1
      for (let i = 0; i < cues.length; i++) {
        if (now >= (cues[i].t || 0) - 0.25) idx = i
        else break
      }
      setActiveCue((prev) => (prev === idx ? prev : idx))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [open, query, cues])
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]')
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [activeCue])

  if (!hasTranscript) return null

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9.2 9.2 12.5 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>Search transcript</span>
        <svg
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
          width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"
        >
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className={styles.panel}>
          <input
            className={styles.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find where a ticker or topic was discussed…"
            aria-label="Search transcript"
            autoFocus
          />
          {loading ? (
            <div className={styles.hint}>Loading transcript…</div>
          ) : cues.length === 0 ? (
            <div className={styles.hint}>Transcript isn’t available for this video yet.</div>
          ) : (
            <>
              {query && (
                <div className={styles.count}>
                  {filtered.length} {filtered.length === 1 ? 'match' : 'matches'}
                </div>
              )}
              <div className={styles.list} ref={listRef}>
                {filtered.map((c, i) => (
                  <button
                    key={`${c.t}-${i}`}
                    type="button"
                    className={`${styles.cue} ${!query && i === activeCue ? styles.cueActive : ''}`}
                    data-active={!query && i === activeCue}
                    onClick={() => onSeek(c.t)}
                    title={`Jump to ${fmt(c.t)}`}
                  >
                    <span className={styles.cueTime}>{fmt(c.t)}</span>
                    <span className={styles.cueText}>{highlight(c.text, query)}</span>
                  </button>
                ))}
                {filtered.length === 0 && <div className={styles.hint}>No matches.</div>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
