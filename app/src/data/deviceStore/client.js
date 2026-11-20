// app/src/data/deviceStore/client.js — the page's half of the on-device bar store.
//
//   getBars(sym, tf)  → Promise<{t,o,h,l,c,v, build} | null>   one worker round trip (the leader's read
//                       is a positioned OPFS read + decode: ~0.3 ms for 1,000 bars), deduped per key
//   peekBars(sym, tf) → the same, SYNCHRONOUSLY, from the recently-read cache (LRU, SYNC_CACHE_MAX keys),
//                       or null: a switch to a neighbour the warm already read needs no await at all
//   warm(syms, tf)    → read many into that cache in one round trip (list neighbours)
//   start()           → spawn the worker now and, after the page's first chart paint and at idle, ask
//                       the leader to bring the seed files up to date (one timeframe at a time) and to
//                       follow TODAY's minute frames (live.js / liveFeed.js), reporting this page's
//                       visibility (lib/deskVisibility.isAppVisible) on every change and once a minute
//                       while visible, so the leader's feed pauses when no tab is looked at
//
// ⭐ THE SYNCHRONOUS CACHE EXPIRES (SYNC_CACHE_TTL_MS). Today's bars grow every minute, so a copy read
// a while ago is behind (never WRONG: it holds complete buckets only, live.js); past the TTL `peekBars`
// answers null and the next read asks the worker again. Every copy carries `through`, which the handoff
// checks before painting (prefetch.devicePaints).
//
// Loaded only by source.js's dynamic import, and only when the switch is on; the worker is a separate
// chunk. Nothing here is in first-open bytes. Never throws at a caller: every failure reads as null.

import { afterFirstChartPaint } from '../../lib/barsPackClient'
import { isAppVisible, onDeskHiddenChange } from '../../lib/deskVisibility'
import { SERVED_TFS } from './tfs'

/** Where the first-frame seed's manifest lives (the edge, docs/charts/first-frame-seed-format.md section 2:
 *  `latest.json` names the build and each timeframe's url / bytes / sha256). Overridable per browser. */
export const DEVICE_SEED_MANIFEST = '/api/seed/v1/latest.json'
export const DEVICE_SEED_MANIFEST_KEY = 'uct.deviceStore.manifest'
export const SYNC_CACHE_MAX = 96
export const SYNC_CACHE_TTL_MS = 20_000
export const VISIBLE_HEARTBEAT_MS = 60_000
const SERVED = new Set(SERVED_TFS)

const _whenIdle = (fn) => {
  try { if (typeof requestIdleCallback === 'function') { requestIdleCallback(() => fn(), { timeout: 8000 }); return } } catch { /* fall through */ }
  setTimeout(fn, 3000)
}

/** document visibility + the desktop desk's hidden state, both (lib/deskVisibility). */
function _onVisibilityChange(cb) {
  try { if (typeof document !== 'undefined') document.addEventListener('visibilitychange', cb) } catch { /* none */ }
  try { onDeskHiddenChange(cb) } catch { /* none */ }
}

function _manifestUrl() {
  let u = DEVICE_SEED_MANIFEST
  try { u = localStorage.getItem(DEVICE_SEED_MANIFEST_KEY) || u } catch { /* default */ }
  try { return new URL(u, globalThis.location?.href).href } catch { return u }
}

export function createDeviceClient({
  makeWorker = () => new Worker(new URL('./deviceStore.worker.js', import.meta.url), { type: 'module' }),
  manifestUrl = _manifestUrl,
  afterPaint = afterFirstChartPaint,
  idle = _whenIdle,
  cacheMax = SYNC_CACHE_MAX,
  cacheTtlMs = SYNC_CACHE_TTL_MS,
  now = () => Date.now(),
  visible = isAppVisible,
  onVisibilityChange = _onVisibilityChange,
  setIntervalFn = (fn, ms) => setInterval(fn, ms),
} = {}) {
  let worker = null
  let dead = false
  let nextId = 1
  let ingestAsked = false
  const pending = new Map()      // id → resolve
  const cache = new Map()        // `${tf}|${SYM}` → {cols, at} (LRU: Map order)
  const reads = new Map()        // `${tf}|${SYM}` → in-flight read
  let status = null

  const keyOf = (sym, tf) => `${tf}|${String(sym).toUpperCase()}`

  function _drop(tf) {
    const tfs = tf === 'D' ? ['D', 'W', 'M'] : [tf]
    for (const k of [...cache.keys()]) if (tfs.includes(k.slice(0, k.indexOf('|')))) cache.delete(k)
  }

  function _worker() {
    if (dead) return null
    if (worker) return worker
    try { worker = makeWorker() } catch { dead = true; return null }
    worker.onmessage = (e) => {
      const m = e?.data
      if (!m) return
      if (m.id != null) {
        const r = pending.get(m.id)
        if (r) { pending.delete(m.id); r(m.ok ? (m.res ?? null) : null) }
      } else if (m.type === 'event') {
        if (m.event?.type === 'gen') _drop(String(m.event.tf))
      } else if (m.type === 'status') {
        status = m
      }
    }
    worker.onerror = () => {
      dead = true
      for (const r of pending.values()) r(null)
      pending.clear()
      try { worker.terminate() } catch { /* gone */ }
      worker = null
    }
    return worker
  }

  function _call(msg) {
    const w = _worker()
    if (!w) return Promise.resolve(null)
    const id = nextId++
    return new Promise((resolve) => {
      pending.set(id, resolve)
      try { w.postMessage({ ...msg, id }) } catch { pending.delete(id); resolve(null) }
    })
  }

  function _put(k, cols) {
    cache.delete(k)
    cache.set(k, { cols, at: now() })
    while (cache.size > cacheMax) cache.delete(cache.keys().next().value)
  }

  /** Tell the leader whether this page is looked at (it starts the live feed on the first call). */
  const _report = () => _call({ op: 'live', visible: (() => { try { return visible() !== false } catch { return true } })() })

  const api = {
    start() {
      _worker()
      if (!ingestAsked) {
        ingestAsked = true
        afterPaint(() => idle(() => {
          _call({ op: 'ingest', manifestUrl: manifestUrl() })
          _report()
          try { onVisibilityChange(() => { _report() }) } catch { /* no document */ }
          try { setIntervalFn(() => { try { if (visible() !== false) _report() } catch { /* hidden */ } }, VISIBLE_HEARTBEAT_MS) } catch { /* no timers */ }
        }))
      }
      return api
    },
    peekBars(sym, tf) {
      if (!sym || !SERVED.has(String(tf))) return null
      const k = keyOf(sym, tf)
      const c = cache.get(k)
      if (!c) return null
      if (now() - c.at > cacheTtlMs) { cache.delete(k); return null }
      cache.delete(k)
      cache.set(k, c)
      return c.cols
    },
    getBars(sym, tf) {
      tf = String(tf)
      if (!sym || !SERVED.has(tf)) return Promise.resolve(null)
      const hit = api.peekBars(sym, tf)
      if (hit) return Promise.resolve(hit)
      const k = keyOf(sym, tf)
      const running = reads.get(k)
      if (running) return running
      const p = _call({ op: 'read', sym: String(sym).toUpperCase(), tf }).then((res) => {
        if (res && res.t?.length) { const cols = Object.freeze(res); _put(k, cols); return cols }
        return null
      }).finally(() => { reads.delete(k) })
      reads.set(k, p)
      return p
    },
    async warm(syms, tf) {
      tf = String(tf)
      if (!SERVED.has(tf)) return 0
      const want = [...new Set((syms || []).filter(Boolean).map((s) => String(s).toUpperCase()))].filter((s) => !api.peekBars(s, tf))
      if (!want.length) return 0
      const res = await _call({ op: 'readMany', syms: want, tf })
      let n = 0
      if (Array.isArray(res)) res.forEach((cols, i) => { if (cols && cols.t?.length) { _put(keyOf(want[i], tf), Object.freeze(cols)); n++ } })
      return n
    },
    info() { return _call({ op: 'info' }) },
    status: () => status,
    cacheSize: () => cache.size,
    dispose() {
      for (const r of pending.values()) r(null)
      pending.clear()
      cache.clear()
      try { worker?.terminate() } catch { /* gone */ }
      worker = null
    },
  }
  return api
}

let _default = null
/** The page's one client. */
export function getDeviceClient() {
  if (!_default) _default = createDeviceClient()
  return _default
}
