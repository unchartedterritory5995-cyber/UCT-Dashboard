import styles from './ResearchPage.module.css'

// Phase 1: structure only. Real values arrive in Phase 4 (UCT Ratings).
const COMPONENTS = [
  { key: 'composite', label: 'UCT Composite', hero: true },
  { key: 'eps', label: 'EPS' },
  { key: 'rs', label: 'Rel Strength' },
  { key: 'growth', label: 'Growth' },
  { key: 'value', label: 'Value' },
  { key: 'smr', label: 'SMR' },
  { key: 'accdis', label: 'Acc / Dis' },
  { key: 'sponsorship', label: 'Sponsorship' },
]

export default function RatingBadges({ ratings = null }) {
  return (
    <div className={styles.ratings} aria-label="UCT Ratings">
      {COMPONENTS.map(c => {
        const val = ratings?.[c.key]
        return (
          <div key={c.key} className={`${styles.rb} ${c.hero ? styles.rbHero : ''}`}>
            <div className={styles.rbLbl}>{c.label}</div>
            <div className={styles.rbVal}>{val ?? '—'}</div>
          </div>
        )
      })}
    </div>
  )
}
