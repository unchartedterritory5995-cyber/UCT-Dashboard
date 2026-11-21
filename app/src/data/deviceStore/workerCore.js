// app/src/data/deviceStore/workerCore.js — what the device store's dedicated worker does, without the
// worker: the message protocol with its page, the leader election (crossTab.js) and the leader's engine
// (engine.js). deviceStore.worker.js wires it to `self`, OPFS, Web Locks and BroadcastChannel; tests
// wire several of these "tabs" to fakes sharing one memory disk.
//
// Page → worker, correlated by `id`:
//   {id, op:'read', sym, tf}            → {id, ok, res: {t,o,h,l,c,v, build} | null}   (columns TRANSFERRED)
//   {id, op:'readMany', syms, tf}       → {id, ok, res: [cols | null, ...]}
//   {id, op:'why', sym, tf}             → {id, ok, res: 'ok' | 'seed-only:<rule>' | <rule> | null}  diagnostics
//                                         (engine.why: the rule behind what 'read' answers; null: no engine yet)
//   {id, op:'info'}                     → {id, ok, res: {tfs: {...}} | null}
//   {id, op:'ingest', manifestUrl}      → {id, ok, res: {status}}   (the LEADER ingests, whichever tab asked)
//   {id, op:'live', visible}            → {id, ok, res: {status}}   TODAY's bars (liveFeed.js): the LEADER
//                                         starts the minute-frame feed once (after the seed's ingest when
//                                         one is running), and every call reports the app's visibility
// Worker → page, unsolicited:
//   {type:'status', role, supported, info}      this worker became the leader (and opened the files)
//   {type:'event', event:{type:'gen', tf, build}} a new generation of `tf` was committed (any tab)

import { createDeviceEngine } from './engine'
import { createCrossTab } from './crossTab'
import { createLiveOverlay } from './live'
import { createLiveFeed } from './liveFeed'

/** The transferable buffers of a read answer (each distinct ArrayBuffer once). */
export function transferablesOf(res) {
  const out = new Set()
  const add = (c) => { if (c) for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) if (c[k]?.buffer) out.add(c[k].buffer) }
  if (Array.isArray(res)) res.forEach(add); else if (res && typeof res === 'object' && res.t) add(res)
  return [...out]
}

/**
 * @param {object} o
 * @param {(msg:object, transfer?:ArrayBuffer[]) => void} o.post   to this worker's page
 * @param {object|null} o.locks
 * @param {Function|null} o.makeChannel
 * @param {() => Promise<object|null>} o.makeIO                    io.js interface, or null (unsupported)
 * @param {Function} [o.fetchFn]
 * @param {string} o.tabId
 * @param {object} [o.liveOpts]   extra createLiveFeed options (tests: `load`, `now`, `consumerOpts`)
 * @param {object} [o.engineOpts] extra createDeviceEngine options (tests: `now`)
 */
export function createWorkerCore({ post, locks, makeChannel, makeIO, fetchFn, tabId, timeoutMs = 300, setTimer, clearTimer, liveOpts = {}, engineOpts = {} } = {}) {
  let engine = null
  let ready = null
  let ingesting = null
  let lastIngest = null      // the last ingest's per-timeframe outcome (diagnostics: `info`)
  let feed = null            // liveFeed.js, the leader's, created on the first 'live' ask

  /** Is any seed file held? The feed is useless without one (and a browser whose storage cannot hold
   *  one, e.g. a private window, must not poll for nothing). */
  const _seedHeld = () => !!engine && Object.keys(engine.info().tfs).length > 0

  /** The leader's live feed: created once, started only once a seed file is held, after any ingest in
   *  flight (so the overlay knows the seed's symbols); the app's visibility recorded on every ask. */
  function _live(visible) {
    if (!engine) return { status: 'unsupported' }
    if (!feed) {
      const nameOf = (sym) => engine.seedName(sym)
      const overlay = createLiveOverlay({ nameOf })
      engine.attachLive(overlay)
      feed = createLiveFeed({ overlay, accept: (sym) => !!nameOf(sym), ...liveOpts })
    }
    feed.visible(!!visible)
    if (!feed.running()) Promise.resolve(ingesting).then(() => { if (_seedHeld()) feed.start() }).catch(() => {})
    return { status: feed.running() ? 'running' : (_seedHeld() || ingesting ? 'starting' : 'no-seed') }
  }

  function _withBuild(cols, tf) {
    if (!cols) return null
    cols.build = engine.buildOf(tf)
    return cols
  }

  async function _kickIngest(manifestUrl) {
    if (!engine) return { status: 'unsupported' }
    if (ingesting) return { status: 'running' }
    ingesting = (async () => {
      const r = await fetchFn(manifestUrl, { credentials: 'same-origin', cache: 'no-cache' })
      if (!r.ok) return [{ status: 'error', error: `manifest ${r.status}` }]
      const manifest = await r.json()
      if (!manifest || manifest.v !== 1 || manifest.kind !== 'ffseed' || !manifest.build || !manifest.tfs) return [{ status: 'error', error: 'manifest shape' }]
      return engine.ingestAll(manifest, { base: manifestUrl })
    })().catch((e) => [{ status: 'error', error: String(e?.message || e) }])
      .then((out) => {
        lastIngest = out
        // a new seed may name symbols the overlay dropped while it ran: replay today into it; a feed
        // that was waiting for its first seed starts now
        if (feed?.running() && out.some((r) => r.status === 'ingested')) feed.resync('seed', { force: true })
        else if (feed && !feed.running() && _seedHeld()) feed.start()
        return out
      })
      .finally(() => { ingesting = null })
    return { status: 'started' }
  }

  // The leader's handler: this worker's own page and every follower tab come through here.
  async function serve(req) {
    await ready
    if (!engine || !req) return null
    switch (req.op) {
      case 'read': return _withBuild(engine.read(req.sym, req.tf), req.tf)
      case 'readMany': return (req.syms || []).map((s) => _withBuild(engine.read(s, req.tf), req.tf))
      case 'info': return { ...engine.info(), lastIngest, live: feed?.status() ?? null }
      case 'ingest': return _kickIngest(req.manifestUrl)
      case 'live': return _live(req.visible)
      // diagnostics (data/deviceStore/diag.js): the rule behind what read() answers for (sym, tf)
      case 'why': return engine.why(req.sym, req.tf)
      default: return null
    }
  }

  const xt = createCrossTab({
    locks, makeChannel, tabId, timeoutMs, setTimer, clearTimer, serve,
    onLeader: () => {
      ready = (async () => {
        const io = await makeIO()
        if (!io) { post({ type: 'status', role: 'leader', supported: false }); return }
        engine = createDeviceEngine({
          io, fetchFn, ...engineOpts,
          onEvent: (ev) => { xt.broadcast(ev); post({ type: 'event', event: ev }) },
        })
        try { await engine.open() } catch { /* an unreadable store serves nothing until the next ingest */ }
        post({ type: 'status', role: 'leader', supported: true, info: engine.info() })
      })()
      return ready
    },
    onEvent: (ev) => post({ type: 'event', event: ev }),
  })

  return {
    async onMessage(msg) {
      const { id, op } = msg || {}
      if (id == null) return
      try {
        if (op === 'read' || op === 'readMany' || op === 'info' || op === 'ingest' || op === 'live' || op === 'why') {
          const res = await xt.request({ op, sym: msg.sym, syms: msg.syms, tf: msg.tf, manifestUrl: msg.manifestUrl, visible: msg.visible })
          post({ id, ok: true, res: res ?? null }, transferablesOf(res))
        } else {
          post({ id, ok: false, error: `unknown op ${op}` })
        }
      } catch (e) {
        post({ id, ok: false, error: String(e?.message || e) })
      }
    },
    isLeader: () => xt.isLeader(),
    /** The leader's engine (tests). */
    engine: () => engine,
    whenReady: () => Promise.resolve(ready),
    ingesting: () => ingesting,
    /** The leader's live feed (tests). */
    feed: () => feed,
    close() { xt.close(); try { feed?.stop() } catch { /* gone */ } feed = null; try { engine?.close() } catch { /* gone */ } engine = null },
  }
}
