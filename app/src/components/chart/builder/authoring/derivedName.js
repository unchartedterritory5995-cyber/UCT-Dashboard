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

const OP_WORDS = Object.freeze({
  '>': '>', '<': '<', '>=': '≥', '<=': '≤', '==': '=', '!=': '≠',
  '+': '+', '-': '−', '*': '×', '/': '÷', '&&': 'and', '||': 'or',
})
const PREC = Object.freeze({ '||': 1, '&&': 2, '==': 3, '!=': 3, '>': 4, '<': 4, '>=': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6 })
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

export const NAME_MAX = 80

const norm = (s) => String(s).toLowerCase().replace(/[\s ]+/g, ' ').trim()
const NAMING_CUE = /\b(?:called|named|call it|name it|titled|title it|label it|labelled|labeled)\s+["'“‘]?([^"'”’.,;!?\n]{1,80})/gi
const QUOTED = /["“]([^"”\n]{1,80})["”]/g

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
    }
  }
  return out
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
export function nameOfTree(node, parentPrec = 0) {
  if (!isObj(node)) return '?'
  switch (node.type) {
    case 'num': return fmtNum(node.value)
    case 'series': return cap(String(node.name || ''))
    case 'offset': return `${nameOfTree(node.args ? node.args[0] : node.of, 9)}[${fmtNum(node.value)}]`
    case 'call': {
      const args = Array.isArray(node.args) ? node.args : []
      // ⭐ P3S — an event reads as one: "RSI 28 crosses above 70", not
      // "CROSSOVER 70 (RSI 28)" (P3R). Presentation only — names are not identity.
      if ((node.name === 'crossOver' || node.name === 'crossUnder') && args.length === 2) {
        const dir = node.name === 'crossOver' ? 'above' : 'below'
        return `${nameOfTree(args[0], 9)} crosses ${dir} ${nameOfTree(args[1], 9)}`
      }
      const fn = String(node.name || '').toUpperCase()
      // ⭐ THE CHART CONVENTION: "EMA 20", "RSI 14", "MACD 12,26,9". The bar
      // field `close` is the default source and is not repeated; any other source
      // IS part of the name ("EMA 20 (Open)") — a name must not hide what it reads.
      const nums = args.filter((a) => isObj(a) && a.type === 'num').map((a) => fmtNum(a.value))
      const other = args.filter((a) => !(isObj(a) && a.type === 'num')
        && !(isObj(a) && a.type === 'series' && a.name === 'close'))
      const head = nums.length ? `${fn} ${nums.join(',')}` : fn
      return other.length ? `${head} (${other.map((a) => nameOfTree(a)).join(', ')})` : head
    }
    case 'op': {
      const args = Array.isArray(node.args) ? node.args : []
      const word = OP_WORDS[node.name] || node.name
      if (args.length === 1) return `${node.name === '!' ? 'not ' : word}${nameOfTree(args[0], 9)}`
      const p = PREC[node.name] || 7
      const text = args.map((a) => nameOfTree(a, p)).join(` ${word} `)
      return p < parentPrec ? `(${text})` : text
    }
    // ⭐ PHASE 5 — the scope wrappers name what they read: "SPY Close", "EMA 50 (W)",
    // "High (W, forming)". A name must not hide another symbol or timeframe.
    case 'sym': {
      const child = Array.isArray(node.args) ? node.args[0] : null
      return `${String(node.value || '?')} ${nameOfTree(child, 9)}`
    }
    case 'tf':
    case 'tf_live': {
      const child = Array.isArray(node.args) ? node.args[0] : null
      return `${nameOfTree(child, 9)} (${String(node.value || '?')}${node.type === 'tf_live' ? ', forming' : ''})`
    }
    default: return '?'
  }
}

const clip = (s, max) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`)

/** The formula-derived label of ONE output row (`{key, ast}`) — the P2 rule. */
function formulaRowName(row) {
  return clip(row && row.ast ? nameOfTree(row.ast) : String((row && row.key) || ''), LABEL_MAX)
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
function formulaDefName(model) {
  // ⭐ PHASE 5 — a colour rule's / cloud's hidden column is not part of the name
  // (found in the sandbox flow: "EMA 50 · EMA 50 > EMA 50[1]", "EMA 10 · EMA 30 +1").
  const helpers = helperKeysOfRows(model && model.rows)
  const rows = (model && Array.isArray(model.rows) ? model.rows : []).filter((r) => r && r.ast && !helpers.has(r.key))
  if (!rows.length) return ''
  const primary = rows.find((r) => r.key === model.scanKey) || rows[0]
  const rest = rows.filter((r) => r !== primary)
  const parts = [nameOfTree(primary.ast), ...(rest.length ? [nameOfTree(rest[0].ast)] : [])]
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
        || (notPrimary(model, r) && r.label === formulaRowName(r))
      : !!r.label && (r.label === derivedRowName(r, model) || r.label === formulaRowName(r)),
  }]))
  // ⭐ An older save stored the FORMULA name; it is still automatic, so it follows.
  return { name: model.name, nameAuto: model.name === derivedDefName(model) || model.name === formulaDefName(model), rows }
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
