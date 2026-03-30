// app/src/components/tiles/EarningsModal.jsx
import { useEffect, useState } from 'react'
import TickerPopup from '../TickerPopup'
import styles from './EarningsModal.module.css'

function fmtEps(v) {
  if (v == null) return '—'
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toFixed(2)}`
}

function fmtRev(m) {
  if (m == null) return '—'
  return m >= 1000 ? `$${(m / 1000).toFixed(2)}B` : `$${Math.round(m)}M`
}

export default function EarningsModal({ row, label, onClose }) {
  const [gap, setGap]                       = useState(null)
  const [aiState, setAiState]               = useState({ loading: true, data: null })
  const [transcriptState, setTranscriptState] = useState({ loading: false, data: null })
  const [transcriptOpen, setTranscriptOpen] = useState(false)

  // Live gap %
  useEffect(() => {
    if (!row) return
    setGap(null)
    fetch(`/api/snapshot/${row.sym}`)
      .then(r => r.json())
      .then(d => { if (d.change_pct != null) setGap(d.change_pct) })
      .catch(() => {})
  }, [row?.sym])

  // AI analysis + related news
  useEffect(() => {
    if (!row) return
    setAiState({ loading: true, data: null })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    fetch(`/api/earnings-analysis/${row.sym}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => setAiState({ loading: false, data: d }))
      .catch(err => {
        if (err.name !== 'AbortError') {
          setAiState({ loading: false, data: null })
        }
      })
      .finally(() => clearTimeout(timer))
    return () => { controller.abort(); clearTimeout(timer) }
  }, [row?.sym])

  // Transcript (only for reported entries)
  const verdict = row?.verdict?.toLowerCase()
  const isPending = verdict === 'pending'
  useEffect(() => {
    if (!row || isPending) return
    setTranscriptState({ loading: true, data: null })
    setTranscriptOpen(false)
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
  }, [row?.sym, isPending])

  // Escape key
  useEffect(() => {
    const handleKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  if (!row) return null

  const isBeat = verdict === 'beat'
  const isMixed = verdict === 'mixed'
  const verdictLabel = isBeat ? '✓ Beat' : isMixed ? '~ Mixed' : '✗ Miss'
  const summaryText = row.reported_eps != null && row.eps_estimate != null
    ? `${verdictLabel} — EPS ${fmtEps(row.reported_eps)} vs ${fmtEps(row.eps_estimate)} est (${row.surprise_pct} surprise)`
    : null

  const hasAiContent = aiState.data?.analysis || aiState.data?.analysis_bullets?.length || aiState.data?.news?.length
  const transcript = transcriptState.data

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="earnings-modal-title">

        <div className={styles.header}>
          <span className={styles.sym} id="earnings-modal-title">{row.sym}</span>
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
            {summaryText}
          </div>
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
          ) : aiState.data && !aiState.data.preview_text ? (
            <div className={styles.previewUnavailable}>Preview unavailable</div>
          ) : null
        )}

        {/* ── Trend block ──────────────────────────────────────────────── */}
        {(aiState.data?.yoy_eps_growth || aiState.data?.beat_streak) && (
          <div className={styles.trend}>
            {aiState.data.yoy_eps_growth && (
              <span className={aiState.data.yoy_eps_growth.startsWith('+') ? styles.pos : styles.neg}>
                YoY EPS {aiState.data.yoy_eps_growth}
              </span>
            )}
            {aiState.data.beat_history?.length > 0 && (
              <span className={styles.beatHistory}>
                {aiState.data.beat_history.map((s, i) => (
                  <span key={i} className={s === '✓' ? styles.pos : s === '✗' ? styles.neg : styles.muted}>
                    {s}
                  </span>
                ))}
                <span className={styles.muted}>{aiState.data.beat_streak}</span>
              </span>
            )}
          </div>
        )}

        {/* ── Gap % ────────────────────────────────────────────────────── */}
        {gap != null && (
          <div className={`${styles.gap} ${gap >= 0 ? styles.pos : styles.neg}`}>
            {gap >= 0 ? '↑' : '↓'} Gap {gap >= 0 ? '+' : ''}{gap.toFixed(2)}%
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

        <div className={styles.actions}>
          <TickerPopup sym={row.sym} as="button" className={styles.btnChart}>
            View Chart
          </TickerPopup>
          <a
            href={`https://finviz.com/quote.ashx?t=${row.sym}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.btnFinviz}
          >
            FinViz
          </a>
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
