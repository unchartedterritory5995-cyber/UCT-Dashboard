import { useCallback, useEffect, useMemo, useRef } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import PullToRefresh from '../components/PullToRefresh'
import TileCard from '../components/TileCard'
import TickerPopup from '../components/TickerPopup'
import { SkeletonTileContent } from '../components/Skeleton'
import ReadAloudButton from '../components/voice/ReadAloudButton'
import MorningWireIndexes from '../components/tiles/MorningWireIndexes'
import MarketClock from '../components/tiles/MarketClock'
import CatalystTable from '../components/tiles/CatalystTable'
import useReadAloudFollow from '../hooks/useReadAloudFollow'
import useTweetFeed from '../hooks/useTweetFeed'
import { rundownToSpeechText } from '../utils/htmlToSpeech'
import { timeAgo } from '../utils/timeAgo'
import { quoteOfTheDay } from '../constants/quotes'
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

// ── Quote of the Day ──────────────────────────────────────────────────────────
// Reuses the Dashboard's shared, date-seeded quote library so both surfaces show
// the same quote on a given day.

function QuoteOfTheDay() {
  const quote = useMemo(() => quoteOfTheDay(), [])

  return (
    <div className={styles.quoteBanner}>
      <div className={styles.quoteLabel}>
        <UIcon name="sparkle" size={11} style={{ verticalAlign: '-1px', marginRight: 5 }} />Quote of the Day
      </div>
      <div className={styles.quoteText}>&#8220;{quote.t}&#8221;</div>
      <div className={styles.quoteAuthor}>— {quote.a}</div>
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

  // Morning Wire is MANUAL-only: no auto-read on page open. (The hands-free
  // hook is intentionally NOT invoked here — decoupled from proactive_speak so
  // proactive voice still works elsewhere, e.g. the EOD recap.)

  // Follow-along: highlight + scroll to the briefing block being read aloud.
  const rundownRef = useRef(null)
  useReadAloudFollow({
    containerRef: rundownRef,
    trackId: `morning-wire-${rundown?.date || 'today'}`,
  })

  // Per-segment + overall feedback: inject 👍/👎 AND a ✎ note affordance into the
  // rundown DOM (the rundown is dangerouslySetInnerHTML, so controls are injected,
  // not React). One delegated handler posts votes + notes (best-effort). Notes feed
  // the nightly wire-critic so the brief self-refines. Existing votes/notes hydrate
  // from /api/wire-feedback/mine so the UI reflects what you already left.
  useEffect(() => {
    const root = rundownRef.current
    if (!root || !rundown?.html || !rundown?.date) return
    const date = rundown.date
    const hydrated = {}  // seg -> { verdict, note }

    const ctrlHtml = (seg) =>
      '<span class="rd-fb">' +
      `<button data-fb-vote="up" data-seg="${seg}" aria-label="thumbs up">👍</button>` +
      `<button data-fb-vote="down" data-seg="${seg}" aria-label="thumbs down">👎</button>` +
      `<button class="rd-fb-note" data-fb-note="${seg}" aria-label="add a note" title="Add a note">✎</button>` +
      '</span>'

    // Controls on each segment label.
    root.querySelectorAll('section.rd-seg[data-seg] > .rd-seg-label').forEach((label) => {
      if (label.querySelector('[data-fb-vote]')) return
      const seg = label.closest('section.rd-seg')?.dataset.seg || 'overall'
      label.insertAdjacentHTML('beforeend', ctrlHtml(seg))
    })

    // Overall-brief feedback bar (once, at the end of the monologue).
    const sections = root.querySelector('.rd-sections')
    if (sections && !root.querySelector('.rd-overall-fb')) {
      const bar = document.createElement('div')
      bar.className = 'rd-overall-fb'
      bar.innerHTML = '<span class="rd-overall-fb-label">Feedback on the whole brief</span>' + ctrlHtml('overall')
      sections.appendChild(bar)
    }

    const segAnchor = (seg) => seg === 'overall'
      ? root.querySelector('.rd-overall-fb')
      : root.querySelector(`section.rd-seg[data-seg="${seg}"]`)

    const paint = () => {
      root.querySelectorAll('[data-fb-vote]').forEach((b) => {
        b.classList.toggle('rd-fb-on', hydrated[b.dataset.seg]?.verdict === b.dataset.fbVote)
      })
      root.querySelectorAll('[data-fb-note]').forEach((b) => {
        b.classList.toggle('rd-fb-note-has', !!(hydrated[b.dataset.fbNote]?.note))
      })
    }

    const togglePanel = (seg) => {
      const existing = root.querySelector(`.rd-note-panel[data-seg="${seg}"]`)
      root.querySelectorAll('.rd-note-panel').forEach((p) => p.remove())
      if (existing) return  // was open → just close
      const anchor = segAnchor(seg)
      if (!anchor) return
      const panel = document.createElement('div')
      panel.className = 'rd-note-panel'
      panel.dataset.seg = seg
      panel.innerHTML =
        '<textarea class="rd-note-input" rows="3" placeholder="What should change here? Your note refines future briefs."></textarea>' +
        '<div class="rd-note-actions"><span class="rd-note-status"></span>' +
        `<button class="rd-note-save" data-fb-note-save="${seg}">Save note</button></div>`
      anchor.insertAdjacentElement('afterend', panel)
      const ta = panel.querySelector('.rd-note-input')
      ta.value = hydrated[seg]?.note || ''
      ta.focus()
    }

    const post = (payload) => fetch('/api/wire-feedback', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_date: date, ...payload }),
    })

    const onClick = async (e) => {
      const saveBtn = e.target.closest('[data-fb-note-save]')
      if (saveBtn) {
        const seg = saveBtn.dataset.fbNoteSave
        const panel = saveBtn.closest('.rd-note-panel')
        const ta = panel?.querySelector('.rd-note-input')
        const status = panel?.querySelector('.rd-note-status')
        const note = (ta?.value || '').trim()
        if (status) status.textContent = 'Saving…'
        try {
          await post({ segment_key: seg, note })
          hydrated[seg] = { ...(hydrated[seg] || {}), note }
          if (status) status.textContent = 'Saved ✓'
          paint()
          setTimeout(() => panel?.remove(), 700)
        } catch { if (status) status.textContent = 'Save failed — try again' }
        return
      }
      const noteBtn = e.target.closest('[data-fb-note]')
      if (noteBtn) { togglePanel(noteBtn.dataset.fbNote); return }
      const vote = e.target.closest('[data-fb-vote]')
      if (vote) {
        const seg = vote.dataset.seg || vote.closest('section.rd-seg')?.dataset.seg || 'overall'
        hydrated[seg] = { ...(hydrated[seg] || {}), verdict: vote.dataset.fbVote }
        paint()
        try { await post({ segment_key: seg, verdict: vote.dataset.fbVote }) } catch { /* best-effort */ }
      }
    }
    root.addEventListener('click', onClick)

    let cancelled = false
    fetch(`/api/wire-feedback/mine?date=${encodeURIComponent(date)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.feedback) { Object.assign(hydrated, d.feedback); paint() } })
      .catch(() => {})

    return () => { cancelled = true; root.removeEventListener('click', onClick) }
  }, [rundown?.html, rundown?.date])

  const handleRefresh = useCallback(() => Promise.all([
    mutate('/api/rundown'),
    mutate('/api/tweets/feed?hours=12&limit=50'),
  ]), [mutate])

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className={styles.pageWrap}>
    <div className={styles.page}>

      {/* ── Intro stack: header · index strip · quote ────────────── */}
      <div className={styles.topStack}>

      {/* ── Page header — centered title, date beneath ───────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.titleRow}>
          <span className={styles.wireName}>The Morning Wire</span>
        </div>
        {rundown?.date && <span className={styles.wireDate}>{rundown.date}</span>}
      </div>

      {/* ── Quote of the Day ─────────────────────────────────────── */}
      <QuoteOfTheDay />

      </div>{/* /topStack */}

      {/* ── Top-left corner: ambient market clock ────────────────── */}
      <div className={styles.tlCorner}>
        <MarketClock />
      </div>

      {/* ── Top-right corner: SPY QQQ DIA · IWM BTC VIX (3×2 grid) ── */}
      <div className={styles.trCorner}>
        <MorningWireIndexes grid />
      </div>

      {/* ── Main reading column: the rundown + disclaimer ────────── */}
      <div className={styles.mainStack}>

      {/* ── The Rundown (Read aloud sits by the "UPDATED …" line) ── */}
      <TileCard>
        <div className={styles.rundownArea}>
          <div className={styles.rundownReadAloud}>
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
              size="sm"
            >
              Read aloud
            </ReadAloudButton>
          </div>
          {rundown?.html
            ? (
              <div
                ref={rundownRef}
                className={styles.rundownWrap}
                dangerouslySetInnerHTML={{ __html: rundown.html }}
              />
            )
            : <SkeletonTileContent lines={12} />
          }
        </div>
      </TileCard>

      {/* ── Legal disclaimer ─────────────────────────────────────── */}
      <p style={{
        margin: '18px 4px 4px', fontSize: 11, lineHeight: 1.5,
        color: 'var(--color-text-muted, #8a8a8a)', textAlign: 'center',
      }}>
        For educational and informational purposes only — not investment advice or a
        recommendation to buy or sell any security. Levels, picks, and commentary reflect the
        firm&apos;s method, not personalized advice. Trading involves substantial risk of loss;
        you are solely responsible for your own decisions.
      </p>

      </div>{/* /mainStack */}

      {/* ── Stock Catalysts — left rail on desktop ───────────────── */}
      <aside className={styles.lrail}>
        <CatalystTable compact datePicker title="PRE MARKET MOVERS" />
      </aside>

      {/* ── On The Tape (live tweet feed) — right rail on desktop ── */}
      {TWITTER_UI_ENABLED && (
        <aside className={styles.rail}>
          <OnTheTape />
        </aside>
      )}

    </div>
    </div>
    </PullToRefresh>
  )
}
