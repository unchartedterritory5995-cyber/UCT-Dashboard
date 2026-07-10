// app/src/components/tiles/EarningsModal.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import TickerPopup from '../TickerPopup'
import ReadAloudButton from '../voice/ReadAloudButton'
import useTickerTweets from '../../hooks/useTickerTweets'
import { timeAgo } from '../../utils/timeAgo'
import FundamentalsStrip from '../calendar/FundamentalsStrip'
import CallRecapSection from '../calendar/CallRecapSection'
import AnalystPanel from '../fundamentals/AnalystPanel'
import OwnershipPanel from '../fundamentals/OwnershipPanel'
import SentimentGauge from '../calendar/SentimentGauge'
import useFilings from '../../hooks/useFilings'
import useCallRecap from '../../hooks/useCallRecap'
import useEarningsAudio from '../../hooks/useEarningsAudio'
import CompanyLogo from '../CompanyLogo'
import UIcon from '../ui/UIcon'
import styles from './EarningsModal.module.css'

const TWEETS_UI_ENABLED = (import.meta.env.VITE_TWITTER_UI_ENABLED ?? '1') !== '0'

function renderTweetText(text) {
  if (!text) return null
  const parts = text.split(/(\$[A-Z]{1,5}\b)/g)
  return parts.map((p, i) =>
    /^\$[A-Z]{1,5}$/.test(p)
      ? <span key={i} className={styles.tweetCashtag}>{p}</span>
      : <span key={i}>{p}</span>,
  )
}

function TweetsBlock({ sym }) {
  const { data: tweets } = useTickerTweets(sym, { hours: 24, enabled: TWEETS_UI_ENABLED })
  const [collapsed, setCollapsed] = useState(false)

  if (!TWEETS_UI_ENABLED) return null
  if (!tweets || tweets.length === 0) return null

  // Default expanded if ≤5 tweets, collapsed otherwise (user can toggle)
  const startsExpanded = tweets.length <= 5
  const isOpen = startsExpanded ? !collapsed : collapsed

  return (
    <div className={styles.tweetsBlock}>
      <button
        className={styles.tweetsHeader}
        onClick={() => setCollapsed(c => !c)}
        type="button"
      >
        <span><UIcon name="chat" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Recent tweets ({tweets.length})</span>
        <span>{isOpen ? '▾' : '▸'}</span>
      </button>
      {isOpen && (
        <div className={styles.tweetsList}>
          {tweets.map(t => (
            <div key={t.id} className={styles.tweetCard}>
              <div className={styles.tweetMeta}>
                <span className={styles.tweetAuthor}>@{t.author_handle}</span>
                <span className={styles.tweetTime}>{timeAgo(t.created_at)}</span>
                <a className={styles.tweetLink} href={t.url} target="_blank" rel="noreferrer" title="open on X">↗</a>
              </div>
              <div
                className={styles.tweetText}
                style={t.is_retweet ? { fontSize: '90%', opacity: 0.75 } : undefined}
              >
                {t.is_retweet ? 'RT: ' : ''}{renderTweetText(t.text)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function fmtEps(v) {
  if (v == null) return '—'
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toFixed(2)}`
}

function fmtRev(m) {
  if (m == null) return '—'
  return m >= 1000 ? `$${(m / 1000).toFixed(2)}B` : `$${Math.round(m)}M`
}

// Plain-language SEC form labels — bare form numbers are jargon dead-ends.
const FILING_LABELS = {
  '4':       'Insider trade (Form 4)',
  '3':       'Insider ownership (Form 3)',
  '5':       'Insider annual (Form 5)',
  '8-K':     'Current report (8-K)',
  '10-Q':    'Quarterly report (10-Q)',
  '10-K':    'Annual report (10-K)',
  '144':     'Insider sale notice (144)',
  'DEF 14A': 'Proxy statement (DEF 14A)',
  'S-8':     'Employee stock plan (S-8)',
  'SC 13G':  'Passive stake (13G)',
  'SC 13D':  'Activist stake (13D)',
  '13F-HR':  'Fund holdings (13F)',
}

function filingLabel(form) {
  const f = (form || '').trim()
  return FILING_LABELS[f] || FILING_LABELS[f.replace('/A', '')] || `Form ${f}`
}

// Dedupe identical filings + collapse same-form-same-day runs (nine identical
// "4" rows carried zero information) → one row with a ×N count, capped at 5.
function groupFilings(filings) {
  const seen = new Set()
  const groups = new Map()   // `${form}|${filed}` → {form, filed, url, count}
  for (const f of filings || []) {
    const uniq = f.url || `${f.form}|${f.filed}|${f.title || ''}`
    if (seen.has(uniq)) continue   // exact duplicate row
    seen.add(uniq)
    const key = `${f.form}|${f.filed}`
    const g = groups.get(key)
    if (g) g.count += 1
    else groups.set(key, { form: f.form, filed: f.filed, url: f.url, count: 1 })
  }
  return [...groups.values()].slice(0, 5)
}

export default function EarningsModal({ row, label, reportDate = null, timing = null, onClose }) {
  const navigate = useNavigate()
  const { isPaid } = useAuth()
  const [gap, setGap]                       = useState(null)
  const [aiState, setAiState]               = useState({ loading: true, data: null })
  const [transcriptState, setTranscriptState] = useState({ loading: false, data: null })
  const [transcriptOpen, setTranscriptOpen] = useState(false)

  // C1: Fundamentals strip — fetched by FundamentalsStrip itself (null-safe, lazy)
  // C2: SEC Filings (deduped + grouped + capped at 5)
  const { data: filingsData } = useFilings(row?.sym)
  const groupedFilings = groupFilings(filingsData?.filings)
  // C5: Call recap + audio
  const { data: recapData } = useCallRecap(row?.sym)
  const { data: audioData } = useEarningsAudio(row?.sym)

  // Lock body scroll while the modal is open (also hides the floating
  // orb/feedback FABs so they don't cover the bottom "View Chart" CTA).
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Live gap % (analyst consensus/PT now rendered by <AnalystPanel>)
  useEffect(() => {
    if (!row) return
    setGap(null)
    fetch(`/api/snapshot/${row.sym}`)
      .then(r => r.json())
      .then(d => { if (d.change_pct != null) setGap(d.change_pct) })
      .catch(() => {})
  }, [row?.sym])

  // Reset transcript panel state when the row changes
  useEffect(() => {
    if (!row) return
    setTranscriptState({ loading: false, data: null })
    setTranscriptOpen(false)
  }, [row?.sym])

  // AI analysis + related news
  useEffect(() => {
    if (!row) return
    setAiState({ loading: true, data: null })
    const controller = new AbortController()
    // Bumped 20s → 30s: the AI call can take 12-18s for cold cache, and the
    // previous timeout was aborting just-barely-too-late requests.
    const timer = setTimeout(() => controller.abort(), 30_000)
    fetch(`/api/earnings-analysis/${row.sym}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => setAiState({ loading: false, data: d }))
      .catch(() => {
        // Always clear loading on error (including AbortError) so the spinner
        // never persists indefinitely. Previously the AbortError branch left
        // loading=true, which is what produced the "Generating preview…" hang.
        setAiState({ loading: false, data: null })
      })
      .finally(() => clearTimeout(timer))
    return () => { controller.abort(); clearTimeout(timer) }
  }, [row?.sym])

  // Transcript (only for reported entries, only when panel is expanded)
  // Gate on transcriptOpen so we don't fire eagerly on modal open — the
  // transcript section is collapsed by default and the fetch is expensive.
  const verdict = row?.verdict?.toLowerCase()
  const isPending = verdict === 'pending'
  useEffect(() => {
    if (!row || isPending || !transcriptOpen) return
    setTranscriptState({ loading: true, data: null })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25_000)
    fetch(`/api/transcripts/${row.sym}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => setTranscriptState({ loading: false, data: d }))
      .catch(err => {
        if (err.name !== 'AbortError') {
          setTranscriptState({ loading: false, data: null })
        }
      })
      .finally(() => clearTimeout(timer))
    return () => { controller.abort(); clearTimeout(timer) }
  }, [row?.sym, isPending, transcriptOpen])

  // Escape key
  useEffect(() => {
    const handleKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  if (!row) return null

  const isBeat = verdict === 'beat'
  const isMixed = verdict === 'mixed'
  const verdictIcon = isBeat ? 'check' : isMixed ? null : 'x'
  const verdictWord = isBeat ? 'Beat' : isMixed ? '~ Mixed' : 'Miss'
  const summaryText = row.reported_eps != null && row.eps_estimate != null
    ? `EPS ${fmtEps(row.reported_eps)} vs ${fmtEps(row.eps_estimate)} est (${row.surprise_pct} surprise)`
    : null

  const hasAiContent = aiState.data?.analysis || aiState.data?.analysis_bullets?.length || aiState.data?.news?.length
  const transcript = transcriptState.data

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="earnings-modal-title">

        <div className={styles.header}>
          <CompanyLogo sym={row.sym} size={38} tile />
          <span className={styles.sym} id="earnings-modal-title">{row.sym}</span>
          {reportDate && (
            <a
              className={styles.addCal}
              href={`/api/calendar/report.ics?sym=${encodeURIComponent(row.sym)}&date=${reportDate}&timing=${timing || 'tbd'}`}
              title="Downloads a calendar event — opens in Google/Apple Calendar"
              onClick={e => e.stopPropagation()}
            >
              <UIcon name="calendar" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Add to calendar
            </a>
          )}
          <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.badges}>
          <span className={styles.badge}>EARNINGS REPORT</span>
          <span className={styles.badgeTime}>{label}</span>
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>METRIC</th>
              <th>EXPECTED</th>
              <th>REPORTED</th>
              <th>SURPRISE</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>EPS</td>
              <td>{fmtEps(row.eps_estimate)}</td>
              <td>{fmtEps(row.reported_eps)}</td>
              <td className={row.surprise_pct?.startsWith('+') ? styles.pos : styles.neg}>
                {row.surprise_pct ?? '—'}
              </td>
            </tr>
            <tr>
              <td>REVENUE</td>
              <td>{fmtRev(row.rev_estimate)}</td>
              <td>{fmtRev(row.rev_actual)}</td>
              <td className={row.rev_surprise_pct?.startsWith('+') ? styles.pos : styles.neg}>
                {row.rev_surprise_pct ?? '—'}
              </td>
            </tr>
          </tbody>
        </table>

        {summaryText && (
          <div className={`${styles.summary} ${isBeat ? styles.summaryBeat : isMixed ? styles.summaryMixed : styles.summaryMiss}`}>
            {verdictIcon && <UIcon name={verdictIcon} size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />}{verdictWord} — {summaryText}
          </div>
        )}

        {/* ── Earnings stats strip (implied/historical move, pre-earnings ctx, revisions) */}
        {!aiState.loading && aiState.data && (
          (aiState.data.implied_move || aiState.data.hist_moves || aiState.data.pre_earnings || aiState.data.revisions) && (
            <div className={styles.statsStrip}>
              {(aiState.data.implied_move || aiState.data.hist_moves) && (
                <div className={styles.statRow}>
                  <span className={styles.statLabel}>EXPECTED MOVE</span>
                  {aiState.data.implied_move?.pct != null && (
                    <span className={styles.statVal}>
                      Options ±{aiState.data.implied_move.pct.toFixed(1)}%
                    </span>
                  )}
                  {aiState.data.hist_moves?.avg_abs_move_pct != null && (
                    <span className={styles.muted}>
                      Hist avg ±{aiState.data.hist_moves.avg_abs_move_pct.toFixed(1)}% ({aiState.data.hist_moves.n_quarters}q)
                    </span>
                  )}
                </div>
              )}
              {aiState.data.pre_earnings?.label && (
                <div className={styles.statRow}>
                  <span className={styles.statLabel} title="Price action heading into the report">RUN-IN</span>
                  <span className={styles.statVal}>{aiState.data.pre_earnings.label}</span>
                </div>
              )}
              {aiState.data.revisions?.label && (
                <div className={styles.statRow}>
                  <span className={styles.statLabel}>REVISIONS</span>
                  <span className={
                    aiState.data.revisions.delta_90d > 0 ? styles.pos :
                    aiState.data.revisions.delta_90d < 0 ? styles.neg : styles.muted
                  }>
                    {aiState.data.revisions.arrow} {aiState.data.revisions.label}
                  </span>
                </div>
              )}
            </div>
          )
        )}

        {/* ── Pending: AI Preview ──────────────────────────────────────── */}
        {isPending && (
          aiState.loading ? (
            <div className={styles.aiLoading}>
              <span className={styles.aiSpinner} />
              Generating preview…
            </div>
          ) : aiState.data?.preview_text ? (
            <div className={styles.previewBox}>
              <span className={styles.badge}>EARNINGS PREVIEW</span>
              <p className={styles.aiText}>{aiState.data.preview_text}</p>
              {aiState.data.preview_bullets?.length > 0 && (
                <>
                  <div className={styles.watchLabel}>THINGS TO WATCH</div>
                  <ul className={styles.watchList}>
                    {aiState.data.preview_bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </>
              )}
              {aiState.data.news?.length > 0 && (
                <NewsList items={aiState.data.news} />
              )}
            </div>
          ) : null
          // No preview_text → the section doesn't render. A thin-coverage name
          // shows a short confident dossier, never a stack of apologies (the
          // loading state above already distinguishes in-flight from finished).
        )}

        {/* ── Trend block (YoY EPS + beat-magnitude bars or fallback) ───── */}
        {(aiState.data?.yoy_eps_growth || aiState.data?.beat_streak || aiState.data?.beat_surprises?.length) && (
          <div className={styles.trend}>
            {aiState.data.yoy_eps_growth && (
              <span className={aiState.data.yoy_eps_growth.startsWith('+') ? styles.pos : styles.neg}>
                YoY EPS {aiState.data.yoy_eps_growth}
              </span>
            )}
            {aiState.data.beat_surprises?.length > 0 ? (
              <span className={styles.beatBars} title="Last quarters' EPS surprise %">
                {/* Render oldest→newest so bar order matches time direction */}
                {[...aiState.data.beat_surprises].reverse().map((q, i) => {
                  const mag = Math.min(Math.abs(q.surprise_pct || 0), 30) / 30  // clip at 30%
                  const h = Math.max(4, Math.round(mag * 18))  // 4-18px tall
                  return (
                    <span
                      key={i}
                      className={q.beat ? styles.beatBarPos : styles.beatBarNeg}
                      style={{ height: `${h}px` }}
                      title={`${q.date}: ${q.surprise_pct >= 0 ? '+' : ''}${q.surprise_pct}%`}
                    />
                  )
                })}
                <span className={styles.muted}>{aiState.data.beat_streak}</span>
              </span>
            ) : aiState.data.beat_history?.length > 0 ? (
              <span className={styles.beatHistory}>
                {aiState.data.beat_history.map((s, i) => (
                  <span key={i} className={s === '✓' ? styles.pos : s === '✗' ? styles.neg : styles.muted}>
                    {s === '✓' ? <UIcon name="check" size={12} /> : s === '✗' ? <UIcon name="x" size={12} /> : s}
                  </span>
                ))}
                <span className={styles.muted}>{aiState.data.beat_streak}</span>
              </span>
            ) : null}
          </div>
        )}

        {/* ── Gap % ────────────────────────────────────────────────────── */}
        {gap != null && (
          <div className={`${styles.gap} ${gap >= 0 ? styles.pos : styles.neg}`}>
            {gap >= 0 ? '↑' : '↓'} Gap {gap >= 0 ? '+' : ''}{gap.toFixed(2)}%
          </div>
        )}

        {/* ── Analyst (consensus · price target · upgrades/downgrades) ──── */}
        <AnalystPanel sym={row.sym} />

        {/* ── Institutional ownership (13F) ────────────────────────────── */}
        <OwnershipPanel sym={row.sym} />

        {/* ── C1: Fundamentals strip ───────────────────────────────────── */}
        <FundamentalsStrip ticker={row.sym} />

        {/* ── C5: Sentiment gauge ──────────────────────────────────────── */}
        <SentimentGauge ticker={row.sym} />

        {/* ── C5: Call recap + audio (+ lazy full transcript) ─────────── */}
        {recapData && (
          <CallRecapSection recap={recapData} audio={audioData ?? null} ticker={row.sym} />
        )}

        {/* ── C2: SEC Filings section ──────────────────────────────────── */}
        {groupedFilings.length > 0 && (
          <div className={styles.filingsSection}>
            <div className={styles.watchLabel}>SEC FILINGS</div>
            <div className={styles.filingsList}>
              {groupedFilings.map((f, i) => (
                <a
                  key={i}
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.filingItem}
                >
                  <span className={styles.filingForm}>{filingLabel(f.form)}{f.count > 1 ? ` ×${f.count}` : ''}</span>
                  <span className={styles.filingDate}>{f.filed}</span>
                  <span className={styles.filingArrow}>↗</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ── C6: Historical reaction stats in modal ───────────────────── */}
        {row.hist_stats?.avg_abs_move != null && (
          <div className={styles.statsStrip}>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>HIST REACTIONS</span>
              <span className={styles.statVal}>
                avg ±{row.hist_stats.avg_abs_move.toFixed(1)}%
                {row.hist_stats.total != null && (
                  <span className={styles.muted}>
                    {/* last_n is an ARRAY of moves — its length is the count */}
                    {' '}over {Array.isArray(row.hist_stats.last_n)
                      ? (row.hist_stats.last_n.length || row.hist_stats.total)
                      : (row.hist_stats.last_n ?? row.hist_stats.total)}
                  </span>
                )}
                {row.hist_stats.up_count != null && row.hist_stats.total != null && (
                  <span className={styles.muted}>
                    {' '}· up {row.hist_stats.up_count}/{row.hist_stats.total}
                  </span>
                )}
              </span>
            </div>
            {/* Post-print playbook — the swing-trader's "do I chase the gap?"
                read, derived from the reaction distribution already on the
                wire (biggest up + down move over the sampled prints). */}
            {Array.isArray(row.hist_stats.last_n) && row.hist_stats.last_n.length > 1 && (() => {
              const moves = row.hist_stats.last_n.filter(v => v != null && Number.isFinite(v))
              if (moves.length < 2) return null
              const up = Math.max(...moves)
              const dn = Math.min(...moves)
              return (
                <div className={styles.statRow}>
                  <span className={styles.statLabel}>PLAYBOOK</span>
                  <span className={styles.statVal}>
                    biggest {up >= 0 ? '+' : ''}{up.toFixed(1)}% · {dn >= 0 ? '+' : ''}{dn.toFixed(1)}%
                    <span className={styles.muted}> over last {moves.length} prints</span>
                  </span>
                </div>
              )
            })()}
          </div>
        )}

        {/* ── Reported: AI Analysis (structured bullets) ───────────────── */}
        {!isPending && (
          aiState.loading ? (
            <div className={styles.aiLoading}>
              <span className={styles.aiSpinner} />
              Analyzing earnings…
            </div>
          ) : hasAiContent ? (
            <div className={styles.analysisBox}>
              {/* New structured bullets format */}
              {aiState.data.analysis_bullets?.length > 0 ? (
                <>
                  {aiState.data.analysis_headline && (
                    <p className={styles.analysisHeadline}>{aiState.data.analysis_headline}</p>
                  )}
                  {aiState.data.analysis_summary && (
                    <p className={styles.aiText}>{aiState.data.analysis_summary}</p>
                  )}
                  <div className={styles.watchLabel}>KEY TAKEAWAYS</div>
                  <ul className={styles.watchList}>
                    {aiState.data.analysis_bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </>
              ) : aiState.data.analysis ? (
                /* Fallback: old paragraph format (cached data during transition) */
                <p className={styles.aiText}>{aiState.data.analysis}</p>
              ) : null}
              {aiState.data.news?.length > 0 && (
                <NewsList items={aiState.data.news} />
              )}
            </div>
          ) : null
        )}

        {/* ── Recent tweets section (spec 2026-05-25) ─────────────────── */}
        <TweetsBlock sym={row.sym} />

        {/* ── Transcript section (reported only, collapsible) ──────────── */}
        {!isPending && transcript?.available && (
          <div className={styles.transcriptSection}>
            <button
              className={styles.transcriptToggle}
              onClick={() => setTranscriptOpen(o => !o)}
            >
              <span className={styles.transcriptLabel}>
                <span className={styles.transcriptChevron}>{transcriptOpen ? '▾' : '▸'}</span>
                EARNINGS CALL TRANSCRIPT
              </span>
              <span className={styles.transcriptMeta}>
                {transcript.quarter && transcript.year && (
                  <span className={styles.transcriptQuarter}>Q{transcript.quarter} {transcript.year}</span>
                )}
                <span className={
                  transcript.sentiment === 'bullish' ? styles.sentimentBull :
                  transcript.sentiment === 'bearish' ? styles.sentimentBear :
                  styles.sentimentNeutral
                }>
                  {transcript.sentiment?.toUpperCase()}
                </span>
              </span>
            </button>
            {transcriptOpen && (
              <div className={styles.transcriptBody}>
                {transcript.headline && (
                  <p className={styles.analysisHeadline}>{transcript.headline}</p>
                )}
                {(transcript.headline || transcript.bullets?.length > 0) && (
                  <ReadAloudButton
                    trackId={`transcript-${row.sym}`}
                    label={`${row.sym} earnings transcript`}
                    textProvider={() => {
                      const headline = transcript.headline || ''
                      const bullets = (transcript.bullets || []).join('. ')
                      return `${headline}. ${bullets}`
                    }}
                  >
                    Read transcript
                  </ReadAloudButton>
                )}
                {transcript.bullets?.length > 0 && (
                  <ul className={styles.watchList}>
                    {transcript.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
        {!isPending && transcriptState.loading && (
          <div className={styles.transcriptLoading}>Loading transcript…</div>
        )}

        {/* ── Key quotes from prior earnings call (works pre + post) ───── */}
        {aiState.data?.key_quotes?.length > 0 && (
          <div className={styles.quotesSection}>
            <div className={styles.watchLabel}>LAST CALL — KEY QUOTES</div>
            <ul className={styles.quoteList}>
              {aiState.data.key_quotes.map((q, i) => (
                <li key={i} className={styles.quoteItem}>
                  {q.topic && <span className={styles.quoteTopic}>{q.topic}: </span>}
                  <span className={styles.quoteText}>"{q.quote}"</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={styles.actions}>
          <TickerPopup sym={row.sym} as="button" className={styles.btnChart}>
            View Chart
          </TickerPopup>
          <button
            className={styles.btnReport}
            onClick={() => { onClose?.(); navigate(`/research/${row.sym}`) }}
          >
            {isPaid ? 'Open full report →' : <><UIcon name="lock" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Unlock full research →</>}
          </button>
        </div>

      </div>
    </div>
  )
}

function NewsList({ items }) {
  return (
    <div className={styles.newsList}>
      {items.map((item, i) => (
        <a
          key={i}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.newsItem}
          aria-label={`${item.source}: ${item.headline}`}
        >
          <span className={styles.newsItemSource}>
            {item.source}{item.time ? ` · ${item.time}` : ''}
          </span>
          <span className={styles.newsItemHeadline}>{item.headline}</span>
        </a>
      ))}
    </div>
  )
}
