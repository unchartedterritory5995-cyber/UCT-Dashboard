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
import { translateThinkScript } from '../engine/ast/thinkscript'
import { detectDialect, DIALECTS } from '../engine/ast/dialect'
import { evaluateFormula } from './FormulaField'
import { BUILDER_INPUT_SCOPE, memberInputTranslation } from './builderInputs'
import { vendorNotesForTree } from '../engine/ast/parse'
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
  // ⭐ THE TRANSLATION THAT KEEPS THE AUTHOR'S KNOBS. `memberInputTranslation`
  // runs `translatePine` twice — once declaring every bound input to find which
  // ones the engine has to fold back into a window, then again declaring only the
  // survivors — and annotates each output with `memberInputs` / `skippedInputs`.
  // ⛔ IT IS NOT A DIFFERENT TRANSLATOR. Same function, same guards, same
  // refusals; the only difference is that a threshold or a multiplier reaches the
  // formula as its own identifier instead of as somebody else's constant.
  const translated = memberInputTranslation(translatePine, source)
  const outputs = translated.outputs.map((out) => ({
    ...out,
    vendorNotes: out.ast ? vendorNotesForTree(out.ast) : [],
    // ⛔ THE DOWNSTREAM VERDICT IS THE DOWNSTREAM DOOR'S. Not a copy of its
    // rules, not a prediction of them — the function itself.
    downstream: out.formula ? evaluateFormula(out.formula, BUILDER_INPUT_SCOPE) : null,
  }))
  // ⭐ `ignored` IS THE ONE NAME THE UI READS. `notes` is kept because it is this
  // function's published shape and other callers read it; the alias is what lets
  // the renderer below have exactly one spelling instead of a fallback chain that
  // silently misses whichever it was not written for.
  return { ...translated, outputs, ignored: translated.notes || [] }
}

/**
 * ⭐⭐ ONE PASTE BOX, FOUR DIALECTS, THE SAME SAVE DOOR.
 *
 * `inspectPine` above answered for Pine alone. This answers for whatever the
 * member pasted, in ONE shape, so no component downstream has to know which
 * translator ran.
 *
 * ⛔ `ignored` IS THE ONE NAME. Pine spells its skipped lines `notes`;
 * thinkScript spells them `ignored`. Normalising here — in ONE place, at the
 * door — is what stops a second spelling entering the UI, where it would become
 * a component that renders one and silently misses the other.
 *
 * ⛔⛔ EVERY REFUSAL IS STAMPED WITH THE TEXT IT WAS MEASURED ON (X13, owed to
 * W1a). `CodeEditor` applies a lint mark ONLY while `diagnostics.source ===` its
 * own document, and FAILS CLOSED on a refusal that names no text — because a
 * refusal without a stamp cannot be told apart from a stale one, and the right
 * token underlined under the wrong sentence is worse than no mark at all. A
 * translator refusal carries `line`/`column` INTO THE PASTE, so the stamp is the
 * PASTE, never the formula: an editor showing the formula then correctly marks
 * nothing, and an editor showing the paste marks the token the member wrote.
 * ⭐ THE STAMP IS THE CONTRACT — without it a member sees no mark at all, which
 * is the failure that deleted the `Diagnostic[]` door.
 *
 * @param {string} source the pasted text
 * @param {'auto'|'pine'|'thinkscript'|'pcf'|'formula'} [dialect]
 * @returns {{ok, dialect, version, outputs, selected, refusal, ignored, folded}}
 */
export function inspectSource(source, dialect = 'auto') {
  const chosen = dialect === 'auto' ? detectDialect(source) : dialect
  /* istanbul ignore next — `DIALECTS` is the closed set; a caller typo is a bug */
  const lang = DIALECTS.includes(chosen) ? chosen : 'formula'

  // ⛔ THE STAMP GOES ON EVERY REFUSAL THIS FUNCTION RETURNS, at the one place
  // that knows which text produced them. Doing it per call site is how one path
  // ends up unstamped and silently unmarkable.
  const stamp = (r) => (r ? { ...r, source } : r)

  if (lang === 'pine' || lang === 'thinkscript') {
    // ⛔ THE PINE LANE GOES THROUGH THE MEMBER-INPUT DOOR AND THINKSCRIPT DOES
    // NOT, because `declareInputs` is `pine.js`'s option and thinkScript's own
    // input form has not been given the same hand-back. Routing both through it
    // would be a claim about a capability one of them does not have.
    const t = lang === 'pine'
      ? memberInputTranslation(translatePine, source)
      : translateThinkScript(source)
    const outputs = (t.outputs || []).map((out) => ({
      ...out,
      vendorNotes: out.ast ? vendorNotesForTree(out.ast) : [],
      refusal: stamp(out.refusal),
      downstream: out.formula ? evaluateFormula(out.formula, BUILDER_INPUT_SCOPE) : null,
    }))
    return {
      ok: t.ok,
      dialect: lang,
      version: t.version ?? null,
      declaration: t.declaration ?? null,
      title: t.title ?? null,
      outputs,
      selected: t.selected,
      refusal: stamp(t.refusal),
      // ⭐ Pine's `notes` and thinkScript's `ignored` are the same list.
      ignored: t.ignored || t.notes || [],
      folded: t.folded || [],
    }
  }

  // ⭐ `pcf` AND `formula` ARE NOT TRANSLATED — they ARE the formula source, so
  // the ONE downstream door answers for them directly and there is no second
  // reading of the text. `evaluateFormula` already stamps its own `source`
  // (that is where the shape came from), so a stamp here would be a second
  // authority over the same field.
  const ev = source.trim() === '' ? null : evaluateFormula(source, BUILDER_INPUT_SCOPE)
  const okNow = !!(ev && ev.ok)
  return {
    ok: okNow,
    dialect: lang,
    version: null,
    declaration: null,
    title: null,
    outputs: okNow
      ? [{ kind: 'formula', title: null, line: 1, column: 1, formula: source, refusal: null, downstream: ev }]
      : [],
    selected: okNow ? 0 : -1,
    refusal: okNow || !ev ? null : stamp({
      guard: ev.guard || null, message: ev.error, line: null, column: null, token: null,
    }),
    ignored: [],
    folded: [],
  }
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

/** What the box calls the language it is reading, for the heading and the meta
 *  line. ⛔ Derived from the report's own `dialect`, never from what the box was
 *  asked to read — with `dialect="auto"` those are different answers, and the
 *  member needs the one the detector actually reached. */
const DIALECT_LABEL = Object.freeze({
  pine: 'Pine script', thinkscript: 'thinkScript study',
  pcf: 'TC2000 formula', formula: 'formula',
})

/**
 * @param {Function} onPick     (formulaSource) => void — the ONE output
 * @param {boolean}  [disabled]
 * @param {string}   [initialSource]
 * @param {'auto'|'pine'|'thinkscript'|'pcf'|'formula'} [dialect] `undefined`
 *        keeps the Pine-only behaviour `PineBox` shipped with; anything else
 *        routes through `inspectSource`.
 */
function PasteBox({ onPick, disabled = false, initialSource = '', dialect }) {
  const inspect = useCallback(
    (s) => (dialect === undefined ? inspectPine(s) : inspectSource(s, dialect)),
    [dialect],
  )
  const [text, setText] = useState(initialSource)
  const [report, setReport] = useState(() => (initialSource ? inspect(initialSource) : null))
  const [chosen, setChosen] = useState(null)
  const [showNotes, setShowNotes] = useState(false)
  const areaRef = useRef(null)

  useEffect(() => {
    if (text.trim() === '') { setReport(null); setChosen(null); return undefined }
    const id = setTimeout(() => {
      const next = inspect(text)
      setReport(next)
      setChosen(next.selected >= 0 ? next.selected : null)
    }, PINE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [text, inspect])

  const active = useMemo(() => {
    if (!report || chosen == null) return null
    return report.outputs[chosen] || null
  }, [report, chosen])

  const use = useCallback(() => {
    if (!active || !active.formula) return
    // ⭐⭐ THE OBJECT FORM CARRIES THE AUTHOR'S KNOBS. `BuilderSheet` has branched
    // on `{source, inputs}` since W1b.9 and nothing ever produced one — the only
    // thing that did was a `vi.mock` in its own test, which is the "built, tested,
    // green and reachable from nothing" shape this repo keeps paying for.
    // ⛔ THE STRING FORM IS UNCHANGED FOR EVERY OTHER CALLER. `StarterLibrary` and
    // a paste with no declarable input still hand back a bare string, byte for
    // byte, so the sheet's older path is untouched rather than migrated.
    const rows = active.memberInputs || []
    onPick?.(rows.length ? { source: active.formula, inputs: rows } : active.formula)
  }, [active, onPick])

  const usable = report ? report.outputs.filter((o) => o.formula) : []
  const anyDialect = dialect !== undefined
  // ⛔ THE DETECTED dialect, not the requested one. With `dialect="auto"` the box
  // is asked to read "whatever this is" and the member has to be told what it
  // decided — a heading that still said "Pine" over a thinkScript paste would be
  // a sentence that is false about the text on screen.
  const seen = report && report.dialect ? report.dialect : null

  return (
    <section className={styles.wrap} aria-labelledby="uct-pine-head" data-testid="pine-box">
      <h3 className={styles.head} id="uct-pine-head">
        {anyDialect ? 'Paste a script or a formula' : 'Paste a Pine script'}
      </h3>
      <p className={styles.hint}>
        {anyDialect ? (
          <>
            A TradingView <b>Pine</b> indicator, a thinkorswim <b>thinkScript</b> study, a
            {' '}<b>TC2000</b> formula, or one of this engine&apos;s own. Everything the screen
            {' '}would read is listed below, in this engine&apos;s own words, before anything is
            {' '}saved.
          </>
        ) : (
          <>
            A TradingView indicator that <code>plot()</code>s a value or declares an
            {' '}<code>alertcondition()</code>. Everything the screen would read is listed below,
            {' '}in this engine&apos;s own words, before anything is saved.
          </>
        )}
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
        aria-label={anyDialect ? 'Script or formula' : 'Pine script'}
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {report && (
        <div className={styles.report}>
          <p className={styles.meta} data-testid="pine-meta" data-dialect={seen || ''}>
            {anyDialect
              ? `Read as ${DIALECT_LABEL[seen] || seen}`
              : (report.version != null ? `Pine v${report.version}` : 'No //@version line')}
            {anyDialect && seen === 'pine' && report.version != null ? ` v${report.version}` : ''}
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

          {active && active.vendorNotes && active.vendorNotes.length > 0 && (
            <ul className={styles.notes} data-testid="pine-vendor-notes">
              {/* ⭐⭐ THE SENTENCE THE PRODUCT OWES SOMEBODY WHO PASTED A SCRIPT.
                  Where our answer for a name deliberately differs from the
                  platform they copied it from, they read it HERE — before they
                  commit — rather than discovering it later by comparing two
                  charts and filing a bug. The text is the manifest's own
                  `vendorNote`; this component writes no sentence of its own, for
                  the same reason it renders refusals verbatim.
                  ⛔ IT IS NOT IN THE "lines a screen does not read" LIST. That
                  list is about text we SKIPPED; this is about maths we RAN and
                  ran differently. Collapsing the two would bury a numeric
                  divergence inside a note about syntax. */}
              {active.vendorNotes.map((v) => (
                <li key={v.name} className={styles.note} data-vendor-note={v.name}>
                  <span className={styles.noteWhere}>{v.name}</span>
                  <span>{v.note}</span>
                </li>
              ))}
            </ul>
          )}

          {active && active.memberInputs && active.memberInputs.length > 0 && (
            <p className={styles.folded} data-testid="pine-inputs-kept">
              {/* ⭐⭐ THE HALF THAT USED NOT TO EXIST. These are the author's own
                  controls, carried across as knobs the member can turn after
                  saving — with the author's own minval/maxval as their bounds. */}
              <UIcon name="sliders" size={12} /> Inputs you can change later:{' '}
              {active.memberInputs.map((r) => `${r.label} = ${r.default}`).join(' · ')}
            </p>
          )}

          {active && active.skippedInputs && active.skippedInputs.length > 0 && (
            <p className={styles.folded} data-testid="pine-inputs-folded">
              {/* ⭐ SAID OUT LOUD. A knob folded to its default silently would be a
                  formula that means something other than the script the member
                  reads on TradingView.
                  ⛔ AND IT NOW LISTS ONLY WHAT IS ACTUALLY FIXED. It used to print
                  EVERY folded entry, which was true when nothing could be declared
                  and became a false sentence the moment one could — a member would
                  read "fixed at their defaults" about a control sitting live in
                  their own settings. */}
              Fixed at their defaults:{' '}
              {active.skippedInputs.map((f) => `${f.title || f.name || f.call} = ${f.folded}`).join(' · ')}
              {active.skippedInputs.some((f) => /lands in a WINDOW/.test(f.reason || ''))
                && ' — a length cannot be a member input in this engine, so it stays as written.'}
            </p>
          )}

          {report.ignored.length > 0 && (
            <div className={styles.notesWrap}>
              <button
                type="button"
                className={styles.notesToggle}
                aria-expanded={showNotes}
                onClick={() => setShowNotes((v) => !v)}
                data-testid="pine-notes-toggle"
              >
                {showNotes ? 'Hide' : 'Show'} {report.ignored.length} line
                {report.ignored.length === 1 ? '' : 's'} a screen does not read
              </button>
              {showNotes && (
                <ul className={styles.notes} data-testid="pine-notes">
                  {report.ignored.map((n, i) => (
                    <li key={`${n.code}-${n.line}-${i}`} className={styles.note}>
                      <span className={styles.noteWhere}>{n.line != null ? `line ${n.line}` : '—'}</span>
                      <span>{n.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ⭐ THE DOOR OUT OF "I DO NOT KNOW WHAT I CAN WRITE", placed where the
              member is actually stuck rather than in a menu they would have to
              think to open. The reference is derived from the same manifest this
              box translates against, so what it lists is exactly what a paste
              here can resolve. */}
          <p className={styles.refLink}>
            <a href="/formulas/reference">See every name you can write →</a>
          </p>

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

/**
 * ⭐⭐ THE IMPORT BOX — one paste box, four dialects, the same Save door.
 *
 * ⛔ IT IS THE SAME COMPONENT, not a second one. `PasteBox` renders both, so the
 * refusal chrome, the per-output read-back, the folded-inputs line, the ignored
 * lines and the `Use this formula` button cannot drift between the Pine door and
 * the thinkScript one — which is what a copy of this file would guarantee.
 *
 * ⭐ AND THE TESTIDS ARE UNCHANGED. `pine-box`, `pine-use`, `pine-formula-N` and
 * the rest mean "the paste box", not "the Pine box"; renaming them would have
 * been churn in W1b's test file for no behaviour, and the hand-back stays the two
 * lines the brief asked for.
 */
export function ImportBox({ onPick, disabled = false, initialSource = '', dialect = 'auto' }) {
  return (
    <PasteBox onPick={onPick} disabled={disabled} initialSource={initialSource} dialect={dialect} />
  )
}

/** The Pine-only box, byte-identical in behaviour to what it was: no `dialect`
 *  prop means `inspectPine`, the Pine heading and the Pine aria-label. */
export default function PineBox({ onPick, disabled = false, initialSource = '' }) {
  return <PasteBox onPick={onPick} disabled={disabled} initialSource={initialSource} />
}
