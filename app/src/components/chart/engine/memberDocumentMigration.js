// app/src/components/chart/engine/memberDocumentMigration.js
//
// ─── ⭐⭐ A SAVED MEMBER DOCUMENT GETS TODAY'S BEHAVIOUR ON LOAD ─────────────
//
// Two defects shipped in documents the member pane wrote, and both are in member
// data that is never rewritten server-side (a stopped run must never be a bulk
// write against member documents). So the fix is applied where every document
// enters a chart — `nativeRegistry.validateUserDefinitions` — as a PURE,
// DETERMINISTIC, IDEMPOTENT migration of the document in hand:
//
//   1. ⚰️ A CONDITION COLUMN THE PARAM MANIFEST NEVER PLACED. A conditional
//      colour's hidden column (`isBullish = fastMA > slowMA`) reads the same
//      lengths its plots do, but the door placed a parameter's locators in the
//      drawn rows only — so a length edit moved the lines and left the colour
//      deciding on the OLD lengths (TradingView set E3: 520 band-bars the wrong
//      side; E4: 4,980). The migration places the parameter in that column too,
//      at exactly the call the parameter already locates in a drawn row: a
//      locator `{tree, path}` names a literal argument of a call node N; every
//      node in a condition column equal to N — or to N at the parameter's
//      DEFAULT, which is where an old edit left the column — gets the same
//      argument's locator, and an EDITED document's column is moved to the value
//      the drawn rows hold (verified by parsing the text back). A node two
//      parameters would both claim is left alone.
//
//   2. ⚰️ A STALE HANDLE. `applyParamEdit` used to rewrite the scan tree and
//      leave `compute.fn` at the UNEDITED tree's hash, which `defSchema` refuses
//      — the edited document could not install. The handle is set back to the
//      hash of the tree the document holds, ONLY for a document whose parameter
//      manifest says it was edited this way (a param-edited `ast` document) and
//      whose trees are otherwise self-consistent (`treesHash`). A document whose
//      handle disagrees for any other reason is still refused, by `defSchema`.
//
// ⛔ NOTHING ELSE MOVES, and a document that needs neither comes back as the SAME
// object, so every caller of the registry sees exactly what it saw before.

import { astHash, parseFormula } from './ast/parse.js'
import { treesHash } from './ast/trees.js'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function nodeAt(tree, path) {
  let n = tree
  for (const k of path) {
    if (n === null || n === undefined) return undefined
    n = n[k]
  }
  return n
}

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  return JSON.stringify(v)
}

/** Every node of `tree` (through `args`), by its serialised form → the paths it
 *  sits at. Built ONCE per tree, bottom-up, so a lookup is O(1) — a per-node
 *  re-serialisation is quadratic and measurably slow on a large corpus tree. */
function indexTree(tree) {
  const index = new Map()
  const walk = (node, path) => {
    if (!isObj(node)) return stable(node)
    const parts = []
    for (const k of Object.keys(node).sort()) {
      if (k === 'args' && Array.isArray(node.args)) {
        const kids = node.args.map((a, i) => walk(a, [...path, 'args', i]))
        parts.push(`${JSON.stringify('args')}:[${kids.join(',')}]`)
      } else {
        parts.push(`${JSON.stringify(k)}:${stable(node[k])}`)
      }
    }
    const key = `{${parts.join(',')}}`
    if (!index.has(key)) index.set(key, [])
    index.get(key).push(path)
    return key
  }
  walk(tree, [])
  return index
}

/** The hidden columns a `colorMode` names — a plot's or a fill's colour rule. */
function conditionColumnKeys(def) {
  const hidden = new Set((def.plots || []).filter((p) => p && p.hidden === true).map((p) => p.key))
  const named = new Set()
  for (const p of def.plots || []) {
    for (const m of [p && p.colorMode, p && p.fill && p.fill.colorMode]) {
      if (typeof m === 'string' && m.startsWith('column:')) named.add(m.slice('column:'.length))
    }
  }
  for (const p of def.paints || []) {
    if (p && typeof p.colorMode === 'string' && p.colorMode.startsWith('column:')) named.add(p.colorMode.slice('column:'.length))
  }
  return [...named].filter((k) => hidden.has(k))
}

/** A call node whose arguments are all series names and numbers, printed the way
 *  the formula printer prints it (`name(a, b)`), or null for anything richer —
 *  the only shape the value repair below will touch, and it is VERIFIED by parse. */
function simpleCallText(node) {
  if (!isObj(node) || node.type !== 'call' || typeof node.name !== 'string' || !Array.isArray(node.args)) return null
  const parts = []
  for (const a of node.args) {
    if (isObj(a) && a.type === 'series' && typeof a.name === 'string') parts.push(a.name)
    else if (isObj(a) && a.type === 'num' && Number.isFinite(a.value)) parts.push(String(a.value))
    else return null
  }
  return `${node.name}(${parts.join(', ')})`
}

function withLiteral(tree, path, value) {
  if (!path.length) return { type: 'num', value }
  const [head, ...rest] = path
  if (Array.isArray(tree)) {
    const copy = tree.slice()
    copy[head] = withLiteral(tree[head], rest, value)
    return copy
  }
  return { ...tree, [head]: withLiteral(tree[head], rest, value) }
}

function migrateConditionLocators(def) {
  const c = def.compute
  if (!c || c.kind !== 'ast' || !isObj(c.trees) || !isObj(c.paramManifest)) return def
  const columns = conditionColumnKeys(def).filter((k) => isObj(c.trees[k]))
  if (!columns.length) return def
  const colSet = new Set(columns)
  const indexes = new Map()
  const indexOf = (k) => { if (!indexes.has(k)) indexes.set(k, indexTree(c.trees[k])); return indexes.get(k) }
  // candidate additions: column path → the parameters that would claim it, and the
  // value a drawn row holds for that parameter (an edited document's CURRENT value)
  const claims = new Map()
  const current = new Map()
  for (const [pid, entry] of Object.entries(c.paramManifest)) {
    const locs = Array.isArray(entry && entry.locators) ? entry.locators : []
    for (const loc of locs) {
      if (!loc || colSet.has(loc.treeIndex) || !Array.isArray(loc.astPath) || loc.astPath.length < 2) continue
      const tree = loc.treeIndex === null ? c.ast : c.trees[loc.treeIndex]
      const argPath = loc.astPath.slice(-2)
      if (argPath[0] !== 'args') continue
      const parent = nodeAt(tree, loc.astPath.slice(0, -2))
      const lit = nodeAt(tree, loc.astPath)
      if (!isObj(parent) || parent.type !== 'call' || !isObj(lit) || lit.type !== 'num') continue
      if (!current.has(pid)) current.set(pid, lit.value)
      // ⭐ The column holds the call as the door wrote it: at the parameter's DEFAULT
      // (a column no edit ever reached), or at its current value (an unedited one).
      const shapes = new Set([stable(parent)])
      if (Number.isFinite(entry.default)) shapes.add(stable(withLiteral(parent, argPath, entry.default)))
      for (const k of columns) {
        for (const want of shapes) {
          for (const p of (indexOf(k).get(want) || [])) {
            const astPath = [...p, ...argPath]
            const key = `${k}|${JSON.stringify(astPath)}`
            if (!claims.has(key)) claims.set(key, { treeIndex: k, astPath, callPath: p, pids: new Set() })
            claims.get(key).pids.add(pid)
          }
        }
      }
    }
  }
  if (!claims.size) return def
  const add = new Map()
  for (const cl of claims.values()) {
    if (cl.pids.size !== 1) continue
    const pid = [...cl.pids][0]
    const have = (c.paramManifest[pid].locators || [])
      .some((l) => l && l.treeIndex === cl.treeIndex && JSON.stringify(l.astPath) === JSON.stringify(cl.astPath))
    if (have) continue
    if (!add.has(pid)) add.set(pid, [])
    add.get(pid).push(cl)
  }
  if (!add.size) return def
  // ⭐⭐ AN EDITED DOCUMENT'S COLUMN IS MOVED TO THE VALUE THE MEMBER CHOSE — the
  // old edit moved every drawn row and left this one at the default. Only a call
  // whose text this module can print (series and numbers), and only when the
  // rewritten text PARSES BACK to the rewritten tree; otherwise the column keeps
  // its value and gains the locator, so the next edit moves it.
  let trees = c.trees
  let sources = c.sources
  for (const [pid, cls] of add) {
    const v = current.get(pid)
    if (!Number.isFinite(v)) continue
    for (const cl of cls) {
      const lit = nodeAt(trees[cl.treeIndex], cl.astPath)
      if (!isObj(lit) || lit.type !== 'num' || lit.value === v) continue
      const oldCall = nodeAt(trees[cl.treeIndex], cl.callPath)
      const nextTree = withLiteral(trees[cl.treeIndex], cl.astPath, v)
      const nextCall = nodeAt(nextTree, cl.callPath)
      const a = simpleCallText(oldCall)
      const b = simpleCallText(nextCall)
      const text = sources && typeof sources[cl.treeIndex] === 'string' ? sources[cl.treeIndex] : null
      if (!a || !b || !text || text.split(a).length !== 2) continue
      const nextText = text.replace(a, b)
      const back = parseFormula(nextText)
      let ok = false
      try { ok = !!(back && back.ok && astHash(back.ast) === astHash(nextTree)) } catch { ok = false }
      if (!ok) continue
      trees = { ...trees, [cl.treeIndex]: nextTree }
      sources = { ...sources, [cl.treeIndex]: nextText }
    }
  }
  const paramManifest = {}
  for (const [pid, entry] of Object.entries(c.paramManifest)) {
    const extra = add.get(pid)
    paramManifest[pid] = extra
      ? { ...entry, locators: [...(entry.locators || []), ...extra.map((cl) => ({ treeIndex: cl.treeIndex, astPath: cl.astPath }))] }
      : entry
  }
  const compute = { ...c, paramManifest }
  if (trees !== c.trees) {
    compute.trees = trees
    compute.sources = sources
    compute.treesHash = treesHash(trees)
  }
  return { ...def, compute }
}

function migrateStaleHandle(def) {
  const c = def.compute
  if (!c || c.kind !== 'ast' || !isObj(c.paramManifest) || typeof c.fn !== 'string' || !c.ast) return def
  let now
  try { now = astHash(c.ast) } catch { return def }
  if (now === c.fn) return def
  // ⛔ only a self-consistent document: its trees still hash to its `treesHash`
  if (isObj(c.trees)) {
    try { if (typeof c.treesHash === 'string' && treesHash(c.trees) !== c.treesHash) return def } catch { return def }
  }
  return { ...def, compute: { ...c, fn: now } }
}

/** One saved document → the same document with today's behaviour. Pure. */
export function migrateMemberDocument(def) {
  if (!isObj(def)) return def
  return migrateStaleHandle(migrateConditionLocators(def))
}
