import { useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import styles from './SavedViewEditor.module.css'

/**
 * Wave E — the "Save current view" prompt. Deliberately just a name field:
 * the filter/sort state to save is already fully determined by the caller
 * (NotebookTab's current propertyFilter/propertySort + chosen viewType) --
 * this component's only job is naming it, matching the small-footprint
 * "saving a view" affordance the checkpoint calls for, not a second
 * filter-builder UI.
 */
export default function SavedViewEditor({ open, onClose, onSave }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed)
      setName('')
    } catch (e) {
      setError(e.message || 'Could not save view')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Save view" variant="auto" maxWidth={420}>
      <div className={styles.wrap}>
        <label className={styles.label} htmlFor="save-view-name">Name</label>
        <input
          id="save-view-name"
          type="text"
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Active Theses"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
        />
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.actions}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save view'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
