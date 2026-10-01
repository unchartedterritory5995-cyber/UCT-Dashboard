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
//   · a renamed input, or one whose kind changed, matches nothing: it is a new
//     input and keeps the id the translation gave it;
//   · ⛔ a new input may never sit on an id the saved document holds for a
//     DIFFERENT input — the server would hand it that input's record. It is
//     moved to a free id above every id in play;
//   · a prior input the script no longer declares is simply absent, as it
//     always was.
//
// ⛔ PURE. It reads two manifests and returns a third; it never reads a tree.

const NUM = (id) => Number(String(id).slice('__uct_param_'.length))
const idOf = (n) => `__uct_param_${n}`
const kindKey = (e) => `${e && e.sourceName}\u0000${e && e.type}`

/**
 * @param {object|null} next   the manifest the fresh translation produced
 * @param {object|null} prior  the manifest the SAVED document holds
 * @returns {{manifest: object|null, carried: Array<{name: string, id: string, from: string}>,
 *            added: Array<{name: string, title: string, id: string}>, dropped: string[]}}
 */
export function carryPriorParamIds(next, prior) {
  const empty = { manifest: next || null, carried: [], added: [], dropped: [] }
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
  return { manifest, carried, added, dropped }
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

/** What the member is told when the pasted script has an adjustable input the
 *  saved formula does not hold. null when there is nothing to say. */
export function carryNotice(result) {
  if (!result || !result.added.length) return null
  const names = result.added.map((a) => `\`${a.title}\``).join(', ')
  const one = result.added.length === 1
  return `${names} ${one ? 'is' : 'are'} not among the adjustable settings this formula was saved with `
    + '(a new input, a renamed one, or one whose type changed). A saved formula keeps the adjustable '
    + `settings it was saved with and cannot gain ${one ? 'one' : 'more'}, so saving this over it will be `
    + 'refused. Save it as a new formula to keep '
    + `${one ? 'that setting' : 'those settings'} adjustable.`
}
