// app/src/components/chart/builder/FormulaField.jsx
//
// ─── THE TEXT BOX A TRADER TYPES A FORMULA INTO ─────────────────────────────
//
// Everything Phase D built before this task was invisible: a parser, two
// interpreters, a budget guard, a repaint linter, a read-back. This is the
// surface, and the FIRST thing it has to get right is that a parse failure is
// the NORMAL case here, not the exceptional one — the box is something somebody
// is halfway through typing into. `parseFormula` never throws for exactly that
// reason; this file never lets one reach React either.
//
// ⛔ THE REFUSAL SENTENCE IS THE REFUSING DOOR'S, VERBATIM. jsep's message
// carries a CHARACTER OFFSET ("Expected ) at character 10") and the budget's
// carries the number that was exceeded ("measures 600 and the cap is 500"). A
// rewritten message loses the only part a user can act on, and a second
// vocabulary for one decision rots apart from the first the day a guard is
// reworded. `data-guard` carries the door's NAME beside it, so a diagnostic
// names the gate rather than describing the symptom.

import { useEffect, useRef, useCallback, useState } from 'react'
import UIcon from '../../ui/UIcon'
import { evaluateFormula } from './evaluateFormula'
import { formulaHint } from '../engine/ast/formulaHints'
import styles from './BuilderSheet.module.css'
import editorStyles from './editor/CodeEditor.module.css'

/**
 * ⭐ SPEC §6's SETTINGS-FORM RULE, AS A NUMBER: 250 ms.
 *
 * ⛔ NOT "debounce so the UI feels nice". `evaluateFormula` runs the parser, a
 * whole-tree budget walk and the read-back compiler; on every keystroke that is
 * an interpreter in the input handler's frame budget, and nobody has measured
 * that budget. The tests pin this two ways — the literal, because 250 is the
 * spec's number and a mutation to 0 must be visible even when the behavioural
 * half is read through the constant; and the behaviour, because a constant
 * nothing reads is not a debounce.
 */
export const FORMULA_DEBOUNCE_MS = 250

/** The legacy formula sheet's read-back option: say formula functions by name (see `evaluateFormula`). */
export const SHEET = Object.freeze({ nameFunctions: true })

/** ⭐ `evaluateFormula` and `canSaveFormula` live in `evaluateFormula.js` (pure, so the member door's
 *  worker can import them); re-exported here for this module's existing callers. */
export { evaluateFormula, canSaveFormula } from './evaluateFormula'

/** The editor chunk. ⛔ A FAILED LOAD IS THE TEXTAREA, NOT A RELOAD: this is an
 *  inline enhancement of a box that already works, so `lazyWithRetry`'s
 *  hard-reload (right for a ROUTE) would throw away a member's draft here. */
function loadEditor() {
  return import('./editor/CodeEditor').then((m) => m.default).catch(() => TEXTAREA_FALLBACK)
}

/** TERM-033: what a failed chunk load resolves to, by name: no editor, so the textarea
 *  (already mounted and already the value carrier) stays the box. Never a reload. */
const TEXTAREA_FALLBACK = null

/**
 * The box, its error chip, and nothing else.
 *
 * The read-back, the badge and Save live in `BuilderSheet` — this component
 * owns the TEXT and the 250 ms settle, and hands the evaluation up.
 *
 * The textarea is the value carrier and the fallback; when the editor chunk
 * loads it is hidden (never unmounted) and CodeEditor renders beside it.
 *
 * @param {string}   value        the current source (controlled)
 * @param {Function} onChange     (source) => void, on every keystroke
 * @param {Function} onEvaluated  (result) => void, once per SETTLE
 * @param {object}   [inputs]     the declared-input scope for the read-back and
 *                                the linter — `BuilderSheet.BUILDER_INPUT_SCOPE`,
 *                                derived from the very array `buildDefinition`
 *                                writes into the document, so the names the
 *                                sentence may say are the names the saved
 *                                definition actually declares.
 * @param {string}   [dialect]    `'auto'` (the default) lets the source decide;
 *                                `'native'` or `'pcf'` forces one reader.
 * @param {string}   [label]      what this box is CALLED — the visible `<label>`
 *                                and the `aria-label`, which are one string on
 *                                purpose.
 *
 *   ⛔ ONE PROP, TWO SITES, BECAUSE A SECOND FIELD MUST NOT BE A SECOND
 *   "FORMULA". The component already took an `inputId` so two of it could
 *   coexist, and then hard-coded the word `Formula` in both places — so the
 *   moment W1b.5's Plots editor rendered a field per plot, `getByLabelText`
 *   (and a screen reader) saw N controls with one name and no way to say which
 *   plot each belonged to. The default keeps every existing caller byte-identical.
 */
export default function FormulaField({
  value,
  onChange,
  onEvaluated,
  onPendingChange,
  debounceMs = FORMULA_DEBOUNCE_MS,
  result = null,
  inputId = 'uct-formula',
  autoFocus = false,
  inputs = undefined,
  dialect = 'auto',
  label = 'Formula',
}) {
  const onEvaluatedRef = useRef(onEvaluated)
  onEvaluatedRef.current = onEvaluated
  const onPendingChangeRef = useRef(onPendingChange)
  onPendingChangeRef.current = onPendingChange
  const inputRef = useRef(null)
  const [Editor, setEditor] = useState(null)
  const editorRef = useRef(null)
  useEffect(() => {
    let alive = true
    loadEditor().then((component) => { if (alive && component) setEditor(() => component) })
    return () => { alive = false }
  }, [])
  // The editor arrives after the textarea took the autofocus: hop once, never forward.
  useEffect(() => {
    if (Editor && document.activeElement === inputRef.current) editorRef.current?.focus()
  }, [Editor])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // ⛔ ONE TIMER, RESET ON EVERY KEYSTROKE. Typing "sma(close, 20)" is fifteen
  // characters and fourteen of them are a tree the user has not finished
  // describing — evaluating those is fourteen parses, fourteen budget walks and
  // fourteen read-backs of a formula nobody asked about.
  // ⚠️ `inputs` IS IN THE DEPENDENCY LIST AND THE CALLER MUST HAND A STABLE
  // OBJECT. `BuilderSheet` exports one module-level scope for exactly that
  // reason: a fresh object per render would restart the 250 ms timer on every
  // render and the box would never settle.
  //
  // 🔴🔴 `onPendingChange` NAMES THE GAP A SILENT SAVE NO-OP WAS HIDING IN
  // (Compatibility Remediation Tranche 1, 2026-09-06). `result`/`canSave` in
  // the caller reflect the LAST SETTLED evaluation, not the current `value` —
  // for up to `debounceMs` after a paste or a keystroke, `Save` can still be
  // showing yesterday's verdict, `disabled` and all. A member who types then
  // clicks fast lands the click on a disabled button, which fires no `onClick`
  // at all: no toast, no error, no persisted row — indistinguishable from
  // broken (reproduced directly on a hand-typed formula: the first click did
  // nothing, an identical second click, after the timer fired, saved cleanly).
  // This does not change what Save DOES — it lets the caller say "still
  // checking" instead of silently doing nothing, satisfying "Save must either
  // persist or clearly refuse" without touching persistence or translation.
  useEffect(() => {
    onPendingChangeRef.current?.(true)
    const id = setTimeout(() => {
      onPendingChangeRef.current?.(false)
      onEvaluatedRef.current?.(evaluateFormula(value, inputs, dialect, SHEET))
    }, debounceMs)
    return () => clearTimeout(id)
  }, [value, debounceMs, inputs, dialect])

  /** `Mod-Enter`: apply the draft NOW — the settle's own evaluation, without the wait. */
  const applyNow = useCallback(() => {
    onPendingChangeRef.current?.(false)
    onEvaluatedRef.current?.(evaluateFormula(value, inputs, dialect, SHEET))
  }, [value, inputs, dialect])

  const handle = useCallback((e) => { onChange?.(e.target.value) }, [onChange])

  const refused = !!(result && result.error)
  const hint = refused ? formulaHint(result) : null
  // ⭐ THE MEMBER IS TOLD WHICH LANGUAGE WE READ, AND IT IS READ OFF THE RESULT
  // — never re-derived here. `evaluateFormula` already decided; a second
  // `detectDialect(value)` in this component would be a SECOND AUTHORITY OVER
  // ONE VALUE, and it would disagree with the first during the 250 ms settle.
  const readAs = result && result.dialect === 'pcf' ? 'pcf' : null

  return (
    <div className={styles.fieldWrap} {...(label === 'Formula' ? { 'data-guide': 'builder.formula' } : null)}>
      <label className={styles.label} htmlFor={inputId}>{label}</label>
      <textarea
        id={inputId}
        ref={inputRef}
        // ⛔ NOT combined with `styles.field` once the editor has mounted: two
        // classes on one element leaves which `width`/`border` wins to import
        // order between two different CSS modules. Standalone, `editorStyles.model`
        // is the whole story regardless of load order (see its own comment).
        className={Editor ? editorStyles.model : styles.field}
        tabIndex={Editor ? -1 : undefined}
        aria-hidden={Editor ? 'true' : undefined}
        // ⚠️ `spellCheck` off and `autoCapitalize` off: a phone keyboard that
        // capitalises `Close` produces a name the table does not declare, and
        // the refusal would be correct and completely baffling.
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        rows={2}
        placeholder="sma(close, 20)"
        aria-label={label}
        aria-invalid={refused || undefined}
        aria-describedby={refused ? (hint ? `${inputId}-error ${inputId}-hint` : `${inputId}-error`) : undefined}
        value={value}
        onChange={handle}
        data-dialect={result?.dialect || 'native'}
      />
      {Editor && (
        <Editor
          ref={editorRef}
          value={value}
          onChange={onChange}
          /* ⛔ READ OFF THE RESULT, never a second `detectDialect` (see `readAs`). */
          dialect={result && result.dialect === 'pcf' ? 'pcf' : 'formula'}
          inputs={inputs}
          diagnostics={result}
          // ⛔ NOT `label` verbatim: `getAllByLabelText('Formula')` must still
          // resolve to exactly ONE element (the hidden textarea) — the same
          // "ONE PROP, TWO SITES" reason this component takes `label` at all.
          // A distinguishing suffix keeps that true per-instance once W1b.5's
          // Plots editor mounts N of these with N different `label`s.
          ariaLabel={`${label} editor`}
          testId="formula-editor"
          onApply={applyNow}
        />
      )}
      {readAs && (
        <p
          className={`${styles.badge} ${styles.badgeClean}`}
          data-testid="formula-dialect"
          data-dialect="pcf"
        >
          Read as TC2000 PCF
        </p>
      )}
      {refused && (
        <p
          id={`${inputId}-error`}
          className={styles.errorChip}
          role="alert"
          data-testid="formula-error"
          data-guard={result.guard || ''}
          data-dialect={result.dialect || 'native'}
        >
          <span className={styles.errorDot} aria-hidden="true" />
          <UIcon name="warning" size={14} />
          {/* ⛔ VERBATIM. See the header. */}
          <span className={styles.errorText}>{result.error}</span>
        </p>
      )}
      {/* ⭐ THE FIX, IN ONE LINE, BESIDE (never instead of) the verbatim refusal —
          `formulaHints.js` reads the refusal and names the spelling to use. */}
      {refused && hint && (
        <p id={`${inputId}-hint`} className={styles.formulaHint} data-testid="formula-hint">
          {/* `code` spans are written in backticks; even parts are prose */}
          {hint.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}
        </p>
      )}
    </div>
  )
}
