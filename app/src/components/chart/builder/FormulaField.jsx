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

import { useEffect, useRef, useCallback } from 'react'
import UIcon from '../../ui/UIcon'
import { parseFormula } from '../engine/ast/parse'
import { checkBudget } from '../engine/ast/budget'
import { sentenceFor } from '../engine/ast/sentence'
import { lintRepaint } from '../engine/ast/lint'
import styles from './BuilderSheet.module.css'

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

/**
 * A source string → everything the builder knows about it. PURE, and it never
 * throws.
 *
 * The doors are consulted in ADMISSIBILITY order and the FIRST refusal is the
 * one reported, because that is the one whose message names the real defect:
 *
 *   1. `parseFormula`  — syntax, and the five node shapes the table refuses
 *                        (`canonicalise:member`, …).
 *   2. `checkBudget`   — the three caps. ⚠️ IT CAN ALSO **THROW** a `TableRefusal`
 *                        from ANOTHER guard: `resolve:name`, `resolve:function`,
 *                        `resolve:arity`, `resolve:window`. Those propagate as
 *                        the doors they are — relabelling one as "over budget"
 *                        is the wrong-door defect this branch has now found four
 *                        separate times, every occurrence a correct NUMBER
 *                        produced by the wrong MECHANISM.
 *   3. `sentenceFor`   — a tree with no English is a tree the user cannot
 *                        confirm, and a read-back that quietly degrades to a
 *                        placeholder is a read-back nobody can rely on.
 *
 * ⭐ THE VERDICT IS COMPUTED FOR EVERY TREE THAT PARSES, INCLUDING ONE THAT IS
 * REFUSED. It is not a refusal reason — it is the linter's measurement — and
 * keeping the two separate is what stops "unknown function `foo`" from being
 * reported to a user as "this formula repaints". `lintRepaint` fails CLOSED
 * (`repaints`) for a tree it cannot bound, which is why both facts are true of
 * `foo(close, 3)` at once and only one of them is the reason.
 *
 * 🔴 `inputs` REACHES THE LINTER AND THE READ-BACK, AND UNTIL NOW IT REACHED
 * NEITHER. `parse.js` turns every identifier into a `series` node, and
 * `buildDefinition` puts `lineWidth` and `color` on EVERY document this surface
 * writes — so `close * lineWidth` is one keystroke away for every member. This
 * function passed no scope to `lintRepaint`, which badged it `repaints`
 * ("`lineWidth` is not a series this table declares"), and none to `sentenceFor`,
 * which refused the read-back at `sentence:name`. Both doors were correct about a
 * scope that was empty because nobody filled it, and the whole lane behind them —
 * both interpreters, the budget, the 1e-9 cross-lane proof, the registration door
 * and `ias.create` — now handles a declared input. The UI was refusing it one
 * door too early.
 *
 * ⛔ ONE VOCABULARY, AND THE SCOPE IS BUILT BY `lint.declaredInputs` — the same
 * reader `lintDefinition` uses, on `inputs[].key`, with `name` NOT a fallback.
 * ⛔ AND AN UNDECLARED NAME STILL REFUSES. Only a name the DEFINITION declares
 * resolves; `close * nosuch` is still `sentence:name` and still `repaints`, and
 * both directions are asserted.
 *
 * @param {string} source
 * @param {object} [inputs] the definition's declared inputs, BY NAME
 * @returns {{source: string, ok: boolean, ast: object|null, guard: string|null,
 *            error: string|null, readback: string|null, verdict: object|null,
 *            measured: object|null}}
 */
export function evaluateFormula(source, inputs = undefined) {
  const blank = {
    source: typeof source === 'string' ? source : '',
    ok: false, ast: null, guard: null, error: null,
    readback: null, verdict: null, measured: null,
  }
  if (typeof source !== 'string' || source.trim() === '') {
    return { ...blank, empty: true }
  }

  const parsed = parseFormula(source)
  if (!parsed.ok) {
    return { ...blank, guard: parsed.guard || 'parser', error: parsed.error }
  }
  const ast = parsed.ast

  // Fail closed: a tree the linter cannot read is `repaints`, and a linter that
  // raised here would take the whole surface down over a badge.
  let verdict = null
  try {
    verdict = lintRepaint(ast, { inputs })
  } catch (err) {
    verdict = {
      mode: 'repaints',
      reasons: [`the repaint linter could not read this tree (${msg(err)})`],
      forward: 'unknown', back: 'unknown',
    }
  }

  let budget
  try {
    budget = checkBudget(ast, undefined)
  } catch (err) {
    return { ...blank, ast, verdict, guard: err?.guard || 'resolve:node', error: msg(err) }
  }
  if (!budget.ok) {
    return { ...blank, ast, verdict, guard: budget.guard, error: budget.error, measured: budget.measured }
  }

  let readback
  try {
    readback = sentenceFor(ast, inputs)
  } catch (err) {
    return {
      ...blank, ast, verdict, measured: budget.measured,
      guard: err?.guard || 'sentence:node', error: msg(err),
    }
  }

  return {
    source, ok: true, ast, guard: null, error: null,
    readback, verdict, measured: budget.measured,
  }
}

/**
 * ⭐⭐ THE BADGE IS A GATE, NOT A LABEL — AND IT IS NOT THE USER'S TO SET.
 *
 * Spec §1.3: repaint badges are machine-or-audit-assigned, NEVER self-disclosed.
 * So the linter's verdict is a gate on this form rather than a caption on it:
 *
 *   `repaints`          → SAVE IS REFUSED. There is no acknowledgement that
 *                         makes an unbounded forward reference safe.
 *   `preview-repaints`  → save needs an explicit acknowledgement. The value is
 *                         final the moment bar `i+k` closes, which is a sentence
 *                         a user can accept — but only having read it.
 *   `non-repainting`    → save.
 *
 * ⚠️ A PROPERTY OF TODAY'S MANIFEST, DECLARED RATHER THAN DISCOVERED: every
 * `lookback` in the shipped `closedTable.json` is `≥ 0` or `"argK"`, so
 * `astReach` returns forward `0` for every table-legal tree and the only trees
 * that carry another badge are the ones `checkBudget` has ALREADY refused at
 * `resolve:function` / `resolve:window`. In the product as it ships today this
 * gate therefore admits only `non-repainting`. That is the same declared
 * property `nativeRegistry.validateAstLane` carries, for the same reason, and it
 * is why the gate is a PURE function with its own test rather than something
 * only reachable through the form: the day the manifest declares a negative
 * lookback the gate moves with it and not a line of this file changes.
 */
export function canSaveFormula(result, acknowledged = false) {
  if (!result || !result.ok) return false
  const mode = result.verdict && result.verdict.mode
  if (mode === 'repaints') return false
  if (mode === 'preview-repaints') return acknowledged === true
  return true
}

function msg(err) {
  return String(err && err.message ? err.message : err)
}

/**
 * The box, its error chip, and nothing else.
 *
 * The read-back, the badge and Save live in `BuilderSheet` — this component
 * owns the TEXT and the 250 ms settle, and hands the evaluation up.
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
 */
export default function FormulaField({
  value,
  onChange,
  onEvaluated,
  debounceMs = FORMULA_DEBOUNCE_MS,
  result = null,
  inputId = 'uct-formula',
  autoFocus = false,
  inputs = undefined,
}) {
  const onEvaluatedRef = useRef(onEvaluated)
  onEvaluatedRef.current = onEvaluated
  const inputRef = useRef(null)

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
  useEffect(() => {
    const id = setTimeout(() => {
      onEvaluatedRef.current?.(evaluateFormula(value, inputs))
    }, debounceMs)
    return () => clearTimeout(id)
  }, [value, debounceMs, inputs])

  const handle = useCallback((e) => { onChange?.(e.target.value) }, [onChange])

  const refused = !!(result && result.error)

  return (
    <div className={styles.fieldWrap}>
      <label className={styles.label} htmlFor={inputId}>Formula</label>
      <textarea
        id={inputId}
        ref={inputRef}
        className={styles.field}
        // ⚠️ `spellCheck` off and `autoCapitalize` off: a phone keyboard that
        // capitalises `Close` produces a name the table does not declare, and
        // the refusal would be correct and completely baffling.
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        rows={2}
        placeholder="sma(close, 20)"
        aria-label="Formula"
        aria-invalid={refused || undefined}
        aria-describedby={refused ? `${inputId}-error` : undefined}
        value={value}
        onChange={handle}
      />
      {refused && (
        <p
          id={`${inputId}-error`}
          className={styles.errorChip}
          role="alert"
          data-testid="formula-error"
          data-guard={result.guard || ''}
        >
          <span className={styles.errorDot} aria-hidden="true" />
          <UIcon name="warning" size={14} />
          {/* ⛔ VERBATIM. See the header. */}
          <span className={styles.errorText}>{result.error}</span>
        </p>
      )}
    </div>
  )
}
