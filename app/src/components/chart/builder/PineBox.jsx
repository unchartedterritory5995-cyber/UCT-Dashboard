// app/src/components/chart/builder/PineBox.jsx
//
// ─── PASTE PINE, SEE WHAT WE UNDERSTOOD, PUT IT IN THE BOX ───────────────────
//
// ⛔ A MODE, NOT A FOURTH BUILDER. Its only output is the SAME `source` string
// the Library, the Conditions picker and the typed box all write, so a pasted
// Pine script goes through the same parse, the same budget walk, the same
// repaint linter, the same read-back and the same Save button as a formula
// somebody typed. There is no Pine flag on the saved document, no Pine column on
// the store and no Pine save path — `BuilderSheet` stays the one write door.
//
// ⭐ THE MEMBER SEES WHAT WE UNDERSTOOD BEFORE THEY COMMIT TO IT. Each output the
// script offers is listed with the formula this engine would run and, beside it,
// the verdict the REAL downstream doors give that formula — `evaluateFormula`,
// the same function the text box calls. So "will this work" is answered by the
// gates themselves rather than by a second opinion this component invented.
//
// ⛔ A REFUSAL IS SHOWN VERBATIM, WITH ITS LINE AND A CARET. `translatePine`
// carries `{guard, message, line, column, token, excerpt}` and this file renders
// them; it writes no sentence of its own about why something failed. The `guard`
// rides on `data-guard` so a diagnostic names the gate rather than describing the
// symptom, exactly as `FormulaField`'s error chip does.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import UIcon from '../../ui/UIcon'
import { translatePine } from '../engine/ast/pine'
import { evaluateFormula } from './FormulaField'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import styles from './PineBox.module.css'

/** The same 250 ms `FormulaField` settles on, and for the same reason: a paste is
 *  one event but an edit is a keystroke, and translating on every one runs a
 *  lexer, a parser and a round-trip re-parse in the input handler's frame. */
export const PINE_DEBOUNCE_MS = 250

const PLACEHOLDER = `//@version=5
indicator("My screen")
r = ta.rsi(close, 14)
plot(r < 30 and close > ta.sma(close, 200) ? 1 : 0, "Signal")`

/**
 * Translate once and measure each output against the real downstream doors.
 *
 * PURE, and it never throws — `translatePine` returns a refusal rather than
 * raising and `evaluateFormula` is already the door that cannot throw.
 */
export function inspectPine(source) {
  const translated = translatePine(source)
  const outputs = translated.outputs.map((out) => ({
    ...out,
    // ⛔ THE DOWNSTREAM VERDICT IS THE DOWNSTREAM DOOR'S. Not a copy of its
    // rules, not a prediction of them — the function itself.
    downstream: out.formula ? evaluateFormula(out.formula, BUILDER_INPUT_SCOPE) : null,
  }))
  return { ...translated, outputs }
}

function Refusal({ refusal, testId }) {
  if (!refusal) return null
  return (
    <div className={styles.refusal} role="alert" data-testid={testId} data-guard={refusal.guard}>
      <span className={styles.refusalHead}>
        <UIcon name="warning" size={14} />
        {refusal.line != null
          ? <span className={styles.refusalWhere}>Line {refusal.line}, column {refusal.column}</span>
          : <span className={styles.refusalWhere}>This script</span>}
      </span>
      {/* ⛔ VERBATIM. The refusing door owns the sentence. */}
      <span className={styles.refusalText}>{refusal.message}</span>
      {refusal.excerpt && <pre className={styles.excerpt}>{refusal.excerpt}</pre>}
    </div>
  )
}

/**
 * @param {Function} onPick     (formulaSource) => void — the ONE output
 * @param {boolean}  [disabled]
 * @param {string}   [initialSource]
 */
export default function PineBox({ onPick, disabled = false, initialSource = '' }) {
  const [text, setText] = useState(initialSource)
  const [report, setReport] = useState(() => (initialSource ? inspectPine(initialSource) : null))
  const [chosen, setChosen] = useState(null)
  const [showNotes, setShowNotes] = useState(false)
  const areaRef = useRef(null)

  useEffect(() => {
    if (text.trim() === '') { setReport(null); setChosen(null); return undefined }
    const id = setTimeout(() => {
      const next = inspectPine(text)
      setReport(next)
      setChosen(next.selected >= 0 ? next.selected : null)
    }, PINE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [text])

  const active = useMemo(() => {
    if (!report || chosen == null) return null
    return report.outputs[chosen] || null
  }, [report, chosen])

  const use = useCallback(() => {
    if (active && active.formula) onPick?.(active.formula)
  }, [active, onPick])

  const usable = report ? report.outputs.filter((o) => o.formula) : []

  return (
    <section className={styles.wrap} aria-labelledby="uct-pine-head" data-testid="pine-box">
      <h3 className={styles.head} id="uct-pine-head">Paste a Pine script</h3>
      <p className={styles.hint}>
        A TradingView indicator that <code>plot()</code>s a value or declares an
        {' '}<code>alertcondition()</code>. Everything the screen would read is listed below,
        {' '}in this engine&apos;s own words, before anything is saved.
      </p>

      <textarea
        ref={areaRef}
        className={styles.area}
        // A phone keyboard that capitalises `Close` produces a name Pine does not
        // declare either — same reasoning as `FormulaField`.
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        rows={8}
        placeholder={PLACEHOLDER}
        aria-label="Pine script"
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {report && (
        <div className={styles.report}>
          <p className={styles.meta} data-testid="pine-meta">
            {report.version != null ? `Pine v${report.version}` : 'No //@version line'}
            {report.declaration ? ` · ${report.declaration}()` : ''}
            {report.title ? ` · “${report.title}”` : ''}
          </p>

          {/* ⛔ THE REFUSAL SHOWS WHENEVER THERE IS ONE, AND `translatePine`
              carries one exactly when it is not `ok`. Gating this on "no column
              translated" hid the refusal for a `strategy()` script whose plot
              DID translate — the script was correctly blocked, `Use` was
              correctly disabled, and the screen said nothing at all about why. */}
          {report.refusal && <Refusal refusal={report.refusal} testId="pine-refusal" />}

          {report.ok && usable.length > 0 && (
            <fieldset className={styles.outputs}>
              <legend className={styles.legend}>
                {usable.length === 1 ? 'This script offers one column' : `This script offers ${usable.length} columns`}
              </legend>
              {report.outputs.map((out, i) => {
                if (!out.formula) {
                  return (
                    <div key={`bad-${out.line}-${i}`} className={styles.outputRow}>
                      <span className={styles.outKind}>{out.kind}</span>
                      <span className={styles.outTitle}>{out.title || `line ${out.line}`}</span>
                      <Refusal refusal={out.refusal} testId={`pine-output-refusal-${i}`} />
                    </div>
                  )
                }
                const down = out.downstream
                return (
                  <label key={`ok-${out.line}-${i}`} className={styles.outputRow}>
                    <input
                      type="radio"
                      name="uct-pine-output"
                      checked={chosen === i}
                      onChange={() => setChosen(i)}
                      disabled={disabled}
                    />
                    <span className={styles.outKind}>{out.kind}</span>
                    <span className={styles.outTitle}>{out.title || `line ${out.line}`}</span>
                    <code className={styles.outFormula} data-testid={`pine-formula-${i}`}>{out.formula}</code>
                    {/* ⭐ THE READ-BACK IS THE ENGINE'S, THROUGH THE SAME DOOR THE
                        TEXT BOX USES. A sentence written here would be a second
                        description of one tree. */}
                    {down?.ok
                      ? <span className={styles.outReadback}>{down.readback}</span>
                      : <span className={styles.outBlocked} data-guard={down?.guard || ''}>{down?.error}</span>}
                  </label>
                )
              })}
            </fieldset>
          )}

          {active && active.inputsFolded && active.inputsFolded.length > 0 && (
            <p className={styles.folded} data-testid="pine-inputs-folded">
              {/* ⭐ SAID OUT LOUD. A knob folded to its default silently would be a
                  formula that means something other than the script the member
                  reads on TradingView. */}
              Inputs are fixed at their defaults:{' '}
              {active.inputsFolded.map((f) => `${f.title || f.call} = ${f.folded}`).join(' · ')}
            </p>
          )}

          {report.notes.length > 0 && (
            <div className={styles.notesWrap}>
              <button
                type="button"
                className={styles.notesToggle}
                aria-expanded={showNotes}
                onClick={() => setShowNotes((v) => !v)}
                data-testid="pine-notes-toggle"
              >
                {showNotes ? 'Hide' : 'Show'} {report.notes.length} line
                {report.notes.length === 1 ? '' : 's'} a screen does not read
              </button>
              {showNotes && (
                <ul className={styles.notes} data-testid="pine-notes">
                  {report.notes.map((n, i) => (
                    <li key={`${n.code}-${n.line}-${i}`} className={styles.note}>
                      <span className={styles.noteWhere}>{n.line != null ? `line ${n.line}` : '—'}</span>
                      <span>{n.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <button
            type="button"
            className={styles.useBtn}
            data-testid="pine-use"
            disabled={disabled || !active || !active.formula}
            onClick={use}
          >
            Use this formula
          </button>
        </div>
      )}
    </section>
  )
}
