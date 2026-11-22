/**
 * Sends bars-pack shard jobs to a Web Worker, falling back to the main thread when no worker can
 * start (old engine, CSP, a worker that failed once). Modeled on optionsFlow/flowWorkerClient.js.
 *
 * One worker per page, shared by the three packs, created on the first job and terminated after
 * IDLE_TERMINATE_MS with nothing in flight: a pack ingest is a one-time first-visit job, and a
 * parked worker would keep its own IndexedDB connection and heap for the rest of the session.
 *
 * A worker that errors is marked dead for the page; its in-flight jobs re-run on the main thread,
 * so a broken worker can slow the ingest down but never lose a shard.
 */
import { ingestShard } from './barsPackIngest'

export const IDLE_TERMINATE_MS = 30000

export function absoluteUrl(url) {
  try { return new URL(url, globalThis.location?.href).href } catch { return url }
}

export function createPackWorkerClient({
  makeWorker = () => new Worker(new URL('./barsPack.worker.js', import.meta.url), { type: 'module' }),
  runOnMain = (job) => ingestShard(job),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let worker = null
  let dead = false
  let nextId = 1
  let idleTimer = null
  const pending = new Map()

  const terminate = () => {
    if (worker) { try { worker.terminate() } catch { /* already gone */ } }
    worker = null
  }
  // Re-armed after every reply; it terminates only if nothing is in flight when it fires.
  const armIdle = () => {
    if (idleTimer !== null) clearTimer(idleTimer)
    idleTimer = setTimer(() => { idleTimer = null; if (pending.size === 0) terminate() }, IDLE_TERMINATE_MS)
  }

  function getWorker() {
    if (dead) return null
    if (worker) return worker
    try {
      worker = makeWorker()
    } catch {
      dead = true
      return null
    }
    worker.onmessage = (e) => {
      const { id, ...res } = e.data || {}
      const entry = pending.get(id)
      if (!entry) return
      pending.delete(id)
      entry.resolve(res)
      armIdle()
    }
    worker.onerror = () => {
      // A worker that failed once (module resolution, a crash) fails every time: finish its jobs here.
      dead = true
      const jobs = [...pending.values()]
      pending.clear()
      terminate()
      for (const entry of jobs) Promise.resolve(runOnMain(entry.job)).then(entry.resolve, () => entry.resolve({ status: 'import-failed', written: 0, aborted: false }))
    }
    return worker
  }

  /** Run one shard job; resolves `{ status, written, aborted }`, never rejects. */
  function run(rawJob) {
    // A worker resolves a relative URL against its own script URL: make it absolute against the page.
    const job = { ...rawJob, url: absoluteUrl(rawJob.url) }
    const w = getWorker()
    if (!w) return Promise.resolve(runOnMain(job)).catch(() => ({ status: 'import-failed', written: 0, aborted: false }))
    if (idleTimer !== null) { clearTimer(idleTimer); idleTimer = null }
    return new Promise((resolve) => {
      const id = nextId++
      pending.set(id, { job, resolve })
      try {
        w.postMessage({ id, job })
      } catch {
        pending.delete(id)
        Promise.resolve(runOnMain(job)).then(resolve, () => resolve({ status: 'import-failed', written: 0, aborted: false }))
      }
    })
  }

  return { run, isDead: () => dead, hasWorker: () => worker !== null, inFlight: () => pending.size }
}

let _shared = null
/** The page's shared client. In an environment without Worker (tests, very old engines) every job runs here. */
export function packWorkerClient() {
  if (!_shared) {
    _shared = typeof Worker === 'function'
      ? createPackWorkerClient()
      : createPackWorkerClient({ makeWorker: () => { throw new Error('no Worker') } })
  }
  return _shared
}
export function __resetPackWorkerClient() { _shared = null }
