/**
 * EndCard — the end of a set, in the WORKBENCH look (owner, 2026-11-04: "it looks nothing like the work we did in the
 * local host"): the start-card frame, the mark, the ring filling to n/10 over 400 ms (CSS, reduced motion respected)
 * beside the medal, "8 of 10" as the hero word, the gems (XP and up to two bonus rows), the week's seven dots, a badge
 * if earned, confetti and an opening chest on a perfect set, one gold "Done", a quiet "Keep practising".
 *
 *   <EndCard correct={8} total={10} xp={40} bonuses={[{label, xp}]} weekDots={[true,...]}
 *            badge={{name, line}} onDone={fn} onKeepPractising={fn} />
 */
import { useEffect, useRef, useState } from 'react'
import { useCountUp } from '../../lab/fx'
import UIcon from '../../components/ui/UIcon'
import StudyMark from '../../components/study/StudyMark'
import StartCard, { StartButton } from '../../lab/StartCard'
import { Chest, Confetti, Medal } from '../../lab/bits'
import d5 from '../../lab/duo.module.css'
import { endFeedback, feedbackPrefs } from './studyFeedback'
import styles from './EndCard.module.css'

export const RING_SIZE = 128
export const RING_STROKE = 8
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export default function EndCard({ correct = 0, total = 10, xp = 0, bonuses = [], weekDots = [], badge = null, profile, onDone, onKeepPractising, fire = true }) {
  const r = (RING_SIZE - RING_STROKE) / 2
  const circumference = 2 * Math.PI * r
  const fraction = total > 0 ? Math.max(0, Math.min(1, correct / total)) : 0
  const perfect = total > 0 && correct === total
  const [filled, setFilled] = useState(false)
  // the numbers count up where motion is welcome; a reduced-motion reader (and jsdom) gets the final numbers at once
  const animate = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  const countedCorrect = useCountUp(correct, animate, 90)
  const countedXp = useCountUp(Math.round(xp), animate, 24)
  const shownCorrect = animate ? countedCorrect : correct
  const shownXp = animate ? countedXp : Math.round(xp)
  const big = total > 0 && correct >= Math.ceil(total * 0.8)
  const [open, setOpen] = useState(false)
  const fired = useRef(false)

  useEffect(() => {
    const t = requestAnimationFrame(() => setFilled(true))
    return () => cancelAnimationFrame(t)
  }, [])
  useEffect(() => {
    if (!perfect) return undefined
    const t = setTimeout(() => setOpen(true), 900)
    return () => clearTimeout(t)
  }, [perfect])
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
      {big && <Confetti n={perfect ? 110 : 60} />}
      <StartCard
        eyebrow={perfect ? 'Set finished · perfect' : 'Set finished'}
        art={(
          <div className={styles.artRow}>
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
              <div className={styles.ringMark}><StudyMark mood={perfect ? 'fire' : 'happy'} size={76} /></div>
            </div>
            {perfect ? <div className={d5.winRow}><Medal size={96} won label="★" /><Chest size={88} open={open} /></div> : null}
          </div>
        )}
        title={null}
        button={<StartButton icon="play" label="Done" sub={perfect ? 'ten for ten' : 'back to your trail'} onClick={onDone} hotkey={false} ariaLabel="Done" />}
        below={onKeepPractising ? <button type="button" className={d5.linkBtn} onClick={onKeepPractising}>Keep practising</button> : null}
      >
        <p className={`${d5.heroWord} ${styles.score}`} data-testid="end-score" data-final={`${correct} of ${total}`}>{shownCorrect} of {total}</p>
        <div className={d5.gems}>
          <div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} /></span><small>XP</small><b className={styles.xpMain} data-final={`+${Math.round(xp)}`}>+{shownXp}</b></div></div>
          {rows.map((b, i) => (
            <div className={`${d5.gem} ${i === 0 ? d5.ember : ''}`} key={i}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="bolt" size={20} /></span><small>{b.label}</small><b>+{Math.round(b.xp)}</b></div></div>
          ))}
        </div>
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
      </StartCard>
    </section>
  )
}
