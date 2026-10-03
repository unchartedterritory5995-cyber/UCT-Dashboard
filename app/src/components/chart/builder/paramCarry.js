// app/src/components/chart/builder/paramCarry.js
//
// ─── C46 — PASTING PINE INTO A SAVED DEFINITION KEEPS ITS PARAMETER IDS ──────
//
// A saved definition addresses its adjustable inputs by id, and the server
// (`api/services/param_manifest.py`) holds that roster as the authority: on an
// edit an id it already has keeps its PRIOR record, and an id it does not have
// is refused (owner condition 15). So when a member pastes Pine into a
// definition they are EDITING, the pasted script's parameters must arrive under
// the ids the saved document already uses for those same inputs.
//
// They used to, by accident: an id was a walk-order counter, so the same script
// on the same translator minted `1, 2, 3` again. Since C46 an id is the input
// call's place in the source (`engine/ast/paramIdSource.js`), so a document
// saved before that — or one whose script gained an input above the others —
// holds ids the fresh translation no longer produces. This is where the two
// meet, and the only place they do: a saved document does not carry its Pine.
//
// THE RULE (one function, no state):
//   · an incoming input MATCHES a prior one when its `sourceName` (the Pine
//     variable it was declared as) and its `type` are both equal;
//   · a match takes the PRIOR id;
//   · two inputs declared under one name are matched in order — incoming in the
//     manifest's own order (source order), prior in id order;
//   · ⭐ A RENAME IS RECOGNISED BY ITS PLACE, never guessed. An input left
//     unmatched takes a saved input's id only when that saved input is ALSO left
//     unmatched, is the same KIND, and stood in the SAME PLACE: a saved id is the
//     place it was minted at — a counter id (`_1`, `_2`, …) is the input's turn in
//     the walk, a source id (`_1001`, …) its place in the source — and the pasted
//     input must hold that same place in that same numbering. So everything else
//     lines up and exactly that slot changed its name. (A pre-C46 save of a
//     renamed input went through for this very reason: the counter handed the
//     new name the old number.) It is the same saved setting under a new name;
//   · anything short of that — a different kind, a different place, two saved
//     inputs it could be — is not a rename: the input is new and keeps the id the
//     translation gave it;
//   · ⛔ a new input may never sit on an id the saved document holds for a
//     DIFFERENT input — the server would hand it that input's record. It is
//     moved to a free id above every id in play;
//   · a prior input the script no longer declares is simply absent, as it
//     always was.
//
// ⛔ PURE. It reads two manifests and returns a third; it never reads a tree.

import { SOURCE_ID_BASE } from '../engine/ast/paramIdSource.js'

const NUM = (id) => Number(String(id).slice('__uct_param_'.length))
const idOf = (n) => `__uct_param_${n}`
/** Does the pasted input stand where the saved id was minted? `place` is
 *  `{walk, ordinal}` for the pasted input (the translation's own record). */
const standsAt = (place, savedId) => {
  if (!place) return false
  const n = NUM(savedId)
  if (!Number.isInteger(n) || n < 1) return false
  return n > SOURCE_ID_BASE ? place.ordinal === n - SOURCE_ID_BASE : place.walk === n
}
const kindKey = (e) => `${e && e.sourceName}\u0000${e && e.type}`

/**
 * @param {object|null} next   the manifest the fresh translation produced
 * @param {object|null} prior  the manifest the SAVED document holds
 * @param {object|null} [places] the pasted inputs' places, keyed by the id the
 *   translation gave them: `{[id]: {walk, ordinal}}` (`inputPlaces`). Without it
 *   no rename is recognised — a place that is not known is not a place that matches.
 * @returns {{manifest: object|null, carried: Array<{name: string, id: string, from: string}>,
 *            renamed: Array<{from: string, to: string, id: string}>,
 *            added: Array<{name: string, title: string, id: string}>, dropped: string[]}}
 */
export function carryPriorParamIds(next, prior, places = null) {
  const empty = { manifest: next || null, carried: [], renamed: [], added: [], dropped: [] }
  if (!next || typeof next !== 'object' || !prior || typeof prior !== 'object') return empty
  const priorIds = Object.keys(prior).sort((a, b) => NUM(a) - NUM(b))
  if (!priorIds.length) return empty

  // prior inputs still to be claimed, per (name, kind), in id order
  const unclaimed = new Map()
  for (const id of priorIds) {
    const key = kindKey(prior[id])
    if (!unclaimed.has(key)) unclaimed.set(key, [])
    unclaimed.get(key).push(id)
  }

  const placed = []
  const carried = []
  const taken = new Set()
  for (const id of Object.keys(next)) {
    const queue = unclaimed.get(kindKey(next[id]))
    const priorId = queue && queue.length ? queue.shift() : null
    if (priorId) {
      taken.add(priorId)
      carried.push({ name: next[id].sourceName, id: priorId, from: id })
    }
    placed.push({ entry: next[id], id: priorId, own: id })
  }

  // ⭐ a rename: an unmatched pasted input standing exactly where ONE unmatched
  // saved input of its kind was minted. Two candidates is not a rename.
  const renamed = []
  const left = () => [...unclaimed.values()].flat()
  for (const p of placed) {
    if (p.id) continue
    const place = places && places[p.own]
    const candidates = left().filter((id) => prior[id].type === p.entry.type && standsAt(place, id))
    if (candidates.length !== 1) continue
    const priorId = candidates[0]
    const queue = unclaimed.get(kindKey(prior[priorId]))
    queue.splice(queue.indexOf(priorId), 1)
    taken.add(priorId)
    p.id = priorId
    p.renamedFrom = prior[priorId].title || prior[priorId].sourceName
    renamed.push({ from: p.renamedFrom, to: p.entry.title || p.entry.sourceName, id: priorId })
  }

  // a new input keeps its own id unless the saved document already uses that id
  let free = Math.max(0, ...priorIds.map(NUM), ...Object.keys(next).map(NUM))
  const added = []
  for (const p of placed) {
    if (p.id) continue
    let id = p.own
    if (Object.prototype.hasOwnProperty.call(prior, id) || taken.has(id)) {
      free += 1
      id = idOf(free)
    }
    taken.add(id)
    p.id = id
    added.push({ name: p.entry.sourceName, title: p.entry.title || p.entry.sourceName, id })
  }

  const manifest = {}
  for (const p of placed) manifest[p.id] = p.entry
  const dropped = [...unclaimed.values()].flat().map((id) => prior[id].title || prior[id].sourceName)
  return { manifest, carried, renamed, added, dropped }
}

/** The pasted inputs' places, from `translatePine(...).inputParams` — the entries
 *  carry their turn in the walk and their place in the source as non-enumerable
 *  properties, so they have to be read off the entries themselves. */
export function inputPlaces(inputParams) {
  const out = {}
  for (const p of (Array.isArray(inputParams) ? inputParams : [])) {
    if (p && p.id) out[p.id] = { walk: p.walkIndex, ordinal: p.ordinal }
  }
  return out
}

/** The roster a saved definition holds, from whichever slot it keeps it in
 *  (a V1 document's `compute.paramManifest`, a shared-graph document's
 *  `compute.graph.parameters`) — or null. */
export function savedParamManifest(definition) {
  const compute = (definition && definition.compute) || {}
  const v1 = compute.paramManifest
  if (v1 && typeof v1 === 'object' && Object.keys(v1).length) return v1
  const v2 = compute.graph && compute.graph.parameters
  if (v2 && typeof v2 === 'object' && Object.keys(v2).length) return v2
  return null
}

/** What the member is told about the paste: an input that was recognised under
 *  a new name, and an adjustable input the saved formula does not hold. null
 *  when there is nothing to say. */
export function carryNotice(result) {
  if (!result) return null
  const parts = (result.renamed || []).map((r) => `The input "${r.from}" is now "${r.to}". `
    + 'It is the same saved setting under its new name.')
  if (result.added.length) parts.push(addedNotice(result))
  return parts.length ? parts.join(' ') : null
}

function addedNotice(result) {
  const names = result.added.map((a) => `\`${a.title}\``).join(', ')
  const one = result.added.length === 1
  return `${names} ${one ? 'is' : 'are'} not among the adjustable settings this formula was saved with `
    + '(a new input, a renamed one, or one whose type changed). A saved formula keeps the adjustable '
    + `settings it was saved with and cannot gain ${one ? 'one' : 'more'}, so saving this over it will be `
    + 'refused. Save it as a new formula to keep '
    + `${one ? 'that setting' : 'those settings'} adjustable.`
}
