/**
 * deviceStore.worker.js — the on-device bar store's dedicated worker (one per tab; the workers elect
 * ONE leader that owns the OPFS files). All logic is workerCore.js; this file only wires it to the
 * worker's globals. Loaded by client.js, which is itself loaded lazily: none of this is in first-open
 * bytes.
 */
import { createWorkerCore } from './workerCore'
import { opfsIO } from './io'

const tabId = (() => {
  try { if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID() } catch { /* insecure context */ }
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
})()

/** This worker's own code: its chunk's path. The build names the chunk by its content hash (one self-contained file,
 *  `assets/deviceStore.worker-<hash>.js`), so a deploy that changes the engine changes it. The engine's bad-pack record
 *  names it (engine.js M7; review of #2537 head 107dea1ee1, P-5). '' when the worker cannot say. */
const codeId = (() => {
  try { return String(self.location?.pathname || '') } catch { return '' }
})()

const core = createWorkerCore({
  post: (msg, transfer) => self.postMessage(msg, transfer || []),
  locks: (typeof navigator !== 'undefined' && navigator.locks) || null,
  makeChannel: typeof BroadcastChannel === 'function' ? (name) => new BroadcastChannel(name) : null,
  makeIO: opfsIO,
  fetchFn: (...a) => fetch(...a),
  tabId,
  engineOpts: { codeId },
})

self.onmessage = (e) => { core.onMessage(e.data) }
