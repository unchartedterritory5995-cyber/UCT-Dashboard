// app/src/components/chart/PatternSidePanel.jsx — slide-in panel for clicked pattern detection.
//
// Phase 5 Task 3: detail surface that opens when the user clicks a shape rendered by
// PatternOverlay. Pulls structured fields off the Detection dict returned by
// GET /api/patterns/{sym}:
//
//   detection.pattern_name, .direction, .confidence       → header
//   detection.levels { entry, stop, target_primary, risk_reward }  → summary strip
//   detection.context { trend_stage, ma_alignment, rs_trend, regime, dcr_signature,
//                       recent_dcr_avg, nearest_resistance, nearest_support,
//                       days_to_earnings }                → context section
//   detection.narrative { what_it_is, why_it_matters,
//                         what_to_watch_for, failure_signal }      → narrative subsections
//   detection.quality_components { geometry_score, volume_score,
//                                  context_score, historical_score }  → quality bars
//
// Feedback POSTs to /api/patterns/{detection_id}/feedback with `credentials: 'include'`.
// Historical Stats section is a placeholder until Phase 7 outcome tracker lands.
//
// Closes via ESC, backdrop click, or the X button. Slides from right at 420px desktop /
// full-width <640px.

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import UIcon from '../ui/UIcon'
import styles from './PatternSidePanel.module.css'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtPrice(v) {
  if (v == null || isNaN(v)) return '—'
  const n = Number(v)
  return `$${n.toFixed(n >= 100 ? 2 : n >= 1 ? 2 : 4)}`
}

function fmtRatio(v) {
  if (v == null || isNaN(v)) return '—'
  return `${Number(v).toFixed(2)}R`
}

function fmtPct(v) {
  if (v == null || isNaN(v)) return '—'
  return `${Number(v).toFixed(1)}%`
}

function humanize(value) {
  if (value == null || value === '') return '—'
  if (typeof value === 'number') return String(value)
  return String(value).replace(/_/g, ' ')
}

function dirClass(direction) {
  const d = (direction || '').toLowerCase()
  if (d === 'bullish' || d === 'long' || d === 'up') return styles.dirBullish
  if (d === 'bearish' || d === 'short' || d === 'down') return styles.dirBearish
  return styles.dirNeutral
}

const TREND_STAGE_LABELS = {
  1: '1 — Basing',
  2: '2 — Markup',
  3: '3 — Topping',
  4: '4 — Markdown',
}

// ─── Collapsible row primitive ───────────────────────────────────────────────

function Subsection({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={styles.subsection}>
      <button type="button" className={styles.subsectionHeader} onClick={() => setOpen(o => !o)}>
        <span>{title}</span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}>▶</span>
      </button>
      {open && <div className={styles.subsectionBody}>{children}</div>}
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function PatternSidePanel({ detection, onClose }) {
  const { user } = useAuth()
  const [rating, setRating] = useState(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState(null) // 'success' | 'error' | null
  const [contextOpen, setContextOpen] = useState(true)

  // Reset local state on detection change.
  useEffect(() => {
    setRating(null)
    setNote('')
    setSubmitStatus(null)
  }, [detection?.id])

  // ESC closes panel.
  useEffect(() => {
    if (!detection) return
    const handler = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [detection, onClose])

  const submitFeedback = useCallback(async () => {
    if (!rating || !detection?.pattern_id) return
    setSubmitting(true)
    setSubmitStatus(null)
    try {
      // Route chart feedback into the vision learning loop (source="chart").
      const res = await fetch('/api/patterns/feedback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: detection.sym,
          tf: detection.tf || 'D',
          setup: detection.pattern_id,
          rating,
          note: note.trim() || null,
          source: 'chart',
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSubmitStatus('success')
    } catch (err) {
      console.warn('Pattern feedback submit failed:', err)
      setSubmitStatus('error')
    } finally {
      setSubmitting(false)
    }
  }, [detection?.pattern_id, detection?.sym, detection?.tf, rating, note])

  if (!detection) return null

  const {
    pattern_name,
    direction,
    confidence,
    levels = {},
    context = {},
    narrative = {},
    quality_components = {},
  } = detection

  const confidencePct = Math.max(0, Math.min(100, Number(confidence) || 0))

  const entry = levels.entry
  const stop = levels.stop
  const target = levels.target_primary ?? levels.target
  const rr = levels.risk_reward

  // Quality components — explicit ordering with defaults at 0.
  const qualityRows = [
    { key: 'geometry_score',   label: 'Geometry' },
    { key: 'volume_score',     label: 'Volume' },
    { key: 'context_score',    label: 'Context' },
    { key: 'historical_score', label: 'Historical' },
  ]

  const ratingChoices = [
    { value: 'great', label: 'Great', emoji: 'thumbsUp' },
    { value: 'good',  label: 'Good',  emoji: 'check' },
    { value: 'miss',  label: 'Miss',  emoji: 'x' },
    { value: 'wrong', label: 'Wrong', emoji: 'warning' },
  ]

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside
        className={styles.panel}
        role="dialog"
        aria-labelledby="pattern-side-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <header className={styles.header}>
          <div className={styles.headerTopRow}>
            <h3 id="pattern-side-panel-title" className={styles.patternName}>
              {pattern_name || 'Pattern'}
            </h3>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="Close pattern panel"
              title="Close (Esc)"
            >
              ×
            </button>
          </div>
          <div className={styles.metaRow}>
            <span className={`${styles.dirPill} ${dirClass(direction)}`}>
              {direction || 'neutral'}
            </span>
            <div className={styles.confidenceWrap}>
              <span className={styles.confidenceLabel}>Conf</span>
              <div className={styles.confidenceBarTrack}>
                <div className={styles.confidenceBarFill} style={{ width: `${confidencePct}%` }} />
              </div>
              <span className={styles.confidenceValue}>{confidencePct.toFixed(0)}</span>
            </div>
          </div>
        </header>

        {/* ── Summary strip ── */}
        <div className={styles.summaryStrip}>
          <div className={styles.summaryCell}>
            <span className={styles.summaryLabel}>Entry</span>
            <span className={styles.summaryValue}>{fmtPrice(entry)}</span>
          </div>
          <div className={styles.summaryCell}>
            <span className={styles.summaryLabel}>Stop</span>
            <span className={`${styles.summaryValue} ${styles.summaryValueRed}`}>{fmtPrice(stop)}</span>
          </div>
          <div className={styles.summaryCell}>
            <span className={styles.summaryLabel}>Target</span>
            <span className={`${styles.summaryValue} ${styles.summaryValueGreen}`}>{fmtPrice(target)}</span>
          </div>
          <div className={styles.summaryCell}>
            <span className={styles.summaryLabel}>R:R</span>
            <span className={`${styles.summaryValue} ${styles.summaryValueGold}`}>{fmtRatio(rr)}</span>
          </div>
        </div>

        {/* ── Body ── */}
        <div className={styles.body}>
          {/* Context */}
          <section className={styles.section}>
            <button
              type="button"
              className={styles.sectionHeader}
              onClick={() => setContextOpen(o => !o)}
            >
              <span>Context</span>
              <span className={`${styles.chevron} ${contextOpen ? styles.chevronOpen : ''}`}>▶</span>
            </button>
            {contextOpen && (
              <div className={styles.sectionBody}>
                <div className={styles.contextGrid}>
                  <div className={styles.contextRow}>
                    <span className={styles.contextLabel}>Trend stage</span>
                    <span className={styles.contextValue}>
                      {TREND_STAGE_LABELS[context.trend_stage] ?? humanize(context.trend_stage)}
                    </span>
                  </div>
                  <div className={styles.contextRow}>
                    <span className={styles.contextLabel}>MA alignment</span>
                    <span className={styles.contextValue}>{humanize(context.ma_alignment)}</span>
                  </div>
                  <div className={styles.contextRow}>
                    <span className={styles.contextLabel}>RS trend</span>
                    <span className={styles.contextValue}>{humanize(context.rs_trend)}</span>
                  </div>
                  <div className={styles.contextRow}>
                    <span className={styles.contextLabel}>Regime</span>
                    <span className={styles.contextValue}>{humanize(context.regime)}</span>
                  </div>
                  <div className={styles.contextRow}>
                    <span className={styles.contextLabel}>DCR signature</span>
                    <span className={styles.contextValue}>
                      {humanize(context.dcr_signature)}
                      {context.recent_dcr_avg != null && (
                        <span style={{ color: '#8c8675', marginLeft: 4 }}>
                          ({Number(context.recent_dcr_avg).toFixed(2)})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className={styles.contextRow}>
                    <span className={styles.contextLabel}>Nearest resistance</span>
                    <span className={styles.contextValue}>{fmtPrice(context.nearest_resistance)}</span>
                  </div>
                  <div className={styles.contextRow}>
                    <span className={styles.contextLabel}>Nearest support</span>
                    <span className={styles.contextValue}>{fmtPrice(context.nearest_support)}</span>
                  </div>
                  {context.days_to_earnings != null && (
                    <div className={styles.contextRow}>
                      <span className={styles.contextLabel}>Days to earnings</span>
                      <span className={styles.contextValue}>{context.days_to_earnings}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Narrative */}
          <section className={styles.section}>
            <div className={styles.sectionBody} style={{ padding: '8px 12px 12px' }}>
              <Subsection title="What It Is" defaultOpen>
                {narrative.what_it_is || <span style={{ color: '#8c8675' }}>No description available.</span>}
              </Subsection>
              <Subsection title="Why It Matters">
                {narrative.why_it_matters || <span style={{ color: '#8c8675' }}>—</span>}
              </Subsection>
              <Subsection title="What to Watch For" defaultOpen>
                {narrative.what_to_watch_for || <span style={{ color: '#8c8675' }}>—</span>}
              </Subsection>
              <Subsection title="Failure Signal">
                {narrative.failure_signal || <span style={{ color: '#8c8675' }}>—</span>}
              </Subsection>
            </div>
          </section>

          {/* Quality Components */}
          <section className={styles.section}>
            <div className={styles.sectionHeader} style={{ cursor: 'default' }}>
              <span>Quality Components</span>
            </div>
            <div className={styles.sectionBody}>
              <div className={styles.qualityBars}>
                {qualityRows.map(({ key, label }) => {
                  const raw = Number(quality_components?.[key] ?? 0)
                  const pct = Math.max(0, Math.min(100, raw))
                  return (
                    <div key={key} className={styles.qualityRow}>
                      <span className={styles.qualityLabel}>{label}</span>
                      <div className={styles.qualityTrack}>
                        <div className={styles.qualityFill} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={styles.qualityValue}>{pct.toFixed(0)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          {/* Historical Stats */}
          <section className={styles.section}>
            <div className={styles.sectionHeader} style={{ cursor: 'default' }}>
              <span>Historical Stats</span>
            </div>
            <div className={styles.sectionBody}>
              <div className={styles.placeholder}>
                Pattern stats available after Phase 7 launch — outcome tracker pending.
              </div>
            </div>
          </section>
        </div>

        {/* ── Feedback footer ── */}
        <footer className={styles.footer}>
          <p className={styles.feedbackTitle}>Was this detection useful?</p>
          <div className={styles.feedbackRow}>
            {ratingChoices.map(({ value, label, emoji }) => (
              <button
                key={value}
                type="button"
                className={`${styles.feedbackBtn} ${rating === value ? styles.feedbackActive : ''}`}
                onClick={() => setRating(value)}
                title={label}
              >
                <span className={styles.feedbackEmoji}><UIcon name={emoji} size={16} /></span>
                <span>{label}</span>
              </button>
            ))}
          </div>
          <textarea
            className={styles.noteInput}
            placeholder="Optional note (what worked, what didn't)…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={submitFeedback}
            disabled={!rating || submitting}
          >
            {submitting ? 'Submitting…' : 'Submit Feedback'}
          </button>
          {submitStatus === 'success' && (
            <div className={`${styles.submitMsg} ${styles.submitMsgSuccess}`}>Thanks — feedback recorded.</div>
          )}
          {submitStatus === 'error' && (
            <div className={`${styles.submitMsg} ${styles.submitMsgError}`}>Submit failed — try again.</div>
          )}
        </footer>
      </aside>
    </>
  )
}
