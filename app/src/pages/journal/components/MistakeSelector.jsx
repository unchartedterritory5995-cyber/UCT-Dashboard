// app/src/pages/journal/components/MistakeSelector.jsx
import { useState, useMemo } from 'react'
import styles from './MistakeSelector.module.css'

const MISTAKE_TAXONOMY = [
  { id: 'overtrading', label: 'Overtrading', category: 'discipline' },
  { id: 'fomo', label: 'FOMO Entry', category: 'psychology' },
  { id: 'chasing', label: 'Chasing Extended', category: 'entry' },
  { id: 'early_exit', label: 'Early Exit', category: 'exit' },
  { id: 'late_entry', label: 'Late Entry', category: 'entry' },
  { id: 'no_stop', label: 'No Stop Loss', category: 'risk' },
  { id: 'oversized', label: 'Oversized Position', category: 'risk' },
  { id: 'countertrend', label: 'Countertrend Impulse', category: 'strategy' },
  { id: 'revenge', label: 'Revenge Trade', category: 'psychology' },
  { id: 'ignored_thesis', label: 'Ignored Thesis', category: 'discipline' },
  { id: 'added_to_loser', label: 'Added to Loser', category: 'risk' },
  { id: 'cut_winner', label: 'Cut Winner Too Early', category: 'exit' },
  { id: 'broke_loss_rule', label: 'Broke Daily Loss Rule', category: 'discipline' },
  { id: 'broke_size_rule', label: 'Broke Max Size Rule', category: 'risk' },
  { id: 'broke_checklist', label: 'Broke Process Checklist', category: 'discipline' },
  { id: 'boredom', label: 'Entered from Boredom', category: 'psychology' },
  { id: 'hesitation', label: 'Hesitation / Missed Entry', category: 'psychology' },
]

const CATEGORIES = [
  { key: 'discipline', label: 'Discipline' },
  { key: 'psychology', label: 'Psychology' },
  { key: 'entry', label: 'Entry' },
  { key: 'exit', label: 'Exit' },
  { key: 'risk', label: 'Risk' },
  { key: 'strategy', label: 'Strategy' },
]

const BY_CATEGORY = CATEGORIES.map(cat => ({
  ...cat,
  mistakes: MISTAKE_TAXONOMY.filter(m => m.category === cat.key),
}))

export default function MistakeSelector({ selected, onChange }) {
  const [customInput, setCustomInput] = useState('')

  const selectedSet = useMemo(() => {
    if (!selected) return new Set()
    return new Set(selected.split(',').map(s => s.trim()).filter(Boolean))
  }, [selected])

  function toggle(id) {
    const next = new Set(selectedSet)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    onChange(Array.from(next).join(','))
  }

  function addCustom() {
    const trimmed = customInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    if (!trimmed || selectedSet.has(trimmed)) return
    const next = new Set(selectedSet)
    next.add(trimmed)
    onChange(Array.from(next).join(','))
    setCustomInput('')
  }

  function removeChip(id) {
    const next = new Set(selectedSet)
    next.delete(id)
    onChange(Array.from(next).join(','))
  }

  // Find label for a tag
  function getLabel(id) {
    const found = MISTAKE_TAXONOMY.find(m => m.id === id)
    return found ? found.label : id
  }

  return (
    <div className={styles.wrap}>
      {/* Selected chips */}
      {selectedSet.size > 0 && (
        <div className={styles.chips}>
          {Array.from(selectedSet).map(id => (
            <span key={id} className={styles.chip}>
              <span className={styles.chipLabel}>{getLabel(id)}</span>
              <button className={styles.chipRemove} onClick={() => removeChip(id)}>x</button>
            </span>
          ))}
        </div>
      )}

      {/* Category groups */}
      <div className={styles.groups}>
        {BY_CATEGORY.map(cat => (
          <div key={cat.key} className={styles.group}>
            <div className={styles.groupLabel}>{cat.label}</div>
            <div className={styles.groupItems}>
              {cat.mistakes.map(m => (
                <label key={m.id} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(m.id)}
                    onChange={() => toggle(m.id)}
                    className={styles.checkbox}
                  />
                  <span className={`${styles.checkLabel} ${selectedSet.has(m.id) ? styles.checkLabelActive : ''}`}>
                    {m.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Custom mistake input */}
      <div className={styles.customRow}>
        <input
          className={styles.customInput}
          type="text"
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          placeholder="Custom mistake..."
          maxLength={50}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
        />
        <button
          className={styles.customBtn}
          type="button"
          onClick={addCustom}
          disabled={!customInput.trim()}
        >
          Add
        </button>
      </div>
    </div>
  )
}
