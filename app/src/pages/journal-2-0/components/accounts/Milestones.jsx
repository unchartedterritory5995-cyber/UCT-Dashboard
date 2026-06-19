/**
 * Milestones — return-percentage badges. Derived from current vs
 * starting balance; no storage. The badge for the next-unhit milestone
 * shows progress; hit milestones are gold; future milestones are dim.
 */

import UIcon from '../../../../components/ui/UIcon'
import styles from './Milestones.module.css'

const TIERS = [1, 5, 10, 25, 50, 100]

export default function Milestones({ totalReturn = 0 }) {
  const pct = totalReturn * 100  // totalReturn is decimal (0.0824 = 8.24%)
  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <span className={styles.dot}><UIcon name="star-fill" size={14} /></span>
        <h3 className={styles.title}>Milestones</h3>
        <span className={styles.current}>
          Current: <strong>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</strong>
        </span>
      </div>
      <ul className={styles.list}>
        {TIERS.map((tier, i) => {
          const hit = pct >= tier
          const nextUnhit = !hit && (i === 0 || pct >= TIERS[i - 1])
          let progress = null
          if (nextUnhit) {
            const prevTier = i === 0 ? 0 : TIERS[i - 1]
            progress = Math.max(0, Math.min(1, (pct - prevTier) / (tier - prevTier)))
          }
          return (
            <li
              key={tier}
              className={`${styles.tier} ${hit ? styles.tierHit : ''} ${nextUnhit ? styles.tierActive : ''}`}
            >
              <span className={styles.badge}>
                {hit ? <UIcon name="check" size={13} /> : `${tier}%`}
              </span>
              <span className={styles.tierLabel}>
                {tier}% return
              </span>
              {nextUnhit && progress != null && (
                <div className={styles.tierBar}>
                  <div className={styles.tierBarFill} style={{ width: `${progress * 100}%` }} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
