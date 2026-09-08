// app/src/components/chart/engine/ast/graphDocument.js
//
// ─── THE DOCUMENT-LEVEL HALF OF C2C: WHEN TO STORE A GRAPH, AND HOW ─────────
//
// `graph.js` knows how to turn a forest into a DAG. This module knows the two
// product questions around it: WHICH documents should be stored that way, and
// how a document that already exists gets there without losing a parameter.
//
// ⭐⭐ THE RULE, AND WHY IT IS THIS ONE: a document is reduced to a graph when
// the inlined form WOULD NOT FIT. Not "every multi-tree document" — that would
// change the stored shape of every existing definition in one commit for no
// member-visible gain — and not "whenever the graph is smaller", which is the
// same thing wearing a measurement. Since `def_hash` and `treesHash` are
// PROVABLY identical either way (`graph.test.js`, `test_compute_graph.py`),
// nothing downstream can tell which form a given document took, so the
// threshold can only ever decide whether a save is REFUSED — never whether it
// is wrong. That is the property that makes a conditional representation safe
// here and would not hold if the two forms had different identities.
//
// ⛔ THE BUDGET BELOW IS A DECISION THRESHOLD, NEVER AN ENFORCEMENT.
// `user_definitions.MAX_DEFINITION_BYTES` is the one authority on what fits;
// this number exists so the client can decide to send the smaller form BEFORE
// being refused. If the two ever drift, the failure is a refused save with the
// server's own sentence — not a stored document that is wrong.
import { buildGraph, expandGraph, GRAPH_VERSION } from './graph'
import { bindObjectProgram, graphNodesReferenced } from './objectProgram'
import { astHash } from './parse'
import { printFormula } from './pine'
import { treesHash } from './trees'

/** Mirrors `api/services/user_definitions.MAX_DEFINITION_BYTES`. See above for
 *  why a mirror is acceptable here and would not be for a rule. */
export const DOCUMENT_BYTE_BUDGET = 64 * 1024

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The bytes the store counts: canonical JSON, UTF-8. */
export function documentBytes(definition) {
  return new TextEncoder().encode(JSON.stringify(definition)).length
}

/**
 * Re-attach the parameter provenance a stored V1 document lost.
 *
 * ⛔⛔ THIS IS THE STEP THAT MAKES MIGRATION SAFE, AND SKIPPING IT IS THE
 * OWNER'S NAMED DEFECT. `__uctParamId` is non-enumerable, so it does not
 * survive `JSON.stringify` — a document read back from the store has trees with
 * no provenance at all. Building a graph from those trees would share
 * `sma(close, 14)` belonging to one input with `sma(close, 14)` belonging to a
 * DIFFERENT input, because the expanded ASTs happen to contain equal literals,
 * and one member's slider would then move the other plot. Tagging first is what
 * makes the two nodes distinguishable again.
 *
 * ⛔⛔ ALL-OR-NOTHING PER PARAMETER, AND THAT IS FIDELITY RATHER THAN CAUTION.
 * A parameter whose locators do not ALL resolve is a parameter the V1 document
 * already reports as `partially_detached` — and the reason `reconcile` gives is
 * that it "has been disabled rather than shown partially working". Tagging only
 * the locators that DO resolve would silently promote such a control back to
 * `attached`, handing the member a slider that edits some of its occurrences
 * and not others. So an incompletely-placeable parameter is placed NOWHERE, and
 * `toGraphDocument` carries it into the graph with an empty locator list, which
 * both lanes already reconcile as `detached` with a reason.
 *
 * ⚰️ AND THE CASE IS REAL, NOT THEORETICAL. Measured on the live corpus while
 * this wave was running: `…03-supertrend`'s "Periods" parameter and
 * `…22-rsi-levels`' second parameter carry `astPath`s that do not resolve
 * against the tree the document actually saves — they walk into an argument
 * slot the saved node does not have. That is a PRE-EXISTING Track F defect
 * (`PineBox` builds the manifest from its own `paramManifest: true`
 * translation, while the document saves the `memberInputTranslation` one), not
 * something this wave introduced, and it means those controls are already
 * non-functional today. C2C reports it and preserves the behaviour exactly;
 * fixing it belongs to Track F.
 *
 * @returns {Set<string>} the parameter ids whose every locator resolved AND
 *   which are now tagged. Ids outside it were deliberately left untagged.
 */
function tagFromManifest(trees, manifest, scanPlot) {
  const placed = new Set()
  for (const [pid, entry] of Object.entries(manifest)) {
    const locators = Array.isArray(entry.locators) ? entry.locators : []
    if (!locators.length) continue
    const found = []
    let ok = true
    for (const loc of locators) {
      const key = loc.treeIndex === null || loc.treeIndex === undefined ? scanPlot : loc.treeIndex
      let node = trees[key]
      const steps = Array.isArray(loc.astPath) ? loc.astPath : []
      for (const step of steps) {
        if (node === undefined || node === null) { node = undefined; break }
        if (typeof step === 'number') {
          if (!Array.isArray(node)) { node = undefined; break }
          node = node[step]
        } else {
          if (!isPlainObject(node)) { node = undefined; break }
          node = node[step]
        }
      }
      if (!isPlainObject(node) || node.type !== 'num') { ok = false; break }
      found.push(node)
    }
    // ⛔ THE TAGS GO ON ONLY AFTER EVERY LOCATOR HAS RESOLVED — a half-tagged
    // parameter is the "partially working" state above, built by accident.
    if (!ok) continue
    for (const node of found) {
      Object.defineProperty(node, '__uctParamId',
        { value: pid, enumerable: false, configurable: true })
    }
    placed.add(pid)
  }
  return placed
}

/**
 * A multi-tree definition, stored as a shared graph.
 *
 * @returns {{ok: true, definition: object} | {ok: false, reason: string}}
 *
 * ⛔⛔ IT SAYS WHY, AND THAT IS NOT DECORATION. The first version returned a
 * bare `null`, and the live journey then reported the ORIGINAL refusal — "this
 * definition exceeds 65,536 bytes" — for a document the conversion had quietly
 * declined to convert. A refusal that reads exactly like the one it was built
 * to replace is indistinguishable from the feature not existing
 * (`lesson_an_over_refusal_is_invisible`), and it cost a whole harness run to
 * notice.
 *
 * ⛔ A PARAMETER THAT CANNOT BE PLACED REFUSES THE WHOLE CONVERSION. Dropping
 * one would silently take a member's control off their indicator, and the
 * server's `_canonicalize_manifest` would accept that quietly (an id present
 * only in the PREVIOUS manifest is not carried forward — which is right for a
 * formula the member rewrote, and wrong for one this function mislaid).
 */
export function toGraphDocument(definition) {
  const compute = definition && definition.compute
  if (!isPlainObject(compute) || compute.kind !== 'ast') {
    return { ok: false, reason: 'not an ast definition' }
  }
  const trees = compute.trees
  if (!isPlainObject(trees) || Object.keys(trees).length < 2) {
    return { ok: false, reason: 'not a multi-tree document — one tree is compute.ast' }
  }
  const scan = compute.scanPlot
  if (typeof scan !== 'string' || !(scan in trees)) {
    return { ok: false, reason: 'compute.scanPlot ' + JSON.stringify(scan) + ' names no tree' }
  }

  // ⛔ WORK ON A COPY. Tagging writes onto the node objects, and the caller's
  // document must come back untouched when this refuses.
  let copy
  try {
    copy = JSON.parse(JSON.stringify(trees))
  } catch {
    return { ok: false, reason: 'compute.trees is not JSON' }
  }

  const manifest = isPlainObject(compute.paramManifest) ? compute.paramManifest : {}
  const placed = tagFromManifest(copy, manifest, scan)

  // ⭐⭐ C3B — THE OBJECT PROGRAM'S EXPRESSIONS BECOME EXTRA ROOTS OF THE SAME
  // GRAPH. This is the whole reason the object program stores `{v:'tree', i}`
  // rather than an AST: handing those trees to `buildGraph` alongside the plots
  // means a coordinate that is `close`, or `ta.sma(close, 20)`, or a condition
  // a plot already computes, is stored ONCE and referenced by integer from both
  // places. Inlining them into the ops would have worked and would have undone a
  // ×48 compaction that cost a whole wave to earn.
  // ⚠️ The extra roots are named `uctobj<i>` so they cannot collide with a plot
  // key, and they are removed from `outputRoots` afterwards — an object
  // expression is not a column and must never be offered as one.
  const objectProgram = isPlainObject(definition.objects) ? definition.objects : null
  const objTrees = objectProgram && Array.isArray(objectProgram.trees) ? objectProgram.trees : []
  const objRootKey = (i) => `uctobj${i}`
  objTrees.forEach((tree, i) => {
    if (objRootKey(i) in copy) return
    copy[objRootKey(i)] = JSON.parse(JSON.stringify(tree))
  })

  const params = Object.entries(manifest).map(([id, e]) => ({
    id,
    sourceName: e.sourceName,
    title: e.title,
    type: e.type,
    default: e.default,
    min: e.min,
    max: e.max,
    step: e.step,
    options: e.options,
  }))

  let graph
  try {
    graph = buildGraph(copy, { params })
  } catch (err) {
    return { ok: false, reason: 'buildGraph — ' + (err && err.message ? err.message : String(err)) }
  }

  // ⛔ EVERY DECLARED PARAMETER MUST HAVE ARRIVED. `buildGraph` omits a
  // parameter with nowhere to point, which is right when it is building from a
  // fresh translation and wrong here: this document already HAS these controls.
  // ⛔ EVERY DECLARED PARAMETER SURVIVES THE MIGRATION, PLACED OR NOT. Dropping
  // one would silently take a member's control off their indicator, and the
  // server would accept that quietly (`_canonicalize_manifest` does not carry
  // forward an id that was not resubmitted — which is right for a formula the
  // member rewrote, and wrong for one this function mislaid). An id that could
  // not be placed keeps its metadata and carries NO locators, which both lanes
  // reconcile as `detached` with a reason — the same disabled-with-an-
  // explanation the V1 document was already showing.
  //
  // ⛔ AND A PLACED PARAMETER MUST REALLY HAVE BEEN PLACED. `buildGraph` omits
  // one whose tag did not survive its own fold, so a mismatch here is a bug in
  // this function rather than a property of the document, and it refuses.
  for (const pid of placed) {
    if (!graph.parameters[pid]) {
      return { ok: false, reason: 'internal: ' + pid + ' was tagged but not placed' }
    }
  }
  for (const p of params) {
    if (graph.parameters[p.id]) continue
    graph.parameters[p.id] = {
      sourceName: p.sourceName,
      title: p.title,
      type: p.type,
      default: p.default,
      min: p.min,
      max: p.max,
      step: p.step,
      options: p.options,
      locators: [],
    }
  }

  // ⭐ BIND, THEN STRIP. The object roots have done their job the moment
  // `buildGraph` has told us which node each landed on.
  let boundObjects = null
  if (objectProgram) {
    const nodeOf = (i) => {
      const at = graph.outputRoots[objRootKey(i)]
      if (!Number.isInteger(at)) throw new Error(`object tree ${i} found no root`)
      return at
    }
    try {
      boundObjects = bindObjectProgram(objectProgram, nodeOf)
    } catch (err) {
      return { ok: false, reason: 'objects — ' + (err && err.message ? err.message : String(err)) }
    }
    for (let i = 0; i < objTrees.length; i += 1) delete graph.outputRoots[objRootKey(i)]
    // ⛔ AND EVERY BOUND REFERENCE MUST LAND INSIDE THE GRAPH. A node index past
    // the end is a dangling pointer that renders as NaN — an object at
    // coordinate zero with nothing anywhere saying why.
    const over = graphNodesReferenced(boundObjects).filter((n) => n >= graph.nodes.length)
    if (over.length) {
      return { ok: false, reason: 'objects: node reference(s) past the end of the graph: ' + over.join(', ') }
    }
  }

  const next = { ...definition, compute: { ...compute, graph } }
  if (boundObjects) next.objects = boundObjects
  delete next.compute.trees
  delete next.compute.ast
  delete next.compute.source
  delete next.compute.sources
  delete next.compute.paramManifest
  // ⭐ THE IDENTITY FIELDS ARE CARRIED, NOT RECOMPUTED FROM A NEW RULE — they
  // are the SAME values the inlined document had, which is the whole C2C.7
  // contract. Recomputing them from `trees` here (rather than trusting the
  // document's own) keeps this function honest if it is ever handed a document
  // whose stored hashes had already drifted.
  next.compute.treesHash = treesHash(trees)
  next.compute.fn = astHash(trees[scan])
  if (graph.graphVersion !== GRAPH_VERSION) {
    return { ok: false, reason: 'unexpected graphVersion ' + graph.graphVersion }
  }
  return { ok: true, definition: next }
}

/**
 * The save-door rule: send the graph form only when the inlined one would not
 * fit. Returns `definition` unchanged in every other case, including when the
 * conversion is not possible.
 */
export function reduceIfOversized(definition, budget = DOCUMENT_BYTE_BUDGET) {
  if (!isPlainObject(definition)) return definition
  if (documentBytes(definition) <= budget) return asV1(definition)
  const attempt = toGraphDocument(definition)
  if (!attempt.ok) {
    // ⚠️ THE REASON IS SURFACED, NOT SWALLOWED. The member still gets the
    // store's own size refusal — which is the honest answer, because the
    // document really is too big — but a developer looking at a document that
    // "should have fitted" has to be able to find out why it did not.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[uct] a document over the size budget could not be stored as a shared graph: '
        + attempt.reason)
    }
    return asV1(definition)
  }
  const reduced = attempt.definition
  // ⛔ AND ONLY IF IT ACTUALLY HELPED. A graph that is not smaller is not worth
  // a different stored shape; sending the original keeps the refusal the member
  // sees identical to the one they would have got before this wave existed.
  return documentBytes(reduced) < documentBytes(definition)
    ? reduced
    : asV1(definition)
}

/**
 * A document sent in its INLINED form carries no leftover graph.
 *
 * ⛔⛔ THE EDGE THIS CLOSES IS A REFUSAL, NOT A WRONG NUMBER, AND IT IS REACHABLE
 * BY ORDINARY EDITING. `hydrateGraphDocument` hands the builder a document that
 * has BOTH `compute.graph` (as read) and `compute.paramManifest` (re-derived for
 * the V1 surfaces). If the member then deletes plots until it fits, this
 * function would send it unchanged — and the server would refuse it, correctly,
 * for declaring its parameters TWICE (`compute.graph.parameters` and
 * `compute.paramManifest` are two rosters over one tree, and which one a reader
 * consulted would decide the bounds actually enforced).
 *
 * One representation reaches the wire, always: reduced means the graph, and
 * unreduced means the forest.
 */
function asV1(definition) {
  const compute = definition && definition.compute
  if (!isPlainObject(compute) || !isPlainObject(compute.graph)) return definition
  if (!isPlainObject(compute.trees)) return definition
  const next = { ...definition, compute: { ...compute } }
  delete next.compute.graph
  return next
}

/**
 * The other direction: a stored shared-graph document, read back as the
 * ORDINARY V1 document every builder surface already knows.
 *
 * ⭐⭐ THE SOURCE TEXT IS RE-DERIVED HERE, WHICH IS THE ONLY PLACE IT CAN BE.
 * A graph document deliberately stores no `compute.source`/`sources` (that text
 * is ~11% of the bytes, it is derived, and the server lane has never been able
 * to hold it to the tree anyway — there is one parser and it is in JS). So the
 * lane that CAN print prints it, on read, from the tree that actually runs.
 * That is strictly better than storing it: the read-back can no longer disagree
 * with the maths, because it is computed from it.
 *
 * ⛔ AND THE PARAMETER ROSTER MOVES BACK TO ITS V1 ADDRESS. Every builder
 * surface (`ParamControls`, `paramEdit.reconcileParams`) reads
 * `compute.paramManifest`; a graph document keeps the same roster at
 * `compute.graph.parameters` with node-index locators. Translating them back to
 * `{treeIndex, astPath}` here means those surfaces need no second code path —
 * and `reduceIfOversized` translates them forward again on the way out, from
 * the tags this function restores.
 *
 * @returns {object} the definition, unchanged when it declares no graph.
 */
export function hydrateGraphDocument(definition) {
  const compute = definition && definition.compute
  if (!isPlainObject(compute) || !isPlainObject(compute.graph)) return definition
  let trees
  try { trees = expandGraph(compute.graph) } catch { return definition }
  const scan = compute.scanPlot
  if (typeof scan !== 'string' || !(scan in trees)) return definition

  const sources = {}
  for (const [k, tree] of Object.entries(trees)) {
    try { sources[k] = printFormula(tree) } catch { return definition }
  }

  const paramManifest = {}
  const graphParams = isPlainObject(compute.graph.parameters) ? compute.graph.parameters : {}
  for (const [pid, entry] of Object.entries(graphParams)) {
    const locators = []
    for (const [key, tree] of Object.entries(trees)) {
      collectTagPaths(tree, pid, [], (path) => {
        locators.push({ treeIndex: key === scan ? null : key, astPath: path })
      })
    }
    // ⛔ AN ENTRY WITH NOWHERE TO POINT IS KEPT, WITH NO LOCATORS — not dropped.
    // `buildGraph` drops one when it is building from a fresh translation,
    // because a control that never existed should not be offered. This is the
    // other direction: the control DOES exist on the member's saved indicator,
    // and both lanes' `reconcile` already have a sentence for a parameter that
    // "declares no binding locations". Dropping it here would take a disabled-
    // with-a-reason control and make it vanish.
    paramManifest[pid] = { ...entry, locators }
  }

  const next = {
    ...definition,
    compute: {
      ...compute,
      trees,
      ast: trees[scan],
      sources,
      source: sources[scan],
    },
  }
  if (Object.keys(paramManifest).length) next.compute.paramManifest = paramManifest
  return next
}

/** Every astPath at which `pid`'s tag survived in one expanded tree.
 *
 *  ⚠️ `expandGraph` RESTORES THE TAG NON-ENUMERABLY, so this reads it by name
 *  exactly as `pineParamManifest.collectParamLocators` does; `Object.keys`
 *  never sees it, so it cannot be recursed into or serialised. */
function collectTagPaths(node, pid, path, emit) {
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectTagPaths(child, pid, [...path, i], emit))
    return
  }
  if (!isPlainObject(node)) return
  if (node.__uctParamId === pid) emit([...path])
  for (const key of Object.keys(node)) collectTagPaths(node[key], pid, [...path, key], emit)
}
