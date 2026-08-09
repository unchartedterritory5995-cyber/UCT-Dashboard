// app/src/components/calendar/TranscriptPanel.jsx
//
// The verbatim earnings-call transcript, as its OWN mountable surface.
//
// It used to live inside CallRecapSection, which every parent renders only when
// an AI recap exists. That bound an independent source — FMP Ultimate, uncapped,
// cached 30d, no LLM anywhere in its path — to the success of an LLM artifact,
// so a single failed synthesis hid a published transcript entirely. Measured on
// 2026-08-08: DIS had 81 quarters available and FY26Q3 published three days
// earlier while the Call panel read "No transcript yet".
//
// Fetching stays LAZY (`enabled` follows the disclosure) — FMP is uncapped but
// the AlphaVantage fallback still runs on a 25/day budget, so opening a modal
// must not spend a request on a transcript nobody asked to read.
//
// Styles are deliberately shared with CallRecapSection.module.css: this is a
// pure extraction, and re-declaring the rules would let the two surfaces drift
// apart visually for no benefit. Phase 1 gives the panel its own stylesheet
// when it grows a search bar of its own.
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import useTranscript from '../../hooks/useTranscript'
import UIcon from '../ui/UIcon'
import { escapeLiteral, findMatches, segmentsWithMatches, stepIndex } from './transcriptSearch'
import styles from './CallRecapSection.module.css'
import search from './TranscriptSearch.module.css'

const hasSpeechSynthesis = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window

// How long the user has to stop typing before we re-scan. A transcript is
// ~50k characters, so re-matching and re-rendering every keystroke is felt.
const DEBOUNCE_MS = 150

// Split on the keyword and mark the odd indices. `String.split` with a capture
// group alternates [text, match, text, match, …], so parity IS the answer —
// the previous implementation re-tested each fragment against a /g/ regex,
// whose `lastIndex` carries between calls.
//
// `activeOrdinal` is the index, among THIS field's matches, of the one the
// reader has stepped to; it gets a distinct mark so "3 of 47" points at
// something visible rather than at one of many identical highlights.
function highlight(text, kw, activeOrdinal = -1) {
  if (!text || !kw || !kw.trim()) return text
  const parts = text.split(new RegExp(`(${escapeLiteral(kw)})`, 'gi'))
  let ordinal = -1
  return parts.map((p, i) => {
    if (i % 2 === 0) return p
    ordinal += 1
    const isActive = ordinal === activeOrdinal
    return (
      <mark
        key={i}
        className={isActive ? `${styles.kw} ${search.kwActive}` : styles.kw}
        {...(isActive ? { 'data-active-match': 'true' } : {})}
      >
        {p}
      </mark>
    )
  })
}

/**
 * TranscriptPanel
 *
 * @param {string|null} sym    — symbol; nothing renders without one
 * @param {string} [query]     — keyword to highlight within segment text
 * @param {string} [quarter]   — e.g. "2026Q3"; omit to auto-resolve the newest
 */
export default function TranscriptPanel({ sym = null, query = '', quarter = null }) {
  const [open, setOpen] = useState(false)
  const [ttsActive, setTtsActive] = useState(false)
  const [typed, setTyped] = useState('')
  const [debounced, setDebounced] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [onlyMatching, setOnlyMatching] = useState(false)
  const utteranceRef = useRef(null)
  const segmentsRef = useRef(null)

  const { data: transcript, isLoading } = useTranscript(sym, { enabled: open, quarter })

  // Only what is being TYPED here is debounced — an externally-supplied `query`
  // (a parent search box) is already a settled value, so delaying it would just
  // make the panel look unresponsive to a prop it received fully formed.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(typed), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [typed])

  // The panel's own input wins once the reader types in it.
  const effectiveQuery = debounced || query || ''

  const segments = transcript?.segments
  const matches = useMemo(
    () => findMatches(segments, effectiveQuery),
    [segments, effectiveQuery],
  )
  const matchingSegs = useMemo(() => segmentsWithMatches(matches), [matches])

  // A shorter result list must never leave the cursor pointing past the end.
  useEffect(() => { setActiveIndex(0) }, [effectiveQuery, segments])

  const total = matches.length
  const active = total ? matches[Math.min(activeIndex, total - 1)] : null

  const go = useCallback(
    delta => setActiveIndex(i => stepIndex(i, matches.length, delta)),
    [matches.length],
  )

  // Bring the stepped-to match into view. Keyed on the match itself rather than
  // the index so re-running a search that lands on the same hit still scrolls.
  useEffect(() => {
    if (!active || !segmentsRef.current) return
    const el = segmentsRef.current.querySelector('[data-active-match="true"]')
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active])

  const onSearchKeyDown = useCallback(e => {
    if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1) }
    else if (e.key === 'Escape') { setTyped('') }
  }, [go])

  useEffect(() => () => {
    if (hasSpeechSynthesis()) window.speechSynthesis.cancel()
  }, [])

  useEffect(() => {
    if (!open && ttsActive) {
      if (hasSpeechSynthesis()) window.speechSynthesis.cancel()
      setTtsActive(false)
    }
  }, [open, ttsActive])

  const handleTTSToggle = useCallback(() => {
    if (!hasSpeechSynthesis()) return
    if (ttsActive) {
      window.speechSynthesis.cancel()
      setTtsActive(false)
      return
    }
    if (!transcript?.segments?.length) return
    const text = transcript.segments.map(s => {
      const who = s.speaker || s.title || ''
      return who ? `${who}: ${s.content}` : s.content
    }).join('. ')
    if (!text.trim()) return
    const utter = new window.SpeechSynthesisUtterance(text)
    utter.onend = () => setTtsActive(false)
    utter.onerror = () => setTtsActive(false)
    utteranceRef.current = utter
    window.speechSynthesis.speak(utter)
    setTtsActive(true)
  }, [transcript, ttsActive])

  if (!sym) return null

  const kw = effectiveQuery.trim()

  // Where within its own field the active match falls, so exactly one <mark>
  // is styled active rather than every hit in the segment.
  const activeOrdinal = (segIndex, field) => {
    if (!active || active.segIndex !== segIndex || active.field !== field) return -1
    return matches
      .filter(m => m.segIndex === segIndex && m.field === field)
      .findIndex(m => m.start === active.start)
  }

  return (
    <div className={styles.transcriptBlock}>
      <button
        type="button"
        className={styles.transcriptToggleBtn}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={styles.transcriptChevron}>{open ? '▾' : '▸'}</span>
        <span className={styles.sectionLabel}>FULL TRANSCRIPT</span>
      </button>

      {open && (
        <div className={styles.transcriptPanel}>
          {isLoading && !transcript && (
            <p className={styles.transcriptLoading}>Loading transcript…</p>
          )}

          {/* `undefined` is "not fetched yet"; only a resolved `null` means the
              provider genuinely had nothing. Treating the two alike is how a
              panel ends up asserting absence it never verified. */}
          {!isLoading && transcript === null && (
            <p className={styles.transcriptUnavailable}>Transcript not available.</p>
          )}

          {transcript?.segments?.length > 0 && (
            <>
              <div className={styles.transcriptHeader}>
                {transcript.quarter && (
                  <span className={styles.transcriptQuarter}>{transcript.quarter}</span>
                )}
                {hasSpeechSynthesis() && (
                  <button
                    type="button"
                    className={`${styles.listenBtn} ${ttsActive ? styles.listenBtnActive : ''}`}
                    onClick={handleTTSToggle}
                    title={ttsActive ? 'Stop reading' : 'Listen to call'}
                  >
                    {ttsActive
                      ? <><UIcon name="pause" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Stop</>
                      : <><UIcon name="volume" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Listen to call</>}
                  </button>
                )}
              </div>

              {/* Search over the transcript itself — count, step, filter.
                  Highlighting alone (the old behaviour) reads as "nothing
                  happened" on a transcript this long. */}
              <div className={search.bar}>
                <input
                  type="text"
                  className={search.input}
                  placeholder="Search transcript…"
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  aria-label="Search transcript"
                />
                {kw && (
                  <>
                    <span className={search.count} role="status" aria-live="polite">
                      {total ? `${Math.min(activeIndex, total - 1) + 1} / ${total}` : 'No matches'}
                    </span>
                    <button
                      type="button" className={search.navBtn} onClick={() => go(-1)}
                      disabled={!total} aria-label="Previous match" title="Previous match (Shift+Enter)"
                    >↑</button>
                    <button
                      type="button" className={search.navBtn} onClick={() => go(1)}
                      disabled={!total} aria-label="Next match" title="Next match (Enter)"
                    >↓</button>
                    <label className={search.filterToggle}>
                      <input
                        type="checkbox"
                        checked={onlyMatching}
                        onChange={e => setOnlyMatching(e.target.checked)}
                      />
                      Only matching turns
                    </label>
                  </>
                )}
              </div>

              <div className={styles.transcriptSegments} ref={segmentsRef}>
                {transcript.segments.map((seg, i) => (
                  (kw && onlyMatching && !matchingSegs.has(i)) ? null : (
                  <div key={i} className={styles.transcriptSegment}>
                    {(seg.speaker || seg.title) && (
                      <div className={styles.transcriptSpeaker}>
                        {seg.speaker && (
                          <span className={styles.speakerName}>
                            {highlight(seg.speaker, kw, activeOrdinal(i, 'speaker'))}
                          </span>
                        )}
                        {seg.title && <span className={styles.speakerTitle}>{seg.title}</span>}
                        {seg.sentiment && (
                          <span className={
                            seg.sentiment === 'positive' ? styles.sentBull :
                            seg.sentiment === 'negative' ? styles.sentBear :
                            styles.sentNeutral
                          }>
                            {seg.sentiment}
                          </span>
                        )}
                      </div>
                    )}
                    <p className={styles.transcriptContent}>
                      {highlight(seg.content, kw, activeOrdinal(i, 'content'))}
                    </p>
                  </div>
                  )
                ))}
                {kw && onlyMatching && !matchingSegs.size && (
                  <p className={styles.transcriptUnavailable}>
                    No turns mention “{kw}”.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
