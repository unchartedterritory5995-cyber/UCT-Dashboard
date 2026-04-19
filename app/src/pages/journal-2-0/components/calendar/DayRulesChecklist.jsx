/**
 * Day rules checklist — user-defined trading rules with checkboxes.
 * Persists via the shared day-notes mutation.
 */

import { useState } from 'react'
import styles from './DayRulesChecklist.module.css'

const MAX_RULES = 25

export default function DayRulesChecklist({
  notes = '',
  prepNotes = '',
  midDayNotes = '',
  recapNotes = '',
  attachments = [],
  rules = [],
  onSave,
  saving,
}) {
  const narrativeBundle = { notes, prepNotes, midDayNotes, recapNotes }
  const [newLabel, setNewLabel] = useState('')
  const [error, setError] = useState(null)

  const addRule = async () => {
    const label = newLabel.trim()
    if (!label) return
    if (rules.length >= MAX_RULES) {
      setError(`Max ${MAX_RULES} rules per day.`)
      return
    }
    setError(null)
    const next = [
      ...rules,
      { id: crypto.randomUUID(), label, checked: false },
    ]
    const ok = await onSave({ ...narrativeBundle, attachments, rules: next })
    if (ok) setNewLabel('')
    else setError("Couldn't save rule.")
  }

  const toggleRule = async (idx) => {
    const next = rules.map((r, i) =>
      i === idx ? { ...r, checked: !r.checked } : r
    )
    const ok = await onSave({ ...narrativeBundle, attachments, rules: next })
    if (!ok) setError("Couldn't update rule.")
  }

  const removeRule = async (idx) => {
    const next = rules.filter((_, i) => i !== idx)
    const ok = await onSave({ ...narrativeBundle, attachments, rules: next })
    if (!ok) setError("Couldn't remove rule.")
  }

  const checkedCount = rules.filter((r) => r.checked).length

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Rules checklist</h3>
        {rules.length > 0 && (
          <span className={styles.count}>
            {checkedCount} / {rules.length} checked
          </span>
        )}
      </div>

      {rules.length === 0 ? (
        <p className={styles.empty}>No rules yet. Add your first below.</p>
      ) : (
        <ul className={styles.list}>
          {rules.map((r, i) => (
            <li key={r.id} className={`${styles.item} ${r.checked ? styles.itemChecked : ''}`}>
              <label className={styles.itemLabel}>
                <input
                  type="checkbox"
                  checked={r.checked}
                  onChange={() => toggleRule(i)}
                  disabled={saving}
                  className={styles.checkbox}
                />
                <span className={styles.text}>{r.label}</span>
              </label>
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => removeRule(i)}
                aria-label={`Remove ${r.label}`}
                disabled={saving}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.addRow}>
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addRule() }}
          placeholder="e.g. Waited for confirmation, Sized at 1R risk…"
          className={styles.input}
          disabled={rules.length >= MAX_RULES}
        />
        <button
          type="button"
          className={styles.addBtn}
          onClick={addRule}
          disabled={!newLabel.trim() || rules.length >= MAX_RULES || saving}
        >
          + Add
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </section>
  )
}
