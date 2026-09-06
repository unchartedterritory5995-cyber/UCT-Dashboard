// app/src/components/chart/builder/ParamControls.jsx
//
// ─── TRACK F (DEC-006) — THE SMALLEST USEFUL PARAMETER UI ───────────────────
//
// ⭐ ONE ROW PER LOGICAL PARAMETER, per `compute.paramManifest`. `attached`
// gets a real numeric input (title, current value, original default, min/
// max/step where the author declared them, numeric options where declared,
// Reset to Default). Anything else (`detached`/`partially_detached`/
// `conflicted`/`non_literal`) gets a DISABLED row that DISCLOSES the exact
// reason — never an active-looking control over a value that isn't really
// live. Per the owner's own instruction: "do not show an active control
// that appears functional."
//
// ⛔ NOT A BuilderSheet REDESIGN. This is one small, self-contained,
// presentational component: it takes a definition and two callbacks, and
// renders. All the actual editing logic already lives in `paramEdit.js`
// (`reconcileParams` for display, `applyParamEdit` for the write) — this
// component calls those, it does not reimplement them.
//
// ⛔ PURE PROPS, NO OWN NETWORK CALL. The caller (`BuilderSheet.jsx`) owns
// what happens with an edited definition (update local state; the existing
// Save button persists it exactly as any other formula change already
// does). This mirrors the same division of labour every other builder
// sub-component already keeps.

import { useMemo, useState, useCallback } from 'react'
import { reconcileParams, ATTACHED } from './paramEdit'
import styles from './ParamControls.module.css'

/** One row's live-typed text, kept separate from the committed numeric
 *  value so a member can clear the field or type a partial number ("1.")
 *  without it being force-parsed on every keystroke. Committed on blur or
 *  Enter, exactly like `FormulaField`'s own numeric inputs elsewhere in this
 *  directory. */
function useDraft(committed) {
  const [draft, setDraft] = useState(null)
  const value = draft === null ? (committed == null ? '' : String(committed)) : draft
  const reset = useCallback(() => setDraft(null), [])
  return [value, setDraft, reset]
}

function ParamRow({ id, entry, status, onCommit }) {
  const [draft, setDraft, resetDraft] = useDraft(status.state === ATTACHED ? status.value : null)
  const disabled = status.state !== ATTACHED
  const isDefault = status.state === ATTACHED && status.value === entry.default

  const commit = () => {
    if (disabled) return
    const raw = String(draft).trim()
    if (raw === '') { resetDraft(); return }
    const num = Number(raw)
    if (!Number.isFinite(num)) { resetDraft(); return }
    onCommit(id, num)
    resetDraft()
  }

  return (
    <div className={styles.row} data-testid={`param-row-${id}`} data-state={status.state}>
      <div className={styles.head}>
        <span className={styles.title}>{entry.title || entry.sourceName || id}</span>
        {!disabled && !isDefault && (
          <button
            type="button"
            className={styles.resetBtn}
            data-testid={`param-reset-${id}`}
            onClick={() => onCommit(id, entry.default)}
          >
            Reset to Default
          </button>
        )}
      </div>
      {disabled ? (
        <div className={styles.disabledReason} data-testid={`param-reason-${id}`}>
          {status.reason || 'this control is not currently adjustable'}
        </div>
      ) : entry.type === 'bool' ? (
        // ⭐⭐ TRACK F v1.1 (2026-09-06) — the SAME architecture, an
        // appropriate control for the type. A checkbox commits immediately,
        // exactly like the `options` `<select>` two branches below: there is
        // no free-text "0.7" a boolean could be typed as, so the draft/blur/
        // Enter machinery the numeric input needs has nothing to debounce.
        <input
          type="checkbox"
          className={styles.checkbox}
          data-testid={`param-input-${id}`}
          checked={status.value === 1}
          onChange={(e) => onCommit(id, e.target.checked ? 1 : 0)}
        />
      ) : Array.isArray(entry.options) ? (
        <select
          className={styles.select}
          data-testid={`param-input-${id}`}
          value={draft}
          onChange={(e) => { onCommit(id, Number(e.target.value)); resetDraft() }}
        >
          {entry.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : (
        <input
          type="number"
          className={styles.input}
          data-testid={`param-input-${id}`}
          value={draft}
          min={entry.min ?? undefined}
          max={entry.max ?? undefined}
          step={entry.step ?? (entry.type === 'int' ? 1 : 'any')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
        />
      )}
      <div className={styles.meta}>
        <span>default {entry.type === 'bool' ? (entry.default === 1 ? 'On' : 'Off') : entry.default}</span>
        {entry.min != null && <span>min {entry.min}</span>}
        {entry.max != null && <span>max {entry.max}</span>}
      </div>
    </div>
  )
}

/**
 * @param {object} definition the full definition object (needs `compute.
 *        paramManifest`; `compute.paramState` is read when present — a
 *        freshly-loaded, already-saved definition has one from the server —
 *        and DERIVED FRESH via `reconcileParams` otherwise, so this renders
 *        correctly for a definition that has never been saved yet too.
 * @param {(paramId: string, value: number) => void} onChange called with
 *        the member's committed value; the caller applies it (typically via
 *        `applyParamEdit`) and owns what happens to the result.
 */
export default function ParamControls({ definition, onChange }) {
  const manifest = (definition && definition.compute && definition.compute.paramManifest) || null
  const serverState = definition && definition.compute && definition.compute.paramState
  const state = useMemo(() => {
    if (!manifest) return {}
    if (serverState && typeof serverState === 'object') return serverState
    return reconcileParams(definition)
  }, [definition, manifest, serverState])

  const ids = manifest ? Object.keys(manifest) : []
  if (ids.length === 0) return null

  return (
    <div className={styles.panel} data-testid="param-controls">
      <div className={styles.panelTitle}>Adjustable parameters</div>
      {ids.map((id) => (
        <ParamRow
          key={id}
          id={id}
          entry={manifest[id]}
          status={state[id] || { state: 'detached', value: null, reason: null }}
          onCommit={onChange}
        />
      ))}
    </div>
  )
}
