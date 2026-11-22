// app/src/components/chart/builder/evaluateFormula.js
//
// ─── A FORMULA SOURCE -> EVERYTHING THE BUILDER KNOWS ABOUT IT ───────────────
//
// `evaluateFormula` and `canSaveFormula`, MOVED here verbatim from `FormulaField.jsx` (which
// re-exports both, so no caller changes). ⭐ WHY (paste worker, 2026-11-20): the member door builds a
// pasted script in a Web Worker now, and a worker's module graph may hold no React component.
// ⛔ Pure: no React, no DOM, no network.
import { readFormulaSource } from '../engine/ast/pcf'
import { checkBudget } from '../engine/ast/budget'
import { ENGINE_ERROR, isRefusal } from '../engine/ast/parse'
import { sentenceFor } from '../engine/ast/sentence'
import { describeTree } from './authoring/expansionWords'
import { lintRepaint } from '../engine/ast/lint'
import { interpret } from '../engine/ast/interpret'

/**
 * ⭐ TWO SURFACE DIALECTS, ONE TREE, AND THE CHOICE IS MADE BEFORE THE READ —
 * NEVER AS A FALLBACK AFTER ONE FAILS.
 *
 * A member arriving from TC2000 types `(C > AVGC50) AND (C1 < AVGC50.1)`.
 * `pcf.js` reads that into the SAME canonical tree `parse.js` produces, so
 * everything past this line — the budget, the repaint linter, the read-back,
 * the save path, `ast_interpret.py` — is unchanged and unaware.
 *
 * ⛔ TRYING NATIVE, FAILING, THEN TRYING TC2000 WOULD REPORT A TC2000 REFUSAL
 * FOR A NATIVE TYPO. That is the wrong-door defect this branch has now found
 * five times, every occurrence a correct-looking message produced by the wrong
 * gate. `detectDialect` decides once, off markers only one language can
 * produce, and it is biased so hard toward `native` that `pcf.test.js` proves
 * it against the whole committed corpus: not one shipped formula moves.
 *
 * ⛔ AND THE DECISION IS NOT MADE HERE. `readFormulaSource` is the ONE place
 * that maps a source string to a reader, because `defSchema.validateAstCompute`
 * has to make the identical decision when it re-reads a STORED source against
 * its stored tree. A private copy in this file would let a formula save and
 * then fail to validate — a second authority over one value.
 */

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
 * @param {string} [dialect] `'auto'` (the default), `'native'` or `'pcf'`
 * @returns {{source: string, ok: boolean, ast: object|null, guard: string|null,
 *            error: string|null, readback: string|null, verdict: object|null,
 *            measured: object|null, dialect: string}}
 */
export function evaluateFormula(source, inputs = undefined, dialect = 'auto', { nameFunctions = false } = {}) {
  // ⛔⛔ THE SCOPE GOES TO THE READ DOOR TOO, NOT ONLY TO THE LINTER AND THE
  // READ-BACK (W1b.5). `readFormulaSource` hands it to `letPrepass.prepareSource`,
  // whose docblock warns that ABSENT IS NOT EMPTY: without it a binding could
  // shadow a DECLARED input, the pre-pass would rewrite every use of that name
  // away, and the document would SAVE with its knob inert. `editor/completions.js`
  // was already handing the scope in, so the completion popup refused text this
  // gate accepted — one grammar, two readings, and the stricter one could not
  // stop a save. This function is the one place that knows the scope on the
  // authoring path, so it is the one place that can close it.
  const read = readFormulaSource(source, dialect, inputs)
  const blank = {
    source: typeof source === 'string' ? source : '',
    ok: false, ast: null, guard: null, error: null,
    readback: null, verdict: null, measured: null,
    dialect: read.dialect,
  }
  if (typeof source !== 'string' || source.trim() === '') {
    return { ...blank, dialect: 'native', empty: true }
  }

  const parsed = read.result
  if (!parsed.ok) {
    // ⭐ THE READER'S OWN POSITION, WHEN IT HAS ONE. `parsePcf` answers with the
    // index and the token it refused at; jsep puts its offset in the message.
    // Neither is re-derived here — the editor reads what the door said, and
    // `editor/diagnostics.js` turns whichever of the two is present into a range.
    //
    // ⭐ AND A `let:*` REFUSAL NOW REACHES HERE WITH A LINE AND A COLUMN.
    // `prepareSource` always named them; `pcf.js::READERS.native` used to keep
    // only the guard and the sentence, so there was nothing to forward and
    // `diagnostics.js` recovered the position by asking the same door again.
    // W1b.5 widened the reader (the hand-back W1a.4's report asked for), so the
    // position rides on the refusal and `diagnostics.js`'s path 2 places it —
    // which is the ONLY path open for an input-shadow refusal, because that
    // recovery deliberately asks without a scope and so cannot see one.
    // ⛔ AN ENGINE ERROR CARRIES NO GUARD — see `classifyThrow`. `|| 'parser'`
    // would tell the member their SYNTAX is wrong when the engine crashed.
    if (parsed.status === ENGINE_ERROR) {
      return { ...blank, status: ENGINE_ERROR, engineError: parsed.engineError,
        error: parsed.error }
    }
    return {
      ...blank, guard: parsed.guard || 'parser', error: parsed.error,
      ...(Number.isInteger(parsed.index) ? { index: parsed.index } : {}),
      ...(Number.isInteger(parsed.line) && Number.isInteger(parsed.column)
        ? { line: parsed.line, column: parsed.column } : {}),
      ...(typeof parsed.token === 'string' && parsed.token ? { token: parsed.token } : {}),
    }
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
    return { ...blank, ast, verdict, ...refusalOrEngineError(err) }
  }
  if (!budget.ok) {
    return { ...blank, ast, verdict, guard: budget.guard, error: budget.error, measured: budget.measured }
  }

  // ⭐ `nameFunctions` — THE LEGACY FORMULA SHEET ONLY (its FormulaField and its
  // reopen). A saved `linreg(close, 50)` is stored EXPANDED (sum, wma, a constant),
  // and `sentenceFor` said that arithmetic back. `describeTree` (the conversational
  // builder's own read-back) recognises each expansion structurally and says its
  // name; a tree with none is `sentenceFor`'s sentence byte for byte. `mom` /
  // `kcMiddle` are only `x − x[n]` / a bare `ema`, so they are named only when the
  // member WROTE them — the source says so; a hand-written difference stays one.
  // ⛔ Every other caller (authoring `model.js`, Pine, library intake, member panes)
  // keeps `sentenceFor` exactly: their saved descriptions do not move.
  const named = nameFunctions && typeof source === 'string'
    ? { allowMom: /\bmom\s*\(/.test(source), allowBareEma: /\bkcMiddle\s*\(/.test(source), allowBareSma: /\bbbMiddle\s*\(/.test(source) }
    : null
  let readback
  try {
    readback = named ? describeTree(ast, inputs, named) : sentenceFor(ast, inputs)
  } catch (err) {
    return {
      ...blank, ast, verdict, measured: budget.measured,
      ...refusalOrEngineError(err),
    }
  }

  // 🔴🔴 THE GATE MUST RUN THE TREE, AND UNTIL 2026-08-11 IT NEVER DID.
  //
  // Parsing, the budget, the repaint linter and the read-back all INSPECT a tree
  // without ever evaluating it. So a formula whose refusal fires only at
  // interpret time passed every one of them and reached the save button:
  // `accum(close, sma(self, 3), 5)` measured `ok: true`, `saveable: true`,
  // `non-repainting` — and throws when the chart draws it. A member could save an
  // indicator that crashes, which is the same "green, then wrong" shape as the
  // hidden `hlc3` and the all-NaN accumulator found the same day.
  //
  // ⭐ ONE PASS OVER FOUR BARS IS ENOUGH, and that is a property of the walker,
  // not a hope: the recurrence arm PLANS its body before consuming a single bar,
  // so a plan-time refusal fires even when the warm-up exceeds the series.
  // Measured: the formula above refuses on exactly these four bars.
  //
  // ⛔ EMPTY SCALARS ARE SAFE HERE. `market_cap > 250` under `{}` returns 0
  // rather than raising, so this cannot invent a refusal for a fundamentals
  // formula — checked before the gate was wired, because a save gate that
  // refuses valid work is worse than the hole it closes.
  // ⛔ A NUMERIC STAND-IN PER DECLARED INPUT, NOT THE SCOPE ITSELF. `inputs` here
  // is the DECLARATION map the linter and read-back take, and one of the two
  // inputs every definition carries is `color` — a string. `interpret` takes
  // finite numbers only, so handing it the scope refused `close * lineWidth`,
  // a formula the whole lane below already supports. This gate asks whether the
  // tree RUNS, never what it returns, so 1 for every name is the honest probe.
  const probeInputs = Object.fromEntries(Object.keys(inputs || {}).map((k) => [k, 1]))
  try {
    void [...interpret(ast, PROBE_BARS, probeInputs, undefined, {})]
  } catch (err) {
    return {
      ...blank, ast, verdict, measured: budget.measured, readback,
      ...refusalOrEngineError(err),
    }
  }

  return {
    source, ok: true, ast, guard: null, error: null,
    readback, verdict, measured: budget.measured, dialect: read.dialect,
  }
}

/** Four synthetic bars, enough to reach every PLAN-time refusal in the walker.
 *  ⛔ Deliberately tiny: this runs on the authoring path, and the tree it is
 *  proving is the one the member is still typing. */
const PROBE_BARS = Object.freeze([
  { o: 10, h: 11, l: 9, c: 10, v: 1000 },
  { o: 10, h: 12, l: 9, c: 11, v: 1100 },
  { o: 11, h: 13, l: 10, c: 12, v: 1200 },
  { o: 12, h: 14, l: 11, c: 13, v: 1300 },
])

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
 * ⚠️ A PROPERTY OF TODAY'S MANIFEST, MEASURED — NOT THE CONCLUSION A NEARBY FACT
 * ONCE SEEMED TO IMPLY. Every `lookback` in the shipped `closedTable.json` is
 * `≥ 0` or `"argK"` (checked: `0`, `1`, `argK`, `2*arg3`, `"session"` — no
 * negatives). But `lookback` and `forward` are TWO DIFFERENT DECLARED FIELDS —
 * `astReach` reads both off the same node, independently — and a fact about one
 * says nothing about the other. Exactly ONE entry declares a `forward`:
 * `ichimokuChikou` (`forward: "arg4"`), which `closedTable.json`'s own
 * `_ichimoku_forward_cloud` note calls "the table's first and only entry whose
 * repaint verdict is `preview-repaints` rather than `non-repainting`." So the
 * gate admits BOTH outcomes today, not one: `non-repainting` for every other
 * table-legal tree, and `preview-repaints` — the acknowledgement branch below,
 * confirmed LIVE, not dead code — for any tree that reaches `ichimokuChikou`.
 * Measured directly: `evaluateFormula('ichimokuChikou(high, low, close, 9, 26,
 * 52) > 0', BUILDER_INPUT_SCOPE)` returns `ok: true`, un-refused by
 * `checkBudget`, with `verdict.mode === 'preview-repaints'`. (`nativeRegistry
 * .validateAstLane`'s GATE 3 enforces the same badge-vs-measurement contract —
 * refused in both directions on disagreement — but by a route that never
 * reasons about which manifest entries declare a `forward`, so it does not
 * carry this property and is not evidence for it.) None of this changes why the
 * gate is a PURE function with its own test rather than something only
 * reachable through the form: the day the manifest declares a SECOND `forward`,
 * this gate moves with it and not a line of this file changes.
 */
export function canSaveFormula(result, acknowledged = false) {
  if (!result || !result.ok) return false
  const mode = result.verdict && result.verdict.mode
  if (mode === 'repaints') return false
  if (mode === 'preview-repaints') return acknowledged === true
  return true
}

/** ⭐⭐ A REFUSAL KEEPS ITS GUARD; ANYTHING ELSE IS AN ENGINE ERROR WITH NONE.
 *
 *  ⚰️ THESE THREE CATCH SITES READ `err?.guard || '<a guard name>'`, so EVERY
 *  exception left here wearing a guard: a `TypeError` in the budget walker was
 *  reported to the member as `resolve:node`, a crash in the read-back as
 *  `sentence:node`, and a crash in the gate run as `interpret:node`. Each of those
 *  is a sentence about THEIR formula, for a fault in OUR engine — and downstream
 *  every one of them counts as a refusal.
 *
 *  ⛔ There is no guard name that makes "the engine broke" true, which is why
 *  this returns a different SHAPE rather than a better default.
 */
function refusalOrEngineError(err) {
  if (isRefusal(err)) return { guard: err.guard, error: msg(err) }
  return { status: ENGINE_ERROR, engineError: (err && err.name) || 'Error', error: msg(err) }
}

function msg(err) {
  return String(err && err.message ? err.message : err)
}
