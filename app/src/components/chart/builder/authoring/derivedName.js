// app/src/components/chart/builder/authoring/derivedName.js
//
// ─── ⭐⭐ P2 — THE DERIVED NAME: FROM THE CANONICAL TREES, NEVER FROM PROSE ────
//
// ⚰️ THE DEFECT THIS EXISTS FOR (Slice 1 browser proof, 2026-10-06): "Add a 20
// EMA" created `EMA 20`; "Make it 50" patched the tree to `ema(close, 50)` and the
// name stayed `EMA 20` — and was SAVED that way. The name was whatever the
// model's `create` op said, and no later op ever revisited it, so the model was
// the naming authority and a maths edit could make the name lie.
//
// THE RULE (applied once per patch, after every op, in `applyPatch.runOps`):
//
//   · A name is AUTO when it equals the derived name of the definition as it
//     stood BEFORE the patch. An auto name follows the maths: it is re-derived
//     from the RESULT.
//   · Anything else is CUSTOM and is kept — "My Trend Line" survives "make the
//     EMA 50".
//   · `create` ALWAYS takes the derived name: the model's create-name is prose,
//     not authority. A member who names it says so, and that arrives as an
//     explicit `rename_definition` (in the same patch or later) — custom.
//   · The same rule, per output, for labels (`rename_output` = custom).
//   · ⭐ AND A NAME THE MEMBER GAVE IN THIS TURN'S OWN WORDS — "call it My Trend",
//     "named 'Position size'" — is CUSTOM even when the model put it only on the
//     `create` (`memberNamed`). Only an explicit naming cue or a quoted phrase
//     counts: "Add a 20 EMA" names nothing, so its "EMA 20" still follows the maths.
//
// ⭐ NO STORED FLAG. "Auto" is decided by comparison, so it needs no schema field,
// survives save → reload → reopen, and cannot drift from what it describes. A
// member who renames to exactly the derived text gets auto behaviour, which is
// the same thing.
//
// ⛔ UNDO needs nothing here: the history snapshot holds the whole working
// definition, name included, so undoing a maths edit restores the name it had.

import { helperKeysOfRows, sameTree } from './colorRules'
import { tableSpecOf } from './tables'
import PREFLIGHT_RULES from './preflightRules.json'
import { recogniseExpansion } from '../../engine/ast/callExpansions'

const OP_WORDS = Object.freeze({
  '>': '>', '<': '<', '>=': '≥', '<=': '≤', '==': '=', '!=': '≠',
  '+': '+', '-': '−', '*': '×', '/': '÷', '&&': 'and', '||': 'or',
})
const PREC = Object.freeze({ '||': 1, '&&': 2, '==': 3, '!=': 3, '>': 4, '<': 4, '>=': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6 })
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

export const NAME_MAX = 80

const norm = (s) => String(s).toLowerCase().replace(/[\s ]+/g, ' ').trim()
// ⭐ BATCH 1 — ONE naming rule, shared with the server (`preflightRules.json` →
// `naming`): `/converse` strips the same clause before its planner, so a later
// "call it Swing Line" is a rename on every turn, not an unknown concept.
const NAMING_CUE = new RegExp(PREFLIGHT_RULES.naming.cue, 'gi')
const NAMING_STOP = new RegExp(PREFLIGHT_RULES.naming.stop, 'i')
const QUOTED = /["“]([^"”\n]{1,80})["”]/g

/** A cue's captured text → the name: whitespace collapsed, cut at the first joining
 *  word that starts another instruction ("Swing Line and colour it red"). */
const cueName = (raw) => String(raw).replace(/\s+/g, ' ').trim().split(NAMING_STOP)[0].trim()

/** The phrases the member explicitly gave as a NAME in `words` (normalised). */
export function memberNamePhrases(words) {
  if (typeof words !== 'string' || !words) return new Set()
  const out = new Set()
  for (const re of [NAMING_CUE, QUOTED]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(words))) {
      const p = norm(m[1])
      if (p) out.add(p)
      if (re === NAMING_CUE) { const c = norm(cueName(m[1])); if (c) out.add(c) }
    }
  }
  return out
}

/** The names the member gave after an explicit naming CUE ("call it Swing Line",
 *  "named My Trend") — original casing, trimmed. ⛔ Quoted text alone is NOT here: a
 *  quoted phrase may be table text ("show "BUY""), not a name. */
export function memberCueNames(words) {
  if (typeof words !== 'string' || !words) return []
  const out = []
  NAMING_CUE.lastIndex = 0
  let m
  while ((m = NAMING_CUE.exec(words))) {
    // "call it Swing Line and colour it red" names "Swing Line": the name ends at the
    // first joining word that starts another instruction.
    const text = cueName(m[1])
    if (text && !out.some((x) => norm(x) === norm(text))) out.push(text)
  }
  return out
}

/** Is `text` a naming clause the member wrote ("call it Swing Line")? */
export function isNamingClause(text) {
  if (typeof text !== 'string' || !text) return false
  NAMING_CUE.lastIndex = 0
  return NAMING_CUE.test(text)
}

/** Words that carry no instruction of their own around a naming clause. */
const FILLER = /^(?:please|pls|ok(?:ay)?|now|and|then|also|just|can you|could you|let'?s|i want to|i'd like to|lastly|finally)$/i

/**
 * ⭐ BATCH 1 — is this message ONLY a naming request ("Call it Swing Line",
 * "Okay, rename it to Momentum Pulse.")? Then the name is the whole instruction and
 * the studio renames deterministically, with no model call. Returns the one name,
 * or null when the message asks anything else (or names two things).
 */
export function soleCueName(words) {
  const names = memberCueNames(words)
  if (names.length !== 1) return null
  NAMING_CUE.lastIndex = 0
  const rest = String(words).replace(NAMING_CUE, (whole, raw) => {
    const name = cueName(raw)
    const at = whole.indexOf(name)
    return at < 0 ? ' ' : ` ${whole.slice(at + name.length)} `
  })
  const left = rest.replace(/["'“”‘’]/g, ' ')
    .split(/[\s,.;!?]+/).filter(Boolean)
  // what remains after the clause: filler words only (two-word fillers joined back)
  const joined = left.join(' ')
  if (!joined) return names[0]
  const tokens = joined.split(' ')
  for (let i = 0; i < tokens.length;) {
    const two = i + 1 < tokens.length ? `${tokens[i]} ${tokens[i + 1]}` : null
    const three = i + 2 < tokens.length ? `${two} ${tokens[i + 2]}` : null
    if (three && FILLER.test(three)) { i += 3; continue }
    if (two && FILLER.test(two)) { i += 2; continue }
    if (FILLER.test(tokens[i])) { i += 1; continue }
    return null
  }
  return names[0]
}

/** Did the member explicitly give `name` (a create name or label) in their words? */
export function memberNamed(phrases, name) {
  return typeof name === 'string' && !!name.trim() && phrases.has(norm(name))
}
export const LABEL_MAX = 60

const fmtNum = (v) => {
  if (!Number.isFinite(v)) return String(v)
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)))
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** One node → compact chart words. Deterministic; total over the node grammar. */
/** ⭐ BATCH 2 — how an exact-identity function reads in a name ("LINREG 50"). */
const EXPANSION_LABELS = Object.freeze({ kcUpper: 'KC upper', kcLower: 'KC lower', kcMiddle: 'KC middle' })

/** ⭐⭐ 2026-10-29 — A NAME IS WORDS, NOT A FORMULA (owner: "no formulas in chat").
 *  `plain` (the default) says the maths the way a chart label reads: "EMA 9 above
 *  EMA 20", "High below previous High and Low above previous Low", "EMA 9 vs EMA 20 %",
 *  "Close when Close above SMA 50". `formula` is the wording every name was derived in
 *  before — kept so a name SAVED under it still reads as automatic (`namingSnapshot`)
 *  and follows its maths, rather than being frozen as if a member had typed it. */
export const NAME_MODES = Object.freeze(['plain', 'formula'])

const PLAIN_RELATIONS = Object.freeze({
  '>': 'above', '<': 'below', '>=': 'at or above', '<=': 'at or below', '==': 'equals', '!=': 'not equal to',
})
const PLAIN_ARITHMETIC = Object.freeze({ '+': 'plus', '-': 'minus', '*': 'times', '/': 'divided by' })
const isNum = (n, v) => isObj(n) && n.type === 'num' && (v === undefined || n.value === v)
const isOpNode = (n, name, arity) => isObj(n) && n.type === 'op' && n.name === name
  && Array.isArray(n.args) && n.args.length === arity
const isNoValue = (n) => isOpNode(n, '/', 2) && isNum(n.args[0], 0) && isNum(n.args[1], 0)
const sameShape = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false } }

/** `(A − B) ÷ B × 100` (either factor order) → [A, B], else null. */
function percentDifference(node) {
  if (!isOpNode(node, '*', 2)) return null
  const [l, r] = node.args
  const ratio = isNum(r, 100) ? l : isNum(l, 100) ? r : null
  if (!isOpNode(ratio, '/', 2) || !isOpNode(ratio.args[0], '-', 2)) return null
  const [a, b] = ratio.args[0].args
  return sameShape(b, ratio.args[1]) ? [a, b] : null
}

export function nameOfTree(node, parentPrec = 0, mode = 'plain') {
  if (!isObj(node)) return '?'
  const plain = mode !== 'formula'
  const sub = (n, p) => nameOfTree(n, p, mode)
  // ⭐ BATCH 2 — a stored expansion is named by the function it IS, not its arithmetic.
  const hit = recogniseExpansion(node)
  if (hit) return sub({ type: 'call', name: EXPANSION_LABELS[hit.name] || hit.name, args: hit.args }, parentPrec)
  switch (node.type) {
    case 'num': return fmtNum(node.value)
    case 'series': return cap(String(node.name || ''))
    case 'offset': {
      const child = sub(node.args ? node.args[0] : node.of, 9)
      if (!plain) return `${child}[${fmtNum(node.value)}]`
      return node.value === 1 ? `previous ${child}` : `${child} ${fmtNum(node.value)} bars ago`
    }
    case 'call': {
      const args = Array.isArray(node.args) ? node.args : []
      // ⭐ P3S — an event reads as one: "RSI 28 crosses above 70", not
      // "CROSSOVER 70 (RSI 28)" (P3R). Presentation only — names are not identity.
      if ((node.name === 'crossOver' || node.name === 'crossUnder') && args.length === 2) {
        const dir = node.name === 'crossOver' ? 'above' : 'below'
        return `${sub(args[0], 9)} crosses ${dir} ${sub(args[1], 9)}`
      }
      const fn = String(node.name || '').toUpperCase()
      // ⭐ THE CHART CONVENTION: "EMA 20", "RSI 14", "MACD 12,26,9". The bar
      // field `close` is the default source and is not repeated; any other source
      // IS part of the name ("EMA 20 (Open)") — a name must not hide what it reads.
      const nums = args.filter((a) => isObj(a) && a.type === 'num').map((a) => fmtNum(a.value))
      const other = args.filter((a) => !(isObj(a) && a.type === 'num')
        && !(isObj(a) && a.type === 'series' && a.name === 'close'))
      const head = nums.length ? `${fn} ${nums.join(',')}` : fn
      return other.length ? `${head} (${other.map((a) => sub(a)).join(', ')})` : head
    }
    case 'op': {
      const args = Array.isArray(node.args) ? node.args : []
      if (!plain) {
        const word = OP_WORDS[node.name] || node.name
        if (args.length === 1) return `${node.name === '!' ? 'not ' : word}${sub(args[0], 9)}`
        const p = PREC[node.name] || 7
        const text = args.map((a) => sub(a, p)).join(` ${word} `)
        return p < parentPrec ? `(${text})` : text
      }
      if (isNoValue(node)) return 'no value'
      if (node.name === '?:' && args.length === 3) {
        // "X when C" — the shape of "show a value only when the condition holds"
        const [c, x, y] = args
        const text = isNoValue(y) ? `${sub(x, 1)} when ${sub(c, 1)}`
          : isNoValue(x) ? `${sub(y, 1)} unless ${sub(c, 1)}`
            : `${sub(x, 1)} when ${sub(c, 1)}, else ${sub(y, 1)}`
        return parentPrec > 0 ? `(${text})` : text
      }
      if (args.length === 1) {
        if (node.name === '!') return `not ${sub(args[0], 9)}`
        return isNum(args[0]) ? `−${sub(args[0], 9)}` : `negative ${sub(args[0], 9)}`
      }
      // `x − x[n]` is the n-bar change in x ("Close 5-bar change")
      if (node.name === '-' && args.length === 2 && isObj(args[1]) && args[1].type === 'offset'
          && sameShape(args[0], (args[1].args || [])[0])) {
        const text = `${sub(args[0], 9)} ${fmtNum(args[1].value)}-bar change`
        return parentPrec > 4 ? `(${text})` : text
      }
      const pct = percentDifference(node)
      if (pct) {
        const text = `${sub(pct[0], 5)} vs ${sub(pct[1], 5)} %`
        return parentPrec > 4 ? `(${text})` : text
      }
      if (node.name === '*' && args.length === 2 && (isNum(args[0]) || isNum(args[1]))) {
        const [k, x] = isNum(args[0]) ? args : [args[1], args[0]]
        return `${fmtNum(k.value)} times ${sub(x, 9)}`
      }
      const p = PREC[node.name] || 7
      const word = PLAIN_RELATIONS[node.name] || PLAIN_ARITHMETIC[node.name] || OP_WORDS[node.name] || node.name
      const text = args.map((a) => sub(a, p)).join(` ${word} `)
      return p < parentPrec ? `(${text})` : text
    }
    // ⭐ PHASE 5 — the scope wrappers name what they read: "SPY Close", "EMA 50 (W)",
    // "High (W, forming)". A name must not hide another symbol or timeframe.
    case 'sym': {
      const child = Array.isArray(node.args) ? node.args[0] : null
      return `${String(node.value || '?')} ${sub(child, 9)}`
    }
    case 'tf':
    case 'tf_live': {
      const child = Array.isArray(node.args) ? node.args[0] : null
      return `${sub(child, 9)} (${String(node.value || '?')}${node.type === 'tf_live' ? ', forming' : ''})`
    }
    default: return '?'
  }
}

const clip = (s, max) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`)

/** The formula-derived label of ONE output row (`{key, ast}`) — the P2 rule. */
function formulaRowName(row, mode = 'plain') {
  return clip(row && row.ast ? nameOfTree(row.ast, 0, mode) : String((row && row.key) || ''), LABEL_MAX)
}

// ─── ⭐ STABILIZATION 3 — A CALCULATOR / TABLE INDICATOR IS NAMED BY ITS TABLE ───
//
// ⚰️ Measured on prod 2026-10-08: a position calculator was named "(ABS (EntryPrice −
// StopPrice) > 0) ?: FLOOR (AccountSize × RiskPercent ÷ 100 ÷…" and its outputs the
// same way — the formula IS the maths, but for a calculator it is not a name. Such an
// indicator already carries a member-readable description of itself: its table's
// TITLE (a header row of text alone) and each value's row LABEL. No model call.
//
// It applies to a CALCULATOR (an output reads a member setting) or a TABLE-ONLY
// indicator (no visible line of its own) — an EMA that also shows a small table keeps
// its maths name. A member's own name is untouched (it is custom, as always).

const readsMemberInput = (model, row) => {
  const keys = new Set(((model && model.memberInputs) || []).map((x) => x && x.key))
  if (!keys.size || !row || !row.ast) return false
  const stack = [row.ast]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (n.type === 'series' && keys.has(n.name)) return true
    if (Array.isArray(n.args)) stack.push(...n.args)
  }
  return false
}

/** {title, labels, labelOf} from this model's OWN table, when the naming applies; else null. */
function tableNames(model) {
  if (!model || !model.objects || !Array.isArray(model.rows)) return null
  const rows = model.rows.filter((r) => r && r.ast)
  const calculator = rows.some((r) => readsMemberInput(model, r))
  const tableOnly = rows.length > 0 && rows.every((r) => r.hidden === true)
  if (!calculator && !tableOnly) return null
  let spec = null
  try {
    spec = tableSpecOf(model.objects, (t) => {
      const r = rows.find((x) => sameTree(x.ast, t))
      return r ? r.key : null
    })
  } catch { spec = null }
  if (!spec) return null
  const byRow = new Map()
  for (const c of spec.cells) {
    if (!byRow.has(c.row)) byRow.set(c.row, [])
    byRow.get(c.row).push(c)
  }
  let title = null
  const labels = []
  const labelOf = new Map()
  ;[...byRow.entries()].sort((a, b) => a[0] - b[0]).forEach(([, cells], i) => {
    const sorted = cells.slice().sort((a, b) => a.col - b.col)
    const texts = sorted.filter((c) => typeof c.text === 'string' && c.text.trim())
    const outs = sorted.filter((c) => c.output)
    if (i === 0 && !outs.length && texts.length === 1) { title = texts[0].text.trim(); return }
    if (texts.length && outs.length) {
      const label = texts[0].text.trim()
      labels.push(label)
      for (const o of outs) if (!labelOf.has(o.output)) labelOf.set(o.output, label)
    }
  })
  return { title, labels, labelOf }
}

/** "Calculator · Account size, Risk % +2" — a calculator with no table to name it. */
function calculatorName(model) {
  const rows = ((model && model.rows) || []).filter((r) => r && r.ast)
  if (!rows.some((r) => readsMemberInput(model, r))) return null
  const labels = ((model && model.memberInputs) || []).map((x) => (x && (x.label || x.key)) || '').filter(Boolean)
  if (!labels.length) return null
  return clip(`Calculator · ${labels.slice(0, 2).join(', ')}${labels.length > 2 ? ` +${labels.length - 2}` : ''}`, NAME_MAX)
}

/** The derived label of ONE output row: its table label when the table names the
 *  indicator (`tableNames`), else its formula (the P2 rule). */
export function derivedRowName(row, model = null) {
  const t = model ? tableNames(model) : null
  const label = t && row ? t.labelOf.get(row.key) : null
  return label ? clip(label, LABEL_MAX) : formulaRowName(row)
}

/**
 * The derived name of the whole definition, from EVERY output — never plot 1
 * alone. Primary output first; a second output is named too; more are counted.
 * @param {{rows: {key, ast, hidden}[], scanKey: string}} model
 */
export function derivedDefName(model) {
  const t = tableNames(model)
  if (t && t.title) return clip(t.title, NAME_MAX)
  if (t && t.labels.length) {
    return clip(t.labels.slice(0, 2).join(' · ') + (t.labels.length > 2 ? ` +${t.labels.length - 2}` : ''), NAME_MAX)
  }
  return calculatorName(model) || formulaDefName(model)
}

/** The P2 formula-derived definition name (also what older saves stored). */
function formulaDefName(model, mode = 'plain') {
  // ⭐ PHASE 5 — a colour rule's / cloud's hidden column is not part of the name
  // (found in the sandbox flow: "EMA 50 · EMA 50 > EMA 50[1]", "EMA 10 · EMA 30 +1").
  const helpers = helperKeysOfRows(model && model.rows)
  const rows = (model && Array.isArray(model.rows) ? model.rows : []).filter((r) => r && r.ast && !helpers.has(r.key))
  if (!rows.length) return ''
  const primary = rows.find((r) => r.key === model.scanKey) || rows[0]
  const rest = rows.filter((r) => r !== primary)
  const parts = [nameOfTree(primary.ast, 0, mode), ...(rest.length ? [nameOfTree(rest[0].ast, 0, mode)] : [])]
  const more = rest.length > 1 ? ` +${rest.length - 1}` : ''
  return clip(parts.join(' · ') + more, NAME_MAX)
}

/**
 * ⚰️ Measured on prod 2026-10-08 (real model, a chart table): a HIDDEN `rsi14` CREATED
 * first with `ema20` primary was stored as "EMA 20" — plot 1's empty label follows the
 * definition name (`model.js` DEFAULT_PLOT1_LABEL), so an alert or setting on the RSI
 * would have been named after the EMA. A first row that is NOT primary therefore gets
 * its OWN derived name when it is created, and keeps following its own maths after.
 * ⛔ Existing documents are untouched: a stored plot 1 with an EMPTY label still follows
 * the definition name (the Builder's convention; presentation stays byte-identical).
 */
const notPrimary = (model, row) => !!model.scanKey && model.scanKey !== row.key

/** What "auto" looked like before the patch: name + each row's label. */
export function namingSnapshot(model) {
  if (!model) return null
  // ⚠️ Plot 1's EMPTY label means "follow the definition name" (model.js) — auto.
  // A later output's empty label means "show the key" — a presentation DEFAULT
  // the member (or an import) chose, not a description of the maths, so it is
  // left alone (measured: P2 truth 11 — an imported `sig` must survive a maths
  // edit). Only a label that IS the derived text counts as auto there.
  // ⭐ A non-primary plot 1 that already carries its own DERIVED name (`notPrimary`) is
  // auto too — it follows its own maths.
  const rows = new Map(model.rows.map((r, i) => [r.key, {
    label: r.label || '',
    auto: i === 0
      ? (r.label || '') === '' || r.label === derivedRowName(r, model)
        || (notPrimary(model, r) && (r.label === formulaRowName(r) || r.label === formulaRowName(r, 'formula')))
      : !!r.label && (r.label === derivedRowName(r, model) || r.label === formulaRowName(r)
        || r.label === formulaRowName(r, 'formula')),
  }]))
  // ⭐ An older save stored the FORMULA name; it is still automatic, so it follows.
  // ⭐ 2026-10-29: and a name derived in the FORMULA wording ("EMA 9 > EMA 20", what every
  // save before the plain wording stored) is automatic too, so it moves to the plain words
  // on the next maths edit rather than being frozen as if the member had typed it.
  return {
    name: model.name,
    nameAuto: model.name === derivedDefName(model) || model.name === formulaDefName(model)
      || model.name === formulaDefName(model, 'formula'),
    rows,
  }
}

/**
 * Apply the rule to the patched model IN PLACE. Returns the disclosures.
 * @param {object} model  st.model after every op
 * @param {object|null} before  `namingSnapshot(modelOf(input))`, null on a create
 * @param {{renamedDefinition: boolean, renamedOutputs: Set<string>}} explicit
 */
export function applyDerivedNaming(model, before, explicit) {
  const changes = []
  const renamedOutputs = explicit.renamedOutputs || new Set()
  // ── the definition's name ──
  const nameIsAuto = !explicit.renamedDefinition && (!before || before.nameAuto)
  if (nameIsAuto) {
    const next = derivedDefName(model)
    if (next && next !== model.name) {
      changes.push({ kind: 'name-derived', from: model.name, to: next })
      model.name = next
    }
  }
  // ── each output's label ──
  const helpers = helperKeysOfRows(model.rows)
  model.rows.forEach((row, i) => {
    if (renamedOutputs.has(row.key)) return
    if (helpers.has(row.key)) return               // ⭐ PHASE 5 — keeps "<owner> colour rule"
    const prior = before ? before.rows.get(row.key) : null
    const isNew = !prior
    if (!isNew && !prior.auto) return                 // custom label: keep
    // ⭐ …and a plot 1 whose TABLE names it (a calculator's "Shares") carries that
    // label — the definition's name is the table's title, not this value's.
    const tableLabelled = !!(tableNames(model) && tableNames(model).labelOf.has(row.key))
    const ownName = i === 0 && (tableLabelled || (notPrimary(model, row) && (isNew || prior.label !== '')))
    if (i === 0 && !ownName) {
      // Plot 1's empty label means "follow the definition name" (model.js).
      if (row.label) row.label = ''
    } else {
      const next = derivedRowName(row, model)
      if (next !== row.label) row.label = next
    }
  })
  return changes
}
