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
import { memberNumber, isNumericText } from '../engine/ast/memberValue'
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
/** ⭐⭐ THE INPUTS A MEMBER CAN SET AT PASTE TIME, AND THE ONES THAT STAY PUT —
 *  in ONE shape, whichever translator read the script.
 *
 *  ⛔⛔ NORMALISED HERE, AT THE DOOR, FOR THE REASON THIS FILE ALREADY STATES ABOUT
 *  `ignored`: *"Normalising here — in ONE place, at the door — is what stops a
 *  second spelling entering the UI, where it would become a component that renders
 *  one and silently misses the other."* The two lanes hand back different shapes:
 *  Pine has been through `memberInputTranslation` and carries `skippedInputs` with
 *  a `windowBound` flag, thinkScript has no declare mode at all and carries only
 *  `inputsFolded`. A renderer that sniffed for one of those would render the Pine
 *  lane and silently show nothing for the other — which is exactly the state this
 *  change is fixing.
 *
 *  ⛔ SETTABLE MEANS "THE AUTHOR'S OWN DEFAULT IS A NUMBER". `input.source(hl2)`
 *  folds to `(high + low) / 2` and `input averageType = AverageType.WILDERS` folds
 *  to a name; a number field seeded with either is a control nobody can use, and
 *  both translators refuse a number aimed at one BY NAME rather than dropping it.
 *
 *  ⚠️ THE PREDICATE IS THE ENGINE'S (`memberValue.js`), not a local copy. That
 *  module exists because `Number(null)` is `0` — the coercion defect measured on
 *  the shipped Pine door — and a second answer here would let the box offer a
 *  field the translator then refuses, or hide one it would have taken. */
function splitFoldedInputs(out) {
  const settable = []
  const fixed = []
  // ⛔ THE PINE LANE'S OWN SPLIT COMES FIRST AND IS NOT RE-DERIVED. A Pine input
  // that could be a LIVE knob is already in `memberInputs` and must not appear
  // here as a paste-time field too — two controls for one value, disagreeing.
  const rows = Array.isArray(out?.skippedInputs)
    ? out.skippedInputs.filter((k) => k.windowBound === true)
    : (out?.inputsFolded || [])
  const others = Array.isArray(out?.skippedInputs)
    ? out.skippedInputs.filter((k) => k.windowBound !== true)
    : []
  for (const k of rows) {
    if (k && k.name && isNumericText(k.folded)) settable.push(k)
    else fixed.push(k)
  }
  return { pasteInputs: settable, fixedInputs: [...fixed, ...others] }
}

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
    ...splitFoldedInputs(out),
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
    // ⚰️ THIS COMMENT SAID THE OPTIONS REACH THE PINE LANE ONLY, *"and that is
    // not an oversight to tidy up later: `inputValues` is `pine.js`'s option and
    // `translateThinkScript` has no equivalent."* It was true when written and
    // false one commit later — the exact shape of
    // `lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`, where a
    // sentence explaining why something is NOT checked is how a false premise
    // never gets revisited. Measured: 6 of the 10 thinkScript studies that
    // translate fold 22 inputs between them, and not one reached the member.
    //
    // ⛔ WHAT IS STILL PINE-ONLY IS `declareInputs`, and that is a real
    // difference: a LIVE knob needs a declare mode thinkScript has no equivalent
    // for. A PASTE-TIME value needs only that the translator freeze it, which both
    // now do, with the same semantics and the same shared predicate.
    const t = lang === 'pine'
      ? memberInputTranslation(translatePine, source, opts || {})
      : translateThinkScript(source, opts || {})
    const outputs = (t.outputs || []).map((out) => ({
      ...out,
      ...splitFoldedInputs(out),
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

function Refusal({ refusal, testId, dialect, onApply = null }) {
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
      {/* ⚰️⚰️ THIS FRAME NAMED THINKORSWIM TO EVERY MEMBER WHO SAW IT, and the
          Pine door emits suggestions too. Measured THROUGH `inspectSource` — the
          door a member actually types at, not `translatePine` directly:
            plot(ta.wma(close, 27.5))                     → pine:window,
                                                            suggest hma(close, 55)
            request.security(syminfo.tickerid, "240", …)  → pine:request,
                                                            suggest timeframe.period
          Ordinary Pine, and both read a sentence about thinkorswim plus a reason
          ("these defaults are not published") that is false of each: `hma` is
          offered because this engine DECLARES it and it spares a hand-expansion,
          and `timeframe.period` is not a default in any sense.
          ⚠️ NO COMMITTED FIXTURE REACHES IT. A first pass "measured" four corpus
          Pine scripts carrying a suggest — true of `translatePine`, FALSE of the
          door: the member-input translation lands all four on an earlier wall.
          The bug is real and the corpus cannot show it, which is why the rail
          uses constructed scripts (`lesson_a_projection_drops_what_it_does_not_name`
          in spirit — measure through the shipping reader, not the engine).
          ⭐ THE FILE ALREADY RULED ON THIS SHAPE, for the heading: "a heading that
          still said 'Pine' over a thinkScript paste would be a sentence that is
          false about the text on screen." Same fix, same source of truth — the
          DETECTED dialect.
          ⚠️ THE PINE LEAD DELIBERATELY EXPLAINS NOTHING. Its four cases have
          different reasons and the refusal message directly above already carries
          each one; a lead that tried to cover both `hma` and `timeframe.period`
          would have to be vague enough to be false about one of them. If the
          reasons ever need to differ WITHIN a dialect, the lead belongs on the
          refusal object beside the guard that chose it, not here. */}
      {refusal.suggest && (
        <div className={styles.suggest} data-testid="import-suggest">
          <span className={styles.suggestLead}>
            {dialect === 'thinkscript'
              ? 'thinkorswim doesn’t publish these defaults, so this engine won’t '
                + 'assume them. The conventional call is:'
              : 'This engine declares a call that does translate:'}
          </span>
          <code className={styles.suggestCall}>{refusal.suggest}</code>
          {/* ⭐⭐ THE ACCEPT, WHICH THE RULING ALWAYS DESCRIBED AND NOTHING OFFERED.
              `TS_DOC_BLOCKED` says in as many words: *"the member applies it — they
              accept it, it lands in the script, and the formula read-back shows
              `length = 14, price = close` in their own text."* Until this button
              there was no accepting it: the member read the call and retyped it,
              which for `05-bollinger-rsi` is the same call four times over two
              lines and then a fifth for its RSI.

              ⛔ NOTHING ABOUT THE RULING MOVED. The edit is not applied FOR them —
              it lands in the textarea they are looking at, in their own source, and
              can be typed over or undone. What is refused is still assuming a value
              they never saw; what is offered is still exactly the text above.

              ⚠️ AND IT ONLY APPEARS WHERE THE ENGINE CAN NAME THE CHARACTERS. Pine
              carries `span: null`, so this button is absent on that door rather
              than guessing at a place to put the text — which, with four identical
              calls in one script, would land it in the wrong one three times out
              of four. */}
          {onApply && refusal.span && (
            <button
              type="button"
              className={styles.suggestApply}
              data-testid="import-suggest-apply"
              onClick={() => onApply(refusal)}
            >
              Put this in my script
            </button>
          )}
          <span className={styles.suggestWhy}>
            {dialect === 'thinkscript'
              ? (onApply && refusal.span
                ? 'It lands in your own script, where you can see it and change it — '
                  + 'so the numbers it reads are yours rather than ours.'
                : 'Write the arguments into your own call and it translates — and '
                  + 'because they are in your script, you can see what was assumed.')
              : 'Write it into your own script and what it says stays visible there.'}
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
function memberSettings(settings) {
  const out = {}
  for (const [name, raw] of Object.entries(settings || {})) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    // ⛔ `memberNumber`, THE ENGINE'S OWN PREDICATE. A blank is already gone
    // above; anything else that is not a number is forwarded AS TYPED so the
    // translator refuses it by name, which is what the member needs to see.
    const n = memberNumber(raw)
    out[name] = n === null ? raw : n
  }
  return out
}

/** ⭐⭐ THE EDITOR CHUNK — built, tested against Pine, and mounted by nothing.
 *
 *  ⚰️ `editor/languages.js` defines `pineLanguage` off `PINE_CALL_SHAPES` and
 *  `languageFor` answers `case 'pine'`; `CodeEditor.test.jsx` already mounts it
 *  with `dialect: 'pine'`. The only production caller was `FormulaField`, which
 *  passes `result.dialect === 'pcf' ? 'pcf' : 'formula'` — so `'pine'` could
 *  never be the value, and the Pine authoring surface stayed a bare
 *  `<textarea rows={8}>` while a Pine-aware editor sat one import away.
 *
 *  ⛔ A FAILED LOAD IS THE TEXTAREA, NOT A RELOAD — `FormulaField`'s own ruling
 *  for the same chunk: this is an inline enhancement of a box that already
 *  works, and a hard reload would throw away a member's draft. */
function loadEditor() {
  return import('./editor/CodeEditor').then((m) => m.default).catch(() => null)
}

function PasteBox({ onPick, disabled = false, initialSource = '', dialect, onSourceChange, onImportTelemetry }) {
  const inspect = useCallback(
    (s, opts) => (dialect === undefined ? inspectPine(s, opts) : inspectSource(s, dialect, opts)),
    [dialect],
  )
  const [text, setText] = useState(initialSource)
  const [report, setReport] = useState(() => (initialSource ? inspect(initialSource) : null))
  const [chosen, setChosen] = useState(null)
  const [showNotes, setShowNotes] = useState(false)
  const [Editor, setEditor] = useState(null)
  const areaRef = useRef(null)

  // ⭐⭐ THE MEMBER'S OWN VALUES. `translatePine`'s `inputValues` has shipped,
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
  const [settings, setSettings] = useState({})

  // ⛔⛔ THE ROSTER IS THE PRISTINE TRANSLATION'S, AND THAT IS WHY IT IS STATE.
  // Once a member sets a length, the re-translation reports `folded` as THEIR
  // value — so reading the roster off the live report would lose the author's
  // default the moment it is overridden, and the field could no longer say what
  // it is departing from. It is refreshed only on a pass with no overrides.
  //
  // ⚠️ PER OUTPUT, matching the "Fixed at their defaults" line beside it. A
  // script can plot two columns off different inputs.
  const [authorKnobs, setAuthorKnobs] = useState(
    () => (initialSource && report ? (report.outputs || []).map((o) => o.pasteInputs || []) : []))

  // ⛔ A NEW PASTE FORGETS THE OLD VALUES, and this ref is how the effect can
  // tell "the member typed in the script" from "the member turned a knob".
  // `translatePine` ignores a name that is not an input of the script it was
  // handed, so a stale knob is usually inert — but `len` is the commonest
  // identifier in the corpus, and carrying one paste's `len` into the next would
  // silently compute a length the member never chose for it.
  const lastTextRef = useRef(initialSource)

  // ⛔ THE TEXTAREA STAYS AND IS NEVER UNMOUNTED. It is the value carrier and
  // the fallback; when the chunk lands it is hidden and the editor renders
  // beside it — the arrangement `FormulaField` already ships, and the reason
  // every existing rail that types into `pine-box textarea` keeps working.
  useEffect(() => {
    let alive = true
    loadEditor().then((component) => { if (alive && component) setEditor(() => component) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (text.trim() === '') {
      setReport(null); setChosen(null); setAuthorKnobs([]); return undefined
    }
    const id = setTimeout(() => {
      const values = memberSettings(settings)
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
      if (!overridden) setAuthorKnobs((next.outputs || []).map((o) => o.pasteInputs || []))
    }, PINE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [text, settings, inspect])

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
  const settingFields = useMemo(
    () => (chosen == null ? [] : (authorKnobs[chosen] || [])), [authorKnobs, chosen])

  // ⛔ EVERYTHING ELSE THAT STAYED FOLDED, WITHOUT THE LENGTHS. The sentence
  // below says "fixed at their defaults", which stopped being true of a length the
  // moment there was a field for it — and a member reading that about a control
  // sitting live two lines above would be reading a false sentence about the
  // screen in front of them. Same shape as the note this line already carries: it
  // once printed EVERY folded entry and became false the day one could be a knob.
  const plainSkipped = useMemo(() => (active?.fixedInputs || []), [active])

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
    // ⭐ Phase One Track C — a SEPARATE, purely-additive notification channel,
    // deliberately NOT folded into `onPick`'s own payload. `onPick`'s shape
    // (a bare string, or `{source, inputs}`) is a heavily-guarded contract —
    // see the STRING FORM note two lines up — and every existing caller
    // (`StarterLibrary`, today's `ImportBox`) only understands it as
    // documented today. `onImportTelemetry` is orthogonal: it reports THAT a
    // pick happened and under which dialect, for a caller (`BuilderSheet`)
    // that wants to correlate this moment with the eventual save, without
    // touching what `onPick` itself carries. Fires only here — the same
    // guarded, deliberate "Apply" action `onPick` fires from — never on a
    // keystroke, so pasting and revising text repeatedly before applying
    // logs nothing until the member actually commits to a translation.
    //
    // ⛔ READS `report.dialect` DIRECTLY, NOT THE LATER `seen` CONST — `seen`
    // is declared further down this component's body, and closing over it
    // here would be a temporal-dead-zone reference at first render.
    onImportTelemetry?.((report && report.dialect) || 'pine')
  }, [active, onPick, onImportTelemetry, condition, report])

  // ⚰️⚰️ THIS COUNTED EVERY ROW WITH A FORMULA, and it is what a member reads.
  //
  // Both engines already stamp `hidden` on a row that is not a column a screen
  // can answer from — an author's `display.none`, or a tree that touches no bar
  // and is therefore the same number for every symbol. Neither flag reached here.
  // MEASURED across the three corpora: the member was offered 173 columns and
  // 126 can screen. `03-rsi-directional-momentum-scanner` alone announced
  // "This script offers 18 columns" and had 4 — the other 14 were the literal
  // `0`, each with its own radio button and its own title, one of them
  // "Cont 3rd Short", a saveable scan matching NOTHING on every symbol forever.
  // ⛔ THE ENGINE KNEW, TWICE, AND THE DOOR ASKED NEITHER. `pine.js`'s own
  // comment describes this exact script. Reading `hidden` here is not a new rule;
  // it is this surface finally asking the question the rows already answer
  // (`lesson_a_second_authority_over_one_value`).
  const usable = report ? report.outputs.filter((o) => o.formula && !o.hidden) : []
  const anyDialect = dialect !== undefined
  // ⛔ THE DETECTED dialect, not the requested one. With `dialect="auto"` the box
  // is asked to read "whatever this is" and the member has to be told what it
  // decided — a heading that still said "Pine" over a thinkScript paste would be
  // a sentence that is false about the text on screen.
  /** ⭐⭐ THE ONLY WRITER OF `text`, so nothing can change the member's script
   *  without the sheet above hearing about it.
   *
   *  ⛔⛔ THE TEXTAREA IS NOT THE ONLY WRITER — `applySuggestion` is the other,
   *  and it is the one that would have been missed. A member who accepts an
   *  offered call has just made the most valuable edit in the box; reporting only
   *  keystrokes would have lost exactly that one
   *  (`lesson_one_grammar_four_hand_written_copies`).
   *
   *  ⚠️ `setSettings({})` RIDES ALONG BECAUSE IT ALWAYS DID. The knob values a
   *  member set belong to the script that was on screen; carrying them onto a
   *  different script is how a length from the old text ends up folded into the
   *  new one. */
  const commitText = useCallback((next) => {
    setText(next)
    setSettings({})
    if (onSourceChange) onSourceChange(next)
  }, [onSourceChange])

  /** ⭐⭐ ACCEPT THE OFFERED CALL — splice it into the member's own source.
   *
   *  ⛔⛔ IT SPLICES `refusal.source`, NEVER `text`, AND THAT IS THE WHOLE SAFETY
   *  OF IT. `report` is DEBOUNCED (`PINE_DEBOUNCE_MS`), so between a keystroke and
   *  the next inspection the offsets on screen describe a script that is one edit
   *  old. Applying those offsets to the CURRENT text would cut at the wrong
   *  characters — silently, since any splice produces some string. `stamp` already
   *  carries the exact source each refusal was computed from, so the edit is
   *  applied to the text the engine actually read, and the two can never disagree.
   *
   *  ⚠️ AND IF THE MEMBER HAS TYPED SINCE, IT DECLINES RATHER THAN GUESSING.
   *  Splicing the stale source would silently discard whatever they just wrote;
   *  the next inspection is milliseconds away and the button comes back live.
   *
   *  ⭐ IT MIRRORS THE TEXTAREA'S OWN `onChange` (`setText` + `setSettings({})`)
   *  rather than restating what a text change means — accepting a suggestion IS a
   *  text change, and a second opinion about that would drift
   *  (`lesson_a_second_authority_over_one_value`). */
  const applySuggestion = useCallback((refusal) => {
    if (!refusal || !refusal.suggest || !Array.isArray(refusal.span)) return
    const src = refusal.source
    if (typeof src !== 'string' || src !== text) return
    const [from, to] = refusal.span
    if (!(from >= 0 && to >= from && to <= src.length)) return
    commitText(src.slice(0, from) + refusal.suggest + src.slice(to))
  }, [text, commitText])

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
        onChange={(e) => commitText(e.target.value)}
        tabIndex={Editor ? -1 : undefined}
        aria-hidden={Editor ? 'true' : undefined}
      />
      {Editor && (
        <Editor
          value={text}
          onChange={commitText}
          // ⭐ THE DETECTED DIALECT, NEVER A SECOND `detectDialect`. `seen` is
          // the report's own answer, which is the same rule `FormulaField`
          // states for its own editor — with `dialect="auto"` a second
          // detection here could highlight one language while the door reads
          // another.
          dialect={seen || 'pine'}
          // ⭐⭐ THE REFUSAL BECOMES A GUTTER MARK — and it is the REFUSAL, not the
          // report. `CodeEditor` gates every mark on
          // `diagnostics.source === view.state.doc.toString()`, and
          // `inspectSource`'s `stamp` puts `source` on the REFUSAL object.
          // ⚰️ PASSING `report` HERE READS AS CORRECT AND MARKS NOTHING, FOREVER:
          // the report has no `source`, the comparison is false on every render,
          // and the gutter stays empty with no error anywhere. `FormulaField`
          // passes its whole result because `evaluateFormula` stamps THAT — the
          // same field, one level up, on a different door.
          diagnostics={report ? report.refusal : null}
          // ⛔ NOT THE LABEL VERBATIM: `getByLabelText('Pine script')` has to
          // keep resolving to exactly ONE element, and that element is the
          // hidden textarea every existing rail already types into.
          ariaLabel={`${anyDialect ? 'Script or formula' : 'Pine script'} editor`}
          testId="pine-editor"
        />
      )}

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
          {report.refusal && (
            <Refusal
              refusal={report.refusal}
              testId="pine-refusal"
              dialect={seen}
              onApply={applySuggestion}
            />
          )}

          {report.ok && usable.length > 0 && (
            <fieldset className={styles.outputs}>
              <legend className={styles.legend}>
                {usable.length === 1 ? 'This script offers one column' : `This script offers ${usable.length} columns`}
              </legend>
              {report.outputs.map((out, i) => {
                // ⭐ A HIDDEN ROW IS SHOWN AND NOT OFFERED, which is the whole
                // difference between this and quietly dropping it. A member who
                // pasted a script with eighteen plots and is shown four has been
                // told nothing about the other fourteen; the door's own rule is
                // to refuse BY NAME, at the place the member typed. So the row
                // stays, without a radio, and says which of the two reasons it is
                // — the row carries `hiddenReason` precisely so this does not have
                // to guess.
                if (out.formula && out.hidden) {
                  return (
                    <div key={`hid-${out.line}-${i}`} className={styles.outputRow}
                      data-testid={`pine-output-hidden-${i}`}>
                      <span className={styles.outKind}>{out.kind}</span>
                      <span className={styles.outTitle}>{out.title || `line ${out.line}`}</span>
                      <code className={styles.outFormula}>{out.formula}</code>
                      <span className={styles.outReadback}>
                        {out.hiddenReason === 'author'
                          ? 'The script hides this plot, so it is not offered as a column.'
                          : 'The same number on every bar and every symbol — a screen '
                            + 'cannot answer from it.'}
                      </span>
                    </div>
                  )
                }
                if (!out.formula) {
                  return (
                    <div key={`bad-${out.line}-${i}`} className={styles.outputRow}>
                      <span className={styles.outKind}>{out.kind}</span>
                      <span className={styles.outTitle}>{out.title || `line ${out.line}`}</span>
                      <Refusal
                        refusal={out.refusal}
                        testId={`pine-output-refusal-${i}`}
                        dialect={seen}
                        onApply={applySuggestion}
                      />
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
          {settingFields.length > 0 && (
            <div className={styles.settings} data-testid="pine-settings">
              <p className={styles.folded}>
                {/* ⚰️ THIS SAID "Lengths", AND THAT WAS TRUE OF ONE DOOR ONLY. On
                    the Pine lane these rows are window-bound by construction, so
                    every one of them IS a length. thinkScript has no declare mode
                    at all, so its rows are every numeric input the study folds —
                    `over_Bought = 70` and `oversold = 26` among them. A heading
                    that calls a threshold a length is a false sentence about the
                    fields directly beneath it, and it arrived the moment the
                    second door was wired in. */}
                <UIcon name="sliders" size={12} /> Settings from the script — set them here,
                {' '}before you save
              </p>
              <div className={styles.settingRow}>
                {settingFields.map((k) => (
                  <label key={k.name} className={styles.settingField}>
                    <span className={styles.settingLabel}>{k.title || k.name}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      className={styles.settingInput}
                      data-testid={`pine-input-${k.name}`}
                      aria-label={k.title || k.name}
                      value={settings[k.name] ?? ''}
                      placeholder={String(k.folded)}
                      min={Number.isFinite(k.min) ? k.min : undefined}
                      max={Number.isFinite(k.max) ? k.max : undefined}
                      disabled={disabled}
                      onChange={(e) => setSettings(
                        (p) => ({ ...p, [k.name]: e.target.value }))}
                    />
                    {/* ⛔ THE AUTHOR'S NUMBER STAYS ON SCREEN once it has been
                        departed from. A field showing 21 with no trace of the 14
                        it replaced cannot be checked against the script the
                        member is reading on TradingView. */}
                    {(settings[k.name] ?? '') !== '' && String(k.folded) !== settings[k.name] && (
                      <span className={styles.settingWas} data-testid={`pine-input-was-${k.name}`}>
                        was {k.folded}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <p className={styles.folded}>
                {/* ⛔ THE MECHANISM, NOT AN APOLOGY. These are frozen in before the
                    formula is translated — that is what keeps a window a literal
                    and the repaint verdict decidable — so they are a choice made
                    HERE rather than a knob turned later. Saying so is what stops a
                    member hunting for a gear that will not exist.
                    ⚠️ AND IT NAMES NO MECHANISM IT CANNOT KEEP. The two doors reach
                    this state for different reasons — Pine because a length cannot
                    be a declared knob, thinkScript because it has no declared knobs
                    at all — so the sentence states the CONSEQUENCE, which is true
                    of both, rather than a cause that is true of one. */}
                These are written into the formula this engine saves, so they are chosen here
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
            {/* ⭐ THE OTHER HALF OF "what can I build with": the names this
                engine holds, and the formulas other members have already
                published out of them. */}
            <a href="/formulas/library">Browse what other members published →</a>
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
              single biggest measured gap in the paste path, and it is the one
              thing the member has to say. ⚰️ THE NUMBERS HERE READ "41 scripts
              translate and save, only 19 can be scanned" and both had moved — it
              is 43 and 18 as of 2026-08-31, and the door now delivers all 43 to
              the screener because of this control. `doorScorecard.test.js` owns
              those counts and prints them on every run; a copy typed here can
              only go stale, which is what it did. The gate is right and the
              affordance is what closed the gap. */}
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
export function ImportBox({
  onPick, disabled = false, initialSource = '', dialect = 'auto', onSourceChange = null,
  onImportTelemetry = null,
}) {
  return (
    <PasteBox
      onPick={onPick}
      disabled={disabled}
      initialSource={initialSource}
      dialect={dialect}
      onSourceChange={onSourceChange}
      onImportTelemetry={onImportTelemetry}
    />
  )
}

/** The Pine-only box, byte-identical in behaviour to what it was: no `dialect`
 *  prop means `inspectPine`, the Pine heading and the Pine aria-label. */
export default function PineBox({
  onPick, disabled = false, initialSource = '', onSourceChange = null,
  onImportTelemetry = null,
}) {
  return (
    <PasteBox
      onPick={onPick}
      disabled={disabled}
      initialSource={initialSource}
      onSourceChange={onSourceChange}
      onImportTelemetry={onImportTelemetry}
    />
  )
}
