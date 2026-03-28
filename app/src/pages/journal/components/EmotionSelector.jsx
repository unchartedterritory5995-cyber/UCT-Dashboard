// app/src/pages/journal/components/EmotionSelector.jsx
import { useMemo } from 'react'
import styles from './EmotionSelector.module.css'

const EMOTION_TAGS = [
  'confident', 'anxious', 'greedy', 'fearful', 'calm',
  'frustrated', 'euphoric', 'bored', 'disciplined', 'impulsive',
  'patient', 'rushed', 'focused', 'distracted', 'revenge-driven',
]

const MAX_SELECTIONS = 5

export default function EmotionSelector({ selected, onChange }) {
  const selectedSet = useMemo(() => {
    if (!selected) return new Set()
    return new Set(selected.split(',').map(s => s.trim()).filter(Boolean))
  }, [selected])

  function toggle(tag) {
    const next = new Set(selectedSet)
    if (next.has(tag)) {
      next.delete(tag)
    } else {
      if (next.size >= MAX_SELECTIONS) return // soft limit
      next.add(tag)
    }
    onChange(Array.from(next).join(','))
  }

  const atLimit = selectedSet.size >= MAX_SELECTIONS

  return (
    <div className={styles.wrap}>
      <div className={styles.pills}>
        {EMOTION_TAGS.map(tag => {
          const isSelected = selectedSet.has(tag)
          const isDisabled = !isSelected && atLimit
          return (
            <button
              key={tag}
              type="button"
              className={`${styles.pill} ${isSelected ? styles.pillSelected : ''} ${isDisabled ? styles.pillDisabled : ''}`}
              onClick={() => !isDisabled && toggle(tag)}
              disabled={isDisabled}
            >
              {tag}
            </button>
          )
        })}
      </div>
      {atLimit && (
        <div className={styles.limitNote}>
          Maximum {MAX_SELECTIONS} emotions selected. Remove one to add another.
        </div>
      )}
    </div>
  )
}
