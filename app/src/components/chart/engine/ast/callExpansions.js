// app/src/components/chart/engine/ast/callExpansions.js
//
// ─── ⭐⭐ BATCH 2 — FORMULA FUNCTIONS THAT ARE EXACT IDENTITIES OVER THE TABLE ───
//
// Linear regression, correlation, VWMA, rate of change, momentum and the Keltner
// Channel bands cost the closed table NOTHING: each is an exact closed form over
// functions both interpreters already compute (`sum`, `wma`, `sma`, `stdev`,
// `ema`, offsets, arithmetic). The Pine translator has expanded `ta.linreg`,
// `ta.correlation`, `ta.vwma`, `ta.roc` and `ta.mom` this way since C1, and its
// derivations and vendor checks live beside those expansions in `pine.js`.
//
// ⭐ THIS IS NOW THE ONE COPY. `pine.js::BUILTIN_CALL_TREE` reads these builders,
// the native formula language expands the same names right after it parses
// (`parse.js::parseFormula`), and the conversational door expands a model's call
// before its tree gate (`applyPatch.gateTree`). One builder per name means a
// member's `linreg(close, 50, 0)` and an imported `ta.linreg(close, 50, 0)` are
// THE SAME TREE (the same `astHash`) — not two spellings that happen to agree.
//
// ⛔ A STORED DEFINITION CARRIES ONLY THE EXPANSION. No interpreter, alert lane,
// screen, budget or linter learns a new name, so nothing downstream can disagree
// about what these compute. Readable names come back STRUCTURALLY
// (`recogniseExpansion`), the same way colour-rule helpers are recognised.
//
// ⛔ A BUILDER DECLINES (null) RATHER THAN GUESSING: a window that is not a whole
// number literal (≥ 1, or ≥ 2 where the maths divides by n−1) has no expansion,
// and the caller refuses it by name.
//
// The server mirrors these builders for the trees a model emits
// (`api/services/call_expansions.py`); `tests/test_call_expansions_parity.py`
// runs this module through node and requires byte-identical trees.

// ⚠️ A NEGATIVE LITERAL IS `u-` OF A POSITIVE ONE, because that is what the parser
// produces when it reads the text the printer writes (`pine.js::cNum`, same rule).
const cNum = (value) => (value < 0
  ? { type: 'op', name: 'u-', args: [{ type: 'num', value: -value }] }
  : { type: 'num', value })
const cSeries = (name) => ({ type: 'series', name })
const cOp = (name, args) => ({ type: 'op', name, args })
const cCall = (name, args) => ({ type: 'call', name, args })

/** A whole-number literal window ≥ `min`, or NaN. */
function windowOf(node, min) {
  const n = node && node.type === 'num' ? Number(node.value) : NaN
  return Number.isFinite(n) && Number.isInteger(n) && n >= min ? n : NaN
}

/** Pine's `ta.tr` (no first-bar fallback) — `pine.js::BUILTIN_SERIES_TREE.tr`. */
export function trueRangeTree() {
  const prevClose = { type: 'offset', value: 1, args: [cSeries('close')] }
  const gap = (side) => cCall('abs', [cOp('-', [cSeries(side), prevClose])])
  return cCall('max', [
    cOp('-', [cSeries('high'), cSeries('low')]),
    cCall('max', [gap('high'), gap('low')]),
  ])
}

/**
 * name → `{ min, max, describe, build(args) → tree | null }`. `args` are canonical
 * trees; `describe` is the formula-reference line for the vocabulary list.
 */
export const CALL_EXPANSIONS = Object.freeze({
  // ta.roc(src, n) = 100 * (src - src[n]) / src[n], grouped left (pine.js note).
  roc: {
    min: 2, max: 2, signature: 'roc(source, length)', describe: 'rate of change, in percent: 100 × (source − source n bars ago) ÷ source n bars ago',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n)) return null
      const prev = { type: 'offset', value: n, args: [a[0]] }
      return cOp('/', [cOp('*', [cNum(100), cOp('-', [a[0], prev])]), prev])
    },
  },
  // ta.mom(src, n) = src - src[n] — roc's own numerator.
  mom: {
    min: 2, max: 2, signature: 'mom(source, length)', describe: 'momentum: source − source n bars ago',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n)) return null
      return cOp('-', [a[0], { type: 'offset', value: n, args: [a[0]] }])
    },
  },
  // ta.vwma = sma(src·volume, n) / sma(volume, n) — TradingView's published closed form.
  vwma: {
    min: 2, max: 2, signature: 'vwma(source, length)', describe: 'volume-weighted moving average: sma(source × volume) ÷ sma(volume)',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n)) return null
      const vol = cSeries('volume')
      return cOp('/', [
        cCall('sma', [cOp('*', [a[0], vol]), cNum(n)]),
        cCall('sma', [vol, cNum(n)]),
      ])
    },
  },
  // ta.linreg(src, n, offset) = sum/n + (n·wma − sum)·C, C = 6((n−1)/2 − offset)/(n(n−1)).
  linreg: {
    min: 2, max: 3, signature: 'linreg(source, length, offset = 0)', describe: 'linear regression: the least-squares line over the last n bars, read `offset` bars back from its end',
    build: (a) => {
      const n = windowOf(a[1], 2)
      const off = a[2] === undefined ? 0 : (a[2] && a[2].type === 'num' ? Number(a[2].value) : NaN)
      if (!Number.isFinite(n) || !Number.isFinite(off)) return null
      const total = cCall('sum', [a[0], cNum(n)])
      const weighted = cCall('wma', [a[0], cNum(n)])
      const C = (6 * ((n - 1) / 2 - off)) / (n * (n - 1))
      return cOp('+', [
        cOp('/', [total, cNum(n)]),
        cOp('*', [cOp('-', [cOp('*', [cNum(n), weighted]), total]), cNum(C)]),
      ])
    },
  },
  // ta.correlation(x, y, n) = (sma(x·y) − sma(x)·sma(y)) / (stdev(x)·stdev(y)).
  correlation: {
    min: 3, max: 3, signature: 'correlation(source1, source2, length)', describe: 'Pearson correlation of two series over n bars, from −1 to 1',
    build: (a) => {
      const n = windowOf(a[2], 2)
      if (!Number.isFinite(n)) return null
      const [x, y] = a
      const covariance = cOp('-', [
        cCall('sma', [cOp('*', [x, y]), cNum(n)]),
        cOp('*', [cCall('sma', [x, cNum(n)]), cCall('sma', [y, cNum(n)])]),
      ])
      return cOp('/', [covariance, cOp('*', [cCall('stdev', [x, cNum(n)]), cCall('stdev', [y, cNum(n)])])])
    },
  },
  // ta.kc(src, n, mult) → [middle, upper, lower]: ema(src,n) ± mult·ema(tr,n) (pine.js `kc`).
  kcMiddle: {
    min: 2, max: 2, signature: 'kcMiddle(source, length)', describe: 'Keltner Channel middle line: ema(source, n)',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n)) return null
      return cCall('ema', [a[0], cNum(n)])
    },
  },
  kcUpper: {
    min: 3, max: 3, signature: 'kcUpper(source, length, multiplier)', describe: 'Keltner Channel upper band: ema(source, n) + multiplier × ema(true range, n)',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n) || !a[2]) return null
      const mid = cCall('ema', [a[0], cNum(n)])
      return cOp('+', [mid, cOp('*', [a[2], cCall('ema', [trueRangeTree(), cNum(n)])])])
    },
  },
  kcLower: {
    min: 3, max: 3, signature: 'kcLower(source, length, multiplier)', describe: 'Keltner Channel lower band: ema(source, n) − multiplier × ema(true range, n)',
    build: (a) => {
      const n = windowOf(a[1], 1)
      if (!Number.isFinite(n) || !a[2]) return null
      const mid = cCall('ema', [a[0], cNum(n)])
      return cOp('-', [mid, cOp('*', [a[2], cCall('ema', [trueRangeTree(), cNum(n)])])])
    },
  },
})

export const EXPANSION_NAMES = Object.freeze(Object.keys(CALL_EXPANSIONS))

export const isExpansionName = (name) => typeof name === 'string'
  && Object.prototype.hasOwnProperty.call(CALL_EXPANSIONS, name)

/** Why `call` (an expansion name) has no expansion, in member words, or null. */
export function expansionProblem(call) {
  const spec = CALL_EXPANSIONS[call.name]
  const n = (call.args || []).length
  if (n < spec.min || n > spec.max) {
    return `${call.name} takes ${spec.min === spec.max ? spec.min : `${spec.min} or ${spec.max}`} arguments — ${spec.signature}`
  }
  return `${call.name} needs a whole-number length${call.name === 'linreg' || call.name === 'correlation' ? ' of at least 2' : ''} written as a number — ${spec.signature}`
}

/** The expansion of one call node of an expansion name, or null (`expansionProblem` says why). */
export function expandCall(call) {
  const spec = CALL_EXPANSIONS[call.name]
  const n = (call.args || []).length
  if (!spec || n < spec.min || n > spec.max) return null
  return spec.build(call.args)
}

/** Thrown by `expandCalls` — `guard` 'resolve:expansion'. */
export class ExpansionRefusal extends Error {
  constructor(message) { super(message); this.guard = 'resolve:expansion'; this.name = 'ExpansionRefusal' }
}

/**
 * Every call of an expansion name in `tree`, replaced (innermost first) by its
 * expansion. `declared(name)` → true for a name the closed table itself declares,
 * which is never expanded. Returns the SAME object when nothing was expanded.
 * Throws `ExpansionRefusal` for a call that has no expansion.
 */
export function expandCalls(tree, declared = () => false) {
  if (!tree || typeof tree !== 'object') return tree
  // ⛔ AN ITERATIVE SCAN FIRST: a tree with no expansion call is returned untouched
  // without recursing, so a pathologically deep formula still reaches the BUDGET's
  // depth refusal (`parse.deepTree.test.js`) instead of a stack overflow here.
  const { found, depth } = scanExpansions(tree, declared)
  if (!found) return tree
  if (depth > MAX_EXPANSION_DEPTH) throw new ExpansionRefusal(TOO_DEEP)
  const out = expandIn(tree, declared)
  // ⛔⛔ THE EXPANDED SIZE IS BOUNDED, because an expansion REPEATS its arguments
  // (`correlation` reads each of its two series four times): nesting multiplies, so a
  // 250-character formula nested ten deep became a 25 MB definition and a twelve-deep
  // one froze the tab for a minute (measured 10-09). Evaluation is not the cost — the
  // evaluator computes a shared subtree once — the WRITTEN tree is: the gate walk, the
  // hash, the stored JSON and the server's checks all read it as a tree.
  if (expandedSize(out, MAX_EXPANDED_NODES) > MAX_EXPANDED_NODES) throw new ExpansionRefusal(TOO_LARGE)
  return out
}

/** ⭐ The written size an expansion may reach, in tree nodes (the stored JSON's). A
 *  definition is at most 64 KB at the save door (`user_definitions.MAX_DEFINITION_BYTES`),
 *  about 1,500 nodes for the WHOLE document, so a tree past this cap could hardly be saved
 *  beside anything else. The largest realistic composite measured (three nested linregs)
 *  writes 209. */
export const MAX_EXPANDED_NODES = 1000
/** A tree holding an expansion deeper than this is refused before the recursive pass. */
export const MAX_EXPANSION_DEPTH = 200
const TOO_LARGE = `this formula nests linreg, correlation, vwma, roc, mom or the Keltner bands so deeply that it would write out more than ${MAX_EXPANDED_NODES} terms — nest fewer of them`
const TOO_DEEP = `this formula is nested more than ${MAX_EXPANSION_DEPTH} levels deep`

function scanExpansions(tree, declared) {
  let found = false
  let depth = 0
  const stack = [[tree, 1]]
  while (stack.length) {
    const [n, d] = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (d > depth) depth = d
    if (n.type === 'call' && isExpansionName(n.name) && !declared(n.name)) found = true
    if (Array.isArray(n.args)) for (const a of n.args) stack.push([a, d + 1])
  }
  return { found, depth }
}

/** The tree-node count of `tree` (a shared subtree counted at every place it is
 *  written), saturating just past `cap`. Linear in the DISTINCT nodes. */
export function expandedSize(tree, cap = Infinity) {
  const memo = new Map()
  const stack = [[tree, false]]
  while (stack.length) {
    const [n, done] = stack.pop()
    if (!n || typeof n !== 'object' || (memo.has(n) && !done)) continue
    const args = Array.isArray(n.args) ? n.args : []
    if (!done) {
      stack.push([n, true])
      for (const a of args) if (a && typeof a === 'object' && !memo.has(a)) stack.push([a, false])
      continue
    }
    let size = 1
    for (const a of args) size += a && typeof a === 'object' ? (memo.get(a) || 0) : 0
    memo.set(n, Math.min(size, cap + 1))
  }
  return memo.get(tree) || 0
}

function expandIn(tree, declared) {
  if (!tree || typeof tree !== 'object') return tree
  let changed = false
  const args = Array.isArray(tree.args) ? tree.args.map((a) => {
    const x = expandIn(a, declared)
    if (x !== a) changed = true
    return x
  }) : tree.args
  const node = changed ? { ...tree, args } : tree
  if (node.type === 'call' && isExpansionName(node.name) && !declared(node.name)) {
    const out = expandCall(node)
    if (!out) throw new ExpansionRefusal(expansionProblem(node))
    return out
  }
  return node
}

// ─── recognition: the readable name back from the expansion ───────────────────

const keyOf = (t) => { try { return JSON.stringify(t) } catch { return null } }
const same = (a, b) => { const x = keyOf(a); return x !== null && x === keyOf(b) }
const isCall = (t, name) => !!t && t.type === 'call' && t.name === name && Array.isArray(t.args)
const isOp = (t, name, n) => !!t && t.type === 'op' && t.name === name && Array.isArray(t.args) && t.args.length === n
const numOf = (t) => (t && t.type === 'num' ? t.value
  : (isOp(t, 'u-', 1) && t.args[0].type === 'num' ? -t.args[0].value : NaN))

/** The candidate `(name, args)` pairs a tree could be the expansion of, read off
 *  its shape. Each candidate is CONFIRMED by rebuilding it (below). */
function candidates(t) {
  const out = []
  if (isOp(t, '/', 2) && isOp(t.args[0], '*', 2) && t.args[1] && t.args[1].type === 'offset') {
    const prev = t.args[1]
    out.push(['roc', [prev.args[0], cNum(prev.value)]])
  }
  if (isOp(t, '-', 2) && t.args[1] && t.args[1].type === 'offset') {
    out.push(['mom', [t.args[0], cNum(t.args[1].value)]])
  }
  if (isOp(t, '/', 2) && isCall(t.args[1], 'sma') && isCall(t.args[0], 'sma') && isOp(t.args[0].args[0], '*', 2)) {
    out.push(['vwma', [t.args[0].args[0].args[0], t.args[1].args[1]]])
  }
  if (isOp(t, '+', 2) && isOp(t.args[0], '/', 2) && isCall(t.args[0].args[0], 'sum') && isOp(t.args[1], '*', 2)) {
    const total = t.args[0].args[0]
    const n = numOf(total.args[1])
    const C = numOf(t.args[1].args[1])
    if (Number.isFinite(n) && n >= 2 && Number.isFinite(C)) {
      // invert C = 6((n−1)/2 − off)/(n(n−1)) and keep the offset only if it rebuilds exactly
      const off = Math.round(((n - 1) / 2 - (C * n * (n - 1)) / 6) * 1e9) / 1e9
      out.push(['linreg', off === 0 ? [total.args[0], cNum(n)] : [total.args[0], cNum(n), cNum(off)]])
      if (off !== 0) out.push(['linreg', [total.args[0], cNum(n), cNum(off)]])
    }
  }
  if (isOp(t, '/', 2) && isOp(t.args[0], '-', 2) && isCall(t.args[0].args[0], 'sma') && isOp(t.args[0].args[0].args[0], '*', 2)) {
    const [x, y] = t.args[0].args[0].args[0].args
    out.push(['correlation', [x, y, t.args[0].args[0].args[1]]])
  }
  if (isCall(t, 'ema') && t.args.length === 2) out.push(['kcMiddle', [t.args[0], t.args[1]]])
  if ((isOp(t, '+', 2) || isOp(t, '-', 2)) && isCall(t.args[0], 'ema') && isOp(t.args[1], '*', 2)) {
    out.push([t.name === '+' ? 'kcUpper' : 'kcLower', [t.args[0].args[0], t.args[0].args[1], t.args[1].args[0]]])
  }
  return out
}

/**
 * ⭐ `{name, args}` when `tree` is EXACTLY the expansion of an expansion call, else
 * null. Two shapes are too ordinary to rename by default: `kcMiddle` is a bare
 * `ema` (an EMA is an EMA unless its siblings say otherwise — `allowBareEma`) and
 * `mom` is any `x − x[n]` (a hand-written difference stays a difference —
 * `allowMom`). Both still EXPAND exactly; only the read-back name is withheld.
 */
export function recogniseExpansion(tree, { allowBareEma = false, allowMom = false } = {}) {
  if (!tree || typeof tree !== 'object') return null
  for (const [name, args] of candidates(tree)) {
    if (name === 'kcMiddle' && !allowBareEma) continue
    if (name === 'mom' && !allowMom) continue
    const built = expandCall({ type: 'call', name, args })
    if (built && same(built, tree)) return { name, args }
  }
  return null
}

/** `tree` with every recognised expansion collapsed back to its call (the readable
 *  form the printer writes — the parser expands it again to the SAME tree). */
export function collapseExpansions(tree) {
  if (!tree || typeof tree !== 'object') return tree
  const hit = recogniseExpansion(tree)
  if (hit) return { type: 'call', name: hit.name, args: hit.args.map(collapseExpansions) }
  if (!Array.isArray(tree.args)) return tree
  let changed = false
  const args = tree.args.map((a) => { const x = collapseExpansions(a); if (x !== a) changed = true; return x })
  return changed ? { ...tree, args } : tree
}
