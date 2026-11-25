// app/src/testing/builder/memberDoor.testkit.js
//
// ⭐ THE PASTE WORKER's rails share these (2026-11-20): a canonical text of a door answer, and a stand-in for the
// member door's Web Worker that runs the REAL handler (`memberDoorWorkerCore.answerMemberDoorJob`) over a
// structured clone of the real message, in whatever module graph the rail hands it (a FRESH one, so the only
// page state it holds is the image the job carries, as in a real worker).

/** A canonical text of a value: key ORDER kept (it is part of the bytes), functions skipped (they never cross a
 *  worker boundary), a class instance as its own enumerable fields (an error with its name and message first),
 *  Map/Set/undefined/NaN/-0 tagged, and a second visit of one object as a back-reference, so shared identity is
 *  compared too. Two answers with one canonical text are one answer to every reader. */
export function canonOf(value, { hidden = false } = {}) {
  const seen = new Map()
  const out = []
  const key = (k, v) => { out.push(JSON.stringify(k), ':'); walk(v); out.push(',') }
  function walk(v) {
    if (v === undefined) { out.push('u'); return }
    if (v === null) { out.push('n'); return }
    const t = typeof v
    if (t === 'function') { out.push('f'); return }
    if (t === 'number') { out.push(Object.is(v, -0) ? 'z' : (Number.isNaN(v) ? 'N' : `#${v}`)); return }
    if (t === 'string') { out.push(JSON.stringify(v)); return }
    if (t === 'boolean' || t === 'bigint') { out.push(String(v)); return }
    if (t === 'symbol') { out.push('S'); return }
    if (seen.has(v)) { out.push(`@${seen.get(v)}`); return }
    seen.set(v, seen.size)
    if (Array.isArray(v)) {
      out.push('[')
      for (const x of v) { if (typeof x === 'function') out.push('u'); else walk(x); out.push(',') }
      if (hidden) {
        for (const k of Object.getOwnPropertyNames(v)) {
          if (Object.prototype.propertyIsEnumerable.call(v, k) || k === 'length') continue
          if (typeof v[k] !== 'function') key(`~${k}`, v[k])
        }
      }
      out.push(']')
      return
    }
    if (v instanceof Map) { out.push('M{'); for (const [k, x] of v) { if (typeof x !== 'function') { walk(k); out.push(':'); walk(x); out.push(',') } } out.push('}'); return }
    if (v instanceof Set) { out.push('S{'); for (const x of v) { if (typeof x !== 'function') { walk(x); out.push(',') } } out.push('}'); return }
    if (v instanceof Date) { out.push(`D${v.getTime()}`); return }
    if (v instanceof RegExp) { out.push(`R${String(v)}`); return }
    out.push('{')
    const ks = Object.keys(v)
    if (v instanceof Error) {
      key('name', v.name)
      key('message', v.message)
    }
    for (const k of ks) {
      if (v instanceof Error && (k === 'name' || k === 'message')) continue
      if (typeof v[k] !== 'function') key(k, v[k])
    }
    // ⭐ `hidden`: every non-enumerable own property too (marked `~`), so a faithful crossing is compared with what
    // the synchronous call returned field for field (`memberDoorProtocol.js`)
    if (hidden && !(v instanceof Error)) {
      for (const k of Object.getOwnPropertyNames(v)) {
        if (Object.prototype.propertyIsEnumerable.call(v, k) || (Array.isArray(v) && k === 'length')) continue
        if (typeof v[k] !== 'function') key(`~${k}`, v[k])
      }
    }
    out.push('}')
  }
  walk(value)
  return out.join('')
}

/**
 * A stand-in Worker. `core` is a `memberDoorWorkerCore` module (from the graph the rail chose). `mode`:
 *   'answer' (default) answers each job one microtask later; 'hold' keeps every job until `release()`;
 *   'hang' never answers; 'die' fires `onerror` instead of answering; 'garble' fires `onmessageerror`.
 * Every job it was posted is in `jobs`; `terminated` says whether it was stopped.
 * `answerBy`: 'microtask' (default, as every rail had it) or 'macrotask' — every message it delivers (an answer, a
 * page message to the handler, the hub's unasked post) one TIMER later, as a real Worker's messages are. ⭐ A rail
 * whose code under test could re-post on each answer uses 'macrotask': a microtask stand-in turns such a rebuild loop
 * into an endless microtask chain that starves every timer, so the test's own timeout can never fire (e96: mutant S9
 * hung memberDoorService.test.js until the CI job's 30-minute limit).
 */
export class FakeDoorWorker {
  constructor(core, { mode = 'answer', onPost = null, answerBy = 'microtask' } = {}) {
    this.core = core
    this.mode = mode
    this.onPost = onPost
    if (answerBy !== 'microtask' && answerBy !== 'macrotask') throw new Error(`FakeDoorWorker: answerBy ${answerBy}`)
    this.later = answerBy === 'macrotask' ? (fn) => { setTimeout(fn, 0) } : (fn) => { Promise.resolve().then(fn) }
    this.jobs = []
    this.held = []
    this.terminated = false
    this.onmessage = null
    this.onerror = null
    this.onmessageerror = null
    // ⭐ THE HUB: what this worker's handler sends the page unasked (a status), one microtask later, cloned
    if (typeof core.setPagePost === 'function') {
      core.setPagePost((m) => {
        const data = structuredClone(m)
        this.later(() => { if (!this.terminated && this.onmessage) this.onmessage({ data }) })
      })
    }
  }

  /** Runs `fn` as this worker's own work (a counting stand-in marks it). */
  inWorker(fn) { return fn() }

  postMessage(msg, transfer) {
    if (this.terminated) return
    // ⭐ THE HUB: the page's channel to the other worker (its port handed to the handler, every message it delivers run
    // as this worker's work), and a door answer the page made (handed to the handler one microtask later)
    if (msg && msg.kind === 'peer') {
      const port = transfer && transfer[0]
      if (port && typeof this.core.setPeer === 'function') {
        const worker = this
        const wrapped = {
          postMessage: (m) => port.postMessage(m),
          close: () => { if (port.close) port.close() },
          set onmessage(h) { port.onmessage = h ? (e) => worker.inWorker(() => h(e)) : null },
        }
        this.inWorker(() => this.core.setPeer(wrapped, msg.role))
      }
      return
    }
    if (msg && typeof msg.type === 'string') {
      const data = structuredClone(msg)
      this.later(() => { if (!this.terminated) this.inWorker(() => this.core.acceptPageMessage(data)) })
      return
    }
    const job = structuredClone(msg)
    this.jobs.push(job)
    if (this.onPost) this.onPost(job, this)
    if (this.mode === 'hang') return
    if (this.mode === 'hold') { this.held.push(job); return }
    this.later(() => this.answer(job))
  }

  answer(job) {
    if (this.terminated) return
    if (this.mode === 'die') { if (this.onerror) this.onerror({ message: 'boom', preventDefault() {} }); return }
    if (this.mode === 'garble') { if (this.onmessageerror) this.onmessageerror({}); return }
    const answer = this.core.answerJobOfKind || this.core.answerMemberDoorJob
    const reply = structuredClone(answer(job))
    if (!this.terminated && this.onmessage) this.onmessage({ data: reply })
  }

  /** 'hold': answer every held job now. */
  release() {
    const jobs = this.held.splice(0)
    for (const j of jobs) this.answer(j)
  }

  terminate() { this.terminated = true }
}

/** A worker factory that records every worker it made (`made`), each a `FakeDoorWorker` over `core`. */
export function fakeDoorWorkers(core, opts = {}) {
  const made = []
  const factory = () => {
    const w = new FakeDoorWorker(core, typeof opts === 'function' ? opts(made.length) : opts)
    made.push(w)
    return w
  }
  return { factory, made }
}

/**
 * ⭐ THE WORKER'S OWN MODULE GRAPH, for a rail's stand-in worker: a FRESH graph (`vi.resetModules()`) in which the
 * imports `vite.config.js` resolves differently inside a worker bundle (`scripts/memberDoorWorkerPure.mjs`) resolve as
 * they do there (each component a pure function was taken through is the pure module), then the worker's handler
 * (`memberDoorWorkerCore.js`). So a stand-in answers from the graph the real worker has, registrations and all, not
 * from the page's. `vi` is the calling rail's; returns the handler module.
 */
export async function importWorkerCore(vi) {
  const path = await import('node:path')
  const fs = await import('node:fs')
  const { WORKER_PURE_RESOLUTIONS } = await import('../../../scripts/memberDoorWorkerPure.mjs')
  const app = path.resolve(__dirname, '../../..')
  const file = (base) => [base, `${base}.js`, `${base}.jsx`].find((x) => fs.existsSync(x) && fs.statSync(x).isFile())
  vi.resetModules()
  for (const [importer, table] of Object.entries(WORKER_PURE_RESOLUTIONS)) {
    for (const [spec, to] of Object.entries(table)) {
      const dir = path.dirname(path.join(app, importer))
      const target = file(path.resolve(dir, to))
      vi.doMock(file(path.resolve(dir, spec)), () => import(target))
    }
  }
  return import('../../components/chart/builder/memberPane/memberDoorWorkerCore.js')
}

/** ⭐ A stand-in MessageChannel for the hub (`inspectAsync.__setHubChannelForTests`): two linked ports, each message
 *  structured-cloned and delivered one microtask later (a real channel delivers on the event loop, which a rail's fake
 *  timers would hold). */
export function fakeChannel() {
  const make = () => ({ onmessage: null, other: null, closed: false,
    postMessage(m) { const data = structuredClone(m); const to = this.other; Promise.resolve().then(() => { if (!to.closed && to.onmessage) to.onmessage({ data }) }) },
    close() { this.closed = true } })
  const port1 = make()
  const port2 = make()
  port1.other = port2
  port2.other = port1
  return { port1, port2 }
}
