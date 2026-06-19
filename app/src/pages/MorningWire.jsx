import { useCallback, useRef } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import PullToRefresh from '../components/PullToRefresh'
import TileCard from '../components/TileCard'
import TickerPopup from '../components/TickerPopup'
import { SkeletonTileContent } from '../components/Skeleton'
import ReadAloudButton from '../components/voice/ReadAloudButton'
import useHandsFreeMorningWire from '../hooks/useHandsFreeMorningWire'
import useReadAloudFollow from '../hooks/useReadAloudFollow'
import useTweetFeed from '../hooks/useTweetFeed'
import { rundownToSpeechText } from '../utils/htmlToSpeech'
import { timeAgo } from '../utils/timeAgo'
import UIcon from '../components/ui/UIcon'
import styles from './MorningWire.module.css'

// Master kill-switch shared with MoversSidebar: VITE_TWITTER_UI_ENABLED="0" hides the tape.
const TWITTER_UI_ENABLED = (import.meta.env.VITE_TWITTER_UI_ENABLED ?? '1') !== '0'

const fetcher = url => fetch(url).then(r => r.json())

// Small stat pill used in the page header strip
function StatPill({ label, value, color }) {
  return (
    <div className={`${styles.statPill} ${styles[`pill_${color}`]}`}>
      <span className={styles.pillLabel}>{label}</span>
      <span className={styles.pillValue}>{value}</span>
    </div>
  )
}

// Verdict badge for earnings rows
function VerdictBadge({ verdict }) {
  if (!verdict) return null
  const isbeat = verdict.toUpperCase() === 'BEAT'
  return (
    <span className={isbeat ? styles.beat : styles.miss}>
      {verdict.toUpperCase()}
    </span>
  )
}

// One earnings row inside "By the Numbers"
function EarningsRow({ row }) {
  const sym = row.sym || row.ticker || row.symbol
  const surprise = row.surprise_pct
  const isPos = typeof surprise === 'number' ? surprise > 0
    : typeof surprise === 'string' ? surprise.startsWith('+') : false

  return (
    <div className={styles.earningsRow}>
      <TickerPopup sym={sym} className={styles.earningsTicker} />
      <VerdictBadge verdict={row.verdict} />
      <span className={`${styles.surprise} ${isPos ? styles.gainText : styles.lossText}`}>
        {surprise != null
          ? (typeof surprise === 'number'
              ? `${surprise > 0 ? '+' : ''}${surprise.toFixed(1)}%`
              : surprise)
          : '—'}
      </span>
    </div>
  )
}

// ── On The Tape (live tweet feed) ─────────────────────────────────────────────

function renderTweetText(text) {
  if (!text) return null
  // Style cashtags ($AAPL) in brand gold while keeping plain text intact.
  const parts = text.split(/(\$[A-Z]{1,5}\b)/g)
  return parts.map((p, i) =>
    /^\$[A-Z]{1,5}$/.test(p)
      ? <span key={i} className={styles.tapeCashtag}>{p}</span>
      : <span key={i}>{p}</span>,
  )
}

function OnTheTape() {
  const { data: tweets } = useTweetFeed({ hours: 12, limit: 50 })

  return (
    <div className={styles.tapeBlock}>
      <div className={styles.tapeLabel}><UIcon name="wire" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />ON THE TAPE</div>
      <div className={styles.tapeBody}>
        {tweets == null
          ? <SkeletonTileContent lines={5} />
          : tweets.length === 0
            ? <span className={styles.noData}>No tweets on the tape yet</span>
            : tweets.map((t) => (
                <div key={t.id} className={styles.tweetRow}>
                  <span className={styles.tweetHandle}>@{t.author_handle}</span>
                  <span className={styles.tweetTime}>{timeAgo(t.created_at)}</span>
                  <a
                    className={styles.tweetLink}
                    href={t.url}
                    target="_blank"
                    rel="noreferrer"
                    title="open on X"
                  >↗</a>
                  <div
                    className={styles.tweetText}
                    style={t.is_retweet ? { fontSize: '90%', opacity: 0.75 } : undefined}
                  >
                    {t.is_retweet ? 'RT: ' : ''}{renderTweetText(t.text)}
                  </div>
                </div>
              ))
        }
      </div>
    </div>
  )
}

export default function MorningWire() {
  const { mutate } = useSWRConfig()
  const { data: rundown }  = useSWR('/api/rundown', fetcher, { refreshInterval: 300000 })

  // P5-E: hands-free auto-read of today's rundown when proactive_speak is ON
  useHandsFreeMorningWire({ rundownHtml: rundown?.html })

  // Follow-along: highlight + scroll to the briefing block being read aloud.
  const rundownRef = useRef(null)
  useReadAloudFollow({
    containerRef: rundownRef,
    trackId: `morning-wire-${rundown?.date || 'today'}`,
  })

  const handleRefresh = useCallback(() => Promise.all([
    mutate('/api/rundown'),
    mutate('/api/tweets/feed?hours=12&limit=50'),
  ]), [mutate])

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className={styles.page}>

      {/* ── Page header ─────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.titleRow}>
          <span className={styles.wireName}>The Morning Wire</span>
          {rundown?.date && <span className={styles.wireDate}>{rundown.date}</span>}
          <ReadAloudButton
            trackId={`morning-wire-${rundown?.date || 'today'}`}
            label="Morning Wire"
            textProvider={async () => {
              // Prefer the server's canonical briefing text so it matches the
              // pre-warmed audio exactly (instant cache hit). Fall back to
              // client-side extraction if the endpoint is unavailable.
              try {
                const r = await fetch('/api/rundown/speech-text', { credentials: 'include' })
                if (r.ok) {
                  const d = await r.json()
                  if (d && d.text) return d.text
                }
              } catch { /* fall through */ }
              return rundownToSpeechText(rundown?.html)
            }}
            size="md"
          >
            Read aloud
          </ReadAloudButton>
        </div>
      </div>

      {/* ── The Rundown ──────────────────────────────────────────── */}
      <TileCard>
        {rundown?.html
          ? (
            <div
              ref={rundownRef}
              className={styles.rundownWrap}
              dangerouslySetInnerHTML={{ __html: rundown.html }}
            />
          )
          : <p className={styles.loading}>Loading rundown…</p>
        }
      </TileCard>

      {/* ── On The Tape (live tweet feed) ────────────────────────── */}
      {TWITTER_UI_ENABLED && <OnTheTape />}

    </div>
    </PullToRefresh>
  )
}
