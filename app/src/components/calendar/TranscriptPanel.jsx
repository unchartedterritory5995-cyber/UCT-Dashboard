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
import { useState, useRef, useEffect, useCallback } from 'react'
import useTranscript from '../../hooks/useTranscript'
import UIcon from '../ui/UIcon'
import styles from './CallRecapSection.module.css'

const hasSpeechSynthesis = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window

// Split on the keyword and mark the odd indices. `String.split` with a capture
// group alternates [text, match, text, match, …], so parity IS the answer —
// the previous implementation re-tested each fragment against a /g/ regex,
// whose `lastIndex` carries between calls.
function highlight(text, kw, styleMap) {
  if (!text || !kw || !kw.trim()) return text
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return parts.map((p, i) =>
    i % 2 === 1 ? <mark key={i} className={styleMap.kw}>{p}</mark> : p,
  )
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
  const utteranceRef = useRef(null)

  const { data: transcript, isLoading } = useTranscript(sym, { enabled: open, quarter })

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

  const kw = (query || '').trim()

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

              <div className={styles.transcriptSegments}>
                {transcript.segments.map((seg, i) => (
                  <div key={i} className={styles.transcriptSegment}>
                    {(seg.speaker || seg.title) && (
                      <div className={styles.transcriptSpeaker}>
                        {seg.speaker && <span className={styles.speakerName}>{seg.speaker}</span>}
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
                      {highlight(seg.content, kw, styles)}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
