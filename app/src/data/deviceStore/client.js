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
// ⭐ PERSISTENT STORAGE, ASKED ONCE. OPFS is best-effort storage: under disk pressure the browser may
// evict the 70+ MB of seed files. Once a seed file is held (the worker's status, or a new generation),
// the page asks `navigator.storage.persist()` ONCE (only a page can; a worker cannot), after checking
// `persisted()`, never awaited by anything: Chrome decides by itself (no prompt), and a browser that
// asks the member does so without holding any work. The answer is in `status().storage`.
//
// ⭐ THE SYNCHRONOUS CACHE EXPIRES (SYNC_CACHE_TTL_MS). Today's bars grow every minute, so a copy read
// a while ago is behind (never WRONG: it holds complete buckets only, live.js); past the TTL `peekBars`
// answers null and the next read asks the worker again. Every copy carries `through`, which the handoff
// checks before painting (prefetch.devicePaints).
//
// ⭐ TWO LANES (2026-11-22, the 70-row jump). Every read is one worker message, and its answer is one task on the
// page that turns the columns into the store's rows. A list scrolled into view asks for ~80 keys at once (the rows
// around the selection and the rows on screen, each on every linked timeframe), and the chart the member then
// clicked waited behind all of them: measured on a D + 30m board, its copy landed 100 to 830 ms after the click
// (18 ms with nothing else asked), the D/W/M hold ran out, and the switch was slower than with the store off.
// A read the worker does not answer within READ_TIMEOUT_MS gives up (null) and frees its place, on either lane.
//   urgent      the member's own ask (a key press, the chart on screen): sent at once, always, and never counted
//   background  everything else (the default): at most BACKGROUND_READS_MAX in the worker at a time, the next
//               one sent when an answer comes back. A key that is still waiting when an urgent ask for it
//               arrives is sent at that moment (both askers get the one answer).
// ⭐ WHICH BACKGROUND READ IS NEXT (review of #2438). The reads asked in one task are one ASK (a list warm, the
// rows around a selection). Asks are served NEWEST FIRST, each in its own order: the rows around the row the
// member just selected are asked after the list warm and must not wait behind all of it, and a list scrolled on
// has left its older windows behind. Past WAITING_READS_MAX waiting, the least wanted read is dropped: the LAST
// one of the OLDEST ask (it answers null, and is read again the moment it is asked for). One ask larger than the
// bound (a screener result list, a watchlist in scan mode: about 1,000 keys) so keeps the rows it asked first,
// the ones on screen; a head drop threw exactly those away.
// ⭐ A WAITING KEY ASKED FOR AGAIN JOINS THE NEWEST ASK (review round 2). Arrowing down a list asks the rows
// ahead on every press, nearest first, and only the new frontier row is new to the queue: left where they were,
// the rows nearest the selection sat in older asks and were served last, the opposite of what a scan needs.
// `asks` holds only asks with a read still waiting (and the one this task is filling), so it stays bounded by
// what is waiting however long the page lives.
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
/** Background reads in the worker at a time (the urgent lane is never counted and never waits). */
export const BACKGROUND_READS_MAX = 2
/** How long a read waits for the worker's answer before it gives up (answers null) and frees its place. A real
 *  read answers in 1 to 20 ms, a cold open of a timeframe in a few hundred; this is for a worker that hangs (its
 *  storage open never settling, a leader tab frozen in the background), which otherwise held every asker of the
 *  key, and with two such reads the whole background lane, for the page's life. Only reads time out: an ingest
 *  downloads for minutes. */
export const READ_TIMEOUT_MS = 8000
/** Background reads that may wait their turn; past it the oldest is dropped (answers null). */
export const WAITING_READS_MAX = 256
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
  storage = (typeof navigator !== 'undefined' && navigator.storage) || null,
  backgroundMax = BACKGROUND_READS_MAX,
  waitingMax = WAITING_READS_MAX,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  readTimeoutMs = READ_TIMEOUT_MS,
} = {}) {
  let worker = null
  let dead = false
  let nextId = 1
  let ingestAsked = false
  const pending = new Map()      // id → resolve
  let readTimeouts = 0           // reads the worker did not answer in time (diagnostics)
  const cache = new Map()        // `${tf}|${SYM}` → {cols, at} (LRU: Map order)
  const reads = new Map()        // `${tf}|${SYM}` → in-flight read
  // background reads not sent yet: one Map per ASK (the reads of one task), oldest ask first; each Map
  // `${tf}|${SYM}` → {send, drop} in the order asked
  const asks = []
  const askOf = new Map()        // `${tf}|${SYM}` → the ask it waits in
  let openAsk = null             // the ask this task's reads join (closed by a timer: the task is over)
  let backgroundOut = 0          // background reads the worker has not answered
  let status = null
  /** navigator.storage persistence: asked at most once per page. */
  const persist = { asked: false, persisted: null, granted: null, error: null }
  function _maybePersist() {
    if (persist.asked || !storage) return
    persist.asked = true
    Promise.resolve()
      .then(() => (typeof storage.persisted === 'function' ? storage.persisted() : null))
      .then((already) => {
        persist.persisted = already === true
        if (already === true || typeof storage.persist !== 'function') return already === true
        return storage.persist()
      })
      .then((granted) => { persist.granted = granted === true; if (granted === true) persist.persisted = true })
      .catch((e) => { persist.error = String(e?.message || e).slice(0, 120) })
  }
  const _holdsSeed = (info) => !!info?.tfs && Object.keys(info.tfs).length > 0

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
        if (m.event?.type === 'gen') { _drop(String(m.event.tf)); _maybePersist() }
      } else if (m.type === 'status') {
        status = m
        if (_holdsSeed(m.info)) _maybePersist()
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

  /** One message to the worker and its answer. `timeoutMs` > 0: unanswered after that long, it resolves null and is
   *  forgotten (an answer that arrives later finds no entry and is ignored). The timer never outlives its answer. */
  function _call(msg, timeoutMs = 0) {
    const w = _worker()
    if (!w) return Promise.resolve(null)
    const id = nextId++
    return new Promise((resolve) => {
      let timer = null
      const done = (v) => { if (timer != null) { clearTimer(timer); timer = null } resolve(v) }
      pending.set(id, done)
      if (timeoutMs > 0) {
        timer = setTimer(() => {
          timer = null
          if (pending.get(id) !== done) return
          pending.delete(id)
          readTimeouts++
          resolve(null)
        }, timeoutMs)
      }
      try { w.postMessage({ ...msg, id }) } catch { pending.delete(id); done(null) }
    })
  }

  /** Take `k` out of the ask it waits in: its {send, drop}, or null when it is not waiting. */
  function _take(k) {
    const ask = askOf.get(k)
    if (!ask) return null
    const w = ask.get(k)
    ask.delete(k)
    askOf.delete(k)
    if (!ask.size && ask !== openAsk) _forget(ask)
    return w
  }

  /** Take an ask with nothing left waiting out of the list (the open one stays until its task is over). */
  function _forget(ask) {
    const i = asks.indexOf(ask)
    if (i >= 0) asks.splice(i, 1)
  }

  /** Put a background read in this task's ask; past the bound, drop the last read of the oldest ask. */
  function _wait(k, w) {
    if (!openAsk) {
      const mine = new Map()
      openAsk = mine
      asks.push(mine)
      setTimer(() => { if (openAsk === mine) openAsk = null; if (!mine.size) _forget(mine) }, 0)
    }
    openAsk.set(k, w)
    askOf.set(k, openAsk)
    if (askOf.size <= waitingMax) return
    for (const ask of asks) {
      if (!ask.size) continue
      let last
      for (const key of ask.keys()) last = key
      _take(last).drop()
      return
    }
  }

  /** Send waiting background reads while the worker holds fewer than `backgroundMax` of them: the newest ask
   *  first, each ask in the order it was asked. */
  function _pump() {
    while (backgroundOut < backgroundMax && askOf.size) {
      let ask = null
      for (let i = asks.length - 1; i >= 0 && !ask; i--) if (asks[i].size) ask = asks[i]   // (the open ask may be empty)
      if (!ask) break
      _take(ask.keys().next().value).send(true)
    }
  }

  /** One read of `k`, on its lane: the worker's answer (columns or null), or null when it was dropped (`st.dropped`). */
  function _read(k, sym, tf, urgent, st) {
    let settle
    const raw = new Promise((resolve) => { settle = resolve })
    const send = (background) => {
      if (background) backgroundOut++
      _call({ op: 'read', sym, tf }, readTimeoutMs).then((res) => {
        if (background) backgroundOut--
        settle(res)
        _pump()
      })
    }
    // a dropped read is forgotten at once, so the key's next ask in this same task is a read of its own
    const drop = () => { st.dropped = true; if (st.p && reads.get(k) === st.p) reads.delete(k); settle(null) }
    if (urgent) send(false)
    else if (backgroundOut < backgroundMax) send(true)
    else _wait(k, { send, drop })
    return raw
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
    /** `urgent`: the member's own ask (see TWO LANES above); anything else takes the background lane.
     *  ⭐ `newerThan` (review of #2558, P4-L2): the `through` of the copy the caller holds and has REFUSED (the store's device
     *  rule: short of its current bucket). A cached copy no newer than that is not the answer: the worker is asked (the
     *  read in flight for the key, if any, is joined, never doubled), on the same lane as any other read. Every read that
     *  does not say keeps the cache exactly as before. */
    getBars(sym, tf, { urgent = false, newerThan = null } = {}) {
      tf = String(tf)
      if (!sym || !SERVED.has(tf)) return Promise.resolve(null)
      const hit = api.peekBars(sym, tf)
      if (hit && !(Number.isFinite(newerThan) && !(hit.through > newerThan))) return Promise.resolve(hit)
      const k = keyOf(sym, tf)
      const running = reads.get(k)
      if (running) {
        // asked for in earnest while it waits its turn: it goes now (already sent: the answer is on its way)
        // ...or, asked for again by a warm, it joins this task's ask: the newest, served first
        const w = _take(k)
        if (w) { if (urgent === true) w.send(false); else _wait(k, w) }
        return running
      }
      const st = { dropped: false, p: null }
      const p = _read(k, String(sym).toUpperCase(), tf, urgent === true, st).then((res) => {
        if (res && res.t?.length) { const cols = Object.freeze(res); _put(k, cols); return cols }
        return null
      }).finally(() => { if (reads.get(k) === p) reads.delete(k) })
      st.p = p
      if (!st.dropped) reads.set(k, p)
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
    /** Diagnostics: this page's requests still unanswered, sent or waiting their turn (a held arrow's backlog). */
    inFlight() { return pending.size + askOf.size },
    /** Diagnostics: the asks held (each with a read still waiting, plus the one this task is filling). */
    asksHeld() { return asks.length },
    /** Diagnostics: reads the worker did not answer within READ_TIMEOUT_MS. */
    readTimeouts() { return readTimeouts },
    /** Diagnostics: the worker's rule behind what getBars answers (engine.why), or null with no engine yet. */
    why(sym, tf) { return sym ? _call({ op: 'why', sym: String(sym).toUpperCase(), tf: String(tf) }) : Promise.resolve(null) },
    status: () => ({ ...(status || {}), storage: { ...persist } }),
    cacheSize: () => cache.size,
    dispose() {
      const left = []
      for (const ask of asks) for (const w of ask.values()) left.push(w)
      asks.length = 0
      askOf.clear()
      openAsk = null
      for (const w of left) w.drop()
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
