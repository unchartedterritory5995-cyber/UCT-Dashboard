// app/src/components/calendar/CallRecapSection.jsx
// Renders the earnings call recap:
//   - Headline, sentiment label, bullets, quotes, guidance, Q&A highlights
//   - 🔊 Listen button (TTS via browser speechSynthesis)
//   - Keyword search that filters/highlights within the recap
//   - Audio player when audio.stream_url present (native <audio>)
//   - "Listen live ↗" link to webcast_url as fallback
//   - Recent rating changes from the call-recap payload
//   - Full Transcript collapsible (lazy — fetches only when expanded)
//
// All data fetched by the parent via useCallRecap / useEarningsAudio hooks
// and passed as props so the component is purely presentational + testable.
import { useState, useRef, useEffect, useCallback } from 'react'
import useTranscript from '../../hooks/useTranscript'
import UIcon from '../ui/UIcon'
import styles from './CallRecapSection.module.css'

// ── TTS helper ────────────────────────────────────────────────────────────────

const hasSpeechSynthesis = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window

function buildTTSText(recap) {
  if (!recap) return ''
  const parts = []
  if (recap.headline) parts.push(recap.headline)
  if (recap.sentiment) parts.push(`Sentiment: ${recap.sentiment}.`)
  if (recap.guidance) parts.push(`Guidance: ${recap.guidance}`)
  if (recap.bullets?.length) parts.push(recap.bullets.join('. '))
  if (recap.qa_highlights?.length) parts.push('Q&A highlights: ' + recap.qa_highlights.join('. '))
  return parts.join(' ')
}

// ── Keyword highlight helper ───────────────────────────────────────────────────

function highlight(text, kw) {
  if (!text || !kw || !kw.trim()) return text
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(re)
  return parts.map((p, i) =>
    re.test(p) ? <mark key={i} className={styles.kw}>{p}</mark> : p,
  )
}

// ── RatingChanges sub-component ───────────────────────────────────────────────

function RatingChanges({ changes }) {
  if (!changes?.length) return null
  return (
    <div className={styles.ratingsBlock}>
      <div className={styles.sectionLabel}>RATING CHANGES</div>
      <div className={styles.ratingsList}>
        {changes.map((rc, i) => (
          <div key={i} className={styles.ratingRow}>
            <span className={styles.ratingFirm}>{rc.firm}</span>
            <span className={
              rc.action === 'upgrade' ? styles.ratingUp :
              rc.action === 'downgrade' ? styles.ratingDn :
              styles.ratingNeutral
            }>
              {rc.action === 'upgrade' ? '▲' : rc.action === 'downgrade' ? '▼' : '→'}
            </span>
            {rc.from_rating && rc.to_rating ? (
              <span className={styles.ratingDetail}>
                {rc.from_rating} → {rc.to_rating}
              </span>
            ) : rc.to_rating ? (
              <span className={styles.ratingDetail}>{rc.to_rating}</span>
            ) : null}
            {rc.price_target && (
              <span className={styles.ratingPt}>PT ${rc.price_target}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

/**
 * CallRecapSection
 *
 * @param {object} recap   — from useCallRecap().data
 * @param {object|null} audio — from useEarningsAudio().data ({ stream_url, kind, transcript_url })
 * @param {string|null} ticker — symbol, used for lazy full-transcript fetch
 */
export default function CallRecapSection({ recap, audio, ticker = null }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [ttsActive, setTtsActive] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [transcriptTtsActive, setTranscriptTtsActive] = useState(false)
  const utteranceRef = useRef(null)
  const transcriptUtteranceRef = useRef(null)
  const audioRef = useRef(null)

  // Lazy transcript fetch — only fires when the panel is expanded
  const { data: transcript, isLoading: transcriptLoading } = useTranscript(ticker, {
    enabled: transcriptOpen,
  })

  // Stop TTS on unmount
  useEffect(() => {
    return () => {
      if (hasSpeechSynthesis()) window.speechSynthesis.cancel()
    }
  }, [])

  // Stop transcript TTS when panel collapses
  useEffect(() => {
    if (!transcriptOpen && transcriptTtsActive) {
      if (hasSpeechSynthesis()) window.speechSynthesis.cancel()
      setTranscriptTtsActive(false)
    }
  }, [transcriptOpen, transcriptTtsActive])

  const handleTTSToggle = useCallback(() => {
    if (!hasSpeechSynthesis()) return
    if (ttsActive) {
      window.speechSynthesis.cancel()
      setTtsActive(false)
      return
    }
    const text = buildTTSText(recap)
    if (!text) return
    const utter = new window.SpeechSynthesisUtterance(text)
    utter.onend = () => setTtsActive(false)
    utter.onerror = () => setTtsActive(false)
    utteranceRef.current = utter
    window.speechSynthesis.speak(utter)
    setTtsActive(true)
  }, [recap, ttsActive])

  // Build TTS text from verbatim transcript segments
  const handleTranscriptTTSToggle = useCallback(() => {
    if (!hasSpeechSynthesis()) return
    if (transcriptTtsActive) {
      window.speechSynthesis.cancel()
      setTranscriptTtsActive(false)
      return
    }
    if (!transcript?.segments?.length) return
    const text = transcript.segments.map(s => {
      const who = s.speaker || s.title || ''
      return who ? `${who}: ${s.content}` : s.content
    }).join('. ')
    if (!text.trim()) return
    const utter = new window.SpeechSynthesisUtterance(text)
    utter.onend  = () => setTranscriptTtsActive(false)
    utter.onerror = () => setTranscriptTtsActive(false)
    transcriptUtteranceRef.current = utter
    window.speechSynthesis.speak(utter)
    setTranscriptTtsActive(true)
  }, [transcript, transcriptTtsActive])

  if (!recap) return null

  const kw = searchQuery.trim()

  // Filter bullets if keyword active
  const filteredBullets = kw
    ? (recap.bullets || []).filter(b => b.toLowerCase().includes(kw.toLowerCase()))
    : (recap.bullets || [])

  const filteredQuotes = kw
    ? (recap.quotes || []).filter(q => (q.text || q).toLowerCase().includes(kw.toLowerCase()))
    : (recap.quotes || [])

  const filteredQA = kw
    ? (recap.qa_highlights || []).filter(q => q.toLowerCase().includes(kw.toLowerCase()))
    : (recap.qa_highlights || [])

  const showAudioPlayer = audio?.stream_url
  const showWebcastLink = !showAudioPlayer && recap.webcast_url

  return (
    <div className={styles.section}>
      {/* Header row: label + Listen TTS + keyword search */}
      <div className={styles.headerRow}>
        <span className={styles.sectionLabel}>EARNINGS CALL RECAP</span>
        {hasSpeechSynthesis() && (
          <button
            type="button"
            className={`${styles.listenBtn} ${ttsActive ? styles.listenBtnActive : ''}`}
            onClick={handleTTSToggle}
            title={ttsActive ? 'Stop' : 'Read recap aloud'}
          >
            {ttsActive ? <><UIcon name="pause" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Stop</> : <><UIcon name="volume" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Listen</>}
          </button>
        )}
      </div>

      {/* Keyword search */}
      <div className={styles.searchRow}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search in recap…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          aria-label="Search recap"
        />
        {kw && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
          >×</button>
        )}
      </div>

      {/* Headline */}
      {recap.headline && (
        <p className={styles.headline}>{highlight(recap.headline, kw)}</p>
      )}

      {/* Sentiment badge */}
      {recap.sentiment && (
        <span className={
          recap.sentiment === 'bullish' ? styles.sentBull :
          recap.sentiment === 'bearish' ? styles.sentBear :
          styles.sentNeutral
        }>
          {recap.sentiment.toUpperCase()}
        </span>
      )}

      {/* Bullets */}
      {filteredBullets.length > 0 && (
        <>
          <div className={styles.sectionLabel} style={{ marginTop: 8 }}>KEY POINTS</div>
          <ul className={styles.bullets}>
            {filteredBullets.map((b, i) => <li key={i}>{highlight(b, kw)}</li>)}
          </ul>
        </>
      )}

      {/* Guidance */}
      {recap.guidance && (!kw || recap.guidance.toLowerCase().includes(kw.toLowerCase())) && (
        <div className={styles.guidanceBlock}>
          <div className={styles.sectionLabel}>GUIDANCE</div>
          <p className={styles.guidanceText}>{highlight(recap.guidance, kw)}</p>
        </div>
      )}

      {/* Quotes */}
      {filteredQuotes.length > 0 && (
        <div className={styles.quotesBlock}>
          <div className={styles.sectionLabel}>MANAGEMENT QUOTES</div>
          {filteredQuotes.map((q, i) => {
            const text = typeof q === 'string' ? q : q.text
            const speaker = typeof q === 'object' ? q.speaker : null
            return (
              <div key={i} className={styles.quoteItem}>
                {speaker && <span className={styles.speaker}>{speaker}: </span>}
                <span className={styles.quoteText}>"{highlight(text, kw)}"</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Q&A highlights */}
      {filteredQA.length > 0 && (
        <div className={styles.qaBlock}>
          <div className={styles.sectionLabel}>Q&amp;A HIGHLIGHTS</div>
          <ul className={styles.bullets}>
            {filteredQA.map((q, i) => <li key={i}>{highlight(q, kw)}</li>)}
          </ul>
        </div>
      )}

      {/* Rating changes */}
      {recap.rating_changes?.length > 0 && (
        <RatingChanges changes={recap.rating_changes} />
      )}

      {/* Audio player or webcast link */}
      {showAudioPlayer && (
        <div className={styles.audioBlock}>
          <div className={styles.sectionLabel}>
            {audio.kind === 'live' ? <><UIcon name="sparkle" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />LISTEN LIVE</> : <><UIcon name="play" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />REPLAY</>}
          </div>
          {/* Native <audio> — works for MP3/AAC/WAV/OGG natively.
              For .m3u8 HLS: Safari plays natively; Chrome/Firefox degrade to a
              "not supported" message (acceptable — hls.js not added to avoid bloat). */}
          <audio
            ref={audioRef}
            className={styles.audioPlayer}
            controls
            src={audio.stream_url}
            preload="none"
          >
            <p className={styles.audioFallback}>
              Your browser does not support inline audio.{' '}
              {recap.webcast_url && (
                <a href={recap.webcast_url} target="_blank" rel="noopener noreferrer">
                  Listen on webcast ↗
                </a>
              )}
            </p>
          </audio>
          {audio.transcript_url && (
            <a
              href={audio.transcript_url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.transcriptLink}
            >
              View transcript ↗
            </a>
          )}
        </div>
      )}

      {showWebcastLink && (
        <a
          href={recap.webcast_url}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.webcástLink}
        >
          Listen live ↗
        </a>
      )}

      {/* Full Transcript (lazy — only fetches when expanded; preserves AV quota) */}
      {ticker && (
        <div className={styles.transcriptBlock}>
          <button
            type="button"
            className={styles.transcriptToggleBtn}
            onClick={() => setTranscriptOpen(o => !o)}
            aria-expanded={transcriptOpen}
          >
            <span className={styles.transcriptChevron}>{transcriptOpen ? '▾' : '▸'}</span>
            <span className={styles.sectionLabel}>FULL TRANSCRIPT</span>
          </button>

          {transcriptOpen && (
            <div className={styles.transcriptPanel}>
              {transcriptLoading && !transcript && (
                <p className={styles.transcriptLoading}>Loading transcript…</p>
              )}

              {!transcriptLoading && transcript === null && (
                <p className={styles.transcriptUnavailable}>Transcript not available.</p>
              )}

              {transcript?.segments?.length > 0 && (
                <>
                  {/* Header row: quarter label + Listen TTS */}
                  <div className={styles.transcriptHeader}>
                    {transcript.quarter && (
                      <span className={styles.transcriptQuarter}>{transcript.quarter}</span>
                    )}
                    {hasSpeechSynthesis() && (
                      <button
                        type="button"
                        className={`${styles.listenBtn} ${transcriptTtsActive ? styles.listenBtnActive : ''}`}
                        onClick={handleTranscriptTTSToggle}
                        title={transcriptTtsActive ? 'Stop reading' : 'Listen to call'}
                      >
                        {transcriptTtsActive ? <><UIcon name="pause" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Stop</> : <><UIcon name="volume" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Listen to call</>}
                      </button>
                    )}
                  </div>

                  {/* Transcript segments with keyword search highlight */}
                  <div className={styles.transcriptSegments}>
                    {transcript.segments.map((seg, i) => (
                      <div key={i} className={styles.transcriptSegment}>
                        {(seg.speaker || seg.title) && (
                          <div className={styles.transcriptSpeaker}>
                            {seg.speaker && <span className={styles.speakerName}>{seg.speaker}</span>}
                            {seg.title && (
                              <span className={styles.speakerTitle}>{seg.title}</span>
                            )}
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
                          {highlight(seg.content, kw)}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
