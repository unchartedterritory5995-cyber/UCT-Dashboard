// app/src/components/chart/builder/inspectSource.js
//
// ─── ⭐⭐ PASTEBOX'S REPORT, A PURE MODULE (THE PASTE WORKER, 2026-11-21) ────────────────────────────────────
//
// `inspectSource` / `inspectPine` are what PasteBox shows a member about a paste: the translation of the script, each
// output measured against the real downstream doors. They are pure functions of the text, and they moved here from
// `PineBox.jsx` VERBATIM (PineBox re-exports both), so the member door's Web Worker can run them: PasteBox's report is
// computed off the page's main thread, once per text (`memberPane/memberDoorAsync.js::inspectService`), like the
// chart door's build. On the page this module is PineBox's own and imports what PineBox imported (`./FormulaField`
// among them); inside a WORKER bundle `vite.config.js` resolves `./FormulaField` from this file to the pure
// `./evaluateFormula.js` (`scripts/memberDoorWorkerPure.mjs`), so the worker holds no React.
import { translatePine } from '../engine/ast/pine'
import { translateThinkScript, TS_CALL_SHAPES, TS_DOC_BLOCKED } from '../engine/ast/thinkscript'
import { detectDialect, DIALECTS } from '../engine/ast/dialect'
import { evaluateFormula } from './FormulaField'
import { BUILDER_INPUT_SCOPE, memberInputTranslation } from './builderInputs'
import { declaredInputs } from '../engine/ast/lint'
import { isNumericText } from '../engine/ast/memberValue'
import { vendorNotesForTree, foldNotesForOutput, alertNoteForOutput, TABLE } from '../engine/ast/parse'
import { importOutcome, controlledErrorReport } from '../engine/ast/importOutcome'
import { foreignLanguage, foreignRefusal } from '../engine/ast/foreignLanguage'

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

/** The scope `evaluateFormula` needs to read back a Pine candidate's OWN
 *  declared inputs by name, not only the chrome every document carries.
 *
 *  🔴🔴 WITHOUT THIS, EVERY CANDIDATE THAT DECLARES ANY INPUT REFUSED AT
 *  `sentence:name` — not a boolean-specific defect, a `BUILDER_INPUT_SCOPE`-only
 *  one. `memberInputTranslation` already computes `out.memberInputs` (Track F's
 *  own machinery, proven live for numeric knobs) two lines above every call site
 *  that reads it below; the downstream verdict simply never saw it. A script
 *  whose only declared inputs land in a WINDOW slot (folded back to a literal —
 *  `pd` in `03-cm-williams-vix-fix.pine`) never surfaced this, because no bare
 *  name from `BUILDER_INPUT_SCOPE`'s complement ever reached the tree — a
 *  boolean toggle, used as a GATE rather than a length, almost always does.
 *  Measured directly against the real corpus: `hp`/`sd` in
 *  `03-cm-williams-vix-fix.pine` and `show_52_week_high_low` in
 *  `18-minervini-trend-template.pine` all read back cleanly once this scope is
 *  merged in, with no other change anywhere in the translator. */
function downstreamScopeFor(out) {
  return { ...BUILDER_INPUT_SCOPE, ...declaredInputs({ inputs: out?.memberInputs }) }
}

/** ⭐⭐ P0 0L (2026-10-05) — THE CONTROLLED ERROR. `translatePine` threw on a
 *  public corpus script (`smart-money-breakouts-chartprime`) and `PasteBox` ran
 *  it inside a `setTimeout` with no catch, so the box silently stopped answering —
 *  the opposite of the "never throws" claim above. Every door below now goes
 *  through this boundary: a throw becomes ONE report that says the engine failed
 *  (outcome ERROR), is logged, and offers nothing to save
 *  (`importOutcome.js::controlledErrorReport`). */
export function inspectPine(source, opts = undefined) {
  let r
  try { r = inspectPineUnguarded(source, opts) } catch (e) { return controlledErrorReport(source, e, 'pine') }
  return { ...r, outcome: importOutcome({ ...r, dialect: 'pine' }) }
}

function inspectPineUnguarded(source, opts = undefined) {
  // ⭐ THE TRANSLATION THAT KEEPS THE AUTHOR'S KNOBS. `memberInputTranslation`
  // runs `translatePine` twice — once declaring every bound input to find which
  // ones the engine has to fold back into a window, then again declaring only the
  // survivors — and annotates each output with `memberInputs` / `skippedInputs`.
  // ⛔ IT IS NOT A DIFFERENT TRANSLATOR. Same function, same guards, same
  // refusals; the only difference is that a threshold or a multiplier reaches the
  // formula as its own identifier instead of as somebody else's constant.
  // ⭐⭐ C2D.1 — `paramManifest: true` RIDES ON *THIS* TRANSLATION, and that is
  // the whole fix. It is structurally inert (measured: the saved trees are
  // byte-identical with and without it, on every corpus script) because the
  // parameter mint runs AFTER the fold and tags the literal it already
  // produced, with a NON-ENUMERABLE property. What it buys is the invariant
  // C2D.1 demands: the manifest and the saved computation come from ONE
  // translation result.
  const translated = memberInputTranslation(
    translatePine, source, { paramManifest: true, ...(opts || {}) })
  const outputs = translated.outputs.map((out) => ({
    ...out,
    ...splitFoldedInputs(out),
    // ⭐⭐ TWO SOURCES, ONE LIST, AND THE SECOND ONE CANNOT COME FROM THE TREE.
    // A fold ERASES the call it folded — that is what a fold is — so a walk over
    // the saved tree can never find `request.security` to hang a note on. The
    // translation records it on the ROW instead, and `foldNotesForOutput` maps
    // that channel to the sentence declared in `closedTable.json::_folds`.
    // ⛔ Rendered VERBATIM, like every other note here: this component writes no
    // sentence of its own (owner ruling, 2026-09-12).
    vendorNotes: [
      ...(out.ast ? vendorNotesForTree(out.ast) : []),
      ...foldNotesForOutput(out),
      // ⭐ THIRD SOURCE, SAME RULE (ruling D1, option C, 2026-09-12): an
      // `alertcondition` row tells the member the pane declined to draw it and
      // where the condition actually lives. Interpolated in `parse.js`, rendered
      // here verbatim — this component still writes no sentence of its own.
      ...alertNoteForOutput(out),
    ],
    // ⛔ THE DOWNSTREAM VERDICT IS THE DOWNSTREAM DOOR'S. Not a copy of its
    // rules, not a prediction of them — the function itself.
    downstream: out.formula ? evaluateFormula(out.formula, downstreamScopeFor(out)) : null,
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
/** ⭐⭐ P0 0K — a name the native reader did not know that IS a thinkScript call
 *  (`Average`, `ExpAverage`, `RSI` …): the one-line thinkScript scan shape with no
 *  `def`/`plot` that `dialect.js` has no marker for. Capitalised only — the native
 *  table's own names are lower-case, so `sma` can never be taken for one. */
function isThinkScriptName(name) {
  if (typeof name !== 'string' || !/[A-Z]/.test(name)) return false
  return Object.prototype.hasOwnProperty.call(TS_CALL_SHAPES, name.toLowerCase())
    || Object.prototype.hasOwnProperty.call(TS_DOC_BLOCKED, name)
}

const NATIVE_NAMES = new Set([
  ...Object.keys(TABLE.series || {}), ...Object.keys(TABLE.functions || {}),
])

/**
 * ⭐⭐ P0 — THE DOOR, GUARDED AND ROUTED. Same contract as before (one shape for
 * every dialect) plus `outcome` (`importOutcome.js`) and, where it applies,
 * `foreign` / `rerouted`.
 *
 * 0K ROUTING, CONSERVATIVELY:
 *   • a recognisable language this engine does not read (NinjaScript, MQL,
 *     EasyLanguage, Python, MetaStock, AFL — `foreignLanguage.js`, two markers)
 *     is UNSUPPORTED BY NAME, instead of a TC2000 character refusal. Never for a
 *     paste the detector reads as Pine (`foreignLanguage.js`: it never overrides
 *     a dialect we do read).
 *   • a native-formula refusal for an unknown function that is a thinkScript
 *     call name is read by the thinkScript translator — its answer, success or
 *     its own refusal, is the one about the language actually pasted.
 *   • a TC2000 refusal of a lower-case name the engine's own grammar declares,
 *     in a paste using lower-case `and`/`or`, says so instead of only blaming TC2000.
 */
export function inspectSource(source, dialect = 'auto', opts = undefined) {
  // ⭐ EDITOR STATUS — the language the door had settled on when a throw came. The
  // controlled report keeps its `formula` stamp (nothing that renders it changes);
  // `faultDialect` says the text was read as Pine, so the Pine editor's status panel
  // can show its engine-fault state for it (`PineEditorStatus.usePineEditorStatus`).
  const routed = { dialect: dialect === 'auto' ? null : dialect }
  let report
  try {
    report = routeAndInspect(source, dialect, opts, routed)
  } catch (e) {
    const fault = controlledErrorReport(source, e, dialect === 'auto' ? 'formula' : dialect)
    return routed.dialect === 'pine' && fault.dialect !== 'pine' ? { ...fault, faultDialect: 'pine' } : fault
  }
  return { ...report, outcome: importOutcome(report) }
}

function routeAndInspect(source, dialect, opts, routed = {}) {
  const text = typeof source === 'string' ? source : ''
  if (dialect !== 'auto') return inspectSourceUnguarded(text, dialect, opts)
  const detected = detectDialect(text)
  routed.dialect = detected
  if (detected !== 'pine') {
    const found = foreignLanguage(text)
    if (found) {
      return {
        ok: false, dialect: detected, version: null, declaration: null, title: null,
        outputs: [], selected: -1,
        refusal: { guard: 'language', message: foreignRefusal(found), line: null, column: null, token: null, source: text },
        ignored: [], folded: [], inputParams: [], objects: null, foreign: found.name,
      }
    }
  }
  const rep = inspectSourceUnguarded(text, detected, opts)
  if (rep.dialect === 'formula' && !rep.ok && rep.refusal && rep.refusal.guard === 'resolve:function') {
    const m = /unknown function "([^"]+)"/.exec(String(rep.refusal.message || ''))
    if (m && isThinkScriptName(m[1])) {
      const ts = inspectSourceUnguarded(text, 'thinkscript', opts)
      return { ...ts, rerouted: { from: 'formula', name: m[1] } }
    }
  }
  if (rep.dialect === 'pcf' && !rep.ok && rep.refusal && rep.refusal.guard === 'pcf:name'
    && /\b(?:and|or)\b/.test(text)) {
    const tok = /`([^`]+)`/.exec(String(rep.refusal.message || ''))
    if (tok && NATIVE_NAMES.has(tok[1])) {
      return {
        ...rep,
        refusal: {
          ...rep.refusal,
          message: `${rep.refusal.message}. This reads like this engine's own formula syntax `
            + '(lower-case names such as `close` and `sma(…)`), where `and` and `or` are written '
            + '`&&` and `||`; a TC2000 formula writes AND / OR with TC2000 names such as C and AVGC50.',
        },
      }
    }
  }
  return rep
}

function inspectSourceUnguarded(source, dialect = 'auto', opts = undefined) {
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
      // ⭐⭐ C2D.1 — see `inspectPine`. Inert for thinkScript, which has no
      // `paramManifest` option and simply ignores it, leaving `inputParams`
      // absent exactly as it is today.
      ? memberInputTranslation(translatePine, source, { paramManifest: true, ...(opts || {}) })
      : translateThinkScript(source, opts || {})
    const outputs = (t.outputs || []).map((out) => ({
      ...out,
      ...splitFoldedInputs(out),
      // ⭐⭐ TWO SOURCES, ONE LIST, AND THE SECOND ONE CANNOT COME FROM THE TREE.
    // A fold ERASES the call it folded — that is what a fold is — so a walk over
    // the saved tree can never find `request.security` to hang a note on. The
    // translation records it on the ROW instead, and `foldNotesForOutput` maps
    // that channel to the sentence declared in `closedTable.json::_folds`.
    // ⛔ Rendered VERBATIM, like every other note here: this component writes no
    // sentence of its own (owner ruling, 2026-09-12).
    vendorNotes: [
      ...(out.ast ? vendorNotesForTree(out.ast) : []),
      ...foldNotesForOutput(out),
      // ⭐ THIRD SOURCE, SAME RULE (ruling D1, option C, 2026-09-12): an
      // `alertcondition` row tells the member the pane declined to draw it and
      // where the condition actually lives. Interpolated in `parse.js`, rendered
      // here verbatim — this component still writes no sentence of its own.
      ...alertNoteForOutput(out),
    ],
      refusal: stamp(out.refusal),
      downstream: out.formula ? evaluateFormula(out.formula, downstreamScopeFor(out)) : null,
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
      // ⭐⭐ C2D.1 — NAMED, because this function does not spread (see the note
      // below on exactly that). `inputParams` is the immutable per-declaration
      // parameter metadata from the SAME translation whose `outputs` are above,
      // and the manifest is assembled from it plus each output's own tags.
      // Absent for a dialect with no `paramManifest` support, which is an empty
      // list rather than a missing key.
      inputParams: t.inputParams || [],
      // ⭐⭐ C3B — THE OBJECT PROGRAM, FORWARDED BY NAME for the same reason
      // `presentation` had to be added below: this function does NOT spread, so
      // a new field the translator produces is invisible here until a line says
      // otherwise — and `ImportBox`, the only production paste door, goes
      // through THIS function. A program left unforwarded would translate
      // perfectly, save nothing, and draw nothing, with every test still green.
      objects: t.objects || null,
      // ⭐ P0 0G — the object pass's own loss counters, forwarded BY NAME so the
      // import outcome can say what the drawing lost (`objectLoss.js`).
      objectDiagnostics: t.objectDiagnostics || null,
      // ⭐⭐ WAVE B — AND THIS LINE IS WHY THE WAVE EXISTS, COMMITTED TWICE.
      //
      // ⚰️ `inspectPine` above SPREADS its translation (`{...translated}`), so it
      // carried the new `presentation` field the day the translator started
      // producing one. This function does not spread — it names every field it
      // forwards, deliberately, so that one shape answers for four dialects. The
      // consequence is that a new field is INVISIBLE here until someone adds a
      // line, and `ImportBox` — the only production paste door — goes through
      // THIS function, not that one.
      //
      // So the visual program was read off the source, handed to a door that
      // dropped it, and every unit test passed because they call `translatePine`
      // directly. It took the real chart to see: an imported RSI arrived with its
      // levels box empty. That is the same failure this whole wave is about — a
      // carriage that stops one door short — committed inside the wave fixing it.
      presentation: t.presentation || null,
      // ⭐ ENGINE 55 (review F1) — which other symbols the trees read and how each was spelled,
      // so the import screen can say up front which plots a binding will refuse
      // (`importOutcome` → `otherSymbols.staticOtherSymbolRefusalOf`), forwarded by name.
      otherSymbols: Array.isArray(t.otherSymbols) ? t.otherSymbols : null,
      // ⭐ L1 — the imported libraries this translation linked, with their licence
      // and attribution, which the member is shown (forwarded by name: see above).
      libraries: t.libraries || [],
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
    inputParams: [],
    objects: null,
  }
}
