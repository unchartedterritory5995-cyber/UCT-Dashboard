// app/src/components/chart/builder/builderInputs.js
//
// ─── THE INPUTS EVERY DOCUMENT THE BUILDER WRITES DECLARES ──────────────────
//
// ⭐ ONE ARRAY, AND IT IS SHARED BY THREE READERS THAT MUST NOT DISAGREE:
// `buildDefinition` writes it into the saved document, the READ-BACK is told
// which names it may say, and the REPAINT LINTER is told which names are
// declared scalars rather than unknown series. `parse.js` turns every identifier
// into a `series` node, so `close * lineWidth` is only sayable — and only
// badgeable non-repainting — if all three are looking at the same list.
//
// ⛔ ITS OWN MODULE, NOT AN EXPORT FROM `BuilderSheet.jsx`, and the reason is a
// lint rule with a real failure behind it: `react-refresh/only-export-components`
// fires on a component file that also exports constants, and Fast Refresh then
// re-mounts the sheet on every edit to it. The sheet already carries three such
// exports; two more is the wrong direction.
//
// ⛔ ONE VOCABULARY, AND IT IS `key`. `defSchema.validateInput` REQUIRES
// `input.key`, `nativeRegistry.resolveInputs` reads it, `lint.declaredInputs`
// reads it and the server's `registry_defs.resolve_inputs` reads `spec["key"]`.
// `name` is NOT a fallback: a reader that took either is the second vocabulary
// for one field that left `alert_user_series._inputs_for` returning `{}` for the
// whole of its life.

import { declaredInputs } from '../engine/ast/lint'

/** The `inputs[]` array of every document `buildDefinition` produces. */
export const BUILDER_INPUTS = Object.freeze([
  { key: 'color', type: 'color', label: 'Color', default: '#c9a84c' },
  { key: 'lineWidth', type: 'int', label: 'Line width', default: 1, min: 1, max: 4, step: 1 },
])

/** The same names, in the shape `sentenceFor` and `lintRepaint` take.
 *
 *  ⚠️ MODULE-LEVEL AND FROZEN because `FormulaField` depends on its IDENTITY: it
 *  sits in the debounce effect's dependency list, and a fresh object per render
 *  would restart the 250 ms timer every render so the box never settles. */
export const BUILDER_INPUT_SCOPE = Object.freeze(
  declaredInputs({ inputs: BUILDER_INPUTS }),
)

// ─── THE CHROME A MULTI-PLOT DOCUMENT DECLARES ──────────────────────────────
//
// ⛔ ONE DERIVATION, TWO READERS, AND THEY MUST NOT DISAGREE. `buildDefinition`
// writes `plots[].color = '$<key>'` and the SAME function decides what that key
// is named; the sheet builds its member-input RESERVED set from it, so a member
// cannot declare an input called `signalColor` beside a plot called `signal`.
// A hand-typed `${row.key}Color` at either site is the second-authority defect
// this repo names most often — the day the naming rule moves, one of the two
// silently keeps the old spelling and the `$ref` resolves to nothing.

/** Which two chrome inputs a plot row's colour and width resolve through.
 *
 *  ⭐ ROW 0 KEEPS `color`/`lineWidth`, and that is what makes a single-plot
 *  document byte-identical to a schema-1 one. Later rows are named after their
 *  plot — the `macd` native's own idiom (`macdColor`, `signalColor`).
 *
 *  ⚠️ It takes the ROW, not just its key, so the naming rule stays in one place
 *  even if a later row ever needs more than the key to name its settings. */
export function chromeInputKeys(row, index) {
  const key = (row && typeof row.key === 'string') ? row.key : ''
  if (index === 0) return { color: BUILDER_INPUTS[0].key, width: BUILDER_INPUTS[1].key }
  return { color: `${key}Color`, width: `${key}Width` }
}

/** The chrome `inputs[]` for every plot row, in row order.
 *
 *  ⛔ THE ROW'S CHOSEN COLOUR AND WIDTH BECOME THE INPUT'S **DEFAULT**, INCLUDING
 *  ROW 0's. `plots[].color` is `'$color'` — a REFERENCE — so the swatch on the
 *  form has nowhere else to land: writing the literal into the plot would take
 *  the value out of the settings dialog the member later tunes it in, and
 *  writing it nowhere makes the swatch a control that does nothing. Row 0 was
 *  the one that would have been dropped, because it is the only row whose two
 *  inputs already existed.
 *
 *  ⛔ AND ROW 0's LABELS ARE THE SHIPPED ONES, UNTOUCHED (`Color` / `Line
 *  width`). They are what the generated settings row says; renaming them to
 *  match the later rows' `"<plot> colour"` pattern would move a string every
 *  saved definition already carries. */
export function chromeInputsFor(rows) {
  const list = (Array.isArray(rows) && rows.length) ? rows : [{ key: BUILDER_INPUTS[0].key }]
  const out = []
  list.forEach((row, i) => {
    const keys = chromeInputKeys(row, i)
    const color = (row && typeof row.color === 'string' && row.color) ? row.color : BUILDER_INPUTS[0].default
    const width = (row && Number.isFinite(row.width)) ? row.width : BUILDER_INPUTS[1].default
    if (i === 0) {
      out.push({ ...BUILDER_INPUTS[0], default: color })
      out.push({ ...BUILDER_INPUTS[1], default: width })
      return
    }
    const label = (row && (row.label || row.key)) || keys.color
    out.push({ key: keys.color, type: 'color', label: `${label} colour`, default: color })
    out.push({ key: keys.width, type: 'int', label: `${label} width`, default: width, min: 1, max: 4, step: 1 })
  })
  return out
}

// ─── A PASTED SCRIPT'S OWN INPUTS (W1b.9) ───────────────────────────────────
//
// A published Pine script declares member-tunable inputs — `input.int(14,
// "Length")`, `input.float(2.5, "Mult")` — and `translatePine` FOLDS each one to
// its default so the tree stays statically decidable (`pine.js::resolveInput`
// says why). The fold is recorded on `outputs[i].inputsFolded`, and until this
// door existed nothing read it: a member pasted a script and got its numbers
// frozen where the author left them.
//
// ⛔⛔ AND A DECLARED INPUT IS NOT FREE. THIS IS THE WHOLE OF THIS DOOR'S RISK.
// `interpret.js::windowLiteral` refuses any window argument that is not a
// whole-number LITERAL — measured, not assumed: `sma(close, len)` with `len`
// declared answers `resolve:window`, *"a window must be a whole-number literal —
// sma argument 1 must be a whole number of at least 1, got
// {"type":"series","name":"len"}"*. Most `input.int`s in real Pine ARE lengths
// ("RSI Length", "ATR Period", "Channel Length" — measured across both committed
// corpora), so a door that mapped `input.int → 'int'` and stopped there would
// hand the sheet a formula this engine cannot evaluate, out of a script that
// translated cleanly a moment earlier.
//
// ⭐ SO THE VERDICT IS POSITIONAL, AND IT IS DERIVED FROM THE PRINTED FORMULA
// rather than from the call's name: `input.int(14, "RSI Length")` and
// `input.int(70, "Overbought")` are the SAME CALL and land in opposite worlds. A
// guard keyed on the call kind alone refuses a whole KIND and lets every length
// through — the shape `lesson_a_sweep_that_flags_thirteen_when_two_are_defects`
// names. This door reads the formula, asks the MANIFEST which argument slots it
// declares `int`, and refuses by name.
//
// ⛔ EVERY REFUSAL NAMES THE TOKEN, THE MECHANISM, AND WHAT WOULD UNBLOCK IT —
// the standard `pine.js::PINE_INEXPRESSIBLE` already holds, for the same reason:
// a silent mistranslation is far worse than a refusal, and an over-refusal is
// invisible unless it says what would change its mind.

import { TABLE, KEY_RE } from '../engine/ast/parse'
import { readFormulaSource } from '../engine/ast/pcf'

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** `input.<kind>` → the member input type it becomes; `null` = decide by the
 *  default's integrality. Bare `input(…)` is Pine v3/v4's untyped form and the
 *  corpora are full of it — 80 of the 180 folded entries, measured. */
export const FOLDED_INPUT_TYPES = Object.freeze({ 'input.int': 'int', 'input.float': 'float', input: null })

/** 🔴 PINE INPUT KINDS THAT CANNOT BECOME A MEMBER INPUT HERE, EACH WITH ITS
 *  MECHANISM AND WHAT WOULD UNBLOCK IT.
 *
 *  ⛔ NOT "not built yet". Each has an obvious near-miss that would save and
 *  scan — a `bool` read as arithmetic 1/0, a `source` read as the number 1 — so
 *  they refuse by name rather than resolving to the neighbour.
 *
 *  ⭐ THE FRAGMENT COMPLETES "`input.bool` …", so the token is named by the
 *  caller and never re-typed inside the reason. */
export const FOLDED_INPUT_INEXPRESSIBLE = Object.freeze({
  'input.bool': 'is not a numeric input — `evaluateFormula`\'s save gate runs the '
    + 'tree with ONE FINITE NUMBER per declared name (its probe hands `1`) and '
    + '`interpret` takes finite numbers only, so a true/false switch has no value '
    + 'to hand it. The branch it selected was already decided when the translator '
    + 'folded it, so restoring the switch would move nothing. TO UNBLOCK: a formula '
    + 'lane that reads a `bool` input — `defSchema.INPUT_TYPES` already declares the '
    + 'TYPE; what is missing is the read.',
  'input.source': 'names a COLUMN, not a number — it folds to `close`, `hl2` or '
    + '`(high + low) / 2`, and the formula this sheet saves already carries that '
    + 'column verbatim. A declared input resolves to a finite number here, so a '
    + 'source input would arrive as `1` and silently replace the price it named. TO '
    + 'UNBLOCK: `defSchema.INPUT_TYPES` declares `source`; what is missing is a '
    + 'formula scope that binds a source input to a column rather than to a number.',
  'input.string': 'has no numeric value — and `pine.js::resolveInput` already '
    + 'refuses it upstream with `pine:input-kind`, so an entry of this kind means '
    + 'the translator changed. TO UNBLOCK: an `enum` input the formula lane can read '
    + '(`defSchema.INPUT_TYPES` declares `string` and `enum`; neither reaches '
    + '`interpret` today).',
  'input.price': 'is a price the member picks ON THE CHART, and `price` sits in '
    + '`defSchema.RESERVED_INPUT_TYPES` — schema-reserved for a later phase and '
    + 'refused by the save door with the "ships later" sentence rather than the '
    + '"you typo\'d" one. Landing it as a plain number field would be a different '
    + 'control wearing the same name. TO UNBLOCK: the phase that ships the `price` '
    + 'input type.',
})

/** Every name the closed table already owns. ⛔ DERIVED FROM THE MANIFEST, never
 *  a list typed here — `BuilderSheet`'s own `TABLE_NAMES` reads the same three
 *  maps, so the two cannot disagree about what `close` is. */
const TABLE_NAMES = new Set([
  ...Object.keys(TABLE.series || {}),
  ...Object.keys(TABLE.functions || {}),
  ...Object.keys(TABLE.scalars || {}),
])

/** Push every `series` name in a subtree into `out`. Iterative on purpose —
 *  `parse.js` made its own scans iterative because a guard that dies inside
 *  itself is not a refusal, and this one runs on text a member just pasted. */
function collectNames(root, out) {
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (node.type === 'series' && typeof node.name === 'string') { out.add(node.name); continue }
    const args = Array.isArray(node.args) ? node.args : []
    for (const a of args) stack.push(a)
  }
}

/** The two facts about a printed formula this door needs, in ONE walk: every
 *  name it reads, and every name it reads in a slot the manifest declares `int`
 *  — the slots `interpret.js::windowLiteral` refuses anything but a whole-number
 *  literal in.
 *
 *  ⛔ THE SLOT KINDS COME OFF `closedTable.json`, exactly as
 *  `interpret.js::maxLookback` reads them (`spec.args[i] === 'int'`). A list of
 *  "functions whose second argument is a length" typed here would be the
 *  second-authority-over-one-value defect this repo names most often, and it
 *  would go wrong silently the day a function is added.
 *
 *  ⚠️ ANY NON-`num` NODE IN AN `int` SLOT BLOCKS EVERY NAME BENEATH IT, because
 *  `windowLiteral` requires `arg.type === 'num'` DIRECTLY — `sma(close, len + 1)`
 *  is refused just as `sma(close, len)` is. */
export function formulaNameRoles(ast) {
  const read = new Set()
  const literalOnly = new Set()
  const stack = [ast]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    const args = Array.isArray(node.args) ? node.args : []
    if (node.type === 'series' && typeof node.name === 'string') { read.add(node.name); continue }
    if (node.type === 'call') {
      const spec = (TABLE.functions || {})[node.name]
      const kinds = (spec && Array.isArray(spec.args)) ? spec.args : []
      for (let i = 0; i < args.length; i += 1) {
        if (kinds[i] === 'int' && args[i] && args[i].type !== 'num') {
          collectNames(args[i], literalOnly)
          collectNames(args[i], read)
        } else stack.push(args[i])
      }
      continue
    }
    for (const a of args) stack.push(a)
  }
  return { read, literalOnly }
}

/** Why this candidate key cannot be a member input of THIS formula, or `null`.
 *  Built once per call, so the formula is read exactly once however many
 *  candidates there are. */
function positionVerdict(source, candidates) {
  if (typeof source !== 'string' || source.trim() === '') {
    return (key) => `\`${key}\` cannot be admitted without the formula this translation `
      + 'printed: whether a Pine input can become a member input is a fact about the '
      + 'POSITION it lands in, not about its call — `input.int` is a window in one script '
      + 'and a threshold in the next. TO UNBLOCK: call `inputsFromFolded(folded, formula)` '
      + 'with the same translation\'s `outputs[i].formula`.'
  }
  // ⭐ THE CANDIDATES GO IN AS THE SCOPE. `readFormulaSource`'s docblock warns
  // that ABSENT IS NOT EMPTY for the native reader: without the scope a `let`
  // binding could shadow one of these names, the pre-pass would rewrite every use
  // of it away, and the walk below would see a formula that never read it.
  const scope = Object.fromEntries(candidates.map((c) => [c.key, true]))
  const read = readFormulaSource(source, 'auto', scope)
  const result = read && read.result
  if (!result || !result.ok || !result.ast) {
    const guard = (result && result.guard) || 'parser'
    const why = (result && result.error) || 'it could not be read'
    return (key) => `\`${key}\` cannot be admitted: the formula this translation printed does `
      + `not read back here (\`${guard}\`: ${why}), so nothing can be said about where this `
      + 'input lands. TO UNBLOCK: a formula the sheet\'s own reader accepts — the same door '
      + '`FormulaField` puts every keystroke through.'
  }
  const { read: namesRead, literalOnly } = formulaNameRoles(result.ast)
  return (key, entry) => {
    if (literalOnly.has(key)) {
      return `\`${key}\` lands in a WINDOW, and this engine cannot take a window from an `
        + 'input: `interpret.js::windowLiteral` refuses any window argument that is not a '
        + 'whole-number literal (`resolve:window`), because `maxLookback(ast)` is handed no '
        + 'bars and no inputs and the repaint linter is a tree sum over it. Measured: '
        + '`sma(close, len)` answers *"a window must be a whole-number literal"*. The default '
        + `(\`${entry.folded}\`) stays folded into the formula, so the column is still right `
        + '— it is the KNOB that cannot exist. TO UNBLOCK: '
        + '`closedTable.json::_no_offset_reopened_by` names who may re-open static '
        + 'decidability — the repaint-claim owner and the manifest owner, together. No later '
        + 'task may grant it alone.'
    }
    if (!namesRead.has(key)) {
      return `the formula never reads \`${key}\` — this translation folded it to its default `
        + `(\`${entry.folded}\`), so declaring it would hand the member a knob that changes `
        + 'nothing. TO UNBLOCK: `translatePine(source, { inputs: \'declare\' })` (the W3b '
        + 'hand-back) prints the bound identifier where the literal is now.'
    }
    return null
  }
}

/**
 * `translatePine`'s folded-input list → the member input rows this sheet can
 * declare, and the ones it refuses BY NAME.
 *
 * @param {Array}  folded   `outputs[i].inputsFolded` — `{call, title, folded,
 *        line, column}` today; `name`, `min` and `max` are W3b's additive fields
 *        (`usedInputs[]` gaining the bound identifier, `minval` and `maxval`).
 * @param {string} [source] the SAME translation's `outputs[i].formula`. Without
 *        it nothing can be admitted — see `positionVerdict`.
 * @returns {{inputs: Array, skipped: Array}} `inputs` in the shape
 *        `BUILDER_INPUTS` uses (`defSchema.validateInput` REQUIRES `key`, and
 *        `key` is this repo's ONE vocabulary for it — see the header); `skipped`
 *        is every refused entry, verbatim, with a `reason`.
 *
 * ⏳ THE TWO HAND-BACKS THIS DOOR IS WAITING ON, NAMED RATHER THAN MADE:
 *   • `PineBox.jsx` (W3) — a "Keep as inputs" toggle beside "Use this formula",
 *     calling `onPick({ source: active.formula, inputs: inputsFromFolded(
 *     active.inputsFolded, active.formula).inputs })` and showing `skipped[].reason`
 *     so a member reads WHY a length stayed frozen instead of wondering.
 *   • `pine.js` (W3b) — `translatePine(source, { inputs: 'declare' })`, printing
 *     the BOUND IDENTIFIER where the literal is now and stamping `usedInputs[]`
 *     with `name` (the Pine variable), `min` (`minval`) and `max` (`maxval`).
 *     ⚠️ AND IT MUST NOT PRINT AN IDENTIFIER INTO A WINDOW SLOT — that formula
 *     does not evaluate here (see the header). Folding the literal in EXACTLY
 *     THOSE POSITIONS and binding the rest is the shape that works; this door
 *     refuses the other shape by name rather than trusting it not to happen.
 *
 * ⛔ THE ORDER OF THE GUARDS IS LOAD-BEARING. Entry-intrinsic facts are decided
 * first — no bound name, a kind that cannot be numeric, a default that is not a
 * number, a name something else already owns — so the most SPECIFIC true
 * sentence is the one the member reads. The positional verdict runs LAST,
 * because it is the only one that depends on anything outside the entry.
 */
export function inputsFromFolded(folded, source) {
  const inputs = []
  const skipped = []
  const taken = new Set(BUILDER_INPUTS.map((s) => s.key))
  const decided = []
  const candidates = []
  for (const f of (Array.isArray(folded) ? folded : [])) {
    const entry = f && typeof f === 'object' ? f : {}
    const push = (reason) => decided.push({ entry, reason })
    // ⛔ THE LEGALITY RULE IS THE PARSER'S, PLUS ONE. `KEY_RE` is
    // `parse.js`'s own identifier shape, and the lowercase-first test is the
    // extra condition `BuilderSheet.inputKeyProblem` puts on a MEMBER input
    // (`/^[a-z][a-zA-Z0-9_]*$/`) — composed rather than re-typed, so a key this
    // door admits is always one the sheet's own row accepts. A second copy of
    // that regex here is the defect that would show up as a row landing red.
    const named = typeof entry.name === 'string' ? entry.name : ''
    const key = (KEY_RE.test(named) && named[0] === named[0].toLowerCase()) ? named : null
    if (!key) {
      push('no bound name on the folded entry — `pine.js::resolveInput` records '
        + '`{call, title, folded, line, column}` and nothing else, so there is no identifier '
        + 'to declare. TO UNBLOCK: the W3b hand-back, `usedInputs[]` gaining `name` (the '
        + 'Pine variable the input was assigned to).')
      continue
    }
    if (own(FOLDED_INPUT_INEXPRESSIBLE, entry.call)) {
      push(`\`${entry.call}\` ${FOLDED_INPUT_INEXPRESSIBLE[entry.call]}`)
      continue
    }
    if (!own(FOLDED_INPUT_TYPES, entry.call)) {
      push(`\`${entry.call}\` is not an input call this door knows. It admits `
        + `${Object.keys(FOLDED_INPUT_TYPES).map((k) => `\`${k}\``).join(', ')} and refuses `
        + `${Object.keys(FOLDED_INPUT_INEXPRESSIBLE).map((k) => `\`${k}\``).join(', ')} by `
        + 'name; anything else is a kind `pine.js` grew after this door was written. TO '
        + 'UNBLOCK: decide it into `FOLDED_INPUT_TYPES` or `FOLDED_INPUT_INEXPRESSIBLE` — '
        + 'silence is the one answer that is never right.')
      continue
    }
    const value = Number(entry.folded)
    if (!Number.isFinite(value)) {
      push(`\`${entry.folded}\` is not a number — the fold printed an EXPRESSION `
        + '(`input.source(hl2)` folds to `(high + low) / 2`), and a member input resolves to '
        + 'one finite number. TO UNBLOCK: nothing here; the column it names is already in '
        + 'the formula.')
      continue
    }
    if (TABLE_NAMES.has(key)) {
      push(`\`${key}\` is already a name this engine computes — declaring it would shadow `
        + 'the real column, and the formula would parse, save and draw the wrong thing. '
        + '(The sheet refuses the same key with the same sentence.)')
      continue
    }
    if (taken.has(key)) {
      push(`\`${key}\` is already a name this builder declares — every document carries `
        + `${BUILDER_INPUTS.map((s) => `\`${s.key}\``).join(' and ')}, and `
        + '`defSchema.validateInput` refuses a duplicate key outright.')
      continue
    }
    taken.add(key)
    const type = FOLDED_INPUT_TYPES[entry.call] || (Number.isInteger(value) ? 'int' : 'float')
    const row = { key, type, label: entry.title || key, default: value }
    if (Number.isFinite(entry.min)) row.min = entry.min
    if (Number.isFinite(entry.max)) row.max = entry.max
    decided.push({ entry, row })
    candidates.push(row)
  }
  const verdict = positionVerdict(source, candidates)
  for (const d of decided) {
    if (!d.row) { skipped.push({ ...d.entry, reason: d.reason }); continue }
    const why = verdict(d.row.key, d.entry)
    if (why) { skipped.push({ ...d.entry, reason: why }); continue }
    inputs.push(d.row)
  }
  return { inputs, skipped }
}
