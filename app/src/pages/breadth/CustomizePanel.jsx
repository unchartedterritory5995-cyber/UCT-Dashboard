/**
 * Breadth Sheet Customize Panel — anchored dropdown for the Monitor tab.
 * Spec: docs/superpowers/specs/2026-04-24-breadth-customize-design.md
 *
 * Stateless about persistence — receives data and handlers from the parent
 * via the useBreadthCustomize hook.
 */

import { useEffect, useRef, useState } from 'react'
import UIcon from '../../components/ui/UIcon'
import styles from './CustomizePanel.module.css'
import { DEFAULT_PRESET, validatePresetName } from './useBreadthCustomize'

/**
 * Group ordering follows the COLS layout in Breadth.jsx. Cols within a group
 * inherit their order from the cols array.
 */
function groupCols(cols) {
  const seen = new Map()
  for (const c of cols) {
    if (!seen.has(c.group)) seen.set(c.group, [])
    seen.get(c.group).push(c)
  }
  return [...seen.entries()].map(([group, list]) => ({ group, list }))
}

export default function CustomizePanel({
  title = 'Customize Breadth Sheet',
  cols,
  activePreset,
  hidden,
  presetNames,
  isDefaultActive,
  onToggleHidden,
  onSavePreset,
  onRenamePreset,
  onDeletePreset,
  onSwitchPreset,
  onResetActive,
  onClose,
}) {
  // Modes: null | 'saveAs' | 'rename' | 'delete' | 'savePromptFromDefault'
  const [mode, setMode] = useState(null)
  const [draftName, setDraftName] = useState('')
  const [error, setError] = useState(null)
  const [pendingToggleKey, setPendingToggleKey] = useState(null)

  const panelRef = useRef(null)
  const inputRef = useRef(null)

  // Esc closes; click outside closes (unless inside panel).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const onClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
    }
    window.addEventListener('keydown', onKey)
    // Use mousedown to beat React's onClick handlers from interfering with row clicks
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [onClose])

  // Focus the inline input when entering an inline-form mode.
  useEffect(() => {
    if (mode && (mode === 'saveAs' || mode === 'rename' || mode === 'savePromptFromDefault')) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [mode])

  const closeInline = () => {
    setMode(null)
    setDraftName('')
    setError(null)
    setPendingToggleKey(null)
  }

  const handleCheckClick = (key) => {
    if (isDefaultActive) {
      // Don't mutate Default — capture the intended toggle and prompt for a name.
      setPendingToggleKey(key)
      setDraftName('')
      setError(null)
      setMode('savePromptFromDefault')
      return
    }
    onToggleHidden(key)
  }

  const submitSaveAs = () => {
    const err = validatePresetName(draftName, presetNames.filter(n => n !== DEFAULT_PRESET))
    if (err) { setError(err); return }
    onSavePreset(draftName.trim(), [...hidden])
    closeInline()
  }

  const submitSaveFromDefault = () => {
    const err = validatePresetName(draftName, presetNames.filter(n => n !== DEFAULT_PRESET))
    if (err) { setError(err); return }
    // Default's hidden set is empty; the new preset's hidden = the toggled key.
    onSavePreset(draftName.trim(), [pendingToggleKey])
    closeInline()
  }

  const submitRename = () => {
    const err = validatePresetName(
      draftName,
      presetNames.filter(n => n !== DEFAULT_PRESET && n !== activePreset),
    )
    if (err) { setError(err); return }
    onRenamePreset(activePreset, draftName.trim())
    closeInline()
  }

  const submitDelete = () => {
    onDeletePreset(activePreset)
    closeInline()
  }

  const grouped = groupCols(cols)

  return (
    <div className={styles.panel} ref={panelRef} role="dialog" aria-label={title}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <button className={styles.xBtn} onClick={onClose} aria-label="Close"><UIcon name="x" size={14} /></button>
      </div>

      <div className={styles.presetRow}>
        <select
          className={styles.presetSelect}
          value={activePreset}
          onChange={(e) => onSwitchPreset(e.target.value)}
          aria-label="Active preset"
        >
          {presetNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div className={styles.presetActions}>
          <button
            className={styles.smallBtn}
            onClick={() => { setMode('saveAs'); setDraftName(''); setError(null) }}
            title="Save current selection as a new preset"
          >
            Save as…
          </button>
          <button
            className={styles.smallBtn}
            onClick={() => { setMode('rename'); setDraftName(activePreset); setError(null) }}
            disabled={isDefaultActive}
            title={isDefaultActive ? 'Default cannot be renamed' : 'Rename this preset'}
          >
            Rename
          </button>
          <button
            className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
            onClick={() => { setMode('delete'); setError(null) }}
            disabled={isDefaultActive}
            title={isDefaultActive ? 'Default cannot be deleted' : 'Delete this preset'}
          >
            Delete
          </button>
        </div>
      </div>

      {mode === 'saveAs' && (
        <div className={styles.inlineForm}>
          <div className={styles.inlineLabel}>Save current selection as:</div>
          <input
            ref={inputRef}
            className={styles.inlineInput}
            value={draftName}
            placeholder="e.g. MA Only"
            onChange={(e) => { setDraftName(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') submitSaveAs() }}
            maxLength={60}
          />
          {error && <div className={styles.errorMsg}>{error}</div>}
          <div className={styles.inlineRow}>
            <button className={styles.ghostBtn} onClick={closeInline}>Cancel</button>
            <button className={styles.primaryBtn} onClick={submitSaveAs}>Save</button>
          </div>
        </div>
      )}

      {mode === 'rename' && (
        <div className={styles.inlineForm}>
          <div className={styles.inlineLabel}>Rename "{activePreset}" to:</div>
          <input
            ref={inputRef}
            className={styles.inlineInput}
            value={draftName}
            onChange={(e) => { setDraftName(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') submitRename() }}
            maxLength={60}
          />
          {error && <div className={styles.errorMsg}>{error}</div>}
          <div className={styles.inlineRow}>
            <button className={styles.ghostBtn} onClick={closeInline}>Cancel</button>
            <button className={styles.primaryBtn} onClick={submitRename}>Rename</button>
          </div>
        </div>
      )}

      {mode === 'delete' && (
        <div className={styles.inlineForm}>
          <p className={styles.confirmText}>Delete preset "{activePreset}"?</p>
          <div className={styles.inlineRow}>
            <button className={styles.ghostBtn} onClick={closeInline}>Cancel</button>
            <button className={styles.primaryBtn} onClick={submitDelete}>Delete</button>
          </div>
        </div>
      )}

      {mode === 'savePromptFromDefault' && (
        <div className={styles.inlineForm}>
          <div className={styles.inlineLabel}>
            Default cannot be edited. Save changes as a new preset:
          </div>
          <input
            ref={inputRef}
            className={styles.inlineInput}
            value={draftName}
            placeholder="e.g. My View"
            onChange={(e) => { setDraftName(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') submitSaveFromDefault() }}
            maxLength={60}
          />
          {error && <div className={styles.errorMsg}>{error}</div>}
          <div className={styles.inlineRow}>
            <button className={styles.ghostBtn} onClick={closeInline}>Cancel</button>
            <button className={styles.primaryBtn} onClick={submitSaveFromDefault}>Save</button>
          </div>
        </div>
      )}

      <div className={styles.body}>
        {grouped.map(({ group, list }) => (
          <div key={group} className={styles.section}>
            <div className={styles.sectionHeader}>{group}</div>
            {list.map(col => {
              const isVisible = !hidden.has(col.key)
              return (
                <label key={col.key} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={isVisible}
                    onChange={() => handleCheckClick(col.key)}
                  />
                  <span className={styles.checkLabel}>{col.label}</span>
                </label>
              )
            })}
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <span className={styles.activeLabel}>
          {isDefaultActive
            ? 'Default — all metrics visible'
            : `${cols.length - hidden.size} of ${cols.length} visible`}
        </span>
        <button
          className={styles.resetLink}
          onClick={onResetActive}
          disabled={isDefaultActive || hidden.size === 0}
          title={isDefaultActive ? 'Default has nothing to reset' : 'Show all metrics in this preset'}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  )
}
