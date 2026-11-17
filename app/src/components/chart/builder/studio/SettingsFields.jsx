// app/src/components/chart/builder/studio/SettingsFields.jsx
//
// THE NUMBERS OF THE INDICATOR BEING BUILT, AS FIELDS (`authoring/derivedSettings.js`).
//
// One row per tunable number: where it sits, in plain words; what it is (a length, a level, a
// multiple); and the number, editable. A change is committed on Enter or on leaving the field,
// never per keystroke: each commit is one step of the indicator's history (one Undo), and the
// preview on the chart redraws once.
//
// ⛔ PURE PROPS. The caller owns the change (`onSet(setting, value)` answers `{ok, message?,
// stale?}`); this file holds only what is being typed and the last refusal's words.
import { useState } from 'react'
import styles from './SettingsFields.module.css'

function Row({ setting, onSet, disabled }) {
  const [draft, setDraft] = useState(null)
  const [problem, setProblem] = useState(null)
  const shown = draft === null ? String(setting.value) : draft

  const commit = () => {
    if (draft === null) return
    const raw = draft.trim()
    if (raw === '' || raw === String(setting.value)) { setDraft(null); setProblem(null); return }
    const value = Number(raw)
    const out = onSet(setting, value) || { ok: false }
    if (out.ok || out.stale) { setDraft(null); setProblem(null); return }
    setProblem(out.message || 'That value could not be applied.')
  }

  const fieldId = `setting-${setting.id}`
  return (
    <div className={styles.settingRow} data-testid="studio-setting" data-role={setting.role}>
      <label className={styles.settingCaption} htmlFor={fieldId} title={setting.captionFull || setting.caption}>
        <span>{setting.caption}</span>
        <span className={styles.settingRole}>{setting.role}{setting.slots.length > 1 ? ` · ${setting.slots.length} places` : ''}</span>
      </label>
      <input
        id={fieldId}
        className={styles.settingInput}
        type="text"
        inputMode={setting.whole ? 'numeric' : 'decimal'}
        autoComplete="off"
        spellCheck={false}
        value={shown}
        disabled={disabled}
        aria-invalid={problem ? 'true' : undefined}
        aria-describedby={problem ? `${fieldId}-problem` : undefined}
        onChange={(e) => { setDraft(e.target.value); if (problem) setProblem(null) }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); setProblem(null) }
        }}
      />
      {problem && <span id={`${fieldId}-problem`} className={styles.settingProblem} role="alert">{problem}</span>}
    </div>
  )
}

export default function SettingsFields({ settings, onSet, disabled = false, label = 'Settings' }) {
  if (!Array.isArray(settings) || settings.length === 0) return null
  return (
    <div className={styles.section} data-testid="studio-settings">
      <span className={styles.sectionLabel}>{label}</span>
      {/* keyed on the places the number sits: stable while its value changes, new when the formula's shape does */}
      {settings.map((s) => <Row key={s.id} setting={s} onSet={onSet} disabled={disabled} />)}
      <span className={styles.settingNote}>Changing a number here changes this indicator everywhere it is used, once you save.</span>
    </div>
  )
}
