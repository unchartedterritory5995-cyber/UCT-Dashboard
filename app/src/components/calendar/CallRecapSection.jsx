// app/src/components/calendar/CallRecapSection.jsx
// Renders the earnings call recap:
//   - Headline, sentiment label, bullets, quotes, guidance, Q&A highlights
//   - 🔊 Listen button (TTS via browser speechSynthesis)
//   - Keyword search that filters/highlights within the recap
//   - Audio player when audio.stream_url present (native <audio>)
//   - "Listen live ↗" link to webcast_url as fallback
//   - Recent rating changes from the call-recap payload
//
// The verbatim transcript is NOT here: it is an independent source and must
// stay reachable when this recap does not exist. See TranscriptPanel.jsx.
//
// All data fetched by the parent via useCallRecap / useEarningsAudio hooks
// and passed as props so the component is purely presentational + testable.
import { useState, useRef, useEffect, useCallback } from 'react'
import UIcon from '../ui/UIcon'
import { normalizeCallRecap, guidanceKind } from '../research/callRecap'
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
 */
export default function CallRecapSection({ recap: rawRecap, audio }) {
  // Every surface routes through the one normalizer, so a payload handed in
  // raw (MyStocksHub, CallsTab, EarningsModal) reconciles here rather than
  // rendering a different shape on each screen.
  const recap = normalizeCallRecap(rawRecap) || rawRecap
  const [searchQuery, setSearchQuery] = useState('')
  const [ttsActive, setTtsActive] = useState(false)
  const utteranceRef = useRef(null)
  const audioRef = useRef(null)

  // Stop TTS on unmount
  useEffect(() => {
    return () => {
      if (hasSpeechSynthesis()) window.speechSynthesis.cancel()
    }
  }, [])

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

  if (!recap) return null

  const kw = searchQuery.trim()

  // Filter bullets if keyword active
  const filteredBullets = kw
    ? (recap.bullets || []).filter(b => b.toLowerCase().includes(kw.toLowerCase()))
    : (recap.bullets || [])

  const filteredQuotes = kw
    ? (recap.quotes || []).filter(q =>
        `${q.text} ${q.speaker} ${q.topic}`.toLowerCase().includes(kw.toLowerCase()))
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
          recap.sentiment === 'positive' ? styles.sentBull :
          recap.sentiment === 'negative' ? styles.sentBear :
          styles.sentNeutral
        }>
          {recap.sentiment.toUpperCase()}
        </span>
      )}

      {/* Guidance chip — the field already rides the recap payload (zero new
          spend). Guidance moves stocks as much as the print and appears in no
          retail calendar. */}
      {guidanceKind(recap.guidance) === 'enum' && (
        <span
          className={
            recap.guidance === 'raised' ? styles.guideUp :
            recap.guidance === 'cut' ? styles.guideDn :
            styles.guideFlat
          }
          title="Management's forward guidance vs. prior"
        >
          GUIDANCE {recap.guidance === 'raised' ? 'RAISED' : recap.guidance === 'cut' ? 'LOWERED' : 'MAINTAINED'}
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

      {/* Guidance PROSE only — the enum form is the chip above, and rendering
          both printed the same word twice, the second time as a one-word
          paragraph under a "GUIDANCE" heading. */}
      {guidanceKind(recap.guidance) === 'prose' &&
       (!kw || recap.guidance.toLowerCase().includes(kw.toLowerCase())) && (
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
            const attribution = [q.speaker, q.role].filter(Boolean).join(', ')
            return (
              <div key={i} className={styles.quoteItem}>
                {attribution && <span className={styles.speaker}>{attribution}: </span>}
                {!attribution && q.topic && (
                  <span className={styles.speaker}>{q.topic}: </span>
                )}
                <span className={styles.quoteText}>"{highlight(q.text, kw)}"</span>
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

    </div>
  )
}
