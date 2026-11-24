// app/src/components/chart/supportLoop/doorNameCoverage.js
//
// ─── ⭐ INDICATOR SUPPORT LOOP, PHASE B — "IS THIS GAP FIXED ON MASTER?" ──────
//
// Spec: `docs/pine/support-loop/PHASE-B.md`. The daily digest ranks the gaps
// members hit (Phase A's `indicator_gap_hits`) and must DROP a gap the current
// build has already fixed. The server is Python and the door is JavaScript, so
// the answer is computed here, through the Pine door, and committed as data
// (`doorNameCoverage.json`, next to `pineBuiltins.json`, both read by the server).
// `doorNameCoverage.test.js` regenerates it and fails when the committed file
// differs, so the file IS the current build's answer, not a remembered one.
//
// ⭐ IT ASKS THE DOOR, the same way `doorCoverage.js` does and for the same reason
// (its header: a text search over a translator measures the wrong artifact). Each
// allowlisted built-in is put into a handful of small probe scripts and the
// translator's own refusals are read. A refusal counts for a name ONLY when its
// `token` IS that name: the same attribution `importGaps.js` uses when it logs a
// member's gap, so the two classifications cannot drift apart.
//
//   • `reachable`     — some probe translated with no refusal at all, and (train e95) the
//                       member's paste path serves that probe (`probeName`'s `serves`).
//   • `call-unmapped` — the door refused the name with a guard that is NOT a
//                       name-unknown guard: it KNOWS the name.
//   • `name-unknown`  — every refusal naming it is a name-unknown guard
//                       (`doorCoverage.UNKNOWN_NAME_GUARDS`, imported).
//   • `unprobed`      — no probe ever produced a refusal naming it, and none
//                       translated: the probe could not ask. NEVER read as fixed.
//
// ⛔⛔ WHAT "FIXED" MAY MEAN, AND WHAT IT MAY NOT (`fixedOnMaster`):
//   • a `name-unknown` gap is fixed ONLY when the door now serves the name
//     (`reachable`). When the door knows the name but cannot map the call
//     (`call-unmapped`), the member's paste still loses the built-in: the gap stays
//     OPEN, and the server reclassifies it as `call-unmapped`, merging its demand.
//   • a `call-unmapped` gap is NOT decided by a name probe. The door knew the name
//     when the member hit it; whether THEIR call shape now maps is a fact about a
//     call, not a name. It is fixed only by an entry in `fixedGaps.json` whose
//     `probe` (a minimal repro the implementer writes, never member source)
//     translates through this door. The entry is re-asked on every regeneration,
//     so a regression flips it back to open.
// Wrong in the other direction (a fixed gap left on the list) costs a reader a
// glance; wrong in this direction (an open gap hidden as fixed) costs a member
// their indicator. So every uncertainty resolves to OPEN.

import { UNKNOWN_NAME_GUARDS } from '../engine/ast/doorCoverage'

/** The argument lists tried after each name, in order. Small, generic, and
 *  deliberately not a signature table: the question is "does the door know this
 *  name", and an arity it refuses still answers that (as `call-unmapped`). */
export const PROBE_ARGS = Object.freeze([
  null, // the bare name, as a value: `plot(close * 0 + NAME)` reads a variable
  '()',
  '(close)',
  '(close, 14)',
  '(close, close)',
  '(close, 14, 2)',
  '(high, low, close, 14)',
  '(close, 14, 0.85, 6)',
])

/** Wrap one expression as a whole Pine v5 script that plots it. */
export function probeScript(expr) {
  return `//@version=5\nindicator("probe")\nplot(${expr})\n`
}

/** ⭐⭐ (train e95) THE DATA READS WHOSE BARE CALL TRANSLATES AND IS REFUSED WHEN IT RUNS. The parse rewrites each of
 *  these into a read of the chart's own data (`request.earnings` / `request.dividends` / `request.splits`, T4 E2;
 *  `request.financial`, T4 F1b), and the rewrite takes even an empty argument list: `request.earnings()` translates
 *  with no refusal, so the generic probes below reached it first and the reference handed the assistant that call,
 *  which the bind refuses on every chart (`other-symbol:event-argument` / `other-symbol:financial-argument`: no symbol
 *  is written). Each is probed with the ONE call a member's door serves on a daily chart of its own symbol, and with
 *  that call only: if it ever stops translating, the name is not reachable, never reached through an argument list
 *  the run refuses. `assistantPineReference.test.js` runs every listed call on a daily chart with the doors answering. */
export const NAMED_PROBE_ARGS = Object.freeze({
  'request.earnings': '(syminfo.tickerid, earnings.actual, barmerge.gaps_off, barmerge.lookahead_on)',
  'request.dividends': '(syminfo.tickerid, dividends.gross)',
  'request.splits': '(syminfo.tickerid, splits.denominator)',
  'request.financial': '(syminfo.tickerid, "TOTAL_REVENUE", "FQ")',
})

export function probeExpressions(name) {
  if (Object.prototype.hasOwnProperty.call(NAMED_PROBE_ARGS, name)) return [`${name}${NAMED_PROBE_ARGS[name]}`]
  return PROBE_ARGS.map((a) => (a == null ? name : `${name}${a}`))
}

/** Every refusal in one translation result, flattened (outputs and the top). */
export function refusalsOf(t) {
  if (!t || typeof t !== 'object') return []
  const out = []
  for (const o of (Array.isArray(t.outputs) ? t.outputs : [])) {
    if (o && o.refusal) out.push(o.refusal)
  }
  if (t.refusal) out.push(t.refusal)
  for (const r of (Array.isArray(t.refusals) ? t.refusals : [])) if (r) out.push(r)
  return out
}

const tokenOf = (r) => (r && typeof r.token === 'string' ? r.token
  : (r && r.at && typeof r.at.token === 'string' ? r.at.token : null))

/** Ask the door about one name. `translate` is injected (`translatePine`).
 *  ⭐⭐ (train e95) `serves` (optional, injected by the generator: the member's paste path, `{ok, guard}` for a whole
 *  script) is asked of a probe that translates with no refusal. A probe it does not serve is NOT the name's call: the
 *  next argument list is tried. ⚰️ The reference handed the assistant `ta.pivothigh(close, 14)`, `ta.highestbars(close)`
 *  and `ta.macd(close, 14, 2)`: each translated, and the member's install refused it (`pine:install`, a window or a
 *  period the engine's own check rejects). A name the door translates but serves on no probe is `call-unmapped`, with
 *  the paste path's guard. */
export function probeName(name, translate, serves = null) {
  let known = false
  let unknownSeen = false
  let guard = null
  for (const expr of probeExpressions(name)) {
    let t
    try { t = translate(probeScript(expr)) } catch { continue }
    const refusals = refusalsOf(t)
    const usable = (t && Array.isArray(t.outputs) ? t.outputs : []).some((o) => o && !o.refusal && o.formula)
    if (usable && refusals.length === 0) {
      if (typeof serves !== 'function') return { status: 'reachable', probe: expr, guard: null }
      let s = null
      try { s = serves(probeScript(expr)) } catch (err) { s = { ok: false, guard: `THROW:${(err && err.message) || err}` } }
      if (s && s.ok === true) return { status: 'reachable', probe: expr, guard: null }
      // the door translated the name; the paste path refuses this call of it: it KNOWS the name
      if (!known) { known = true; guard = (s && s.guard) || null }
      continue
    }
    for (const r of refusals) {
      if (tokenOf(r) !== name) continue
      if (UNKNOWN_NAME_GUARDS.includes(r.guard)) { unknownSeen = true; guard = guard || r.guard }
      else if (!known) { known = true; guard = r.guard || null }
    }
  }
  if (known) return { status: 'call-unmapped', probe: null, guard }
  if (unknownSeen) return { status: 'name-unknown', probe: null, guard }
  return { status: 'unprobed', probe: null, guard: null }
}

/** One fix-ledger entry, re-asked: does its repro translate with no refusal? */
export function probeFix(entry, translate) {
  let t
  try { t = translate(String(entry.probe || '')) } catch (err) {
    return { status: 'open', guard: `THROW:${(err && err.message) || err}` }
  }
  const refusals = refusalsOf(t)
  const usable = (t && Array.isArray(t.outputs) ? t.outputs : []).some((o) => o && !o.refusal && o.formula)
  if (usable && refusals.length === 0) return { status: 'fixed', guard: null }
  return { status: 'open', guard: (refusals[0] && refusals[0].guard) || null }
}

/**
 * The whole manifest, deterministic (sorted keys, no clock), so the committed
 * file can be compared byte for byte.
 */
export function buildDoorNameCoverage({ names, fixes = [], translate, serves = null }) {
  const out = {}
  for (const n of [...new Set(names)].sort()) {
    const r = probeName(n, translate, serves)
    out[n] = r.status === 'reachable' ? { status: r.status, probe: r.probe }
      : (r.guard ? { status: r.status, guard: r.guard } : { status: r.status })
  }
  const fixRows = fixes
    .map((f) => ({ name: f.name, kind: f.kind, probe: f.probe, ...probeFix(f, translate) }))
    .map(({ guard, ...rest }) => (guard ? { ...rest, guard } : rest))
    .sort((a, b) => (a.name + a.kind < b.name + b.kind ? -1 : 1))
  const counts = {}
  for (const v of Object.values(out)) counts[v.status] = (counts[v.status] || 0) + 1
  return {
    _comment: 'GENERATED by app/src/components/chart/supportLoop/doorNameCoverage.test.js '
      + '(WRITE_DOOR_NAME_COVERAGE=1). Do not edit by hand. Read by api/services/indicator_support_loop.py '
      + 'to drop gaps the current build has fixed. Spec: docs/pine/support-loop/PHASE-B.md.',
    version: 1,
    counts: Object.fromEntries(Object.entries(counts).sort()),
    names: out,
    fixes: fixRows,
  }
}

/** Mirror of the server's rule, so the two can be railed against each other. */
export function fixedOnMaster(manifest, name, kind) {
  if (!manifest || typeof name !== 'string') return false
  if ((manifest.fixes || []).some((f) => f.name === name && f.kind === kind && f.status === 'fixed')) return true
  if (kind !== 'name-unknown') return false
  const row = (manifest.names || {})[name]
  // ⛔ ONLY `reachable`: a door that knows the name but cannot map the call still
  // loses the built-in from the member's paste (the server reclassifies that gap as
  // call-unmapped and keeps it open).
  return !!row && row.status === 'reachable'
}
