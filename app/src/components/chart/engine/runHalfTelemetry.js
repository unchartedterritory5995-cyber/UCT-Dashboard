// app/src/components/chart/engine/runHalfTelemetry.js
//
// ─── ⭐⭐ ENGINE 54 — RUN-HALF REFUSAL TELEMETRY ──────────────────────────────────────────
//
// The run half is refused by a dozen gates and three rails, and before capability admission
// (engine-53 plan, Part 2) widens who gets one, the reach under admission must be MEASURED,
// not inferred: which code refused, for which script, how often. Two parts:
//
//   1. a per-DOCUMENT-SESSION count in this tab (`runHalfRefusalCounts`): each document
//      (its id and its script) counts a code once each time its run half ENTERS that refusal,
//      not once per paint (a chart repaints on every tick);
//   2. a beacon, the S8 stop beacon's discipline (`runtime/runtimeAsync.js`): POST
//      `RUN_HALF_BEACON_URL` (`api/routers/pine_runtime_telemetry.py`) with EXACTLY
//      `{code, hash}` — the refusal code and the first 12 hex characters of the script's
//      sha256 (the prefix the kill list and the allowlist print). Once per (script, code) per
//      tab, at most `RUN_HALF_BEACONS_PER_TAB`, fire-and-forget (never throws, never waits).
//
// ⛔⛔ NO SOURCE, NO SENTENCE, NO MEMBER DATA. The script leaves as a hash prefix and nothing
// else; a refusal's reason (which can quote the script) never leaves the code it carries, and
// the code itself must match `RUN_HALF_CODE_RE` or nothing is sent.
import { runtimeSourceHash } from './runtimeKill'

export const RUN_HALF_BEACON_URL = '/api/pine-runtime-telemetry/run-half'
export const RUN_HALF_BEACONS_PER_TAB = 32
/** A refusal code as the server accepts it: a guard family and a name, no free text. */
export const RUN_HALF_CODE_RE = /^(run-half|pane|runtime|interpret|pine|lower-tf|budget):[A-Za-z0-9_.-]{1,48}$/

const _counts = new Map()     // document session key -> Map(code -> n)
const _last = new Map()       // document session key -> the last code noted (or null after a serve)
const _beaconed = new Set()
const _hashOf = new Map()
let _reporter = null

function hashPrefixOf(source) {
  if (_hashOf.has(source)) return _hashOf.get(source)
  const h = runtimeSourceHash(source).slice(0, 12)
  if (_hashOf.size >= 16) _hashOf.delete(_hashOf.keys().next().value)
  _hashOf.set(source, h)
  return h
}

/** The beacon body for one refusal, or null (no script, or a code outside the pattern).
 *  Exported for its rail. */
export function runHalfBeaconOf(source, code) {
  if (typeof source !== 'string' || !source || typeof code !== 'string' || !RUN_HALF_CODE_RE.test(code)) return null
  return { code, hash: hashPrefixOf(source) }
}

function sendBeacon(body) {
  if (typeof fetch !== 'function' || typeof window === 'undefined') return
  try {
    const sent = fetch(RUN_HALF_BEACON_URL, {
      method: 'POST', keepalive: true, credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (sent && typeof sent.catch === 'function') sent.catch(() => {})
  } catch { /* a lost count, never an error */ }
}

/** ⭐ Note the run half's answer for one document on one bind. `code` null: served or
 *  pending (resets the session's last code, so a later refusal counts again). Never throws. */
export function noteRunHalfAnswer(def, source, code) {
  try {
    const key = `${(def && def.id) || '?'}|${typeof source === 'string' ? hashPrefixOf(source) : '?'}`
    if (code === null || code === undefined) { _last.set(key, null); return }
    if (_last.get(key) === code) return
    _last.set(key, code)
    let m = _counts.get(key)
    if (!m) { m = new Map(); _counts.set(key, m) }
    m.set(code, (m.get(code) || 0) + 1)
    const body = runHalfBeaconOf(source, code)
    if (!body || _beaconed.size >= RUN_HALF_BEACONS_PER_TAB) return
    const once = `${body.hash}|${body.code}`
    if (_beaconed.has(once)) return
    _beaconed.add(once)
    ;(_reporter || sendBeacon)(body)
  } catch { /* telemetry never reaches the chart */ }
}

/** This tab's counts: `{ '<defId>|<hash12>': { '<code>': n } }` (no source). */
export function runHalfRefusalCounts() {
  const out = {}
  for (const [k, m] of _counts) out[k] = Object.fromEntries(m)
  return out
}

/** Test seams. */
export function setRunHalfBeaconReporter(fn) { _reporter = typeof fn === 'function' ? fn : null }
export function resetRunHalfTelemetry() { _counts.clear(); _last.clear(); _beaconed.clear() }
