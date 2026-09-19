// app/src/components/chart/engine/ast/graph.js
//
// ─── CANONICAL COMPUTATION GRAPH V2 (WAVE C2C) ──────────────────────────────
//
// C2B measured the thing this file exists to fix: the two DOCUMENT_SIZE_BLOCKED
// scripts are ~98.5% REPETITION. `compute.trees` is 84% of a 332 KB document,
// and its two largest trees are byte-identical twins written out in full,
// because a multi-plot Pine script computes one consensus expression and then
// plots several views of it. The 64 KB cap is not the defect; INLINING a DAG as
// a forest is.
//
// ⭐⭐ WHAT THIS IS, IN ONE SENTENCE: a STORAGE form that expands, by pure
// structural dereference, to EXACTLY the canonical trees every existing
// consumer already reads. `expandGraph(buildGraph(trees))` is `trees`, node for
// node, so the interpreter, `printFormula`, `astHash`, `treesHash`, the linter,
// the freshness lane and `param_manifest.py` all keep working on the shape they
// were written against. Nothing downstream learns a new node type.
//
// ⛔⛔ TWO OWNER DECISIONS ARE LOAD-BEARING HERE AND EACH HAS A NAMED FAILURE.
//
// 1. **PARAMETER IDENTITY IS LOGICAL, NOT POSITIONAL — AND SHARING MUST NOT
//    LAUNDER IT.** `pine.js` mints one `__uct_param_N` per Pine `input.*` CALL
//    NODE (object identity via `env`), so one input used nine times is one
//    parameter and two `input.int(14)` declarations are two parameters even
//    though both literals read `14`. If node sharing were keyed on the
//    structural content of the expanded subtree, `sma(close, 14)` owned by
//    `__uct_param_1` would collapse into `sma(close, 14)` owned by
//    `__uct_param_2` — one node, two parameters pointing at it — and moving one
//    member's slider would silently move the OTHER plot. So the sharing key
//    carries the owning parameter id of every literal it contains. An untagged
//    `14` and a tagged `14` are also DIFFERENT nodes: making a fixed constant
//    adjustable by accident is the same defect wearing the other sign.
//
// 2. **HASHES REPRESENT SEMANTIC CONTENT, NOT INCIDENTAL SERIALIZATION
//    LAYOUT.** A hash taken over this node TABLE would depend on node numbering
//    and table order — the definition of incidental layout. So there is no
//    "graph hash": `graphTreesHash` is `treesHash(expandGraph(graph))`, the
//    hash of the PROGRAM. Two graphs that expand to the same trees are the same
//    definition and hash identically, whatever order their nodes are in. The
//    existing `astHash`/`treesHash` do not move by one byte, which is what
//    keeps `compute.rev`, the shared results table, share tokens and the ledger
//    from migrating for a representation change that changed no maths.
//
// ⛔ IDS ARE CANONICAL TOO, so the graph itself is diffable and two independent
// builds of one program are byte-identical: nodes are sorted by (height,
// content digest) and numbered 0..N-1. Height first makes the ordering
// TOPOLOGICAL by construction — a child's height is strictly smaller than its
// parent's — which is why `assertGraph` can prove acyclicity with one integer
// comparison (every arg index < the referencing node's index) instead of a
// colouring walk. A cycle is not "detected" here; it is UNREPRESENTABLE.
//
// ⛔⛔ AND THE ONE NEW ATTACK THIS REPRESENTATION CREATES, GUARDED BEFORE IT
// RUNS. A DAG expands exponentially: forty nodes each doubling the last
// (`op(k-1, k-1)`) is a 2 KB document that inlines to 2^40 nodes. Expansion is
// therefore never attempted until `expandedSizes` has proved it terminates —
// the size of every node is computed BOTTOM-UP IN INTEGERS (`1 + sum of
// children`), which is O(N) arithmetic that never materialises anything, and a
// root over `MAX_EXPANDED_NODES` is refused from that addition. Same shape as
// `interpret`'s `MAX_RECURRENCE_STEPS`: the refusal costs nothing because the
// work never starts.
import { CANONICAL_KEYS, KEY_RE, sha256Hex } from './parse'
import { treesHash } from './trees'

export const GRAPH_VERSION = 2

/** The inlined node count one output root is allowed to expand to.
 *
 *  ⭐ DERIVED FROM WHAT THE PRODUCT CAN ALREADY RUN, not from a round number:
 *  `DEFAULT_BUDGET.maxNodes` refuses any single tree over 128 nodes at compute
 *  time, so a tree beyond this ceiling is already un-runnable by a factor of
 *  sixteen — this bound exists to stop a crafted graph from exhausting memory
 *  during VALIDATION, before the interpreter's own budget ever gets a look. */
export const MAX_EXPANDED_NODES = 2048

/** The whole document's inlined node count, across every output root. The
 *  largest real corpus document expands to a few thousand; this is an order of
 *  magnitude of headroom over anything a member can produce. */
export const MAX_EXPANDED_TOTAL = 32768

/** Distinct nodes a graph may declare. A graph larger than this cannot fit the
 *  64 KB document envelope anyway; the bound is here so validation is total
 *  even on a document that arrived from somewhere else. */
export const MAX_GRAPH_NODES = 8192

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** `__uctParamId` is non-enumerable by design (it must be invisible to
 *  `astHash`, `JSON.stringify` and every persisted copy) — read it BY NAME, the
 *  same way `pineParamManifest.js::collectParamLocators` does. */
const paramIdOf = (node) => (isPlainObject(node) && node.__uctParamId !== undefined
  ? String(node.__uctParamId) : null)

/**
 * The content digest of one node: what makes two nodes THE SAME NODE.
 *
 * ⛔ IT IS NOT `stableStringify`. That function is deliberately blind to the
 * non-enumerable parameter tag — which is right for hashing a program (a
 * parameter's identity is metadata, not maths) and exactly wrong for deciding
 * whether two subtrees may share storage (owner decision 1 above).
 *
 * @param {object} node a canonical V1 node (its children already digested)
 * @param {string[]} childDigests
 * @returns {string} 32 hex chars — 128 bits, and a collision is REFUSED rather
 *   than trusted, because "two different expressions became one node" is the
 *   one failure this whole file exists to prevent.
 */
function digestOf(node, childDigests, seen) {
  const pid = paramIdOf(node)
  const key = [
    node.type,
    node.name === undefined ? '' : JSON.stringify(node.name),
    node.value === undefined ? '' : JSON.stringify(node.value),
    // ⛔ THE PARAMETER TAG IS PART OF THE IDENTITY. Removing this line is the
    // silent-cross-talk defect; `graph.paramProvenance.test.js` pins it.
    pid === null ? '' : `#${pid}`,
    childDigests.length ? `(${childDigests.join(',')})` : '',
  ].join('|')
  const d = sha256Hex(key).slice(0, 32)
  const prior = seen.get(d)
  if (prior !== undefined && prior !== key) {
    throw new Error(`graph: two different nodes digest identically (${d}) — refusing rather than sharing them`)
  }
  seen.set(d, key)
  return d
}

/**
 * `{plotKey: canonicalTree}` to the V2 graph.
 *
 * @param {object} trees the trees a caller is about to SAVE — already the
 *   filtered, kept set, exactly what `pineParamManifest.buildParamManifest`
 *   receives. A refused or hidden output is not a tree.
 * @param {object} [opts]
 * @param {Array} [opts.params] `translatePine(...).inputParams` — the immutable
 *   per-declaration metadata. Locators are derived HERE from the tags the trees
 *   still carry, never re-declared by the caller.
 * @returns {{graphVersion:number, nodes:object[], outputRoots:object, parameters:object}}
 */
export function buildGraph(trees, opts = {}) {
  if (!isPlainObject(trees)) {
    throw new Error(`graph: expected an object of plotKey to canonical tree, got ${typeof trees}`)
  }
  const keys = Object.keys(trees).sort()
  if (!keys.length) throw new Error('graph: an empty trees map names no plot')
  for (const k of keys) {
    if (!KEY_RE.test(k)) throw new Error(`graph: ${JSON.stringify(k)} is not a legal plot key (${KEY_RE})`)
  }

  const seenDigests = new Map()
  /** digest -> {node, childDigests, height, paramId} */
  const distinct = new Map()
  const byObject = new Map()

  const intern = (node) => {
    if (byObject.has(node)) return byObject.get(node)
    if (!isPlainObject(node)) {
      throw new Error(`graph: not a canonical node: ${JSON.stringify(node) ?? String(node)}`)
    }
    const expected = CANONICAL_KEYS[node.type]
    if (!expected) throw new Error(`graph: node type ${JSON.stringify(node.type)} is not canonical`)
    const own = Object.keys(node).sort()
    const want = [...expected].sort()
    if (own.length !== want.length || own.some((k, i) => k !== want[i])) {
      throw new Error(`graph: a ${node.type} node must carry exactly [${want}] — got [${own}]`)
    }
    const childDigests = Array.isArray(node.args) ? node.args.map(intern) : []
    const d = digestOf(node, childDigests, seenDigests)
    if (!distinct.has(d)) {
      const height = childDigests.reduce((h, cd) => Math.max(h, distinct.get(cd).height + 1), 0)
      distinct.set(d, { node, childDigests, height, paramId: paramIdOf(node) })
      if (distinct.size > MAX_GRAPH_NODES) {
        throw new Error(`graph: over ${MAX_GRAPH_NODES} distinct nodes`)
      }
    }
    byObject.set(node, d)
    return d
  }

  const rootDigests = {}
  for (const k of keys) rootDigests[k] = intern(trees[k])

  // ⛔ CANONICAL NUMBERING, and it is what makes the graph itself comparable:
  // (height, digest) is a total order derived only from CONTENT, so shuffling
  // the traversal — a different plot order, a different tree first — cannot
  // move a single id. Height leading also guarantees children sort before
  // parents, which is the acyclicity `assertGraph` then checks for free.
  const order = [...distinct.keys()].sort((a, b) => {
    const ha = distinct.get(a).height
    const hb = distinct.get(b).height
    if (ha !== hb) return ha - hb
    return a < b ? -1 : a > b ? 1 : 0
  })
  const indexOf = new Map(order.map((d, i) => [d, i]))

  const nodes = order.map((d) => {
    const rec = distinct.get(d)
    const node = rec.node
    const out = { type: node.type }
    if (node.name !== undefined) out.name = node.name
    if (node.value !== undefined) out.value = node.value
    if (node.args !== undefined) out.args = rec.childDigests.map((cd) => indexOf.get(cd))
    return out
  })

  const outputRoots = {}
  for (const k of keys) outputRoots[k] = indexOf.get(rootDigests[k])

  // ── parameters: one locator per DISTINCT node that carries the tag ────────
  // ⭐ THE COLLAPSE THAT V1 COULD NOT EXPRESS. A parameter whose literal lives
  // inside a subtree shared nineteen times had nineteen `astPath` locators in
  // V1, every one of which the server had to walk and reconcile, and which
  // could disagree with each other (`conflicted`). Here it has ONE, and
  // "conflicted" is structurally impossible for a shared node — there is only
  // one literal to read.
  const parameters = {}
  const declared = Array.isArray(opts.params) ? opts.params : []
  const byParam = new Map()
  order.forEach((d, i) => {
    const pid = distinct.get(d).paramId
    if (pid === null) return
    if (!byParam.has(pid)) byParam.set(pid, [])
    byParam.get(pid).push({ node: i, path: ['value'] })
  })
  for (const p of declared) {
    const locators = byParam.get(p.id)
    // ⛔ AN ENTRY WITH NOWHERE TO POINT IS NEVER ADVERTISED — the same rule
    // `pineParamManifest.js` states in its own header. A parameter whose every
    // occurrence folded away, or lived only in an output the caller dropped, is
    // omitted, not shown stuck at `detached` forever.
    if (!locators || !locators.length) continue
    parameters[p.id] = {
      sourceName: p.sourceName,
      title: p.title,
      type: p.type,
      default: p.default,
      min: p.min,
      max: p.max,
      step: p.step,
      options: p.options,
      locators,
    }
  }

  return { graphVersion: GRAPH_VERSION, nodes, outputRoots, parameters }
}

/**
 * Shape, acyclicity and expansion bounds — everything decidable WITHOUT
 * materialising anything.
 *
 * @returns {string[]} the output keys, sorted.
 */
export function assertGraph(graph) {
  if (!isPlainObject(graph)) {
    throw new Error(`compute.graph: expected an object, got ${graph === null ? 'null' : typeof graph}`)
  }
  if (graph.graphVersion !== GRAPH_VERSION) {
    throw new Error(`compute.graph.graphVersion: expected ${GRAPH_VERSION}, got ${JSON.stringify(graph.graphVersion)}`)
  }
  const nodes = graph.nodes
  if (!Array.isArray(nodes) || !nodes.length) {
    throw new Error('compute.graph.nodes: expected a non-empty array of canonical nodes')
  }
  if (nodes.length > MAX_GRAPH_NODES) {
    throw new Error(`compute.graph.nodes: ${nodes.length} nodes is over the ${MAX_GRAPH_NODES} limit`)
  }
  nodes.forEach((node, i) => {
    if (!isPlainObject(node)) throw new Error(`compute.graph.nodes[${i}]: not an object`)
    const expected = CANONICAL_KEYS[node.type]
    if (!expected) {
      throw new Error(`compute.graph.nodes[${i}]: node type ${JSON.stringify(node.type)} is not canonical`)
    }
    const own = Object.keys(node).sort()
    const want = [...expected].sort()
    if (own.length !== want.length || own.some((k, j) => k !== want[j])) {
      throw new Error(`compute.graph.nodes[${i}]: a ${node.type} node must carry exactly [${want}] — got [${own}]`)
    }
    if (node.args !== undefined) {
      if (!Array.isArray(node.args)) throw new Error(`compute.graph.nodes[${i}].args: must be an array`)
      node.args.forEach((ref, a) => {
        if (!Number.isInteger(ref)) {
          throw new Error(`compute.graph.nodes[${i}].args[${a}]: must be an integer node reference, got ${JSON.stringify(ref)}`)
        }
        // ⛔ THE WHOLE ACYCLICITY PROOF. Canonical numbering is topological, so
        // a reference forward or to itself is not a legal graph at all — and a
        // cycle needs at least one such edge.
        if (ref < 0 || ref >= i) {
          throw new Error(
            `compute.graph.nodes[${i}].args[${a}]: ${ref} is not a node declared BEFORE it — a graph's `
            + 'references run strictly backwards, which is what makes a cycle unrepresentable')
        }
      })
    }
  })

  const roots = graph.outputRoots
  if (!isPlainObject(roots)) {
    throw new Error(`compute.graph.outputRoots: expected an object of plotKey to node index, got ${typeof roots}`)
  }
  const keys = Object.keys(roots).sort()
  if (!keys.length) throw new Error('compute.graph.outputRoots: names no plot')
  for (const k of keys) {
    if (!KEY_RE.test(k)) {
      throw new Error(`compute.graph.outputRoots: ${JSON.stringify(k)} is not a legal plot key (${KEY_RE})`)
    }
    const ref = roots[k]
    if (!Number.isInteger(ref) || ref < 0 || ref >= nodes.length) {
      throw new Error(`compute.graph.outputRoots.${k}: ${JSON.stringify(ref)} is not an index into nodes[]`)
    }
  }

  assertGraphParameters(graph, nodes.length)
  expandedSizes(graph, keys)
  return keys
}

/** Every parameter locator names a node that exists and a path that reaches a
 *  literal-bearing field. Shape only — the VALUE and its bounds are the
 *  server's business (`param_manifest.py`), which is where they stay. */
function assertGraphParameters(graph, nodeCount) {
  const params = graph.parameters
  if (params === undefined) return
  if (!isPlainObject(params)) {
    throw new Error(`compute.graph.parameters: expected an object, got ${typeof params}`)
  }
  for (const [pid, entry] of Object.entries(params)) {
    if (!isPlainObject(entry)) {
      throw new Error(`compute.graph.parameters.${pid}: expected an object`)
    }
    const locators = entry.locators
    // ⚠️ AN EMPTY LIST IS LEGAL, AND IT MEANS SOMETHING. Both lanes' `reconcile`
    // answer `detached` — "this parameter declares no binding locations" — for a
    // roster entry with no locators, and that is exactly the state a control
    // whose bindings were lost must be left in. Refusing it here would force a
    // migration to either DROP such a control (silently removing something the
    // member's indicator has) or fake a locator for it.
    if (!Array.isArray(locators)) {
      throw new Error(`compute.graph.parameters.${pid}.locators: expected an array`)
    }
    locators.forEach((loc, i) => {
      if (!isPlainObject(loc) || !Number.isInteger(loc.node)
          || loc.node < 0 || loc.node >= nodeCount) {
        throw new Error(`compute.graph.parameters.${pid}.locators[${i}].node: not an index into nodes[]`)
      }
      if (!Array.isArray(loc.path) || !loc.path.length) {
        throw new Error(`compute.graph.parameters.${pid}.locators[${i}].path: expected a non-empty path`)
      }
    })
  }
}

/**
 * The inlined node count of every graph node, bottom-up, in integers.
 *
 * ⛔⛔ THIS IS THE BOMB GUARD AND IT MUST RUN BEFORE ANY EXPANSION. Sharing is
 * what makes a graph small; it is also what lets forty nodes describe a
 * trillion. Because references run strictly backwards, one forward pass with no
 * recursion computes every size, and the numbers stay numbers — nothing is
 * built, so the refusal is free.
 */
export function expandedSizes(graph, keys) {
  const nodes = graph.nodes
  const size = new Array(nodes.length)
  for (let i = 0; i < nodes.length; i += 1) {
    let s = 1
    const args = nodes[i].args
    if (Array.isArray(args)) for (const ref of args) s += size[ref]
    if (!Number.isFinite(s) || s > MAX_EXPANDED_TOTAL) {
      throw new Error(
        `compute.graph.nodes[${i}]: expands to ${s} inlined nodes, over the ${MAX_EXPANDED_TOTAL} `
        + 'ceiling — a shared graph can describe a tree far larger than it is')
    }
    size[i] = s
  }
  const outKeys = keys || Object.keys(graph.outputRoots).sort()
  let total = 0
  for (const k of outKeys) {
    const s = size[graph.outputRoots[k]]
    if (s > MAX_EXPANDED_NODES) {
      throw new Error(
        `compute.graph.outputRoots.${k}: expands to ${s} nodes, over the ${MAX_EXPANDED_NODES} `
        + 'per-plot ceiling')
    }
    total += s
    if (total > MAX_EXPANDED_TOTAL) {
      throw new Error(`compute.graph: expands to over ${MAX_EXPANDED_TOTAL} nodes in total`)
    }
  }
  return size
}

/**
 * The graph to `{plotKey: canonicalTree}`, the shape every existing consumer
 * reads. Pure structural dereference; NEVER a parser.
 *
 * ⭐ THE EXPANDED FOREST SHARES NODE OBJECTS — that is the point, and it is
 * what C2C.11 memoises on. Every consumer of a canonical tree in this codebase
 * walks it read-only (`astHash`, `printFormula`, `interpret`, the linter) and
 * `paramEdit.js` is copy-on-write, so sharing is invisible to all of them.
 * `expandGraph(graph, {copy: true})` hands back independent trees for a caller
 * that wants to be sure.
 */
export function expandGraph(graph, opts = {}) {
  const keys = assertGraph(graph)
  const built = new Array(graph.nodes.length)
  const params = isPlainObject(graph.parameters) ? graph.parameters : {}
  const paramByNode = new Map()
  for (const [pid, entry] of Object.entries(params)) {
    const locators = entry && Array.isArray(entry.locators) ? entry.locators : []
    for (const loc of locators) {
      if (Number.isInteger(loc.node)) paramByNode.set(loc.node, pid)
    }
  }
  for (let i = 0; i < graph.nodes.length; i += 1) {
    const n = graph.nodes[i]
    const out = { type: n.type }
    if (n.name !== undefined) out.name = n.name
    if (n.value !== undefined) out.value = n.value
    if (n.args !== undefined) out.args = n.args.map((ref) => built[ref])
    // ⭐ THE TAG IS RESTORED, non-enumerably, exactly as `pine.js` set it — so
    // an expanded V2 tree is indistinguishable from a freshly translated one,
    // and `pineParamManifest.collectParamLocators` can still derive V1 astPath
    // locators from it. That is what makes the V2 to V1 direction of C2C.6
    // derivable rather than hand-written.
    const pid = paramByNode.get(i)
    if (pid !== undefined) {
      Object.defineProperty(out, '__uctParamId', { value: pid, enumerable: false, configurable: true })
    }
    built[i] = out
  }
  const trees = {}
  for (const k of keys) trees[k] = built[graph.outputRoots[k]]
  if (opts.copy) {
    const deep = (n) => {
      const c = { type: n.type }
      if (n.name !== undefined) c.name = n.name
      if (n.value !== undefined) c.value = n.value
      if (n.args !== undefined) c.args = n.args.map(deep)
      if (n.__uctParamId !== undefined) {
        Object.defineProperty(c, '__uctParamId', { value: n.__uctParamId, enumerable: false, configurable: true })
      }
      return c
    }
    for (const k of keys) trees[k] = deep(trees[k])
  }
  return trees
}

/** The definition's identity, taken over the PROGRAM and never over the table.
 *  Byte-identical to `treesHash` on the same trees stored inline — which is the
 *  whole point: adopting V2 must not migrate one member's alerts. */
export function graphTreesHash(graph) {
  return treesHash(expandGraph(graph))
}

/**
 * ⭐⭐ ONE NODE OF THE TABLE, AS A CANONICAL TREE.
 *
 * `expandGraph` materialises the OUTPUT ROOTS, which is what a plot needs.
 * C3B needs something narrower and more often: the tree for an ARBITRARY node,
 * because an object program references interior nodes directly — a line's
 * y-coordinate is whatever node its expression landed on, and that node may be
 * shared with three plots and never be a root of anything.
 *
 * ⛔ IT IS BOUNDED BY THE SAME RULE AS `expandGraph`. A node whose inlined size
 * exceeds the expansion budget throws rather than materialising, so this cannot
 * become a second, unguarded door into the expansion bomb the budget exists to
 * stop.
 *
 * ⚠️ The result is a FRESH tree every call — callers mutate trees (tagging,
 * substitution), and handing out shared subtrees would let one caller's edit
 * appear in another's node.
 */
export function nodeTree(graph, index, opts = {}) {
  const nodes = graph && graph.nodes
  if (!Array.isArray(nodes)) throw new Error('nodeTree: graph has no node table')
  if (!Number.isInteger(index) || index < 0 || index >= nodes.length) {
    throw new Error(`nodeTree: ${JSON.stringify(index)} is not a node in a ${nodes.length}-node graph`)
  }
  const maxNodes = Number.isInteger(opts.maxNodes) ? opts.maxNodes : MAX_EXPANDED_NODES
  let made = 0
  const build = (i) => {
    made += 1
    if (made > maxNodes) {
      throw new Error(`nodeTree: node ${index} inlines to more than ${maxNodes} nodes`)
    }
    const n = nodes[i]
    const out = { type: n.type }
    if (n.name !== undefined) out.name = n.name
    if (n.value !== undefined) out.value = n.value
    if (n.args !== undefined) out.args = n.args.map(build)
    return out
  }
  return build(index)
}
