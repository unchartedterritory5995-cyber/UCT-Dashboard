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
//   • `reachable`     — some probe translated with no refusal at all.
//   • `call-unmapped` — the door refused the name with a guard that is NOT a
//                       name-unknown guard: it KNOWS the name.
//   • `name-unknown`  — every refusal naming it is a name-unknown guard
//                       (`doorCoverage.UNKNOWN_NAME_GUARDS`, imported).
//   • `unprobed`      — no probe ever produced a refusal naming it, and none
//                       translated: the probe could not ask. NEVER read as fixed.
//
// ⛔⛔ WHAT "FIXED" MAY MEAN, AND WHAT IT MAY NOT (`fixedOnMaster`):
//   • a `name-unknown` gap is fixed when the door now KNOWS the name
//     (`reachable` or `call-unmapped`). That wall is gone; a member who now hits
//     a call-shape wall logs a NEW `call-unmapped` gap, which is what it is.
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

export function probeExpressions(name) {
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

/** Ask the door about one name. `translate` is injected (`translatePine`). */
export function probeName(name, translate) {
  let known = false
  let unknownSeen = false
  let guard = null
  for (const expr of probeExpressions(name)) {
    let t
    try { t = translate(probeScript(expr)) } catch { continue }
    const refusals = refusalsOf(t)
    const usable = (t && Array.isArray(t.outputs) ? t.outputs : []).some((o) => o && !o.refusal && o.formula)
    if (usable && refusals.length === 0) return { status: 'reachable', probe: expr, guard: null }
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
export function buildDoorNameCoverage({ names, fixes = [], translate }) {
  const out = {}
  for (const n of [...new Set(names)].sort()) {
    const r = probeName(n, translate)
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
  return !!row && (row.status === 'reachable' || row.status === 'call-unmapped')
}
