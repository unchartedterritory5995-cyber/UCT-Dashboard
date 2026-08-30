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
import { COMPARISONS, conditionFrom, yieldsCondition, operatorLabel } from './toCondition'
import { splitPaste, inspectLibrary } from './libraryIntake'
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
export function inspectPine(source, opts = undefined) {
  // ⭐ THE TRANSLATION THAT KEEPS THE AUTHOR'S KNOBS. `memberInputTranslation`
  // runs `translatePine` twice — once declaring every bound input to find which
  // ones the engine has to fold back into a window, then again declaring only the
  // survivors — and annotates each output with `memberInputs` / `skippedInputs`.
  // ⛔ IT IS NOT A DIFFERENT TRANSLATOR. Same function, same guards, same
  // refusals; the only difference is that a threshold or a multiplier reaches the
  // formula as its own identifier instead of as somebody else's constant.
  const translated = memberInputTranslation(translatePine, source, opts || {})
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
export function inspectSource(source, dialect = 'auto', opts = undefined) {
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
    // ⛔ THE OPTIONS REACH THE PINE LANE ONLY, and that is not an oversight to
    // tidy up later: `inputValues` is `pine.js`'s option and `translateThinkScript`
    // has no equivalent. Passing it to both would be a claim about a capability one
    // of them does not have — the same reasoning that keeps thinkScript off the
    // member-input door two lines below.
    const t = lang === 'pine'
      ? memberInputTranslation(translatePine, source, opts || {})
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
      {/* ⭐⭐ THE OFFER, WHERE THE MEMBER IS ALREADY LOOKING. thinkorswim publishes
          no default for some study parameters, and this engine REFUSES to assume
          one — `displace` shifts every bar, and a guessed `price` draws a
          plausible column that is wrong everywhere with no refusal anywhere. So
          the conventional call is shown and the MEMBER applies it: typed into
          their own script the value is visible in the read-back, which is the
          whole difference between their choice and our silent guess. */}
      {refusal.suggest && (
        <div className={styles.suggest} data-testid="import-suggest">
          <span className={styles.suggestLead}>
            thinkorswim doesn’t publish these defaults, so this engine won’t assume
            them. The conventional call is:
          </span>
          <code className={styles.suggestCall}>{refusal.suggest}</code>
          <span className={styles.suggestWhy}>
            Write the arguments into your own call and it translates — and because
            they are in your script, you can see what was assumed.
          </span>
        </div>
      )}
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
/** ⭐⭐ THE AUTHOR'S LENGTHS, PER OUTPUT — the rows this box turns into fields.
 *
 *  ⛔ IT READS THE FLAG, NOT THE SENTENCE. `builderInputs.js` stamps
 *  `windowBound` on every skipped row whose refusal is the window one, by EITHER
 *  of the two paths that reach it. This used to match `/lands in a WINDOW/`
 *  against the prose, which is a second authority over a fact the door already
 *  knows and would have started silently rendering nothing the day somebody
 *  reworded a refusal.
 *
 *  ⚠️ AND ONLY THE NUMERIC ONES. `folded` is what the translator PRINTED, so a
 *  source input reads `close` and a bool reads `1` — neither is a length, and a
 *  number field seeded with `close` would be a control that cannot be used. */
function windowKnobsOf(output) {
  return (output?.skippedInputs || []).filter(
    (k) => k.windowBound === true && k.name && Number.isFinite(Number(k.folded)))
}

/** The member's typed text → the `inputValues` map `translatePine` takes.
 *
 *  ⛔⛔ A BLANK FIELD SENDS NOTHING, AND `Number('')` IS `0`. Blank means "leave
 *  the author's default alone"; passing `0` for it would silently substitute a
 *  zero-bar window for the length the member is looking at, and this engine's
 *  whole reason for existing is not to answer a plausible different number.
 *
 *  ⚠️ A NON-NUMERIC ENTRY IS PASSED THROUGH AS TYPED rather than dropped. The
 *  translator refuses a non-number by name (`pine:input-kind`), and that refusal
 *  is what the member needs to see — dropping it here would silently fall back to
 *  the author's default and show a formula that is not the one they asked for. */
function memberLengths(lengths) {
  const out = {}
  for (const [name, raw] of Object.entries(lengths || {})) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    const n = Number(raw)
    out[name] = Number.isFinite(n) ? n : raw
  }
  return out
}

function PasteBox({ onPick, disabled = false, initialSource = '', dialect }) {
  const inspect = useCallback(
    (s, opts) => (dialect === undefined ? inspectPine(s, opts) : inspectSource(s, dialect, opts)),
    [dialect],
  )
  const [text, setText] = useState(initialSource)
  const [report, setReport] = useState(() => (initialSource ? inspect(initialSource) : null))
  const [chosen, setChosen] = useState(null)
  const [showNotes, setShowNotes] = useState(false)
  const areaRef = useRef(null)

  // ⭐⭐ THE MEMBER'S OWN LENGTHS. `translatePine`'s `inputValues` has shipped,
  // tested and green since the knob work — and until now its only caller was its
  // own test file. Measured: 21 of the 43 corpus scripts that translate lose at
  // least one length to the window ceiling, and only 2 of the 43 blocked knobs
  // declare a `maxval`, so "read the author's bounds" would have unlocked almost
  // nothing. What a member actually wants is to set the length THEY trade, at the
  // moment they are looking at the script. This is that door.
  //
  // ⛔ THE TREE STILL HOLDS A LITERAL. Nothing about static decidability moved:
  // the value is fixed BEFORE translation, so `maxLookback` is still a pure tree
  // sum over `num` nodes and the repaint linter still decides statically. A
  // different length is a different indicator and gets a different `astHash`,
  // which is correct rather than a workaround.
  const [lengths, setLengths] = useState({})

  // ⛔⛔ THE ROSTER IS THE PRISTINE TRANSLATION'S, AND THAT IS WHY IT IS STATE.
  // Once a member sets a length, the re-translation reports `folded` as THEIR
  // value — so reading the roster off the live report would lose the author's
  // default the moment it is overridden, and the field could no longer say what
  // it is departing from. It is refreshed only on a pass with no overrides.
  //
  // ⚠️ PER OUTPUT, matching the "Fixed at their defaults" line beside it. A
  // script can plot two columns off different inputs.
  const [authorKnobs, setAuthorKnobs] = useState(
    () => (initialSource && report ? (report.outputs || []).map(windowKnobsOf) : []))

  // ⛔ A NEW PASTE FORGETS THE OLD LENGTHS, and this ref is how the effect can
  // tell "the member typed in the script" from "the member turned a knob".
  // `translatePine` ignores a name that is not an input of the script it was
  // handed, so a stale knob is usually inert — but `len` is the commonest
  // identifier in the corpus, and carrying one paste's `len` into the next would
  // silently compute a length the member never chose for it.
  const lastTextRef = useRef(initialSource)

  useEffect(() => {
    if (text.trim() === '') {
      setReport(null); setChosen(null); setAuthorKnobs([]); return undefined
    }
    const id = setTimeout(() => {
      const values = memberLengths(lengths)
      const overridden = Object.keys(values).length > 0
      const next = inspect(text, overridden ? { inputValues: values } : undefined)
      const isNewText = lastTextRef.current !== text
      lastTextRef.current = text
      setReport(next)
      // ⛔ A LENGTH CHANGE MUST NOT MOVE THE MEMBER'S PICK. Re-selecting
      // `next.selected` on every pass would snap a two-plot script back to the
      // first column each time a field is touched.
      setChosen((prev) => ((isNewText || prev == null)
        ? (next.selected >= 0 ? next.selected : null) : prev))
      if (!overridden) setAuthorKnobs((next.outputs || []).map(windowKnobsOf))
    }, PINE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [text, lengths, inspect])

  const active = useMemo(() => {
    if (!report || chosen == null) return null
    return report.outputs[chosen] || null
  }, [report, chosen])

  // ⭐⭐ A NUMERIC COLUMN CAN BE CHARTED BUT NOT SCREENED ON, and this is where the
  // member turns one into a screen. Measured: 41 corpus scripts translate, all 41
  // save, and only 19 can be RUN as a screen — every refusal is the `yields` gate
  // saying "this tree returns a number". Nothing here softens that gate; the member
  // supplies the comparison that satisfies it, exactly as TradingView's Pine
  // Screener has them pick an operator beside a plotted column.
  //
  // ⛔ AND IT IS OPTIONAL BY DESIGN. A number is a perfectly good column to chart,
  // so the box does not demand a threshold to let the member proceed — leaving it
  // blank hands back the column itself, unchanged.
  const [screenOp, setScreenOp] = useState(COMPARISONS[0] || '>')
  const [screenValue, setScreenValue] = useState('')

  // ⭐⭐ A WHOLE FOLDER, THROUGH THE BOX THAT ALREADY EXISTS. A member arriving
  // with years of scripts discovers the answer one paste at a time today, so they
  // meet their third refusal before a chart has drawn. If the paste holds more than
  // one script, this box answers the bigger question instead of the small one.
  //
  // ⛔ NO NEW TAB, AND THAT IS DELIBERATE. `ImportBox.thinkscript.test.js` records
  // the ruling: ONE BOX, not a second paste surface. Pasting forty scripts is the
  // same act as pasting one — the box simply notices which happened.
  const library = useMemo(() => {
    const split = splitPaste(text)
    if (split.found < 2) return null
    return { split, report: inspectLibrary(split.scripts) }
  }, [text])

  // ⭐ THE FIELDS THE MEMBER SEES, and the ONE place `chosen` selects them.
  const lengthKnobs = useMemo(
    () => (chosen == null ? [] : (authorKnobs[chosen] || [])), [authorKnobs, chosen])

  // ⛔ EVERYTHING ELSE THAT STAYED FOLDED, WITHOUT THE LENGTHS. The sentence
  // below says "fixed at their defaults", which stopped being true of a length the
  // moment there was a field for it — and a member reading that about a control
  // sitting live two lines above would be reading a false sentence about the
  // screen in front of them. Same shape as the note this line already carries: it
  // once printed EVERY folded entry and became false the day one could be a knob.
  const plainSkipped = useMemo(
    () => (active?.skippedInputs || []).filter((k) => k.windowBound !== true), [active])

  const numericColumn = !!(active && active.formula && !yieldsCondition(active.formula))
  const condition = useMemo(() => {
    if (!numericColumn || String(screenValue).trim() === '') return null
    return conditionFrom(active.formula, screenOp, screenValue)
  }, [numericColumn, active, screenOp, screenValue])

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
    // ⛔ THE COMPARISON WRAPS THE COLUMN, so the author's knobs still sit inside it
    // and travel unchanged. A member who left the threshold blank gets the column.
    const picked = condition && condition.ok ? condition.formula : active.formula
    onPick?.(rows.length ? { source: picked, inputs: rows } : picked)
  }, [active, onPick, condition])

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
        onChange={(e) => { setText(e.target.value); setLengths({}) }}
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

          {/* ⭐⭐ THE LENGTHS, AS FIELDS — the half of a pasted script that used to
              arrive as somebody else's constant with no way to change it.
              ⛔ RENDERED FROM `authorKnobs`, NOT FROM `active`. An out-of-range
              value refuses the whole translation, so `active` is null exactly
              when the member most needs the field they must correct — reading
              the live report here would make the control vanish at the moment it
              is wanted, leaving a refusal and nothing to act on. */}
          {lengthKnobs.length > 0 && (
            <div className={styles.lengths} data-testid="pine-lengths">
              <p className={styles.folded}>
                <UIcon name="sliders" size={12} /> Lengths — set them here, before you save
              </p>
              <div className={styles.lengthRow}>
                {lengthKnobs.map((k) => (
                  <label key={k.name} className={styles.lengthField}>
                    <span className={styles.lengthLabel}>{k.title || k.name}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      className={styles.lengthInput}
                      data-testid={`pine-length-${k.name}`}
                      aria-label={`${k.title || k.name} length`}
                      value={lengths[k.name] ?? ''}
                      placeholder={String(k.folded)}
                      min={Number.isFinite(k.min) ? k.min : undefined}
                      max={Number.isFinite(k.max) ? k.max : undefined}
                      disabled={disabled}
                      onChange={(e) => setLengths(
                        (p) => ({ ...p, [k.name]: e.target.value }))}
                    />
                    {/* ⛔ THE AUTHOR'S NUMBER STAYS ON SCREEN once it has been
                        departed from. A field showing 21 with no trace of the 14
                        it replaced cannot be checked against the script the
                        member is reading on TradingView. */}
                    {(lengths[k.name] ?? '') !== '' && String(k.folded) !== lengths[k.name] && (
                      <span className={styles.lengthWas} data-testid={`pine-length-was-${k.name}`}>
                        was {k.folded}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <p className={styles.folded}>
                {/* ⛔ THE MECHANISM, NOT AN APOLOGY. A length is fixed before the
                    formula is translated — that is what keeps the window a literal
                    and the repaint verdict decidable — so it is a choice made HERE
                    rather than a knob turned later. Saying so is what stops a
                    member hunting for a gear that will not exist. */}
                A length is baked into the formula this engine saves, so it is chosen here
                {' '}rather than turned afterwards. Leave a field blank to keep the author’s.
              </p>
            </div>
          )}

          {active && plainSkipped.length > 0 && (
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
              {plainSkipped.map((f) => `${f.title || f.name || f.call} = ${f.folded}`).join(' · ')}
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

          {/* ⭐⭐ THE LIBRARY MANIFEST. Four reaches, never one number: translating
              is not computing, computing is not saveable, saveable is not
              screenable, and on the committed corpora those differ by more than
              half. One blended headline would be us computing a marketing claim
              about a member's own work at the moment of maximum doubt. */}
          {library && (
            <div className={styles.manifest} data-testid="pine-library">
              <span className={styles.manifestLead}>
                {library.report.total} scripts in that paste
                {library.split.how === 'version-marker'
                  ? ' — split on each `//@version` line. A script without that header'
                    + ' joins the one above it, so check this count against what you pasted.'
                  : ''}
              </span>
              <div className={styles.manifestReaches}>
                {[
                  ['translate', library.report.translates],
                  ['compute', library.report.computes],
                  ['save', library.report.saves],
                  ['screen as written', library.report.screensAsWritten],
                ].map(([label, n]) => (
                  <span key={label} className={styles.manifestReach}>
                    <strong>{n}</strong> {label}
                  </span>
                ))}
              </div>
              {library.report.screensWithComparison > 0 && (
                <span className={styles.manifestNote}>
                  {library.report.screensWithComparison} more can screen once you say what
                  you are looking for — pick one below and add a comparison.
                </span>
              )}
              <ul className={styles.manifestRows}>
                {library.report.rows.map((r, i) => (
                  <li key={i} className={styles.manifestRow} data-ok={r.translates ? '1' : '0'}>
                    <span className={styles.manifestName}>{r.name}</span>
                    {r.translates
                      ? <code className={styles.manifestFormula}>{r.formula}</code>
                      : (
                        <span className={styles.manifestWhy}>
                          <span className={styles.manifestGuard}>{r.refusal?.guard}</span>
                          {r.refusal?.message}
                          {/* ⛔ WHAT CAME ACROSS ANYWAY. A script with six plots where
                              one refuses is not a failure, and saying so is both
                              wrong and discouraging. */}
                          {r.partial.length > 0 && (
                            <span className={styles.manifestPartial}>
                              {r.partial.length} column{r.partial.length === 1 ? '' : 's'} from
                              this script did translate
                            </span>
                          )}
                        </span>
                      )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* ⭐⭐ THE COLUMN IS A NUMBER — OFFER TO MAKE IT A SCREEN. This is the
              single biggest measured gap in the paste path: 41 scripts translate
              and save, only 19 can be scanned, and every refusal is the `yields`
              gate. The gate is right; what was missing is the one thing the
              member has to say. */}
          {numericColumn && (
            <div className={styles.toScreen} data-testid="pine-to-screen">
              <span className={styles.toScreenLead}>
                This column is a number, so it can be charted as it is. To SCREEN
                with it, say what you are looking for:
              </span>
              <div className={styles.toScreenRow}>
                <code className={styles.toScreenCol}>{active.formula}</code>
                <select
                  className={styles.toScreenOp}
                  data-testid="pine-screen-op"
                  aria-label="comparison"
                  value={screenOp}
                  disabled={disabled}
                  onChange={(e) => setScreenOp(e.target.value)}
                >
                  {COMPARISONS.map((op) => (
                    <option key={op} value={op}>{operatorLabel(op)}</option>
                  ))}
                </select>
                <input
                  className={styles.toScreenValue}
                  data-testid="pine-screen-value"
                  aria-label="threshold"
                  type="text"
                  inputMode="decimal"
                  placeholder="value"
                  value={screenValue}
                  disabled={disabled}
                  onChange={(e) => setScreenValue(e.target.value)}
                />
              </div>
              {condition && condition.ok && (
                <code className={styles.toScreenPreview} data-testid="pine-screen-preview">
                  {condition.formula}
                </code>
              )}
              {condition && !condition.ok && (
                <span className={styles.toScreenWhy} data-testid="pine-screen-why">
                  {condition.reason}
                </span>
              )}
              {/* ⛔ SAY WHAT HAPPENS IF THEY LEAVE IT BLANK, rather than letting an
                  empty box read as an unfinished step. */}
              {!condition && (
                <span className={styles.toScreenWhy}>
                  Leave this blank to keep the column as it is — you can still chart it.
                </span>
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
