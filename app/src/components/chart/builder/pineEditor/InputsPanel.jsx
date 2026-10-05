// app/src/components/chart/builder/pineEditor/InputsPanel.jsx
//
// ─── A5 — THE SCRIPT'S INPUTS, BOUND TO THE PREVIEW ─────────────────────────
//
// TradingView's Settings → Inputs, for the script being written: move a value
// and the preview pane redraws at it. ⛔ IT NEVER REWRITES THE SOURCE — the
// script's own `input.*` defaults stay what the member typed; the values here
// ride on the preview (and on what Apply stores), keyed by input name.
//
// ⛔ ONE EDITOR OF A KNOB: `ParamControls` renders the rows and
// `applyInputValues` → `applyParamEdit` applies them, atomically. A value that
// does not round-trip on every locator is REFUSED with the editor's sentence and
// the preview keeps the last good values — never a half-applied edit.
//
// ⛔ H10's LOCKS ARE SHOWN, NOT HIDDEN: a knob the member door withheld
// (`built.lockedKnobs`, decided by `memberPane/knobReach.js`) is listed as a
// disabled row with `knobLockedNote`'s own sentence — the reason it would only
// half apply — and offers no control at all.

import { useCallback, useMemo, useState } from 'react'
import ParamControls from '../ParamControls'
import { knobLockedNote } from '../memberPane/knobReach'
import { applyInputValues, inputKeyOf, withInputValue } from './pineScripts'
import styles from './PineEditor.module.css'

/**
 * @param {object|null} built      the editor's `memberPaneDefinition` result
 * @param {object} values          {inputName: value}
 * @param {Function} onValues      (nextValues) => void
 */
export default function InputsPanel({ built, values = {}, onValues = null }) {
  const [error, setError] = useState(null)
  const base = built && built.ok ? built.definition : null
  const shown = useMemo(() => (base ? applyInputValues(base, values) : null), [base, values])
  const locked = useMemo(() => {
    if (!built || !built.ok) return []
    const params = (built.translation && built.translation.inputParams) || []
    return (built.lockedKnobs || []).map((k) => {
      const p = params.find((x) => x && x.id === k.id) || (k.entry ? { ...k.entry, id: k.id } : null)
      return { id: k.id, ...knobLockedNote(p, k.why) }
    })
  }, [built])

  const commit = useCallback((paramId, value) => {
    if (!base || !onValues) return
    const entry = ((base.compute || {}).paramManifest || {})[paramId]
    if (!entry) return
    const next = withInputValue(values, inputKeyOf(paramId, entry), value, entry.default)
    const res = applyInputValues(base, next)
    if (!res.ok) {
      // ⛔ THE EDITOR'S SENTENCE, VERBATIM; the preview keeps the last good values.
      setError(res.error)
      return
    }
    setError(null)
    onValues(next)
  }, [base, values, onValues])

  if (!base) return null
  const hasKnobs = !!(base.compute && base.compute.paramManifest
    && Object.keys(base.compute.paramManifest).length)
  if (!hasKnobs && !locked.length) return null
  // ⭐ counted off the VALUES, not off what applied: a value that no longer
  // applies must still be resettable, or the member is stuck at a refusal.
  const changed = Object.keys(values || {}).length

  return (
    <section className={styles.inputs} aria-label="Inputs" data-testid="pine-editor-inputs">
      <div className={styles.inputsHead}>
        <h4 className={styles.subhead}>Inputs</h4>
        {changed > 0 && (
          <button type="button" className={styles.ghost} data-testid="pine-editor-inputs-reset"
            onClick={() => { setError(null); onValues?.({}) }}>
            Reset all to the script&apos;s values
          </button>
        )}
      </div>
      <p className={styles.note}>
        Changes here redraw the preview and are kept with the script when you apply it.
        Your code is not changed.
      </p>
      {hasKnobs && shown && <ParamControls definition={shown.definition} onChange={commit} />}
      {error && <p className={styles.err} role="alert" data-testid="pine-editor-inputs-error">{error}</p>}
      {shown && shown.stale.length > 0 && (
        <p className={styles.note} data-testid="pine-editor-inputs-stale">
          {`Not applied (the script no longer offers ${shown.stale.length === 1 ? 'this input' : 'these inputs'}): `}
          {shown.stale.join(', ')}
        </p>
      )}
      {locked.length > 0 && (
        <ul className={styles.locked} data-testid="pine-editor-inputs-locked">
          {locked.map((k) => (
            <li key={k.id} data-testid={`pine-editor-locked-${k.id}`}>
              <span className={styles.lockedName}>{k.name}</span>
              <span className={styles.message}>{k.note}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
