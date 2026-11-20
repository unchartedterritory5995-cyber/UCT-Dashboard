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

const core = createWorkerCore({
  post: (msg, transfer) => self.postMessage(msg, transfer || []),
  locks: (typeof navigator !== 'undefined' && navigator.locks) || null,
  makeChannel: typeof BroadcastChannel === 'function' ? (name) => new BroadcastChannel(name) : null,
  makeIO: opfsIO,
  fetchFn: (...a) => fetch(...a),
  tabId,
})

self.onmessage = (e) => { core.onMessage(e.data) }
