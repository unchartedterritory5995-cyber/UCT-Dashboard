// app/src/components/chart/builder/authoring/slots.js
//
// ─── ⭐⭐ P2 — STABLE EDIT TARGETS INSIDE A CANONICAL TREE ─────────────────────
//
// A conversational edit names WHAT it changes. Outputs are named by their key
// (`plotKey`). Inside a tree, this module derives two deterministic lists from
// the canonical tree itself:
//   • PARAMETER SLOTS — the editable leaves: every `num` literal (a window, a
//     threshold, a constant), every offset's bar count, every leaf that reads a
//     bar field (`close` …), and (PHASE 5) the ticker of every `sym` and the
//     period of every `tf` / `tf_live`. Id `<plotKey>#<path>`.
//   • CLAUSES — the operands of a top-level `&&` / `||` chain.
//
// ⛔ RE-DERIVED EVERY TURN, NEVER STORED. Ids are valid only against the
// revision whose compact view showed them (`patch.baseRevision`): the path is a
// list of `args` indices from the output's root (`0.1`), `root` for the root,
// and the segment `n` for an offset node's bar count.
//
// ⛔ ROLES COME FROM THE CLOSED TABLE (`argRoles`, `args`) and the engine's own
// comparison set (`toCondition.comparisons`) — no vocabulary typed here.

import { TABLE } from '../../engine/ast/parse'
import { comparisons } from '../toCondition'
import { outputTreeOf } from '../../engine/outputType'
import { collapseExpansions } from '../../engine/ast/callExpansions'

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** `'0.1'` ⇄ `[0, 1]`; `'root'` ⇄ `[]`; `'n'` stays the string `'n'`. */
export function pathToString(segs) {
  return segs.length ? segs.join('.') : 'root'
}
export function parsePath(text) {
  if (text === 'root') return []
  if (typeof text !== 'string' || !/^(\d+|n)(\.(\d+|n))*$/.test(text)) return null
  return text.split('.').map((s) => (s === 'n' ? 'n' : Number(s)))
}

/** `<plotKey>#<path>` → `{output, segs}` or null. */
export function parseSlotId(id) {
  const m = /^([A-Za-z][A-Za-z0-9_]*)#(.+)$/.exec(String(id || ''))
  if (!m) return null
  const segs = parsePath(m[2])
  return segs ? { output: m[1], segs } : null
}
export const slotIdOf = (output, segs) => `${output}#${pathToString(segs)}`

/** The node at `segs` (an `n` segment answers the offset node's bare count). */
export function nodeAt(tree, segs) {
  let cur = tree
  for (const s of segs) {
    if (s === 'n') {
      if (!isObj(cur) || cur.type !== 'offset') return undefined
      return cur.value
    }
    if (!isObj(cur) || !Array.isArray(cur.args) || s < 0 || s >= cur.args.length) return undefined
    cur = cur.args[s]
  }
  return cur
}

/** Copy-on-write replace of the node at `segs` (or of an offset count when the
 *  last segment is `n`). Every ancestor is shallow-copied; nothing is mutated. */
export function replaceAt(tree, segs, next) {
  if (!segs.length) return next
  const [head, ...rest] = segs
  if (head === 'n') {
    if (rest.length || !isObj(tree) || tree.type !== 'offset') throw new Error('slot: `n` addresses an offset count')
    return { ...tree, value: next }
  }
  if (!isObj(tree) || !Array.isArray(tree.args) || head < 0 || head >= tree.args.length) {
    throw new Error('slot: path does not resolve')
  }
  const args = tree.args.slice()
  args[head] = replaceAt(tree.args[head], rest, next)
  return { ...tree, args }
}

const BAR_FIELDS = Object.freeze(Object.keys(TABLE.series || {}))
export const barFields = () => BAR_FIELDS

/** ⭐ BATCH 2 — which argument of each formula function (`callExpansions.js`) is its
 *  length: a slot there is a WINDOW (a whole number of at least 1). */
const EXPANSION_ARGS = Object.freeze({
  linreg: ['source', 'length', 'offset'], correlation: ['source', 'source', 'length'],
  vwma: ['source', 'length'], roc: ['source', 'length'], mom: ['source', 'length'],
  kcMiddle: ['source', 'length'], kcUpper: ['source', 'length', 'multiplier'], kcLower: ['source', 'length', 'multiplier'],
})

function roleOf(parent, index) {
  if (!parent) return { role: 'constant', window: false, label: 'value' }
  if (parent.type === 'call' && Object.hasOwn(EXPANSION_ARGS, parent.name)) {
    const role = EXPANSION_ARGS[parent.name][index] || `argument ${index + 1}`
    return { role, window: role === 'length', label: `${parent.name} ${role}` }
  }
  if (parent.type === 'call') {
    const spec = (TABLE.functions || {})[parent.name] || {}
    const role = Array.isArray(spec.argRoles) && spec.argRoles[index] ? spec.argRoles[index] : `argument ${index + 1}`
    const window = Array.isArray(spec.args) && spec.args[index] === 'int'
    return { role, window, label: `${parent.name} ${role}` }
  }
  if (parent.type === 'op') {
    if (comparisons().includes(parent.name)) return { role: 'threshold', window: false, label: `threshold of ${parent.name}` }
    return { role: 'constant', window: false, label: `constant in ${parent.name}` }
  }
  return { role: 'constant', window: false, label: 'value' }
}

/** The slots of ONE tree, deterministic pre-order.
 *
 *  ⭐ BATCH 2 — IN THE COORDINATES THE MODEL IS SHOWN. A stored `linreg(close, 50, 0)` is
 *  the tree it IS (50 appears four times, `close` twice), and `compactView` shows the
 *  call. Slots are read off that collapsed tree, so `mom#1` is the momentum length the
 *  model sees and can name in an assumption (measured 10-09, production real model:
 *  `assumption:unknown-slot "momentum#1"` refused a correct turn). A path OUTSIDE an
 *  expansion is the same in both trees, so every other slot id is unchanged; `set_slot`
 *  edits the collapsed tree and the gate re-expands it, so all four 50s move together. */
export function slotsOfTree(output, tree) {
  const out = []
  const walk = (node, segs, parent, index, negated) => {
    if (!isObj(node)) return
    if (node.type === 'num') {
      const r = roleOf(parent, index)
      out.push(Object.freeze({
        id: slotIdOf(output, segs), output, path: pathToString(segs), kind: 'number',
        role: r.role, window: r.window, value: node.value,
        label: negated ? `${r.label} (negated)` : r.label, ...(negated ? { negated: true } : {}),
      }))
      return
    }
    if (node.type === 'series' && BAR_FIELDS.includes(node.name)) {
      const r = roleOf(parent, index)
      out.push(Object.freeze({
        id: slotIdOf(output, segs), output, path: pathToString(segs), kind: 'series',
        role: parent && parent.type === 'call' ? r.role : 'operand', value: node.name,
        label: parent && parent.type === 'call' ? `${parent.name} ${r.role}` : 'price field',
      }))
      return
    }
    if (node.type === 'offset' && typeof node.value === 'number') {
      out.push(Object.freeze({
        id: slotIdOf(output, [...segs, 'n']), output, path: pathToString([...segs, 'n']), kind: 'number',
        role: 'bars-ago', window: true, value: node.value, label: 'bars ago',
      }))
    }
    // ⭐ PHASE 5 — THE SCOPE WRAPPERS' OWN FIELD IS A SLOT: the symbol a `sym` reads
    // ("SPY → QQQ") and the period a `tf` / `tf_live` reads ("weekly → monthly"),
    // addressed at the wrapper node itself (its child is the next path segment).
    if (node.type === 'sym' && typeof node.value === 'string') {
      out.push(Object.freeze({
        id: slotIdOf(output, segs), output, path: pathToString(segs), kind: 'symbol',
        role: 'symbol', value: node.value, label: 'symbol read',
      }))
    }
    if ((node.type === 'tf' || node.type === 'tf_live') && typeof node.value === 'string') {
      out.push(Object.freeze({
        id: slotIdOf(output, segs), output, path: pathToString(segs), kind: 'timeframe',
        role: node.type === 'tf_live' ? 'forming period' : 'closed period', value: node.value,
        label: node.type === 'tf_live' ? 'timeframe (forming period)' : 'timeframe',
      }))
    }
    if (Array.isArray(node.args)) {
      const neg = node.type === 'op' && node.name === 'u-'
      node.args.forEach((a, i) => walk(a, [...segs, i], neg ? parent : node, neg ? index : i, neg))
    }
  }
  walk(collapseExpansions(tree), [], null, 0, false)
  return out
}

/** Every data output that has a tree, in plot order: `[{key, tree}]`. */
export function outputTrees(def) {
  const plots = Array.isArray(def && def.plots) ? def.plots : []
  return plots
    .filter((p) => p && typeof p.key === 'string' && p.style !== 'hlines')
    .map((p) => ({ key: p.key, tree: outputTreeOf(def, p.key) }))
    .filter((o) => isObj(o.tree))
}

/** ⭐ Every parameter slot of every output of `def`, re-derived from its trees. */
export function parameterSlots(def) {
  return outputTrees(def).flatMap((o) => slotsOfTree(o.key, o.tree))
}

/** The operands of a top-level `&&`/`||` chain (flattened, same operator only). */
export function clausesOfTree(output, tree) {
  if (!isObj(tree) || tree.type !== 'op' || (tree.name !== '&&' && tree.name !== '||')) return []
  const join = tree.name === '&&' ? 'and' : 'or'
  const out = []
  const walk = (node, segs) => {
    if (isObj(node) && node.type === 'op' && node.name === tree.name) {
      node.args.forEach((a, i) => walk(a, [...segs, i]))
      return
    }
    out.push({ id: slotIdOf(output, segs), output, path: pathToString(segs), join, node })
  }
  walk(tree, [])
  return out
}

export function clausesOf(def) {
  return outputTrees(def).flatMap((o) => clausesOfTree(o.key, o.tree))
}
