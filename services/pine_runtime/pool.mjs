// services/pine_runtime/pool.mjs
//
// W5-T7: THE JOB POOL (docs/pine/SERVER-RUNTIME-DESIGN.md 3.1, 3.4, 3.7, section 4 L3/L6/L7).
// `createPool({ bundle })` starts N sandboxed workers (sandbox.mjs) and returns the runner the
// supervisor (server.mjs) calls with a validated request. Each job runs on ONE worker, alone:
//
//   priority   alert > on-demand > backtest > record > sweep (PRIORITY); FIFO inside a profile.
//              A sweep request is many jobs, so an alert submitted behind it runs next.
//   owner cap  at most `ownerCaps[profile]` jobs of one owner (the request's owner HMAC) in flight
//              at once; a capped owner's next job waits and other owners' jobs pass it.
//   depth      at most `queueDepth` queued jobs; a request that does not fit is refused WHOLE
//              (BusyError, 429 runtime:server-busy) and none of its jobs is queued.
//   deadline   a job still queued past its profile's deadline is withheld runtime:server-busy.
//   hard kill  a job still running after `killMs` has its worker terminated: withheld
//              runtime:time-budget (the bundle's own guard). A terminated worker is NEVER reused.
//   heap       every worker runs under `resourceLimits`; an overrun ends the worker:
//              withheld runtime:server-worker-oom. Any other exit while busy: runtime:server-worker-failed.
//   recycle    a worker retires after `recycleJobs` jobs or `recycleMs` of age (checked after each
//              job) and a fresh one takes its place (H6).
//   respawn    (W5-INT) once the pool has started, a REPLACEMENT worker that fails to load the
//              bundle does not break the pool for good: it is retried after `respawnBaseMs`,
//              doubling to `respawnMaxMs`, and `ready()` is FALSE from the first failure until a
//              replacement boots (so /ready answers 503 and every run is refused by name, instead
//              of the pool staying broken in silence). A failure during the FIRST boot still
//              refuses the pool, as before.
//
// ⛔ A hard kill, an OOM and a crash are not deterministic: they are answered as stops, never as
// values, and T8 must never cache them (design 3.3). ⛔ A job is answered exactly once.
import { readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { ROLE_JOB, SANDBOX_URL, scanBundle, selfTestL4 } from './sandbox.mjs'

export const BUSY_GUARD = 'runtime:server-busy'
export const OOM_GUARD = 'runtime:server-worker-oom'
export const WORKER_FAILED_GUARD = 'runtime:server-worker-failed'

/** Highest first. The same five names as protocol.PROFILES (a rail holds the two sets equal). */
export const PRIORITY = Object.freeze(['alert', 'on-demand', 'backtest', 'record', 'sweep'])

export const POOL_DEFAULTS = Object.freeze({
  resourceLimits: Object.freeze({ maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 }),
  killMs: 10_000,
  recycleJobs: 500,
  recycleMs: 30 * 60_000,
  queueDepth: 2000,
  ownerCaps: Object.freeze({ 'on-demand': 4 }),
  // design 3.4 names alert, on-demand, backtest and the sweep chunk; record is given on-demand's
  deadlinesMs: Object.freeze({ alert: 15_000, 'on-demand': 60_000, backtest: 60_000, record: 60_000, sweep: 120_000 }),
  respawnBaseMs: 1000,
  respawnMaxMs: 60_000,
})

export class BusyError extends Error {
  constructor(message) { super(message); this.guard = BUSY_GUARD; this.status = 429 }
}

const stop = (job, guard, sentence) => ({ job, status: 'withheld', refusals: [{ key: '*', guard, sentence, bar: null }] })

/**
 * Start the pool. Resolves once every worker has loaded the bundle behind its preamble; rejects
 * (and stops what it started) when the bundle fails the L1 scan, the L4 self-test (when
 * `requireL4`), or a worker's boot.
 */
export async function createPool({
  bundle, workers = availableParallelism(), requireL4 = false, l4Target = undefined, now = () => Date.now(),
  resourceLimits = POOL_DEFAULTS.resourceLimits, killMs = POOL_DEFAULTS.killMs,
  recycleJobs = POOL_DEFAULTS.recycleJobs, recycleMs = POOL_DEFAULTS.recycleMs,
  queueDepth = POOL_DEFAULTS.queueDepth, ownerCaps = POOL_DEFAULTS.ownerCaps, deadlinesMs = POOL_DEFAULTS.deadlinesMs,
  respawnBaseMs = POOL_DEFAULTS.respawnBaseMs, respawnMaxMs = POOL_DEFAULTS.respawnMaxMs,
} = {}) {
  if (!Number.isSafeInteger(workers) || workers < 1) throw new Error('the pool needs at least one worker')
  const { hits } = scanBundle(readFileSync(bundle, 'utf8'))
  if (hits.length) {
    throw new Error(`the bundle holds ${hits.length} capability token(s) outside the L1 allowlist `
      + `(${hits.slice(0, 5).map((h) => `${h.token} at line ${h.line}`).join('; ')}); the pool refuses to start.`)
  }
  if (requireL4) {
    const r = await selfTestL4({ target: l4Target })
    if (!r.ok) {
      const allowed = Object.entries(r.results).filter(([, v]) => v !== 'threw').map(([k]) => k)
      throw new Error(`the L4 self-test found ${allowed.join(', ')} allowed inside a worker; the pool refuses to start.`)
    }
  }
  const href = pathToFileURL(bundle).href
  const TIME_GUARD = (await import(href)).RUNTIME_TIME_BUDGET_GUARD
  if (typeof TIME_GUARD !== 'string') throw new Error('the bundle exports no RUNTIME_TIME_BUDGET_GUARD; the pool refuses to start.')

  const live = new Set()
  const queues = new Map(PRIORITY.map((p) => [p, []]))
  const inflight = new Map()
  const exits = new Set()
  const stats = { starts: 0, kills: 0, recycles: 0, ooms: 0, crashes: 0, bootFailures: 0 }
  const respawns = new Set()
  let nextId = 0
  let closed = false
  let broken = null
  let started = false
  let failing = 0 // replacement boots failed since the last one that loaded; > 0 = not ready

  const queued = () => { let n = 0; for (const q of queues.values()) n += q.length; return n }
  const ownerKey = (e) => `${e.profile}|${e.owner}`

  // Every caller first takes the job out of where it was (the queue, or `s.busy`), so a job reaches
  // here exactly once; no second guard restates that.
  function finish(e, result) {
    clearTimeout(e.killTimer)
    clearTimeout(e.deadlineTimer)
    if (e.dispatched) inflight.set(ownerKey(e), inflight.get(ownerKey(e)) - 1)
    e.resolve(result)
  }

  function spawn() {
    const w = new Worker(SANDBOX_URL, { workerData: { role: ROLE_JOB, bundle: href }, env: {}, resourceLimits })
    const s = { w, threadId: w.threadId, busy: null, jobs: 0, born: now(), ready: false, gone: false, error: null }
    s.booted = new Promise((ok, no) => { s.bootOk = ok; s.bootNo = no })
    s.booted.catch(() => {})
    live.add(s)
    stats.starts += 1
    exits.add(new Promise((done) => w.once('exit', done)))
    w.on('message', (m) => onMessage(s, m))
    w.on('error', (e) => { s.error = e })
    w.on('exit', () => onExit(s))
    return s
  }

  /** Take a worker out of service for good. It is never handed another job. */
  function retire(s) {
    if (s.gone) return
    s.gone = true
    live.delete(s)
    s.w.terminate()
  }

  function replace() { if (!closed && !broken) spawn() }

  /** W5-INT: a replacement failed to boot after the pool started. Not ready, and retry with backoff. */
  function bootFailed() {
    failing += 1
    stats.bootFailures += 1
    const t = setTimeout(() => { respawns.delete(t); replace() }, Math.min(respawnMaxMs, respawnBaseMs * 2 ** (failing - 1)))
    t.unref()
    respawns.add(t)
  }

  function onMessage(s, m) {
    if (m.type === 'ready') { s.ready = true; failing = 0; s.bootOk(); pump(); return }
    if (m.type === 'boot-error') {
      s.bootNo(new Error(`a worker could not load the bundle (${m.message}); the pool refuses to start.`))
      retire(s)
      if (started) { bootFailed(); return }
      broken = m.message
      drain(WORKER_FAILED_GUARD, 'the runtime pool could not start a worker, so this job has no value.')
      return
    }
    if (m.type !== 'result' || !s.busy || s.busy.id !== m.id) return
    const e = s.busy
    s.busy = null
    s.jobs += 1
    finish(e, m.result)
    if (s.jobs >= recycleJobs || now() - s.born >= recycleMs) {
      stats.recycles += 1
      retire(s)
      replace()
    }
    pump()
  }

  function onExit(s) {
    const wasGone = s.gone
    s.gone = true
    live.delete(s)
    if (!s.ready && !started) {
      broken = broken || 'a worker exited before it loaded the bundle'
      s.bootNo(new Error(`${broken}; the pool refuses to start.`))
    } else if (!s.ready && !wasGone) {
      bootFailed() // W5-INT: replaced through the backoff, not at once
      pump()
      return
    }
    if (s.busy) {
      const e = s.busy
      s.busy = null
      if (s.error && s.error.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        stats.ooms += 1
        finish(e, stop(e.job.job, OOM_GUARD, 'this job ran out of the memory a job is given, so it has no value.'))
      } else {
        stats.crashes += 1
        finish(e, stop(e.job.job, WORKER_FAILED_GUARD, 'the worker running this job stopped, so it has no value.'))
      }
    }
    if (!wasGone) replace()
    pump()
  }

  function hardKill(s) {
    const e = s.busy
    if (!e || s.gone) return
    s.busy = null
    stats.kills += 1
    retire(s)
    finish(e, stop(e.job.job, TIME_GUARD, `this job was still running after ${killMs} ms, the hard stop for one job, `
      + 'so it was stopped and has no value.'))
    replace()
  }

  function take() {
    for (const p of PRIORITY) {
      const q = queues.get(p)
      const cap = Object.hasOwn(ownerCaps, p) ? ownerCaps[p] : Infinity
      for (let i = 0; i < q.length; i += 1) {
        if ((inflight.get(ownerKey(q[i])) || 0) >= cap) continue
        return q.splice(i, 1)[0]
      }
    }
    return null
  }

  function pump() {
    for (const s of live) {
      if (!s.ready || s.busy || s.gone) continue
      const e = take()
      if (!e) return
      e.dispatched = true
      inflight.set(ownerKey(e), (inflight.get(ownerKey(e)) || 0) + 1)
      s.busy = e
      e.killTimer = setTimeout(() => hardKill(s), killMs)
      s.w.postMessage({ id: e.id, doc: e.doc, job: e.job })
    }
  }

  function drain(guard, sentence) {
    for (const q of queues.values()) for (const e of q.splice(0)) finish(e, stop(e.job.job, guard, sentence))
  }

  /** The runner server.mjs calls: one result per job, in order. Throws BusyError when it cannot queue. */
  async function run(request) {
    if (closed || broken) throw new Error('the runtime pool is not running')
    if (queued() + request.jobs.length > queueDepth) {
      throw new BusyError(`the runtime service has ${queued()} jobs waiting and this request brings `
        + `${request.jobs.length} more, past its ${queueDepth}; nothing in it is run.`)
    }
    const { profile, owner } = request
    const doc = request.definition.doc
    const answers = request.jobs.map((job) => new Promise((resolve) => {
      const e = { id: (nextId += 1), profile, owner, doc, job, resolve, dispatched: false }
      e.deadlineTimer = setTimeout(() => {
        // ONE guard: only a job still QUEUED is answered here; a dispatched one answers by its run
        const q = queues.get(profile)
        const i = q.indexOf(e)
        if (i < 0) return
        q.splice(i, 1)
        finish(e, stop(job.job, BUSY_GUARD, `this job waited past the ${deadlinesMs[profile]} ms a ${profile} job may wait, so it was not run.`))
      }, deadlinesMs[profile])
      e.deadlineTimer.unref()
      queues.get(profile).push(e)
    }))
    pump()
    return Promise.all(answers)
  }

  async function close() {
    closed = true
    for (const t of respawns) clearTimeout(t)
    respawns.clear()
    drain(WORKER_FAILED_GUARD, 'the runtime pool stopped, so this job has no value.')
    for (const s of [...live]) retire(s)
    await Promise.all(exits)
  }

  for (let i = 0; i < workers; i += 1) spawn()
  try {
    await Promise.all([...live].map((s) => s.booted))
  } catch (e) {
    await close()
    throw e
  }
  started = true
  return {
    run,
    close,
    size: workers,
    ready: () => !closed && !broken && failing === 0 && [...live].some((s) => s.ready),
    stats: () => ({ ...stats, queued: queued(), live: live.size, respawnPending: respawns.size }),
    threadIds: () => [...live].map((s) => s.threadId),
    limits: () => [...live].map((s) => s.w.resourceLimits),
  }
}
