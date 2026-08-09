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
import grounded from './GroundedBlocks.module.css'
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

const HORIZON_LABEL = {
  next_quarter: 'NEXT QUARTER',
  full_year: 'FULL YEAR',
  multi_year: 'MULTI-YEAR',
}

// The Quartr move: every claim links back to the passage it came from. It is
// also the trust mechanism — a reader can check the words in one click, and a
// claim with no locatable source never renders a link because it never renders.
function SourceLink({ segment, onJump }) {
  if (segment == null || !onJump) return null
  return (
    <button
      type="button"
      className={grounded.sourceLink}
      onClick={() => onJump(segment)}
      title="Show this passage in the full transcript"
    >
      ↳ in transcript
    </button>
  )
}

// ── RatingChanges sub-component ───────────────────────────────────────────────

// `get_rating_changes` returns a MONTHLY BUCKET SNAPSHOT series —
// {period, strong_buy, buy, hold, sell, strong_sell, net, net_delta} — and has
// always said so. This rendered `rc.firm` / `rc.action` / `rc.to_rating`, a
// per-firm upgrade-downgrade feed that producer never emits, so every field
// came back undefined and the panel drew four bare "→" arrows against real
// data. Read the shape that is actually sent.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function periodLabel(period) {
  // "2026-08-01" / "2026-08" → "Aug 2026". Parsed by hand rather than via Date
  // so a bare "YYYY-MM" cannot land in the previous month in a west-of-UTC
  // timezone.
  const m = /^(\d{4})-(\d{2})/.exec(String(period || ''))
  if (!m) return period || ''
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${month} ${m[1]}` : m[1]
}

function RatingChanges({ changes }) {
  if (!changes?.length) return null
  return (
    <div className={styles.ratingsBlock}>
      <div className={styles.sectionLabel}>ANALYST RATING TREND</div>
      <div className={styles.ratingsList}>
        {changes.map((rc, i) => {
          // null delta = no prior month to compare, which is not "unchanged".
          const delta = typeof rc.net_delta === 'number' ? rc.net_delta : null
          const bullish = (rc.strong_buy || 0) + (rc.buy || 0)
          const bearish = (rc.sell || 0) + (rc.strong_sell || 0)
          return (
            <div key={rc.period || i} className={styles.ratingRow}>
              <span className={styles.ratingFirm}>{periodLabel(rc.period)}</span>
              <span className={
                delta > 0 ? styles.ratingUp :
                delta < 0 ? styles.ratingDn :
                styles.ratingNeutral
              }>
                {delta > 0 ? '▲' : delta < 0 ? '▼' : '→'}
              </span>
              <span className={styles.ratingDetail}>
                {bullish} buy · {rc.hold || 0} hold{bearish ? ` · ${bearish} sell` : ''}
              </span>
              {delta !== null && delta !== 0 && (
                <span className={styles.ratingPt}>
                  {delta > 0 ? `+${delta}` : delta} net
                </span>
              )}
            </div>
          )
        })}
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
export default function CallRecapSection({ recap: rawRecap, audio, onJumpToSegment = null }) {
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

  const matches = (...parts) =>
    parts.filter(Boolean).join(' ').toLowerCase().includes(kw.toLowerCase())

  const filteredQA = kw
    ? (recap.qa_highlights || []).filter(q =>
        matches(q.takeaway, q.question, q.quote, q.analyst, q.firm))
    : (recap.qa_highlights || [])

  const filteredForward = kw
    ? (recap.forward_looking || []).filter(f =>
        matches(f.topic, f.detail, f.quote, f.speaker))
    : (recap.forward_looking || [])

  // The server returns a {name: role} map read off the transcript itself, which
  // is what finally fills the speaker-title slot — FMP's segmenter hardcodes
  // `title: ""`, so that chip had never rendered on the primary path.
  const roleOf = q => q.role || (recap.speakers || {})[q.speaker] || ''

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

      {/* Forward-looking commentary — the section a trader reads first.
          Every item rests on a verbatim quote the SERVER located in the
          transcript; anything it could not locate was dropped before this
          component ever saw it, so each `↳` below is a real turn. */}
      {filteredForward.length > 0 && (
        <div className={grounded.block}>
          <div className={styles.sectionLabel}>FORWARD-LOOKING COMMENTARY</div>
          {filteredForward.map((f, i) => (
            <div key={i} className={grounded.item}>
              <div className={grounded.itemHead}>
                {f.topic && <span className={grounded.topic}>{highlight(f.topic, kw)}</span>}
                {f.horizon && f.horizon !== 'unspecified' && (
                  <span className={grounded.horizon}>{HORIZON_LABEL[f.horizon] || f.horizon}</span>
                )}
              </div>
              {f.detail && <p className={grounded.detail}>{highlight(f.detail, kw)}</p>}
              <blockquote className={grounded.quote}>
                “{highlight(f.quote, kw)}”
                <cite className={grounded.cite}>
                  {f.speaker}
                  <SourceLink segment={f.segment} onJump={onJumpToSegment} />
                </cite>
              </blockquote>
            </div>
          ))}
        </div>
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
      {recap.guidance_detail && (!kw || recap.guidance_detail.toLowerCase().includes(kw.toLowerCase())) && (
        <p className={grounded.guidanceDetail}>{highlight(recap.guidance_detail, kw)}</p>
      )}

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
            const attribution = [q.speaker, roleOf(q)].filter(Boolean).join(', ')
            return (
              <div key={i} className={styles.quoteItem}>
                {q.topic && <span className={grounded.topic}>{highlight(q.topic, kw)}</span>}
                <span className={styles.quoteText}>“{highlight(q.text, kw)}”</span>
                <cite className={grounded.cite}>
                  {attribution}
                  <SourceLink segment={q.segment} onJump={onJumpToSegment} />
                </cite>
              </div>
            )
          })}
        </div>
      )}

      {/* Q&A highlights */}
      {filteredQA.length > 0 && (
        <div className={styles.qaBlock}>
          <div className={styles.sectionLabel}>Q&amp;A HIGHLIGHTS</div>
          {filteredQA.map((q, i) => (
            <div key={i} className={grounded.item}>
              {(q.analyst || q.firm) && (
                <div className={grounded.itemHead}>
                  <span className={grounded.topic}>
                    {highlight([q.analyst, q.firm].filter(Boolean).join(' · '), kw)}
                  </span>
                </div>
              )}
              {q.question && <p className={grounded.question}>{highlight(q.question, kw)}</p>}
              {q.takeaway && <p className={grounded.detail}>{highlight(q.takeaway, kw)}</p>}
              {q.quote && (
                <blockquote className={grounded.quote}>
                  “{highlight(q.quote, kw)}”
                  <cite className={grounded.cite}>
                    {q.speaker}
                    <SourceLink segment={q.segment} onJump={onJumpToSegment} />
                  </cite>
                </blockquote>
              )}
            </div>
          ))}
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
