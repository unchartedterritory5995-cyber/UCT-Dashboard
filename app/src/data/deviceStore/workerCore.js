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
//   {id, op:'ingest', manifestUrl, recheck?} → {id, ok, res: {status}}   (the LEADER ingests, whichever tab asked)
//                                         status: 'started' | 'running' (one ingest at a time) | 'fresh' (a RE-CHECK
//                                         within MANIFEST_RECHECK_MIN_MS of the last manifest ask) | 'no-room' (M5)
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
import { deviceServesTf } from './tfs'

/**
 * ⭐ A LONG-LIVED PAGE RE-CHECKS THE SEED (review of #2537, M2). Each page asks for an ingest when it loads, and while
 * it stays open and visible it asks again every client.RECHECK_MS (30 min) with `recheck: true`. Every tab asks, the
 * leader answers: a RE-CHECK fetches the manifest at most once per this long, whichever tab asked (a page load's own
 * ask always goes, as it always did). The manifest is served `private, max-age=60` by the edge, so asks this far
 * apart never lean on a stale copy; and the leader runs one ingest at a time.
 * ⭐ NO FEED FOR A SEED THE SPLIT GUARD REFUSES (M2). Past its as-of session plus the one a split list vouches for,
 * every read of a held seed answers null; the minute feed would poll for nothing and its overlay grow for nothing.
 * The feed stops then (its overlay cleared), on the next visibility report or ingest, and starts again once a seed
 * that serves lands (engine.serves).
 * ⭐ NO ROOM (M5): while the engine's "no room" marker stands, an ingest asks NOTHING, not even the manifest.
 */
export const MANIFEST_RECHECK_MIN_MS = 25 * 60_000

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
export function createWorkerCore({ post, locks, makeChannel, makeIO, fetchFn, tabId, timeoutMs = 300, setTimer, clearTimer, liveOpts = {}, engineOpts = {},
  now = () => Date.now(), recheckMinMs = MANIFEST_RECHECK_MIN_MS } = {}) {
  let engine = null
  let ready = null
  let made = null            // resolves once the engine exists (a read then waits only for its timeframe's open)
  let ingesting = null
  let lastIngest = null      // the last ingest's per-timeframe outcome (diagnostics: `info`)
  let feed = null            // liveFeed.js, the leader's, created on the first 'live' ask
  let overlay = null         // the feed's overlay (live.js)
  let lastManifestAt = -Infinity   // when this leader last asked the manifest (M2)

  /** Is any seed file held? The feed is useless without one (and a browser whose storage cannot hold
   *  one, e.g. a private window, must not poll for nothing). */
  const _seedHeld = () => !!engine && Object.keys(engine.info().tfs).length > 0
  /** ...and does the held seed still pass the split guard today (engine.serves, M2)? */
  const _seedServes = () => !!engine && engine.serves() === true

  /** M2: a running feed for a seed the split guard now refuses for good stops, and today's overlay is dropped. */
  function _feedCheck() {
    if (!feed?.running() || _seedServes()) return
    try { feed.stop() } catch { /* stopped */ }
    try { overlay?.clear() } catch { /* cleared */ }
  }

  /** The leader's live feed: created once, started only once a seed file is held, after any ingest in
   *  flight (so the overlay knows the seed's symbols); the app's visibility recorded on every ask. */
  function _live(visible) {
    if (!engine) return { status: 'unsupported' }
    if (!feed) {
      const nameOf = (sym) => engine.seedName(sym)
      overlay = createLiveOverlay({ nameOf })
      engine.attachLive(overlay)
      feed = createLiveFeed({ overlay, accept: (sym) => !!nameOf(sym), ...liveOpts })
    }
    feed.visible(!!visible)
    _feedCheck()
    if (!feed.running()) Promise.resolve(ingesting).then(() => { if (_seedServes()) feed.start() }).catch(() => {})
    return { status: feed.running() ? 'running' : (ingesting || _seedServes() ? 'starting' : _seedHeld() ? 'seed-refused' : 'no-seed') }
  }

  function _withBuild(cols, tf) {
    if (!cols) return null
    cols.build = engine.buildOf(tf)
    return cols
  }

  async function _kickIngest(manifestUrl, recheck = false) {
    if (!engine) return { status: 'unsupported' }
    if (ingesting) return { status: 'running' }
    if (recheck && now() - lastManifestAt < recheckMinMs) return { status: 'fresh' }
    const blocked = engine.ingestBlocked()
    if (blocked) { lastIngest = [blocked]; return { status: 'no-room', until: blocked.until } }
    lastManifestAt = now()
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
        else if (feed && !feed.running() && _seedServes()) feed.start()
        _feedCheck()
        return out
      })
      .finally(() => { ingesting = null })
    return { status: 'started' }
  }

  // The leader's handler: this worker's own page and every follower tab come through here.
  async function serve(req) {
    // ⛔ NEVER A TIMEFRAME THE DEVICE DOES NOT SERVE (review of #2549, P2-L2): W / M from the device's D window lack the
    // period in progress and the depth (tfs.SERVED_TFS). The page stopped asking, but this is the LEADER: any tab asks it,
    // a tab still on the previous client (the deploy overlap) included. Its reads answer null, its diagnostics 'tf'.
    if (req && (req.op === 'read' || req.op === 'readMany' || req.op === 'why') && !deviceServesTf(req.tf)) {
      return req.op === 'read' ? null : req.op === 'readMany' ? (req.syms || []).map(() => null) : 'tf'
    }
    // ⭐ (2026-11-21, the cold switch) a READ waits for its own timeframe's open, never for all six (engine.openTf)
    if (req && (req.op === 'read' || req.op === 'readMany')) {
      await made
      if (!engine) return null
      try { await engine.openTf(req.tf) } catch { /* an unreadable timeframe serves nothing */ }
      return req.op === 'read' ? _withBuild(engine.read(req.sym, req.tf), req.tf) : (req.syms || []).map((s) => _withBuild(engine.read(s, req.tf), req.tf))
    }
    await ready
    if (!engine || !req) return null
    switch (req.op) {
      case 'info': return { ...engine.info(), lastIngest, live: feed?.status() ?? null, ingestState: engine.ingestState(), crossTab: xt.stats() }
      case 'ingest': return _kickIngest(req.manifestUrl, req.recheck === true)
      case 'live': return _live(req.visible)
      // diagnostics (data/deviceStore/diag.js): the rule behind what read() answers for (sym, tf)
      case 'why': return engine.why(req.sym, req.tf)
      default: return null
    }
  }

  const xt = createCrossTab({
    locks, makeChannel, tabId, timeoutMs, setTimer, clearTimer, serve,
    onLeader: () => {
      made = (async () => {
        const io = await makeIO()
        if (!io) { post({ type: 'status', role: 'leader', supported: false }); return }
        engine = createDeviceEngine({
          io, fetchFn, ...engineOpts,
          onEvent: (ev) => { xt.broadcast(ev); post({ type: 'event', event: ev }) },
        })
      })()
      ready = (async () => {
        await made
        if (!engine) return
        try { await engine.open() } catch { /* an unreadable store serves nothing until the next ingest */ }
        post({ type: 'status', role: 'leader', supported: true, info: engine.info() })
      })()
      // the cross-tab layer serves every request after this resolves (crossTab leaderReady): the ENGINE, not the
      // whole open, so a read waits only for its own timeframe (serve: engine.openTf) and the rest await `ready`
      return made
    },
    onEvent: (ev) => post({ type: 'event', event: ev }),
  })

  return {
    async onMessage(msg) {
      const { id, op } = msg || {}
      if (id == null) return
      try {
        if (op === 'read' || op === 'readMany' || op === 'info' || op === 'ingest' || op === 'live' || op === 'why') {
          const res = await xt.request({ op, sym: msg.sym, syms: msg.syms, tf: msg.tf, manifestUrl: msg.manifestUrl, visible: msg.visible, recheck: msg.recheck === true })
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
