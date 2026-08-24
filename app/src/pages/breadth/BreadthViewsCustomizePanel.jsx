// app/src/pages/breadth/BreadthViewsCustomizePanel.jsx
/**
 * View-scoped Customize panel for the Breadth Views tab. Always reflects the
 * ACTIVE view: its presets, its view-specific options, and only the metrics that
 * view can render. Editing while on "Default" prompts a Save-as (Default is
 * immutable). Reuses CustomizePanel.module.css classes.
 * Spec: docs/superpowers/specs/2026-06-01-breadth-views-per-view-customize-design.md
 */
import { useEffect, useRef, useState } from 'react'
import styles from './CustomizePanel.module.css'
import UIcon from '../../components/ui/UIcon'
import { DEFAULT_PRESET, validatePresetName } from './useBreadthViews'

function groupMetrics(metrics) {
  const seen = new Map()
  for (const m of metrics) {
    if (!seen.has(m.group)) seen.set(m.group, [])
    seen.get(m.group).push(m)
  }
  return [...seen.entries()].map(([group, list]) => ({ group, list }))
}

// Option values may be numbers; <select> values are strings. Coerce back using the schema.
function coerceOptionValue(opt, raw) {
  const match = opt.choices.find(c => String(c.value) === raw)
  return match ? match.value : raw
}

export default function BreadthViewsCustomizePanel({
  viewLabel, metrics, optionsSchema, options, activePreset, visibleKeys, presetNames,
  isDefaultActive, onToggleVisible, onSetOption, onSavePreset, onRenamePreset,
  onDeletePreset, onSwitchPreset, onResetActive, onClose,
}) {
  // Modes: null | 'saveAs' | 'rename' | 'delete' | 'savePromptFromDefault'
  const [mode, setMode] = useState(null)
  const [draftName, setDraftName] = useState('')
  const [error, setError] = useState(null)

  const panelRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const onClick = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) onClose() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [onClose])

  useEffect(() => {
    if (mode === 'saveAs' || mode === 'rename' || mode === 'savePromptFromDefault') {
      inputRef.current?.focus(); inputRef.current?.select()
    }
  }, [mode])

  const closeInline = () => { setMode(null); setDraftName(''); setError(null) }
  const customs = presetNames.filter(n => n !== DEFAULT_PRESET)

  const guardDefault = (proceed) => {
    if (isDefaultActive) { setDraftName(''); setError(null); setMode('savePromptFromDefault'); return }
    proceed()
  }

  const submitSaveAs = () => {
    const err = validatePresetName(draftName, customs)
    if (err) { setError(err); return }
    onSavePreset(draftName.trim()); closeInline()
  }
  const submitSaveFromDefault = () => {
    const err = validatePresetName(draftName, customs)
    if (err) { setError(err); return }
    onSavePreset(draftName.trim()); closeInline()
  }
  const submitRename = () => {
    const err = validatePresetName(draftName, customs.filter(n => n !== activePreset))
    if (err) { setError(err); return }
    onRenamePreset(activePreset, draftName.trim()); closeInline()
  }
  const submitDelete = () => { onDeletePreset(activePreset); closeInline() }

  const grouped = groupMetrics(metrics)

  return (
    <div className={styles.panel} ref={panelRef} role="dialog" aria-label={`Customize ${viewLabel}`}>
      <div className={styles.header}>
        <h2 className={styles.title}>Customize {viewLabel}</h2>
        <button className={styles.xBtn} onClick={onClose} aria-label="Close"><UIcon name="x" size={14} /></button>
      </div>

      <div className={styles.presetRow}>
        <select className={styles.presetSelect} value={activePreset}
                onChange={(e) => onSwitchPreset(e.target.value)} aria-label="Active preset">
          {presetNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div className={styles.presetActions}>
          <button className={styles.smallBtn}
                  onClick={() => { setMode('saveAs'); setDraftName(''); setError(null) }}
                  title="Save current view as a new preset">Save as…</button>
          <button className={styles.smallBtn} disabled={isDefaultActive}
                  onClick={() => { setMode('rename'); setDraftName(activePreset); setError(null) }}
                  title={isDefaultActive ? 'Default cannot be renamed' : 'Rename this preset'}>Rename</button>
          <button className={`${styles.smallBtn} ${styles.smallBtnDanger}`} disabled={isDefaultActive}
                  onClick={() => { setMode('delete'); setError(null) }}
                  title={isDefaultActive ? 'Default cannot be deleted' : 'Delete this preset'}>Delete</button>
        </div>
      </div>

      {mode === 'saveAs' && (
        <div className={styles.inlineForm}>
          <div className={styles.inlineLabel}>Save current {viewLabel} as:</div>
          <input ref={inputRef} className={styles.inlineInput} value={draftName} placeholder="e.g. Tight"
                 onChange={(e) => { setDraftName(e.target.value); setError(null) }}
                 onKeyDown={(e) => { if (e.key === 'Enter') submitSaveAs() }} maxLength={60} />
          {error && <div className={styles.errorMsg}>{error}</div>}
          <div className={styles.inlineRow}>
            <button className="btn btn-ghost" onClick={closeInline}>Cancel</button>
            <button className="btn btn-primary" onClick={submitSaveAs}>Save</button>
          </div>
        </div>
      )}
      {mode === 'rename' && (
        <div className={styles.inlineForm}>
          <div className={styles.inlineLabel}>Rename "{activePreset}" to:</div>
          <input ref={inputRef} className={styles.inlineInput} value={draftName}
                 onChange={(e) => { setDraftName(e.target.value); setError(null) }}
                 onKeyDown={(e) => { if (e.key === 'Enter') submitRename() }} maxLength={60} />
          {error && <div className={styles.errorMsg}>{error}</div>}
          <div className={styles.inlineRow}>
            <button className="btn btn-ghost" onClick={closeInline}>Cancel</button>
            <button className="btn btn-primary" onClick={submitRename}>Rename</button>
          </div>
        </div>
      )}
      {mode === 'delete' && (
        <div className={styles.inlineForm}>
          <p className={styles.confirmText}>Delete preset "{activePreset}"?</p>
          <div className={styles.inlineRow}>
            <button className="btn btn-ghost" onClick={closeInline}>Cancel</button>
            <button className="btn btn-primary" onClick={submitDelete}>Delete</button>
          </div>
        </div>
      )}
      {mode === 'savePromptFromDefault' && (
        <div className={styles.inlineForm}>
          <div className={styles.inlineLabel}>Default cannot be edited. Save changes as a new preset:</div>
          <input ref={inputRef} className={styles.inlineInput} value={draftName} placeholder="e.g. My View"
                 onChange={(e) => { setDraftName(e.target.value); setError(null) }}
                 onKeyDown={(e) => { if (e.key === 'Enter') submitSaveFromDefault() }} maxLength={60} />
          {error && <div className={styles.errorMsg}>{error}</div>}
          <div className={styles.inlineRow}>
            <button className="btn btn-ghost" onClick={closeInline}>Cancel</button>
            <button className="btn btn-primary" onClick={submitSaveFromDefault}>Save</button>
          </div>
        </div>
      )}

      {optionsSchema.length > 0 && (
        <div className={styles.body} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>View options</div>
            {optionsSchema.map(opt => (
              <label key={opt.name} className={styles.checkRow} style={{ justifyContent: 'space-between' }}>
                <span className={styles.checkLabel}>{opt.label}</span>
                <select aria-label={opt.label} value={String(options[opt.name])}
                        onChange={(e) => guardDefault(() => onSetOption(opt.name, coerceOptionValue(opt, e.target.value)))}>
                  {opt.choices.map(c => <option key={String(c.value)} value={String(c.value)}>{c.label}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className={styles.body}>
        {grouped.map(({ group, list }) => (
          <div key={group} className={styles.section}>
            <div className={styles.sectionHeader}>{group}</div>
            {list.map(col => (
              <label key={col.key} className={styles.checkRow}>
                <input type="checkbox" className={styles.checkbox} checked={visibleKeys.has(col.key)}
                       onChange={() => guardDefault(() => onToggleVisible(col.key))} />
                <span className={styles.checkLabel}>{col.label}</span>
              </label>
            ))}
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <span className={styles.activeLabel}>
          {isDefaultActive ? `Default — ${viewLabel} preset` : `${visibleKeys.size} of ${metrics.length} visible`}
        </span>
        <button className={styles.resetLink} onClick={onResetActive} disabled={isDefaultActive}
                title={isDefaultActive ? 'Default has nothing to reset' : 'Restore this view\'s defaults'}>
          Reset to defaults
        </button>
      </div>
    </div>
  )
}
