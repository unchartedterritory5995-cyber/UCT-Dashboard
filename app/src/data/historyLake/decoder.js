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
// ⛔⛔ A PAINT-AWAITED DECODE NEVER WAITS BEHIND ANOTHER LOAD'S PIECES (review of #2954). The worker decodes one job at
// a time, in order; a symbol's deep history is many pieces (2-27 ms each), so a first paint of the NEXT symbol queued
// behind them (the A/B: typed cold p100 465 -> 644 ms). Now:
//   - the page keeps the queue: at most WORKER_IN_FLIGHT jobs are posted to the worker at once, the rest wait here;
//   - a job whose load is given up (its `signal` aborts) while it waits here is dropped, never decoded: it rejects with
//     the abort, as the source's own abort checks do;
//   - a decode something waits on to paint (`urgent`: the source's load passed a `wait` that answers nothing,
//     network.lakeSeed `awaited`) goes to the worker only when nothing is posted or waiting; otherwise it is decoded
//     inline at once, ahead of every background piece.
//
// Switch: localStorage `uct.historyLake.decodeWorker` = '0' decodes on the page, as before.
import { PieceError } from './piece'
import { decodePieceColumns } from './decodeCore'

export { decodePieceColumns, decodeReply } from './decodeCore'

export const DECODE_WORKER_OFF_KEY = 'uct.historyLake.decodeWorker'
/** Jobs posted to the worker at once (the rest wait in the page's queue, where an aborted one is dropped). */
export const WORKER_IN_FLIGHT = 2

const abortError = (signal) => signal?.reason ?? new DOMException('The load was aborted', 'AbortError')

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
  const pending = new Map()   // id -> job, posted to the worker
  const queue = []            // jobs not yet posted (oldest first)
  const stats = { inline: 0, worker: 0, fallback: 0, urgentInline: 0, dropped: 0 }

  const unlisten = (job) => { if (job.signal && job.onAbort) job.signal.removeEventListener('abort', job.onAbort) }

  const settleInline = (p) => {
    unlisten(p)
    if (p.signal?.aborted) { stats.dropped += 1; p.reject(abortError(p.signal)); return }
    stats.fallback += 1
    try { p.resolve(decodePieceColumns(p.headerJson, p.body)) } catch (err) { p.reject(err) }
  }
  function die() {
    dead = true
    ready = false
    const jobs = [...pending.values(), ...queue.splice(0)]
    pending.clear()
    if (worker) { try { worker.terminate() } catch { /* gone */ } }
    worker = null
    for (const p of jobs) settleInline(p)
  }
  function post(job) {
    const id = nextId++
    // (the copy's buffer goes to the worker; an inline fallback re-reads `body`, the caller's)
    const copy = job.body instanceof Uint8Array ? job.body.slice() : new Uint8Array(job.body)
    pending.set(id, job)
    stats.worker += 1
    try {
      worker.postMessage({ id, headerJson: job.headerJson, body: copy }, [copy.buffer])
    } catch { pending.delete(id); stats.worker -= 1; settleInline(job) }
  }
  // (a job whose load became paint-awaited while it waited, `isUrgent()` now true, is posted ahead of the rest)
  function nextJob() {
    const i = queue.findIndex((j) => { try { return !!j.isUrgent?.() } catch { return false } })
    return i > 0 ? queue.splice(i, 1)[0] : queue.shift()
  }
  function pump() {
    while (!dead && worker && pending.size < WORKER_IN_FLIGHT && queue.length) post(nextJob())
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
      unlisten(p)
      if (m.ok) p.resolve(m.cols)
      else p.reject(m.piece ? new PieceError(m.message) : new Error(m.message))
      pump()
    }
    worker.onerror = (ev) => { try { ev?.preventDefault?.() } catch { /* nothing to stop */ } die() }
    worker.onmessageerror = () => die()
  }

  return {
    /** Start the worker now (a decode before it is ready runs inline). */
    warm: start,
    /** The float columns of one piece: an object (decoded inline) or a Promise of one (decoded in the worker). Throws or
     *  rejects PieceError exactly as `decodeColumns` does.
     *  `urgent`: a paint waits on it (inline at once unless the worker is idle); `signal`: a job given up while it waits
     *  in the page's queue is dropped (rejects with the abort, never decoded); `isUrgent()`: true once a paint waits on a
     *  job already queued (network.js marks the load awaited later), which then goes to the worker ahead of the rest. */
    decode(headerJson, body, { urgent = false, signal = null, isUrgent = null } = {}) {
      if (!ready || dead || !worker || disabled()) {
        start()
        stats.inline += 1
        return decodePieceColumns(headerJson, body)
      }
      if (urgent && (pending.size || queue.length)) {
        stats.urgentInline += 1
        return decodePieceColumns(headerJson, body)
      }
      if (signal?.aborted) return Promise.reject(abortError(signal))
      return new Promise((resolve, reject) => {
        const job = { headerJson, body, resolve, reject, signal, onAbort: null, isUrgent }
        if (signal) {
          job.onAbort = () => {
            const i = queue.indexOf(job)
            if (i < 0) return                       // posted already: the source drops its answer
            queue.splice(i, 1)
            stats.dropped += 1
            reject(abortError(signal))
          }
          signal.addEventListener('abort', job.onAbort, { once: true })
        }
        queue.push(job)
        pump()
      })
    },
    stats: () => ({ ...stats, ready, dead, pending: pending.size, queued: queue.length }),
  }
}

let _shared = null
/** The page's one decoder (every history source of the page shares its worker). */
export function sharedLakeDecoder() {
  return (_shared ??= createLakeDecoder())
}
