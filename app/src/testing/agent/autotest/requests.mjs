// UCT Agent AUTOTEST: the PUBLIC request set, organized by capability family from the Charts inventory.
// Held-out requests are NOT here and never in this repository in the clear (heldout.mjs).
import { createHash } from 'node:crypto'
import { chartSurface } from './families/chartSurface.mjs'
import { indicators } from './families/indicators.mjs'
import { drawingsAlerts } from './families/drawingsAlerts.mjs'
import { workspace } from './families/workspace.mjs'
import { unseen } from './families/unseen.mjs'
import { unseen2 } from './families/unseen2.mjs'

export function publicRequests() {
  const L = []
  chartSurface(L)
  indicators(L)
  drawingsAlerts(L)
  workspace(L)
  return L.map(r => ({ ...r, set: 'public' }))
}

/** Requests written 2026-11-06 for this rig's first BROWSER-MOCK-MODEL sweep, by an author who had not run the public set against
 *  the product. Kept apart from the public set so the owner-approved public hash does not move. */
export function unseenRequests() {
  const L = []
  unseen(L)
  return L.map(r => ({ ...r, set: 'unseen' }))
}

/** Batch 2 (2026-11-07), written before any run of it: families neither the public set nor batch 1 probed. */
export function unseen2Requests() {
  const L = []
  unseen2(L)
  return L.map(r => ({ ...r, set: 'unseen2' }))
}

/** The set's identity: the owner's authorization names it, so editing the set after approval voids the approval. */
export const setHash = (list) => createHash('sha256').update(JSON.stringify(list)).digest('hex')

/** Fixed, stratified sample: the first `perFamily` of each family, then one of each kind seen fewer times. */
export function sample(list, perFamily = 2) {
  const seen = new Map()
  const out = []
  const kinds = new Map()
  for (const r of list) {
    const n = seen.get(r.family) || 0
    if (n < perFamily) { out.push(r); seen.set(r.family, n + 1); kinds.set(r.kind, (kinds.get(r.kind) || 0) + 1) }
  }
  for (const r of list) if (!out.includes(r) && (kinds.get(r.kind) || 0) < 4) { out.push(r); kinds.set(r.kind, (kinds.get(r.kind) || 0) + 1) }
  return out
}
