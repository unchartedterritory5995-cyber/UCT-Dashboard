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
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Checkbox from '../../components/ui/Checkbox'

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
  // The active preset's column order (Monitor header menu), carried by Save As.
  order = null,
  // A header-menu change asked for while Default (immutable) is active:
  // { hidden: string[] } or { order: string[] }. The panel opens straight on the
  // "save as" prompt so the change lands in a new preset, exactly as a checkbox
  // click on Default does.
  pendingChange = null,
}) {
  // Modes: null | 'saveAs' | 'rename' | 'delete' | 'savePromptFromDefault'
  const [mode, setMode] = useState(pendingChange ? 'savePromptFromDefault' : null)
  const [draftName, setDraftName] = useState('')
  const [error, setError] = useState(null)
  const [pendingToggleKey, setPendingToggleKey] = useState(null)
  const [pending, setPending] = useState(pendingChange)

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
    setPending(null)
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
    onSavePreset(draftName.trim(), [...hidden], order)
    closeInline()
  }

  const submitSaveFromDefault = () => {
    const err = validatePresetName(draftName, presetNames.filter(n => n !== DEFAULT_PRESET))
    if (err) { setError(err); return }
    // Default's hidden set is empty; the new preset's hidden = the toggled key
    // (or the header menu's pending hide / order).
    if (pending) onSavePreset(draftName.trim(), pending.hidden ?? [...hidden], pending.order ?? order)
    else {
      // Default is the core set now: the new preset is Default with this one box flipped.
      const next = new Set(hidden)
      if (next.has(pendingToggleKey)) next.delete(pendingToggleKey)
      else next.add(pendingToggleKey)
      onSavePreset(draftName.trim(), [...next], order)
    }
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
        <button className={styles.xBtn} onClick={onClose} aria-label="Close"><UIcon name="x" size={14} gold={false} /></button>
      </div>

      <div className={styles.presetRow}>
        <Select
          className={styles.presetSelect}
          value={activePreset}
          onChange={(e) => onSwitchPreset(e.target.value)}
          aria-label="Active preset"
        >
          {presetNames.map(n => <option key={n} value={n}>{n}</option>)}
        </Select>
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
          <Input aria-label="New preset name"
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
            <button className="btn btn-ghost" onClick={closeInline}>Cancel</button>
            <button className="btn btn-primary" onClick={submitSaveAs}>Save</button>
          </div>
        </div>
      )}

      {mode === 'rename' && (
        <div className={styles.inlineForm}>
          <div className={styles.inlineLabel}>Rename "{activePreset}" to:</div>
          <Input aria-label="New name"
            ref={inputRef}
            className={styles.inlineInput}
            value={draftName}
            onChange={(e) => { setDraftName(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') submitRename() }}
            maxLength={60}
          />
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
          <div className={styles.inlineLabel}>
            Default cannot be edited. Save changes as a new preset:
          </div>
          <Input aria-label="New preset name"
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
            <button className="btn btn-ghost" onClick={closeInline}>Cancel</button>
            <button className="btn btn-primary" onClick={submitSaveFromDefault}>Save</button>
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
                  <Checkbox
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
            ? `Default — ${cols.length - hidden.size} core metrics`
            : `${cols.length - hidden.size} of ${cols.length} visible`}
        </span>
        <button
          className={styles.resetLink}
          onClick={onResetActive}
          disabled={isDefaultActive}
          title={isDefaultActive ? 'Default has nothing to reset' : 'Put this preset back to the default columns'}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  )
}
