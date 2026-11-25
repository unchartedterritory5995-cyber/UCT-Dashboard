// ⛔ DIAGNOSTIC ONLY (measure/neighbor-miss-why, never merged, 2026-11-25): WHY a next-row press misses what the
// preparer filed. Every array the PREPARER derives from (in idle time) is fingerprinted (length, first and newest
// bar time, the newest row); every MISS outside idle time is classified against the newest prepared fingerprint of
// the same derivation that shares its first or its newest bar time:
//   same-array-other-sig   the prepared array itself, asked with another signature (a recipe changed)
//   copy                   another array with the same length, first bar and newest row (content-equal)
//   tail-reanswered        same length and first bar, the newest row differs
//   appended+k             same first bar, k more rows
//   prepended+k            same newest bar, k more rows at the start
//   shorter-k / other      anything else
//   not-prepared           no prepared array of that derivation shares either end
// Read with window.__uctDiag() (the flip proof's --peek).
import { useRef } from 'react'

const _ring = []          // { name, fp, ref, sigs:Set }
const RING_MAX = 400
const _why = {}           // `${name}:${reason}` -> count
const _samples = []       // the first misses of each reason, with both fingerprints
const _hits = {}
const _renders = []
const _log = []          // every hit / miss / prepare, timed: {at, k, name, len, t0, tN, reason, plen, pt0}
const LOG_MAX = 30000
function _push(e) { _log.push(e); if (_log.length > LOG_MAX) _log.splice(0, _log.length - LOG_MAX) }
let _inIdle = false
const _WR = typeof globalThis !== 'undefined' ? globalThis.WeakRef : undefined

function timeOf(r) { return r == null ? null : (r.t !== undefined ? r.t : r.time) }
export function fingerprint(a) {
  if (!Array.isArray(a) || !a.length) return null
  const f = a[0]
  const l = a[a.length - 1]
  let last = null
  try { last = JSON.stringify(l).slice(0, 240) } catch { last = String(l) }
  return { len: a.length, t0: timeOf(f), tN: timeOf(l), last }
}
export function diagSetIdle(v) { _inIdle = !!v }
export function diagHit(name, src) {
  _hits[name] = (_hits[name] || 0) + 1
  const fp = fingerprint(src)
  _push({ at: Math.round(performance.now() * 10) / 10, k: _inIdle ? 'hit-idle' : 'hit', name, len: fp && fp.len, t0: fp && fp.t0, tN: fp && fp.tN })
}

/** The preparer derived `name` (signature `sig`) from `src`. */
export function diagPrepared(name, src, sig) {
  const fp = fingerprint(src)
  if (!fp) return
  _push({ at: Math.round(performance.now() * 10) / 10, k: 'prep', name, len: fp.len, t0: fp.t0, tN: fp.tN })
  const prev = _ring.find((x) => x.name === name && x.ref && x.ref.deref && x.ref.deref() === src)
  if (prev) { prev.sigs.add(sig); return }
  _ring.push({ name, fp, ref: _WR ? new _WR(src) : { deref: () => src }, sigs: new Set([sig]) })
  if (_ring.length > RING_MAX) _ring.splice(0, _ring.length - RING_MAX)
}

/** A miss of `name` on `src` (signature `sig`), outside idle time: classify it. */
export function diagMiss(name, src, sig, where = 'derive') {
  if (_inIdle) { diagPrepared(name, src, sig); return }
  const fp = fingerprint(src)
  let reason = 'not-prepared'
  let other = null
  for (let i = _ring.length - 1; i >= 0; i--) {
    const c = _ring[i]
    if (c.name !== name) continue
    const same = c.ref && c.ref.deref && c.ref.deref() === src
    if (same) { reason = 'same-array-other-sig'; other = { fp: c.fp, sigs: [...c.sigs].slice(0, 3), sig }; break }
    if (!fp) continue
    if (c.fp.t0 === fp.t0) {
      other = c.fp
      if (c.fp.len === fp.len) reason = c.fp.last === fp.last ? 'copy' : 'tail-reanswered'
      else if (fp.len > c.fp.len) reason = `appended+${fp.len - c.fp.len > 3 ? '4+' : fp.len - c.fp.len}`
      else reason = 'shorter'
      break
    }
    if (c.fp.tN === fp.tN) { other = c.fp; reason = fp.len > c.fp.len ? 'prepended' : 'other-same-newest'; break }
  }
  _push({ at: Math.round(performance.now() * 10) / 10, k: 'miss', name: `${where}:${name}`, len: fp && fp.len, t0: fp && fp.t0, tN: fp && fp.tN, reason,
    plen: other && other.len, pt0: other && other.t0 })
  const k = `${where}:${name}:${reason}`
  _why[k] = (_why[k] || 0) + 1
  if (_samples.filter((s) => s.k === k).length < 3) _samples.push({ k, at: Math.round(performance.now()), fp, prepared: other })
}

/** Which props changed since this component's last render (diagnostics for the post-frame re-renders). */
export function useWhyRender(name, props) {
  const prev = useRef(null)
  const p = prev.current
  const changed = p ? Object.keys({ ...p, ...props }).filter((k) => p[k] !== props[k]) : ['(mount)']
  _renders.push({ n: name, at: Math.round(performance.now() * 10) / 10, changed: changed.slice(0, 16) })
  if (_renders.length > 4000) _renders.splice(0, _renders.length - 4000)
  prev.current = props
}

if (typeof window !== 'undefined') {
  window.__uctDiagNeighbor = { why: _why, samples: _samples, hits: _hits, renders: _renders, log: _log, ring: () => _ring.length }
}
