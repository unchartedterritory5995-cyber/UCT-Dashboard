// UCT Agent AUTOTEST: the PUBLIC request set, organized by capability family from the Charts inventory.
// Held-out requests are NOT here and never in this repository in the clear (heldout.mjs).
import { createHash } from 'node:crypto'
import { chartSurface } from './families/chartSurface.mjs'
import { indicators } from './families/indicators.mjs'
import { drawingsAlerts } from './families/drawingsAlerts.mjs'
import { workspace } from './families/workspace.mjs'
import { unseen } from './families/unseen.mjs'
import { unseen2 } from './families/unseen2.mjs'
import { unseen3 } from './families/unseen3.mjs'
import { followup3 } from './families/followup3.mjs'
import { unseen4 } from './families/unseen4.mjs'
import { unseen5 } from './families/unseen5.mjs'
import { unseen6 } from './families/unseen6.mjs'
import { unseen7 } from './families/unseen7.mjs'
import { unseen8 } from './families/unseen8.mjs'
import { unseen9 } from './families/unseen9.mjs'
import { unseen10 } from './families/unseen10.mjs'
import { unseen11 } from './families/unseen11.mjs'
import { unseen12 } from './families/unseen12.mjs'
import { unseen13 } from './families/unseen13.mjs'
import { unseen14 } from './families/unseen14.mjs'
import { unseen15 } from './families/unseen15.mjs'

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

/** Batch 3 (2026-11-07), written before any run of it: widget controls by name, chart header Info row and Bar info. */
export function unseen3Requests() {
  const L = []
  unseen3(L)
  return L.map(r => ({ ...r, set: 'unseen3' }))
}

/** Read-backs written AFTER batch 3's results (not unseen). */
export function followup3Requests() {
  const L = []
  followup3(L)
  return L.map(r => ({ ...r, set: 'followup3' }))
}

/** Batch 4 (2026-11-07), written before pl-exec's round 3 and before any run of it. */
export function unseen4Requests() {
  const L = []
  unseen4(L)
  return L.map(r => ({ ...r, set: 'unseen4' }))
}

/** Batch 5 (2026-11-07), written before any run of it: panes, lines and indicators next to chart words. */
export function unseen5Requests() {
  const L = []
  unseen5(L)
  return L.map(r => ({ ...r, set: 'unseen5' }))
}

/** Batch 6 (2026-11-07), written before the code lands: conversational targeting (the last named chart keeps the follow-ups). */
export function unseen6Requests() {
  const L = []
  unseen6(L)
  return L.map(r => ({ ...r, set: 'unseen6' }))
}

/** Batch 7 (2026-11-07), written before the code lands: every real Options Flow filter, read from the widget's own code. */
export function unseen7Requests() {
  const L = []
  unseen7(L)
  return L.map(r => ({ ...r, set: 'unseen7' }))
}

/** Batch 8 (2026-11-08), written before any run of it: sequences, screener and scanner, indicator settings across the catalog,
 *  recovery from ambiguity. */
export function unseen8Requests() {
  const L = []
  unseen8(L)
  return L.map(r => ({ ...r, set: 'unseen8' }))
}

/** Batch 9 (2026-11-09), written before any run of it: multistep + undo, scanner filters, the indicator library, references on
 *  3-, 4- and 6-chart boards (its walkthrough part is tutorialCases.mjs tut9-). */
export function unseen9Requests() {
  const L = []
  unseen9(L)
  return L.map(r => ({ ...r, set: 'unseen9' }))
}

/** Batch 10, RELATIONS (2026-11-09), written before any run and without reading deixis.js or #988's tests. */
export function unseen10Requests() {
  const L = []
  unseen10(L)
  return L.map(r => ({ ...r, set: 'unseen10' }))
}

/** Batch 11, RELATIONS II (2026-11-09): 20 new relation phrasings, written before any run and without reading deixis.js or #988's tests. */
export function unseen11Requests() {
  const L = []
  unseen11(L)
  return L.map(r => ({ ...r, set: 'unseen11' }))
}

/** Batch 12, RELATIONS III (2026-11-09): rows, columns, line ordinals, possessives, placement and "next door", written before any run and without reading deixis.js or #988's tests. */
export function unseen12Requests() {
  const L = []
  unseen12(L)
  return L.map(r => ({ ...r, set: 'unseen12' }))
}

/** Batch 13, WATCHLIST (2026-11-09): the Charts watchlist widget and the member's lists, execution and how-to, written before any run and without reading pl-exec's or pl-teach's watchlist code. */
export function unseen13Requests() {
  const L = []
  unseen13(L)
  return L.map(r => ({ ...r, set: 'unseen13' }))
}

/** Batch 14, TICKER ANCHORS (2026-11-09): AUDIT probe-18's five families (G1-G5) in pl-auto's own words, written before any run. */
export function unseen14Requests() {
  const L = []
  unseen14(L)
  return L.map(r => ({ ...r, set: 'unseen14' }))
}

/** Batch 15, COUNTED AND LINE RELATIONS (2026-11-09): AUDIT probe-19's families H1-H5 in pl-auto's own words, written before any run. */
export function unseen15Requests() {
  const L = []
  unseen15(L)
  return L.map(r => ({ ...r, set: 'unseen15' }))
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
