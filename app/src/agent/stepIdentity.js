// ── ⛔ STEP IDENTITY (2026-11-14, owner live test BUG B; AUDIT probe 43) ─────────────────────────────────────────────────
//
// "On my SPY chart, change the 20 EMA to a 50 EMA and make its line blue": the two indicator edits run as SEQUENTIAL steps
// (useAgent: the first now, the rest as follow-ups, each planned on the state the step before left). Step 2 named the EMA the
// way the plan was written — by a DESCRIPTION ("#20:ema", "#20", "EMA 20") — and was resolved against the UPDATED chart, where
// no 20 EMA exists any more: "That indicator isn't on Chart (SPY) any more", over a 50 EMA that is plainly there.
//
// THE RULE: a step queued behind another is PINNED, before anything runs, to the stable identity its words mean on the state
// the member asked about (a target kind's `pinIdentity`: e.g. an indicator's instanceId). When the step runs, its words are
// read again on the live state and the two readings are compared — never the description alone:
//   now = pinned                  → the step runs on that identity
//   now finds nothing             → the pinned identity, if it is still there (the earlier step changed what the words
//                                   describe, not which object it is); truly gone → the kind's own "not there" sentence
//   now = another object / unclear → the step does NOT run: the words mean something else after the earlier step ("#50" was
//                                   the SMA 50; now an EMA 50 is there too) — asked, never guessed
//   the words found nothing before → the live reading, unchanged (a step about what an earlier step MADE)
// A kind without `pinIdentity` is untouched (its steps never queue, or address targets by stable refs).
//
// Kinds that opt in: indicatorEdits (`instance` → instanceId).
import { getCapability, getTargetKind } from './capabilities'

const kindOf = (op) => { try { return getTargetKind(getCapability(op?.action)?.target) } catch { return null } }

/** The op, with `pin` when its kind can name the identity its words mean NOW (call before any step of the request runs). */
export function pinStep(op, host) {
  const k = kindOf(op)
  if (typeof k?.pinIdentity !== 'function') return op
  let pin = null
  try { pin = k.pinIdentity(host, op) } catch { pin = null }
  return pin ? { ...op, pin } : op
}

/** A pinned op, read again on the live state → { op } (run it, aimed at the identity) | { say } (do not run; why). */
export function resolvePinned(op, host) {
  const { pin, ...rest } = op || {}
  if (!pin) return { op: rest }
  const k = kindOf(rest)
  if (typeof k?.resolvePinned !== 'function') return { op: rest }
  try { return k.resolvePinned(host, rest, pin) || { op: rest } } catch { return { op: rest } }
}
