// History-lake piece decode OFF THE MAIN THREAD (section 3.3 change 5, 2026-11-28).
//
// Measured on production's build (cold-arch rig, typed Enter on a cold 15m ticker, CPU profile mapped to source): the
// lake pieces a first paint waits on were decoded on the main thread between the key and the frame, 7-9 ms of
// `decodeColumns` + `toFloats` per press, and every deeper piece after the paint took a main-thread task of its own
// (2-27 ms each, smoothness 2b). The decode is pure arithmetic over bytes, so it runs in a worker: the page hands it the
// piece's header and body, the worker answers the same columns (`decodeColumns` then `toFloats`, the very functions the
// page ran), their buffers transferred back. A Float64Array crosses a worker boundary bit for bit, so every bar is the
// bar the page decoded before: the chart draws the same frame.
//
//   const dec = createLakeDecoder()
//   const cols = dec.decode(headerJson, bytes)   // the columns at once (inline), or a Promise of them (worker)
//
// ⛔ A FIRST FRAME NEVER WAITS FOR THE WORKER TO START. Until the worker has said it is ready (its module loaded), a
// decode runs inline, exactly as before; `warm()` starts it early (the source calls it when it asks an index, a round
// trip before any piece). A worker that fails (it cannot start, it errors) is dead for the page: its decodes in flight
// are run inline from the bytes they were given, and every later decode is inline. So a broken worker can cost a
// decode on the main thread, never a bar.
// ⛔ THE BYTES ARE COPIED, NOT TRANSFERRED. A piece's body is shared by every read of its URL in flight
// (source.js `readPiece`); transferring it would detach it under the other readers. The copy is one memcpy of 7-60 KB.
//
// Switch: localStorage `uct.historyLake.decodeWorker` = '0' decodes on the page, as before.
import { PieceError } from './piece'
import { decodePieceColumns } from './decodeCore'

export { decodePieceColumns, decodeReply } from './decodeCore'

export const DECODE_WORKER_OFF_KEY = 'uct.historyLake.decodeWorker'

function workerOff() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(DECODE_WORKER_OFF_KEY) === '0' } catch { return false }
}

/**
 * @param {object} [o]
 * @param {(() => Worker) | null} [o.makeWorker]  null: always inline (no Worker on this platform)
 * @param {() => boolean} [o.disabled]
 */
export function createLakeDecoder({
  makeWorker = typeof Worker === 'function' ? () => new Worker(new URL('./decode.worker.js', import.meta.url), { type: 'module' }) : null,
  disabled = workerOff,
} = {}) {
  let worker = null
  let ready = false
  let dead = !makeWorker
  let nextId = 1
  const pending = new Map()   // id -> { headerJson, body, resolve, reject }
  const stats = { inline: 0, worker: 0, fallback: 0 }

  const settleInline = (p) => {
    stats.fallback += 1
    try { p.resolve(decodePieceColumns(p.headerJson, p.body)) } catch (err) { p.reject(err) }
  }
  function die() {
    dead = true
    ready = false
    const jobs = [...pending.values()]
    pending.clear()
    if (worker) { try { worker.terminate() } catch { /* gone */ } }
    worker = null
    for (const p of jobs) settleInline(p)
  }
  function start() {
    if (dead || worker || disabled()) return
    try { worker = makeWorker() } catch { dead = true; worker = null; return }
    worker.onmessage = (e) => {
      const m = e.data || {}
      if (m.ready) { ready = true; return }
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.ok) p.resolve(m.cols)
      else p.reject(m.piece ? new PieceError(m.message) : new Error(m.message))
    }
    worker.onerror = (ev) => { try { ev?.preventDefault?.() } catch { /* nothing to stop */ } die() }
    worker.onmessageerror = () => die()
  }

  return {
    /** Start the worker now (a decode before it is ready runs inline). */
    warm: start,
    /** The float columns of one piece: an object (decoded inline) or a Promise of one (decoded in the worker). Throws or
     *  rejects PieceError exactly as `decodeColumns` does. */
    decode(headerJson, body) {
      if (!ready || dead || !worker || disabled()) {
        start()
        stats.inline += 1
        return decodePieceColumns(headerJson, body)
      }
      const copy = body instanceof Uint8Array ? body.slice() : new Uint8Array(body)
      return new Promise((resolve, reject) => {
        const id = nextId++
        // (the copy's buffer goes to the worker; an inline fallback re-reads `body`, the caller's)
        const job = { headerJson, body, resolve, reject }
        pending.set(id, job)
        stats.worker += 1
        try {
          worker.postMessage({ id, headerJson, body: copy }, [copy.buffer])
        } catch { pending.delete(id); stats.worker -= 1; settleInline(job) }
      })
    },
    stats: () => ({ ...stats, ready, dead, pending: pending.size }),
  }
}

let _shared = null
/** The page's one decoder (every history source of the page shares its worker). */
export function sharedLakeDecoder() {
  return (_shared ??= createLakeDecoder())
}
