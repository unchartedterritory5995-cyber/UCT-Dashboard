import TickerPopup from '../../components/TickerPopup'
import PatternFeedbackChip from '../../components/PatternFeedbackChip'
import styles from './PatternResultCard.module.css'

const fmtPrice = (v) => (typeof v === 'number' && Number.isFinite(v)) ? `$${v.toFixed(2)}` : '—'
const fmtRR = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v.toFixed(1) : '—'

function timeSince(unixSec) {
  if (!unixSec) return ''
  const now = Math.floor(Date.now() / 1000)
  const delta = Math.max(0, now - unixSec)
  if (delta < 60) return `${delta}s ago`
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
  return `${Math.floor(delta / 86400)}d ago`
}

/**
 * Card wrapper used as the TickerPopup trigger element. Clicking it opens
 * the popup (TickerPopup manages its own open state internally).
 */
// CAN SLIM grade -> color (O'Neil's 7-pillar composite)
const CAN_SLIM_COLORS = {
  A: '#10b981', // emerald — institutional-grade leader
  B: '#34d399', // light green — mostly confirmed
  C: '#c9a84c', // gold — mixed
  D: '#ef4444', // red — failing
}

function CardTrigger({ detection, onClick, className: _ignoredClass, children: _ignoredChildren, ...rest }) {
  const d = detection
  const dirColor =
    d.direction === 'bullish' ? '#10b981' :
    d.direction === 'bearish' ? '#ef4444' :
    '#c9a84c'

  const conf = Math.max(0, Math.min(100, Number(d.confidence) || 0))
  const ringDeg = (conf / 100) * 360
  const ringStyle = {
    background: `conic-gradient(${dirColor} ${ringDeg}deg, rgba(255,255,255,0.06) ${ringDeg}deg)`,
  }

  const dirBadgeLabel =
    d.direction === 'bullish' ? 'BULLISH' :
    d.direction === 'bearish' ? 'BEARISH' :
    'NEUTRAL'

  const levels = d.levels || {}
  const entry = levels.entry
  const stop = levels.stop
  const target = levels.target_primary != null ? levels.target_primary : levels.target
  const rr = levels.risk_reward

  const canSlimGrade = d.can_slim_grade
  const canSlimScore = d.can_slim_score
  const canSlimColor = canSlimGrade ? (CAN_SLIM_COLORS[canSlimGrade] || '#c9a84c') : null
  const canSlimTitle = canSlimGrade
    ? `CAN SLIM Grade ${canSlimGrade}${typeof canSlimScore === 'number' ? ` (${canSlimScore.toFixed(0)}/100)` : ''} — O'Neil 7-pillar composite`
    : null

  const fromLeaderUniverse = !!d.from_leader_universe

  return (
    <div
      className={styles.card}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.(e)
        }
      }}
      {...rest}
    >
      <div className={styles.cardHeader}>
        <div className={styles.symBlock}>
          <div className={styles.sym}>{d.sym}</div>
          <div className={styles.tfBadge}>{d.tf}</div>
        </div>
        <div className={styles.confidenceRing} style={ringStyle}>
          <div className={styles.confidenceInner}>{Math.round(conf)}</div>
        </div>
      </div>

      <div className={styles.patternRow}>
        <div className={styles.patternName} style={{ color: dirColor }}>{d.pattern_name}</div>
        <div className={styles.patternBadges}>
          {fromLeaderUniverse && (
            <div
              className={styles.leaderBadge}
              title="From curated leader universe (liquid thematic leader)"
            >
              LEADER
            </div>
          )}
          {canSlimGrade && (
            <div
              className={styles.canSlimBadge}
              style={{ color: canSlimColor, borderColor: canSlimColor }}
              title={canSlimTitle}
            >
              CAN SLIM {canSlimGrade}
            </div>
          )}
          <div className={styles.dirBadge} style={{ color: dirColor, borderColor: dirColor }}>
            {dirBadgeLabel}
          </div>
        </div>
      </div>

      <div className={styles.headline}>
        {d.narrative?.headline || '—'}
      </div>

      <div className={styles.levels}>
        <div className={styles.levelBlock}>
          <span className={styles.levelLabel}>Entry</span>
          <strong>{fmtPrice(entry)}</strong>
        </div>
        <div className={styles.levelBlock}>
          <span className={styles.levelLabel}>Stop</span>
          <strong style={{ color: '#ef4444' }}>{fmtPrice(stop)}</strong>
        </div>
        <div className={styles.levelBlock}>
          <span className={styles.levelLabel}>Target</span>
          <strong style={{ color: '#10b981' }}>{fmtPrice(target)}</strong>
        </div>
        <div className={styles.levelBlock}>
          <span className={styles.levelLabel}>R:R</span>
          <strong style={{ color: '#c9a84c' }}>{fmtRR(rr)}</strong>
        </div>
      </div>

      <div className={styles.cardFooter}>
        <span className={styles.status}>{d.status}</span>
        <span className={styles.timeAgo}>{timeSince(d.detected_at)}</span>
      </div>
      <div className={styles.feedbackRow}>
        <PatternFeedbackChip ticker={d.sym} tf={d.tf}
          setup={d.pattern_id} source="pattern-scan" compact />
      </div>
    </div>
  )
}

export default function PatternResultCard({ detection }) {
  // Render TickerPopup with our custom card as its trigger element.
  // TickerPopup forwards `onClick` to the rendered trigger via its `as` prop,
  // and manages modal open/close state internally.
  return (
    <TickerPopup
      sym={detection.sym}
      as={(props) => <CardTrigger detection={detection} {...props} />}
    />
  )
}
