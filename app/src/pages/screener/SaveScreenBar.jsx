import useSavedScreens from './hooks/useSavedScreens'
import styles from './ScannerPro.module.css'

// Starter + saved screen picker. Selecting one applies its spec; "Save current…"
// persists the active spec under a name.
export default function SaveScreenBar({ currentSpec, onApply }) {
  const { saved, starters, create, remove } = useSavedScreens()
  const all = [...starters, ...saved]

  const onSelect = id => {
    const s = all.find(x => String(x.id) === String(id))
    if (s) onApply(s.spec)
  }
  const onSave = async () => {
    const name = window.prompt('Name this screen:')
    if (name) await create(name, currentSpec)
  }

  return (
    <div className={styles.saveBar}>
      <select aria-label="Saved screens" className={styles.presetSelect}
        defaultValue="" onChange={e => onSelect(e.target.value)}>
        <option value="" disabled>Saved screens…</option>
        <optgroup label="Starters">
          {starters.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </optgroup>
        {saved.length > 0 && (
          <optgroup label="My screens">
            {saved.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </optgroup>
        )}
      </select>
      <button type="button" className={styles.saveBtn} onClick={onSave}>Save current…</button>
      {saved.length > 0 && (
        <button type="button" className={styles.linkBtn}
          onClick={() => { const id = window.prompt('Delete saved screen id:'); if (id) remove(id) }}>
          Manage
        </button>
      )}
    </div>
  )
}
