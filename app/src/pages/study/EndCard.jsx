/**
 * EndCard — the end of a set (spec §13.7 D12, D14, D17). A ring filling to n/10
 * over 400 ms (CSS, reduced motion respected) · "8 of 10" · XP with up to two
 * bonus rows · the week's seven dots · a badge if earned (36px gold circle) ·
 * one gold "Done" · a ghost "Keep practising". Nothing more.
 *
 *   <EndCard correct={8} total={10} xp={40} bonuses={[{label, xp}]} weekDots={[true,...]}
 *            badge={{name, line}} onDone={fn} onKeepPractising={fn} />
 */
import { useEffect, useRef, useState } from 'react'
import UIcon from '../../components/ui/UIcon'
import { endFeedback, feedbackPrefs } from './studyFeedback'
import styles from './EndCard.module.css'

export const RING_SIZE = 96
export const RING_STROKE = 6
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export default function EndCard({ correct = 0, total = 10, xp = 0, bonuses = [], weekDots = [], badge = null, profile, onDone, onKeepPractising, fire = true }) {
  const r = (RING_SIZE - RING_STROKE) / 2
  const circumference = 2 * Math.PI * r
  const fraction = total > 0 ? Math.max(0, Math.min(1, correct / total)) : 0
  const [filled, setFilled] = useState(false)
  const fired = useRef(false)

  useEffect(() => {
    const t = requestAnimationFrame(() => setFilled(true))
    return () => cancelAnimationFrame(t)
  }, [])
  useEffect(() => {
    if (!fire || fired.current) return
    fired.current = true
    endFeedback(feedbackPrefs(profile))
  }, [fire, profile])

  const offset = circumference * (1 - (filled ? fraction : 0))
  const rows = (bonuses || []).filter((b) => b && b.xp).slice(0, 2)
  const dots = Array.from({ length: 7 }, (_, i) => !!weekDots[i])

  return (
    <section className={styles.card} data-testid="end-card" aria-label="Set finished">
      <div className={styles.ringWrap}>
        <svg className={styles.ring} width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
          <circle className={styles.ringTrack} cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={r} strokeWidth={RING_STROKE} fill="none" />
          <circle
            className={styles.ringFill}
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={r}
            strokeWidth={RING_STROKE}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            data-testid="end-ring-fill"
          />
        </svg>
        <p className={styles.score} data-testid="end-score">{correct} of {total}</p>
      </div>

      <dl className={styles.xp}>
        <div className={styles.xpRow}>
          <dt>XP</dt>
          <dd className={styles.xpMain}>+{Math.round(xp)}</dd>
        </div>
        {rows.map((b, i) => (
          <div className={styles.xpRow} key={i}>
            <dt>{b.label}</dt>
            <dd>+{Math.round(b.xp)}</dd>
          </div>
        ))}
      </dl>

      <ol className={styles.week} aria-label="This week">
        {dots.map((on, i) => (
          <li key={i} className={`${styles.day} ${on ? styles.dayOn : ''}`} aria-label={`${DAYS[i]}${on ? ', done' : ''}`}>
            <span className={styles.dayDot} aria-hidden="true" />
            <span className={styles.dayLetter} aria-hidden="true">{DAYS[i]}</span>
          </li>
        ))}
      </ol>

      {badge && (
        <div className={styles.badge} data-testid="end-badge">
          <span className={styles.badgeCircle} aria-hidden="true">
            <UIcon name={badge.icon || 'star'} size={18} />
          </span>
          <span className={styles.badgeText}>
            <span className={styles.badgeName}>{badge.name}</span>
            {badge.line && <span className={styles.badgeLine}>{badge.line}</span>}
          </span>
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.done} onClick={onDone}>Done</button>
        {onKeepPractising && (
          <button type="button" className={styles.ghost} onClick={onKeepPractising}>Keep practising</button>
        )}
      </div>
    </section>
  )
}
