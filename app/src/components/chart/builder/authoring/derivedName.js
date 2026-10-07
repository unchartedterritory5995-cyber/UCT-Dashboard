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
//
// ⭐ NO STORED FLAG. "Auto" is decided by comparison, so it needs no schema field,
// survives save → reload → reopen, and cannot drift from what it describes. A
// member who renames to exactly the derived text gets auto behaviour, which is
// the same thing.
//
// ⛔ UNDO needs nothing here: the history snapshot holds the whole working
// definition, name included, so undoing a maths edit restores the name it had.

const OP_WORDS = Object.freeze({
  '>': '>', '<': '<', '>=': '≥', '<=': '≤', '==': '=', '!=': '≠',
  '+': '+', '-': '−', '*': '×', '/': '÷', '&&': 'and', '||': 'or',
})
const PREC = Object.freeze({ '||': 1, '&&': 2, '==': 3, '!=': 3, '>': 4, '<': 4, '>=': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6 })
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

export const NAME_MAX = 80
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
    default: return '?'
  }
}

const clip = (s, max) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`)

/** The derived label of ONE output row (`{key, ast}`). */
export function derivedRowName(row) {
  return clip(row && row.ast ? nameOfTree(row.ast) : String((row && row.key) || ''), LABEL_MAX)
}

/**
 * The derived name of the whole definition, from EVERY output — never plot 1
 * alone. Primary output first; a second output is named too; more are counted.
 * @param {{rows: {key, ast, hidden}[], scanKey: string}} model
 */
export function derivedDefName(model) {
  const rows = (model && Array.isArray(model.rows) ? model.rows : []).filter((r) => r && r.ast)
  if (!rows.length) return ''
  const primary = rows.find((r) => r.key === model.scanKey) || rows[0]
  const rest = rows.filter((r) => r !== primary)
  const parts = [nameOfTree(primary.ast), ...(rest.length ? [nameOfTree(rest[0].ast)] : [])]
  const more = rest.length > 1 ? ` +${rest.length - 1}` : ''
  return clip(parts.join(' · ') + more, NAME_MAX)
}

/** What "auto" looked like before the patch: name + each row's label. */
export function namingSnapshot(model) {
  if (!model) return null
  // ⚠️ Plot 1's EMPTY label means "follow the definition name" (model.js) — auto.
  // A later output's empty label means "show the key" — a presentation DEFAULT
  // the member (or an import) chose, not a description of the maths, so it is
  // left alone (measured: P2 truth 11 — an imported `sig` must survive a maths
  // edit). Only a label that IS the derived text counts as auto there.
  const rows = new Map(model.rows.map((r, i) => [r.key, {
    label: r.label || '',
    auto: i === 0 ? (r.label || '') === '' : !!r.label && r.label === derivedRowName(r),
  }]))
  return { name: model.name, nameAuto: model.name === derivedDefName(model), rows }
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
  model.rows.forEach((row, i) => {
    if (renamedOutputs.has(row.key)) return
    const prior = before ? before.rows.get(row.key) : null
    const isNew = !prior
    if (!isNew && !prior.auto) return                 // custom label: keep
    if (i === 0) {
      // Plot 1's empty label means "follow the definition name" (model.js).
      if (row.label) row.label = ''
    } else {
      const next = derivedRowName(row)
      if (next !== row.label) row.label = next
    }
  })
  return changes
}
