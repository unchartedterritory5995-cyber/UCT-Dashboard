// app/src/data/barStore/status.js — Snapshot.status: derivation + the legal transitions.
//
// ⭐ ONE FRESHNESS FUNCTION. Intraday currentness is `utils/marketSession.intradayBarCurrentness`
// (session frontier in EXPECTED BUCKETS, one-bucket tolerance, `verifiedThrough` as the only
// proof beyond it); the daily paint frontier is `expectedDailyTailForPaintET`. This module
// only MAPS their answers onto the store's six states — it never measures staleness itself.
//
//   empty        nothing held (and no terminal error)
//   provisional  local copy only (pack / IDB / mem) and its tail is behind the frontier:
//                history may paint, the live edge is BUFFERED
//   context      current enough but not server-verified: a local copy within tolerance, or a
//                legacy server answer (no `verified_through`)
//   current      a server answer that is current AND verified (verified_through or
//                tail_status 'verified'); D/W/M: a server answer whose tail is the paint
//                frontier (P1 does not seal D/W/M yet — bar-contract.md §8)
//   updating     a server answer is held but it is behind / unverified: fast catch-up
//   unavailable  terminal: the server said no data (or an error with nothing to show)

import {
  intradayBarCurrentness, CURRENTNESS, expectedDailyTailForPaintET,
} from '../../utils/marketSession'
import { STATUS, isDateTf, unixToDateLabel } from './types'

/**
 * @param {import('./types').Snapshot} s
 * @param {{nowMs?:number, session?:'rth'|'eth'}} [ctx]
 * @returns {string} a STATUS value
 */
export function deriveStatus(s, ctx = {}) {
  const nowMs = ctx.nowMs ?? Date.now()
  const hasBars = (s.bars && s.bars.length > 0) || !!s.developing
  if (s.error === 'no_data' && !hasBars) return STATUS.UNAVAILABLE
  if (!hasBars) return STATUS.EMPTY   // a non-terminal error is retried, not a state
  const tailT = s.developing ? s.developing.t : s.bars[s.bars.length - 1].t
  // The held window predates the server's current history; a full read is in flight.
  if (s.restSeen && s.pendingHistoryRev != null) return STATUS.UPDATING
  // P3-S2b: a live bar opened past MISSING expected buckets (reducer.liveGapStart) — the base is
  // behind the live edge; a read is in flight until the server answers.
  if (s.restSeen && s.liveGapFrom != null) return STATUS.UPDATING

  if (isDateTf(s.tf)) {
    let behind = false
    if (s.tf === 'D') behind = unixToDateLabel(tailT) < expectedDailyTailForPaintET(nowMs)
    if (!s.restSeen) return behind ? STATUS.PROVISIONAL : STATUS.CONTEXT
    return behind ? STATUS.UPDATING : STATUS.CURRENT
  }

  const c = intradayBarCurrentness({
    tf: s.tf, tailT, nowMs,
    session: ctx.session === 'eth' ? 'extended' : 'rth',
    verifiedThrough: s.verifiedThrough,
    serverStatus: s.tailStatus,
    pending: true,
  })
  const settled = c === CURRENTNESS.CURRENT || c === CURRENTNESS.NO_EXPECTATION
  if (!s.restSeen) return settled ? STATUS.CONTEXT : STATUS.PROVISIONAL
  if (!settled) return STATUS.UPDATING
  // P3-S2b: rows a TICK closed (the fallback, src 'tick') are the client's observation, not the
  // server's — the tail is unverified until a REST answer replaces them (closed-row precedence:
  // a REST row outranks a tick row). `verifiedThrough` is only ever the server's claim.
  const verified = (s.verifiedThrough != null || s.tailStatus === 'verified') && !tickClosedTail(s)
  return verified ? STATUS.CURRENT : STATUS.CONTEXT
}

/** Does the tail hold a closed row a tick produced, after the newest server (REST) row? */
export function tickClosedTail(s) {
  const bars = s.bars || []
  for (let i = bars.length - 1; i >= 0; i--) {
    const src = bars[i].src
    if (src === 'rest') return false
    if (src === 'tick') return true
  }
  return false
}

/**
 * Legal status transitions. Self-transitions are always legal; any state may go to
 * `empty` (invalidate). The rule the table encodes: once a server answer is held, the
 * entry never goes back to a local-only state (`provisional`) — only an invalidate resets
 * it — and `unavailable` is left only by data arriving.
 */
export const TRANSITIONS = Object.freeze({
  empty: Object.freeze(['provisional', 'context', 'current', 'updating', 'unavailable']),
  provisional: Object.freeze(['context', 'current', 'updating', 'unavailable', 'empty']),
  context: Object.freeze(['provisional', 'current', 'updating', 'unavailable', 'empty']),
  current: Object.freeze(['context', 'updating', 'unavailable', 'empty']),
  updating: Object.freeze(['context', 'current', 'unavailable', 'empty']),
  unavailable: Object.freeze(['context', 'current', 'updating', 'empty']),
})

export function isLegalTransition(from, to) {
  if (from === to) return true
  return !!TRANSITIONS[from] && TRANSITIONS[from].includes(to)
}
