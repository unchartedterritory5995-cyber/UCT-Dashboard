// app/src/pages/journal/components/ReviewProgress.jsx
import styles from './ReviewProgress.module.css'

const STEPS = [
  {
    key: 'core',
    label: 'Core Fields',
    check: (t) => !!(t.sym && t.entry_price != null),
  },
  {
    key: 'thesis',
    label: 'Thesis',
    check: (t) => !!(t.thesis && t.thesis.trim()),
  },
  {
    key: 'process',
    label: 'Process Score',
    check: (t) => t.process_score != null,
  },
  {
    key: 'screenshots',
    label: 'Screenshots',
    check: (t) => t._has_screenshots === true, // injected by parent if available
  },
  {
    key: 'notes',
    label: 'Notes',
    check: (t) => !!((t.notes && t.notes.trim()) || (t.lesson && t.lesson.trim())),
  },
  {
    key: 'mistakes',
    label: 'Mistakes',
    check: (t) => t.mistake_tags != null, // even empty string means reviewed
  },
]

export default function ReviewProgress({ trade }) {
  if (!trade) return null

  const completedCount = STEPS.filter(s => s.check(trade)).length
  const total = STEPS.length

  return (
    <div className={styles.strip}>
      <div className={styles.header}>
        <span className={styles.count}>{completedCount}/{total}</span>
      </div>
      <div className={styles.steps}>
        {STEPS.map(step => {
          const done = step.check(trade)
          return (
            <div key={step.key} className={styles.step} title={step.label}>
              <div className={`${styles.dot} ${done ? styles.dotDone : styles.dotPending}`} />
              <span className={`${styles.stepLabel} ${done ? styles.stepLabelDone : ''}`}>
                {step.label.charAt(0)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
