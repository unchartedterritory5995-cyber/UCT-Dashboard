// ── D31 RESOLVER · THE SHADOW HOOK (useAgent.railOf; AUDIT R2 / R4 / I7) ─────────────────────────────────────────────────
// Runs the resolver beside the rails and ENFORCES NOTHING: the rails' decision stands, always (enforce.js 'shadow').
//   R2  no production telemetry, no server-side record, no endpoint: a record goes only to a sink a TEST or the offline replay
//       installs (setShadowSink); in the product there is none and the record is dropped.
//   R4  every exception is swallowed here (and again at the call site): the shadow can never change, delay or break a turn.
//   I10 a record carries codes, types, counts and the family — never words, tickers, ids or labels.
import { resolve } from './resolve'
import { worldFromHost, targetsOfPlan } from './world'
import { modeOf } from './enforce'

let SINK = null
/** Test / offline-replay only: receive each shadow record. Returns the previous sink. */
export function setShadowSink(fn) { const was = SINK; SINK = typeof fn === 'function' ? fn : null; return was }

/** A rails' outcome as a verdict class: 'allow' | 'ask' | 'refuse'. */
export const railClass = (text, isAsk = false) => (text == null ? 'allow' : isAsk ? 'ask' : 'refuse')

/**
 * The shadow comparison for one planned change. Never throws; returns the no-leak record (or null).
 * Disagreement classes: A — the resolver asks / refuses where the rails allow (a candidate added block);
 * B — the resolver resolves where a rail blocks (the resolver is looser: never effective, I7); C — both block, different kind.
 */
export function shadowRemoval({ plan, words, carried = null, host, subject = null, previous = null, picked = null, rails = { text: null, ask: false } } = {}, { resolveFn = resolve } = {}) {
  try {
    const planTargets = targetsOfPlan(plan, host)
    if (!planTargets.length) return null
    const world = worldFromHost(host, { subject, previous, picked })
    const rz = resolveFn({ words: { typed: String(words || ''), carried }, planTargets, world })
    const rail = railClass(rails?.text ?? null, !!rails?.ask)
    const res = rz.verdict === 'resolved' || rz.verdict === 'abstain' ? 'allow' : rz.verdict
    const cls = rail === 'allow' && res !== 'allow' ? 'A' : rail !== 'allow' && res === 'allow' && rz.verdict !== 'abstain' ? 'B' : rail !== 'allow' && res !== 'allow' && rail !== res ? 'C' : null
    const record = { family: rz.family, mode: modeOf(rz.family), verdict: rz.verdict, reason: rz.reason, rail, cls, agree: !cls,
      types: [...new Set(planTargets.map(t => t.type))], targets: planTargets.length }
    if (SINK) { try { SINK(record) } catch { /* a sink never breaks the shadow */ } }
    return record
  } catch {
    return null
  }
}
