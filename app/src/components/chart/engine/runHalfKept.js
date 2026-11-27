// app/src/components/chart/engine/runHalfKept.js
//
// ─── ⭐⭐ (Fred RS, 2026-11-27) A RUN HALF'S SERVED DRAWINGS, KEPT FOR THE SAME CHART'S NEXT OPEN ─────────────────────
//
// ⚰️ MEASURED (production-flag bundle of master 3ae19734c4, smoke@ AGL 1D, 12 cold + 12 warm reloads, 2026-11-27):
// Fred RS's line lands in the candles' frame, its RS Rating label 715-2,169 ms after them (cold p50 857 ms, warm
// p50 982 ms). One run is posted per reload, and the label waits for all of it: the runtime lane's main-thread chunk
// is imported after the first paint (~270 ms), then the worker is spawned and evaluates its 1.7 MB chunk and runs the
// script over the listing's bars (~480-690 ms). No ordering of that work lands in the candles' frame: the run needs
// the chart's bars, and those bars ARE the candles.
//
// So the drawings a run half SERVED (both rails held, `nativeRegistry.js::withRunHalf`) are kept, under a fingerprint
// of everything that run and its rails read, and the same chart opened again draws them in the frame its candles
// land in, while the run is still in flight. The run is still asked (its gates and its post are unchanged), and its
// own answer replaces the kept one when it lands: the same inputs, so the same drawings.
//
// ⛔⛔ A KEPT PICTURE IS NEVER A STAND-IN. It is served only when its fingerprint equals this paint's EXACTLY:
//   - the bundle that computed it (the page's own entry chunk: a deploy is another engine, and every kept entry is
//     another fingerprint),
//   - the document (its whole stored form: the run half's script, the host trees, the object program the rail reads),
//   - the member's settings, the chart's bars (every field of every bar), the host columns the column rail compared,
//   - and every plain fact of the context the run and the rails read (the timeframe, the symbol facts, the forming and
//     listing facts, the other-symbol bars, each by every field), walked whole (`ctxDigest`), never a hand-picked list.
// Anything the walk cannot read faithfully (a cycle, a depth past the cap, a value JSON cannot carry) keeps NOTHING,
// and a payload that does not come back from storage byte for byte (`sameDeep`) is not kept either.
// ⛔ A script that reads the wall clock (`timenow`) or keeps realtime state (`varip`) is never kept: its drawings are
// not a function of the fingerprint.
// ⛔ The gates are not cached: a killed, not-graded or switched-off run half is refused before this is asked.
//
// ⛔ THIS MODULE IMPORTS NOTHING (it rides the registry's bundle, which every chart loads).

const STORE_KEY = 'uct.runHalfKept.v1'
/** How many charts' drawings are kept, newest first. */
export const RUN_HALF_KEPT_MAX = 8
/** The largest one encoded entry kept, and the whole store, in UTF-16 code units (localStorage's own measure). */
export const RUN_HALF_KEPT_ENTRY_CAP = 96 * 1024
export const RUN_HALF_KEPT_TOTAL_CAP = 384 * 1024
const MAX_DEPTH = 512   // a document's trees nest deep; past this the walk keeps nothing (never a stack overflow)

const UNKEEPABLE_SOURCE = /\btimenow\b|\bvarip\b/

/** What this tab did (read-only diagnostics, `window.__uctRunHalfKept`): kept, served from a kept answer, missed, and
 *  the last reason a fingerprint could not be read. */
const _stats = { kept: 0, hits: 0, misses: 0, unreadable: 0, lastUnreadable: null, notKept: 0, fingerprints: 0, fpMsMax: 0, fpMsTotal: 0, saves: 0 }
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())
export function runHalfKeptStats() { return { ..._stats } }
try { if (typeof window !== 'undefined') window.__uctRunHalfKept = _stats } catch { /* no window */ }

// ─── the fingerprint ──────────────────────────────────────────────────────────────────────────────────────────────────

const _f64 = new Float64Array(1)
const _u32 = new Uint32Array(_f64.buffer)

/** Two independent 32-bit FNV-style accumulators: a collision needs both, and the length, to agree. */
class Hasher {
  constructor() { this.a = 0x811c9dc5; this.b = 0x9e3779b9; this.n = 0 }
  word(w) {
    this.a = Math.imul(this.a ^ (w >>> 0), 0x01000193) >>> 0
    this.b = Math.imul(this.b ^ (w >>> 0), 0x85ebca6b) >>> 0
    this.b = (this.b ^ (this.b >>> 13)) >>> 0
    this.n += 1
  }
  num(x) {
    // every bit of the double (NaN, -0 and Infinity included): what the run reads is the number itself
    _f64[0] = x
    this.word(_u32[0]); this.word(_u32[1])
  }
  str(s) {
    this.word(0x5354 ^ s.length)
    for (let i = 0; i < s.length; i += 1) this.word(s.charCodeAt(i))
  }
  out() { return `${this.n.toString(36)}.${this.a.toString(36)}.${this.b.toString(36)}` }
}

class Unreadable extends Error {}

// array / object digests memoised per object: a chart's bars and the other-symbol bars are the same arrays paint after
// paint, so each is walked once (a new array is a new walk)
const _memo = new WeakMap()

function digestValue(v, depth, seen) {
  const h = new Hasher()
  feed(h, v, depth, seen)
  return h.out()
}

function feed(h, v, depth, seen) {
  if (depth > MAX_DEPTH) throw new Unreadable('depth')
  if (v === null) { h.word(1); return }
  switch (typeof v) {
    case 'undefined': h.word(2); return
    case 'boolean': h.word(v ? 3 : 4); return
    case 'number': h.word(5); h.num(v); return
    case 'string': h.word(6); h.str(v); return
    case 'bigint': h.word(7); h.str(v.toString()); return
    case 'function': h.word(8); return            // a callback is not a fact (`exchangeOf` is read below, by key)
    case 'symbol': throw new Unreadable('symbol')
    default: break
  }
  if (seen.has(v)) throw new Unreadable('cycle')
  const known = _memo.get(v)
  if (known !== undefined) { h.word(9); h.str(known); return }
  seen.add(v)
  const inner = new Hasher()
  if (Array.isArray(v)) {
    inner.word(10); inner.word(v.length)
    for (let i = 0; i < v.length; i += 1) feed(inner, v[i], depth + 1, seen)
  } else if (ArrayBuffer.isView(v)) {
    inner.word(11); inner.str(Object.prototype.toString.call(v)); inner.word(v.length || 0)
    for (let i = 0; i < (v.length || 0); i += 1) inner.num(Number(v[i]))
  } else if (v instanceof Map) {
    inner.word(12)
    const ents = [...v.entries()].map(([k, x]) => [digestValue(k, depth + 1, seen), x])
    ents.sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0))
    for (const [k, x] of ents) { inner.str(k); feed(inner, x, depth + 1, seen) }
  } else if (v instanceof Set) {
    inner.word(13)
    const ds = [...v].map((x) => digestValue(x, depth + 1, seen)).sort()
    for (const d of ds) inner.str(d)
  } else if (v instanceof Date) {
    inner.word(14); inner.num(v.getTime())
  } else {
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) throw new Unreadable('class instance')
    inner.word(15)
    const keys = Object.keys(v).sort()
    for (const k of keys) { inner.str(k); feed(inner, v[k], depth + 1, seen) }
  }
  seen.delete(v)
  const d = inner.out()
  _memo.set(v, d)
  h.word(9); h.str(d)
}

/** The context's digest: every own field but the pane's name (`hostPane`: which binder asked, not what it asked),
 *  each walked whole, and the store exchange of every other-symbol key (the run reads it through `exchangeOf`). */
function ctxDigest(ctx) {
  const h = new Hasher()
  const keys = Object.keys(ctx || {}).filter((k) => k !== 'hostPane').sort()
  for (const k of keys) { h.str(k); feed(h, ctx[k], 1, new Set()) }
  const sec = ctx && ctx.secondary
  if (sec && typeof sec.keys === 'function' && ctx && typeof ctx.exchangeOf === 'function') {
    const ks = [...sec.keys()].map(String).sort()
    for (const k of ks) {
      let x = null
      try { x = ctx.exchangeOf(k) } catch { throw new Unreadable('exchangeOf') }
      h.str(k); feed(h, x === undefined ? null : x, 1, new Set())
    }
  }
  return h.out()
}

/** The engine that computed it: the page's entry chunk (its hash moves with every chunk it reaches, the runtime
 *  worker's included). 'dev' where no built entry is on the page. */
let _engine = null
function engineId() {
  if (_engine !== null) return _engine
  let id = 'dev'
  try {
    if (typeof document !== 'undefined' && document.querySelectorAll) {
      const src = [...document.querySelectorAll('script[type="module"][src]')].map((s) => s.getAttribute('src'))
        .find((u) => typeof u === 'string' && /\/assets\/index-[^/]+\.js$/.test(u))
      if (src) id = src
    }
  } catch { /* no document */ }
  _engine = id
  return id
}
/** Tests: the engine identity is read again (a "deploy"). */
export function __setRunHalfKeptEngineForTests(id) { _engine = typeof id === 'string' ? id : null }

/**
 * The fingerprint of one run half's answer on one chart, or null when it cannot be read faithfully (then nothing is
 * kept or served). `host`: the host columns the column rail compares (`outputs` keys only).
 */
export function runHalfFingerprint(def, rows, inputs, ctx, host, outputs) {
  const t0 = nowMs()
  try {
    const ro = def && def.compute && def.compute.runtimeObjects
    if (!ro || typeof ro.source !== 'string' || UNKEEPABLE_SOURCE.test(ro.source)) return null
    const h = new Hasher()
    h.str(engineId())
    h.str(digestValue(def, 0, new Set()))
    h.str(digestValue(inputs || {}, 0, new Set()))
    h.str(digestValue(rows || [], 0, new Set()))
    const keys = Object.keys(outputs || {}).sort()
    for (const k of keys) { h.str(k); h.str(digestValue(host ? host[k] : undefined, 0, new Set())) }
    h.str(ctxDigest(ctx))
    const ms = nowMs() - t0
    _stats.fingerprints += 1
    _stats.fpMsTotal += ms
    if (ms > _stats.fpMsMax) _stats.fpMsMax = ms
    return h.out()
  } catch (err) {
    _stats.unreadable += 1
    _stats.lastUnreadable = err instanceof Unreadable ? err.message : String((err && err.message) || err)
    return null
  }
}

// ─── faithful encoding: JSON with the numbers JSON drops spelled out ──────────────────────────────────────────────────

const enc = (_k, v) => {
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return { $n: 'NaN' }
    if (v === Infinity) return { $n: 'Inf' }
    if (v === -Infinity) return { $n: '-Inf' }
    if (Object.is(v, -0)) return { $n: '-0' }
  }
  if (v === undefined) return { $n: 'undef' }
  return v
}
const NUMS = { NaN: NaN, Inf: Infinity, '-Inf': -Infinity, '-0': -0 }
function dec(v) {
  if (Array.isArray(v)) return v.map(dec)
  if (v && typeof v === 'object') {
    const ks = Object.keys(v)
    if (ks.length === 1 && ks[0] === '$n' && typeof v.$n === 'string') {
      if (v.$n === 'undef') return undefined
      if (Object.prototype.hasOwnProperty.call(NUMS, v.$n)) return NUMS[v.$n]
    }
    const o = {}
    for (const k of ks) o[k] = dec(v[k])
    return o
  }
  return v
}

/** Are `a` and `b` the same plain data, leaf for leaf (`Object.is`), with the same own keys? */
export function sameDeep(a, b, depth = 0) {
  if (depth > 64) return false
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) if (!sameDeep(a[i], b[i], depth + 1)) return false
    return true
  }
  const pa = Object.getPrototypeOf(a)
  if ((pa !== Object.prototype && pa !== null) || Object.getPrototypeOf(b) !== pa) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!sameDeep(a[k], b[k], depth + 1)) return false
  }
  return true
}

// ─── the store: memory first, the device's localStorage behind it ─────────────────────────────────────────────────────

let _entries = null          // [{k, p}] newest first, `p` the encoded payload
const _decoded = new Map()   // fingerprint -> decoded payload (this tab)

const storage = () => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

function load() {
  if (_entries) return _entries
  _entries = []
  const ls = storage()
  if (!ls) return _entries
  try {
    const raw = ls.getItem(STORE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && parsed.v === 1 && Array.isArray(parsed.entries)) {
      _entries = parsed.entries.filter((e) => e && typeof e.k === 'string' && typeof e.p === 'string').slice(0, RUN_HALF_KEPT_MAX)
    }
  } catch { _entries = [] }
  return _entries
}

// ⭐ the device's copy is written once the chart is quiet (`SAVE_DELAY_MS`), never per update: a live chart serves a
// new answer on every bar, and each is kept in memory at once
const SAVE_DELAY_MS = 2000
let _saveTimer = null
function save() {
  if (_saveTimer !== null) return
  if (typeof setTimeout !== 'function') { saveNow(); return }
  _saveTimer = setTimeout(() => { _saveTimer = null; saveNow() }, SAVE_DELAY_MS)
}
try {
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', () => { if (_saveTimer !== null) { clearTimeout(_saveTimer); _saveTimer = null; saveNow() } })
  }
} catch { /* no window */ }
/** Tests: write the device's copy now. */
export function __flushRunHalfKeptForTests() { if (_saveTimer !== null) { clearTimeout(_saveTimer); _saveTimer = null } saveNow() }

function saveNow() {
  const ls = storage()
  if (!ls || !_entries) return
  _stats.saves += 1
  let entries = _entries.slice(0, RUN_HALF_KEPT_MAX)
  let total = entries.reduce((n, e) => n + e.p.length + e.k.length, 0)
  while (entries.length && total > RUN_HALF_KEPT_TOTAL_CAP) {
    const gone = entries.pop()
    total -= gone.p.length + gone.k.length
  }
  _entries = entries
  try { ls.setItem(STORE_KEY, JSON.stringify({ v: 1, entries })) } catch { /* full or blocked: memory only */ }
}

/** The drawings kept for `fingerprint`, or null. */
export function keptRunHalfPayload(fingerprint) {
  if (typeof fingerprint !== 'string') return null
  if (_decoded.has(fingerprint)) return _decoded.get(fingerprint)
  const e = load().find((x) => x.k === fingerprint)
  if (!e) { _stats.misses += 1; return null }
  let p = null
  try { p = dec(JSON.parse(e.p)) } catch { p = null }
  if (!p || typeof p !== 'object' || p.status !== 'ok' || !Array.isArray(p.live)) return null
  _decoded.set(fingerprint, p)
  _stats.hits += 1
  return p
}

/** Keep the drawings a run half SERVED under `fingerprint` (newest first). A payload that does not come back from
 *  its encoding as itself, or is over the entry cap, is not kept. Returns whether it was kept. */
export function keepRunHalfPayload(fingerprint, payload) {
  if (typeof fingerprint !== 'string' || !payload || payload.status !== 'ok' || !Array.isArray(payload.live)) return false
  const entries = load()
  const at = entries.findIndex((x) => x.k === fingerprint)
  if (at === 0 && _decoded.has(fingerprint)) return true
  let p
  try { p = JSON.stringify(payload, enc) } catch { return false }
  if (typeof p !== 'string' || p.length > RUN_HALF_KEPT_ENTRY_CAP) { _stats.notKept += 1; return false }
  let back
  try { back = dec(JSON.parse(p)) } catch { _stats.notKept += 1; return false }
  if (!sameDeep(back, payload)) { _stats.notKept += 1; return false }
  if (at >= 0) entries.splice(at, 1)
  entries.unshift({ k: fingerprint, p })
  _decoded.set(fingerprint, back)
  save()
  _stats.kept += 1
  return true
}

/** Tests: forget this tab's memory (the device's storage is left as it is: a "reload"). */
export function __forgetRunHalfKeptMemoryForTests() {
  if (_saveTimer !== null) { clearTimeout(_saveTimer); _saveTimer = null }
  _entries = null; _decoded.clear(); _engine = null
}
