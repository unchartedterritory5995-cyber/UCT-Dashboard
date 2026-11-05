// A STAND-IN SERVER BUNDLE for the W5-T7 pool and sandbox rails. It exports what the job adapter
// reads, and its `computeRuntimeColumns` does what `def.compute.source` names, including what a
// real bundle never may (hang, exhaust the heap, exit the thread): it plays an escaped VM, so the
// rails can prove the pool's hard stops. It holds no import and no L1 token, so it passes the
// pool's bundle scan like the real bundle does.
export const RUNTIME_PANE_TIME_BUDGET_MS = 1000
export const RUNTIME_INCREMENTAL_KEY = '__runtimeIncremental'
export const RUNTIME_OBJECTS_KEY = '__runtimeObjects'
export const RUNTIME_FAILED_GUARD = 'runtime:failed'
export const RUNTIME_TIME_BUDGET_GUARD = 'runtime:time-budget'

// What a script could reach, read when this module is EVALUATED (the preamble must already have run).
const NAMES = ['fetch', 'Request', 'Response', 'Headers', 'FormData', 'WebSocket', 'EventSource', 'XMLHttpRequest',
  'CloseEvent', 'MessageEvent', 'WebAssembly', 'navigator', 'Navigator', 'crypto', 'Crypto', 'CryptoKey',
  'SubtleCrypto', 'BroadcastChannel', 'MessageChannel', 'MessagePort', 'setTimeout', 'setInterval', 'setImmediate',
  'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'require', ['mod', 'ule'].join(''), 'importScripts']
const PROC_NAMES = ['binding', '_linkedBinding', 'dlopen', 'kill', '_kill', 'getBuiltinModule']
const proc = () => globalThis['process']
const reach = () => {
  const out = {}
  for (const k of NAMES) out[k] = k in globalThis ? 0 : 1
  for (const k of PROC_NAMES) out[`proc:${k}`] = k in proc() ? 0 : 1
  return out
}
const AT_EVAL = reach()

let sessions = 0
let ledgers = 0
export function resetRuntimeSessions() { sessions = 0 }
export function resetRuntimeLedgers() { ledgers = 0 }
// W5-T7b: the real bundle's reader (runtimeObjects.js::runtimeWarmupOf) reads the same key
export const RUNTIME_WARMUP_KEY = '__runtimeWarmup'
export function runtimeWarmupOf(cols) {
  const w = cols && typeof cols === 'object' ? cols[RUNTIME_WARMUP_KEY] : null
  return w && typeof w === 'object' ? w : null
}

// W5-INT: the job adapter writes column bytes with the bundle's T3 encoder. A STAND-IN of that
// encoder's contract (Array / Float64Array of numbers or na, canonical NaN, -0 kept); the real one is
// the bundle's runtime/columnDigest.js, which job.test.mjs runs against.
export function encodeColumn(col) {
  if (!Array.isArray(col) && !(col instanceof Float64Array)) throw new Error('not a column')
  const f = new Float64Array(col.length)
  const out = new Uint8Array(f.buffer)
  for (let i = 0; i < col.length; i += 1) {
    const x = col[i]
    if (x !== null && x !== undefined && typeof x !== 'number') throw new Error('not a number')
    if (x === null || x === undefined || x !== x) { out[i * 8 + 6] = 0xf8; out[i * 8 + 7] = 0x7f } else f[i] = x
  }
  return out
}
export function bytesToB64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s) }

const fill = (n, x) => Array.from({ length: n }, () => x)
const cold = (cols) => Object.defineProperty(cols, RUNTIME_INCREMENTAL_KEY, { enumerable: false, value: { resumedFrom: null } })

export function computeRuntimeColumns(def, rows, ctx, opts) {
  const src = String(def.compute.source)
  const n = rows.length
  sessions += 1
  ledgers += 1
  if (src === 'echo') return cold({ value: rows.map((r) => r.c), opts: fill(n, Object.keys(opts).length) })
  if (src === 'count') return cold({ sessions: fill(n, sessions), ledgers: fill(n, ledgers) })
  if (src.startsWith('sleep:')) {
    const start = Date.now()
    while (Date.now() - start < Number(src.slice(6))) { /* busy: one job holds its worker */ }
    return cold({ start: fill(n, start), end: fill(n, Date.now()) })
  }
  if (src === 'hang') for (;;) { /* never returns */ }
  if (src === 'oom') { const keep = []; for (;;) keep.push(new Array(1e5).fill(Math.random())) }
  if (src === 'exit') proc().exit(3)
  if (src === 'probe') {
    const now = reach()
    const cols = {}
    for (const k of Object.keys(now)) cols[k] = fill(n, AT_EVAL[k] && now[k] ? 1 : 0)
    cols.frozen = fill(n, Object.isFrozen(globalThis) ? 1 : 0)
    cols.env = fill(n, Object.keys(proc().env).length)
    return cold(cols)
  }
  if (src.startsWith('warmup:')) {
    const cols = cold({ value: rows.map((r) => r.c) })
    return Object.defineProperty(cols, RUNTIME_WARMUP_KEY, { enumerable: false, value: { withheldBars: JSON.parse(src.slice(7)), shift: 2 } })
  }
  if (src === 'resumed') return Object.defineProperty({ value: fill(n, 1) }, RUNTIME_INCREMENTAL_KEY, { enumerable: false, value: { resumedFrom: 3 } })
  throw Object.assign(new Error(`the fake bundle has no behaviour ${src}`), { guard: 'runtime:fake' })
}
