// app/src/components/chart/builder/objectProgramCarry.js
//
// ─── ⭐⭐ P2X (owner decision 3) — A MANUAL REOPEN-EDIT NEVER SILENTLY DESTROYS
//     AN OBJECT PROGRAM ─────────────────────────────────────────────────────────
//
// A stored definition may carry `definition.objects`: the graphical-object
// program an imported Pine script compiled to (labels, lines, boxes, tables,
// linefills — `engine/ast/objectProgram.js`). The Builder's row model has no
// slot for it, and before this module a reopen → save in the manual editor wrote
// the document from the rows alone, so every drawing was dropped with no word.
//
// The rule, in three outcomes:
//
//   kept     the edit is representable and every reference the program makes
//            still resolves in the new document → the program rides on it
//            BYTE-IDENTICALLY (the stored object, never a re-serialisation).
//   lossy    the program cannot ride on the new document (it is bound to a
//            computation graph this editor does not write, it reads an input or a
//            parameter the edit removes, or the document validator refuses it)
//            → NOTHING is sent until the member explicitly confirms a save that
//            removes it; the confirmation names what goes.
//   replaced the member pasted a different script whose own program now rides
//            on the document — their explicit act, not a loss.
//
// ⛔ PURE. No React, no network: `BuilderSheet` asks `objectCarry(prior, doc)`
// before the save request and acts on the answer.

import { graphNodesReferenced, paramsReferenced } from '../engine/ast/objectProgram'
import { validateDefinition } from '../engine/defSchema'
import { seriesNamesOf } from './builderInputs'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The stored object program of a definition, or null. `compute.objects: true`
 *  (a runtime document that draws its own objects) is not a program and is
 *  never touched here. */
export function storedObjectProgram(def) {
  const p = def && def.objects
  return isObj(p) && Array.isArray(p.ops) && p.ops.length ? p : null
}

/** A program the manual editor can carry on a document it writes: the Builder
 *  writes no `compute.graph`, so a program bound to graph node indexes cannot
 *  ride (its indexes would point at a table that is not there). */
export function carriableObjectProgram(def) {
  const p = storedObjectProgram(def)
  if (!p) return null
  let nodes = []
  try { nodes = graphNodesReferenced(p) } catch { return null }
  return nodes.length ? null : p
}

const FAMILY_WORDS = Object.freeze({
  line: ['line', 'lines'], label: ['label', 'labels'], box: ['box', 'boxes'],
  table: ['table', 'tables'], linefill: ['line fill', 'line fills'],
})

function* walk(ops) {
  for (const op of (Array.isArray(ops) ? ops : [])) {
    yield op
    if (isObj(op) && Array.isArray(op.body)) yield* walk(op.body)
  }
}

/** What the program draws, counted by its CREATE instructions per family. A
 *  site may make many objects over the bars; the count names the instructions,
 *  which is what the member's script wrote. */
export function objectProgramCensus(program) {
  const families = {}
  let total = 0
  for (const op of walk(program && program.ops)) {
    if (isObj(op) && op.k === 'create' && typeof op.family === 'string') {
      families[op.family] = (families[op.family] || 0) + 1
      total += 1
    }
  }
  return { families, total }
}

function listWords(words) {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** The sentence the confirmation shows — what will be removed, by name. */
export function objectLossSentence(census) {
  const fams = Object.entries((census && census.families) || {})
  const parts = fams.map(([fam, n]) => {
    const w = FAMILY_WORDS[fam] || [fam, `${fam}s`]
    return `${n} ${n === 1 ? w[0] : w[1]}`
  })
  const what = parts.length ? listWords(parts) : 'drawings'
  return `This indicator also draws ${what} from its imported script; saving this edit will remove them.`
}

function inputKeys(def) {
  return new Set((def && Array.isArray(def.inputs) ? def.inputs : [])
    .filter((s) => s && typeof s.key === 'string').map((s) => s.key))
}

/**
 * Why `program` cannot ride on `doc` (empty when it can).
 *
 * @param {object} program the stored program
 * @param {object} doc     the document the editor is about to save
 * @param {object} prior   the stored document the program came from
 */
export function objectProgramProblems(program, doc, prior) {
  const reasons = []
  let nodes = []
  try { nodes = graphNodesReferenced(program) } catch { /* the validator names it below */ }
  const hasGraph = !!(doc && doc.compute && isObj(doc.compute.graph))
  if (nodes.length && !hasGraph) {
    reasons.push('its drawings are bound to a computation graph this editor does not write')
  }
  // an INPUT the program's own trees read, which the stored document declared
  // and the new one no longer does
  const priorKeys = inputKeys(prior)
  const nextKeys = inputKeys(doc)
  const read = new Set()
  for (const t of (Array.isArray(program.trees) ? program.trees : [])) seriesNamesOf(t, read)
  const lostInputs = [...read].filter((n) => priorKeys.has(n) && !nextKeys.has(n)).sort()
  for (const n of lostInputs) reasons.push(`its drawings read the input "${n}", which this edit removes`)
  // a PARAMETER the program reads, which the new document's manifest drops
  let params = []
  try { params = paramsReferenced(program) } catch { params = [] }
  const manifest = (doc && doc.compute && isObj(doc.compute.paramManifest)) ? doc.compute.paramManifest : {}
  const lostParams = params.filter((id) => !Object.prototype.hasOwnProperty.call(manifest, id))
  for (const id of lostParams) reasons.push(`its drawings read the parameter "${id}", which this edit removes`)
  // and the document validator's own word on the program in this document
  if (!reasons.length) {
    const candidate = doc && doc.objects === program ? doc : { ...doc, objects: program }
    const v = validateDefinition(candidate)
    if (!v.ok) {
      for (const e of v.errors) if (/^objects/.test(e)) reasons.push(e)
    }
  }
  return reasons
}

/**
 * The verdict on the stored program for the document about to be saved.
 *
 * @returns {{status:'none'|'kept'|'replaced'|'lossy', program, census, reasons, sentence}}
 */
export function objectCarry(prior, doc) {
  const program = storedObjectProgram(prior)
  if (!program) return { status: 'none', program: null, census: null, reasons: [], sentence: null }
  const census = objectProgramCensus(program)
  const next = doc ? doc.objects : undefined
  const same = next === program
    || (isObj(next) && JSON.stringify(next) === JSON.stringify(program))
  if (isObj(next) && !same) {
    // the member pasted a different script; its program is theirs to save
    return { status: 'replaced', program, census, reasons: [], sentence: null }
  }
  const reasons = objectProgramProblems(program, doc, prior)
  if (same && !reasons.length) return { status: 'kept', program, census, reasons: [], sentence: null }
  return {
    status: 'lossy',
    program,
    census,
    reasons: reasons.length ? reasons : ['this editor could not carry it'],
    sentence: objectLossSentence(census),
  }
}

/** The stored document's `meta` the Builder does not write (a Pine import's
 *  `recurrenceOrigin`, `naConditionFalse`, `runtimeErrors`, `lowerTf`,
 *  `otherSymbols`, `periodReads`, …), carried onto `doc` when the stored
 *  program rides on it — the object lane evaluates under those stamps
 *  (`objectColumns.objectReaderFor`), so carrying the program without them would
 *  draw it differently. `semantics` stays the store's decision. Returns `doc`
 *  by identity when there is nothing to carry. */
export function carryProgramMeta(doc, prior) {
  const pm = prior && isObj(prior.meta) ? prior.meta : null
  if (!pm || !doc) return doc
  const meta = isObj(doc.meta) ? doc.meta : {}
  const extra = Object.keys(pm).filter((k) => k !== 'semantics' && !(k in meta))
  if (!extra.length) return doc
  return { ...doc, meta: { ...meta, ...Object.fromEntries(extra.map((k) => [k, pm[k]])) } }
}
