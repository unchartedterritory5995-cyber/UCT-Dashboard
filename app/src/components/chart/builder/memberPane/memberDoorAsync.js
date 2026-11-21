// app/src/components/chart/builder/memberPane/memberDoorAsync.js
//
// ─── ⭐⭐ THE PASTE WORKER (2026-11-20) — THE MEMBER DOOR, BUILT OFF THE MAIN THREAD, ONCE PER SCRIPT ───────
//
// docs/pine/evidence/2026-11-20-paste-worker/EVIDENCE.md. A pasted script's build (`memberPaneDefinition`) is a
// synchronous function of the script and the page's state, and on the scripts the door serves it takes from
// milliseconds to minutes (#2225's census: p50 0.57 s, p90 4.3 s, p99 52 s, max 157 s on the dev PC). Run on
// the page's main thread, every one of those seconds was a frozen tab, and no deadline can shorten a call: it
// can only end one. And a paste built it TWICE there: the member pane (`MemberPane.jsx`) and the editor's
// status panel (`PineEditorStatus.jsx::usePineEditorStatus`) each called the door for the same text.
//
// So the build runs in a Web Worker (`memberDoorWorker.js`), ONCE: this service holds one build per script and
// every consumer that asks for that script while the page's state stands reads its answer.
//
// ⛔ ONE COMPUTATION, NOT A SECOND: the worker runs `memberPaneDefinition` itself, over the page's state
// imaged into it (`memberDoorImage.js`), and its answer is the door's answer (`memberDoorWorkerCore.js`). What
// the build does TO the page (the consults' effects on this tab's runtime lists, warming the runtime lane) is
// done here when the answer lands, in the order the build did it.
//
// ⭐ SHARED, KEYED: a consumer SUBSCRIBES to a script (`{source, id, name}`; `id` defaults as the door defaults
// it, `MEMBER_PANE_DEF_PREFIX`, so `{source}` and `{source, id: MEMBER_PANE_DEF_PREFIX}` are one request, as
// they are one build) and is told its answer, and every newer answer while it stays subscribed. A subscriber
// arriving while the build it needs is running waits for it; one arriving after it landed, in the same state
// (`memberDoorStateVersion`), reads it at once; one arriving in a newer state starts a new build, which every
// subscriber of that script then reads. The answer is held only while someone is subscribed to it.
//
// ⛔ ONE BUILD AT A TIME, THE NEWEST FIRST: a build for another script stops the running one (its worker is
// terminated at once: it cannot be told to stop) and the newer one starts on a fresh worker. A stopped script
// that still has subscribers is built again once the worker is free. Two builds never race to answer anyone.
//
// ⛔ NEVER A SILENT HANG, NEVER A GUESS:
//   · the door's own deadline (#2225, `MEMBER_DOOR_BUDGET_MS`, one window per call) runs INSIDE the worker and
//     refuses a script by name (`pine:timeout`) when it trips;
//   · the WATCHDOG: a worker that has not answered `MEMBER_DOOR_WATCHDOG_GRACE_MS` after that deadline (a walk
//     that never asks the clock) is terminated, and the script refused with the deadline's own answer;
//   · a worker that DIES (an error it did not catch, an answer it could not post or this side cannot read, a
//     worker that would not start) is terminated and the script refused by name (`MEMBER_DOOR_WORKER_GUARD`);
//   · a door that THREW is said to each consumer in its own words, as it always was.
// ⛔ WITHOUT `Worker` (tests, a non-browser host) the build runs here, synchronously, as it always did (still
// once per script and state).
import {
  memberPaneDefinition, doorAnswer, MEMBER_DOOR_BUDGET_MS, MEMBER_PANE_DEF_PREFIX, warmRuntimeLane,
} from './memberPaneDefinition'
import { memberDoorImage, memberDoorStateVersion } from './memberDoorImage'
import { MEMBER_DOOR_JOB, restoreFaithful } from './memberDoorProtocol'
import { replayRuntimeConsults, runtimeConsultPendingOf } from '../../engine/runtimeKill'

/** How long past the door's own deadline a silent worker is given (its bundle load included) before the
 *  watchdog stops it. */
export const MEMBER_DOOR_WATCHDOG_GRACE_MS = 30000

/** The watchdog: the door's deadline plus the grace. */
export const MEMBER_DOOR_WATCHDOG_MS = MEMBER_DOOR_BUDGET_MS + MEMBER_DOOR_WATCHDOG_GRACE_MS

/** How long an idle worker nobody subscribes through is kept before it is let go (its memory), in ms. A member
 *  typing keeps it (every keystroke subscribes again within this); a closed builder frees it. */
export const MEMBER_DOOR_IDLE_MS = 60000

/** The guard a script is refused by when the worker building it died or could not answer. */
export const MEMBER_DOOR_WORKER_GUARD = 'pine:door-worker'
/** The guard a script is refused by on the member pane when the door threw while building it (an engine defect;
 *  the editor's status panel keeps its own wording, `PineEditorStatus.paneFor`). */
export const MEMBER_DOOR_FAILED_GUARD = 'pine:door-failed'

const refusal = (reason, guard) => ({ ok: false, definition: null, reason, guard, rows: [], notes: [] })

/** A refusal the page made because the worker stopped (it died, it could not answer) carries this mark: like the
 *  door's deadline (`memberPaneDefinition.DOOR_TIMED_OUT`), it is a fact about the CHECK, never about the script, so a
 *  reader that must not take a picture away for it (`savedScriptUpgrade`) can tell it from a refusal. */
export const DOOR_WORKER_STOPPED = 'doorWorkerStopped'

/** What a member reads when the worker building the script died or could not answer. */
export function doorWorkerFailedAnswer(why) {
  return {
    ...refusal(`this script is not drawn: the background check of it stopped before it answered (${why}), `
      + 'so nothing is drawn rather than a guess. Reloading the page starts a fresh check.', MEMBER_DOOR_WORKER_GUARD),
    [DOOR_WORKER_STOPPED]: true,
  }
}

/** What a member reads on the member pane when the door threw while building the script. */
export function doorFailedAnswer(message) {
  return refusal(`this script is not drawn: checking it failed inside this engine (${String(message || 'no message')}). `
    + 'That is a fault in this engine, not a mistake in the script.', MEMBER_DOOR_FAILED_GUARD)
}

/** The door arguments a shared request may carry, and the key they are one build under. */
export function memberDoorKeyOf(args) {
  const a = args && typeof args === 'object' ? args : {}
  for (const k of Object.keys(a)) {
    if (k !== 'source' && k !== 'id' && k !== 'name') throw new TypeError(`memberDoorService: \`${k}\` is not a shared door argument`)
  }
  return JSON.stringify([typeof a.source === 'string' ? a.source : null, a.id || MEMBER_PANE_DEF_PREFIX, a.name ?? null])
}

const browserCanWork = () => typeof Worker === 'function' && typeof window !== 'undefined'
/** ⛔ Not under the dev server: there the worker's module graph is the page's (`vite.config.js` resolves the door's
 *  two sheet imports to the pure modules in BUILT worker bundles only, `scripts/memberDoorWorkerPure.mjs`), so it
 *  would load the sheet, its React and its CSS into a worker. A dev page builds on its thread, as before. */
const devServer = () => { try { return import.meta.env.DEV === true } catch { return false } }
const defaultFactory = () => new Worker(new URL('./memberDoorWorker.js', import.meta.url), { type: 'module' })

/** ⭐ A User Timing mark per job event (`uct-worker-job:<kind>:<event>`: post, land, supersede, stop, died,
 *  watchdog), so a trace of a real page shows each job's life on the timeline (how many builds a paste made, and
 *  whether one was stopped). Marks only: nothing reads them, and a host without User Timing has none. */
function mark(kind, event) {
  try { if (typeof performance !== 'undefined' && typeof performance.mark === 'function') performance.mark(`uct-worker-job:${kind}:${event}`) } catch { /* no timeline here */ }
}

/** A consult the worker sent with its source as a mark (`{job: true}`) gets the job's source back. */
function expandConsults(list, source) {
  return (Array.isArray(list) ? list : []).map((c) => {
    if (!c || c.job !== true) return c
    const { job: _mark, ...rest } = c
    return { ...rest, source }
  })
}

/** ⭐ THE HUB — which door build (its key and the page state it was asked in) an answer that crossed is, so the editor
 *  status panel can ask the report's worker for the status of exactly that answer (`inspectAsync.js`). */
const DOOR_REFS = new WeakMap()
/** `{key, version}` of a door answer that crossed from the worker, or null (one made on this page). */
export function doorRefOf(built) {
  return built && typeof built === 'object' ? (DOOR_REFS.get(built) || null) : null
}

/** ⭐ THE CHART DOOR'S JOB, for `createKeyedWorkerService`: what is the door's own in the service below. */
function doorJob(budgetMs) {
  return {
    kind: MEMBER_DOOR_JOB,
    keyOf: memberDoorKeyOf,
    // ⭐ the build's arguments are the KEY's, whoever asked first: the id the door would default to, named
    argsOf: (a) => ({ source: a.source, id: a.id || MEMBER_PANE_DEF_PREFIX, ...(a.name != null ? { name: a.name } : {}) }),
    // ⭐ no workers here: the build and the read right after it, on this thread, exactly as before
    runHere(args) {
      let built = null
      let error = null
      try {
        built = memberPaneDefinition(args)
      } catch (err) {
        error = { message: String((err && err.message) || err) }
      }
      return { built, error, consultPending: runtimeConsultPendingOf({ source: args.source }), offThread: false }
    },
    fromReply(reply, entry, version) {
      if (reply.ok === true) {
        if (reply.warmed === true) warmRuntimeLane()
        // ⭐ THE HUB: what crossed is the build without its `translation`; the status of the full one is the report
        // worker's (`memberDoorWorkerCore.js`), asked for by this build's key and state
        const built = restoreFaithful({ value: reply.answer, hidden: reply.hidden })
        if (built && typeof built === 'object') DOOR_REFS.set(built, { key: entry.key, version })
        return { built, error: null, consultPending: reply.consultPending === true, offThread: true, ms: reply.ms }
      }
      return { built: null, error: { message: (reply.error && reply.error.message) || 'no message' }, consultPending: false, offThread: true }
    },
    failed: (why) => ({ built: doorWorkerFailedAnswer(why), error: null, consultPending: false, offThread: true }),
    // ⛔ THE WATCHDOG'S ANSWER: the deadline's own, by name (`pine:timeout`), as a deadline the worker saw would give
    timedOut: () => ({ built: doorAnswer({ value: null, tripped: true }, budgetMs), error: null, consultPending: false, offThread: true }),
  }
}

/**
 * The member door, shared.
 * @param {object} [opts]
 * @param {(() => Worker)|null} [opts.factory] a worker factory (a rail's stand-in); default: the real worker
 *        where a browser has workers, else none (the build runs on this thread, as before)
 * @param {number} [opts.watchdogMs] how long a build may go unanswered before its worker is stopped
 * @param {number} [opts.budgetMs] the door deadline the watchdog's refusal names
 * @param {() => string} [opts.version] the state a build is made in (`memberDoorStateVersion`)
 * @returns {{subscribe: Function, stats: () => object, dispose: () => void, offThread: boolean}}
 *   `subscribe(args, onAnswer)` -> `release()`. `onAnswer(landed)` gets `{built, error, consultPending,
 *   offThread, ms}`: `built` the door's answer (null when the door threw, `error` then holds `{message}`),
 *   `consultPending` whether a consult the build made left the script "still being checked".
 */
export function createMemberDoorService({ factory = null, watchdogMs = MEMBER_DOOR_WATCHDOG_MS,
  budgetMs = MEMBER_DOOR_BUDGET_MS, version = memberDoorStateVersion } = {}) {
  return createKeyedWorkerService({ job: doorJob(budgetMs), factory, watchdogMs, version })
}

/**
 * ⭐⭐ ONE KEYED, SHARED, OFF-THREAD COMPUTATION PER (ARGS, PAGE STATE): the member door's service, for any job the
 * member door's worker answers (`memberDoorProtocol.js`). `job` names what is the job's own: its message `kind`, its
 * `keyOf(args)` and `argsOf(args)`, how it runs on this thread where there are no workers (`runHere(args)`), what a
 * reply lands as (`fromReply(reply, entry)`), and what a member reads when the worker died (`failed(why, entry)`) or
 * the watchdog stopped it (`timedOut(entry)`). The consults a job made are replayed here, in order, before anyone reads
 * its answer. Each service holds its OWN worker, so two services compute at once.
 */
export function createKeyedWorkerService({ job, factory = null, watchdogMs = MEMBER_DOOR_WATCHDOG_MS,
  version = memberDoorStateVersion, onMessage = null } = {}) {
  const workerListeners = new Set()   // told of every worker this service starts, and when it has none
  const told = (w) => { for (const fn of [...workerListeners]) { try { fn(w) } catch { /* a listener's fault */ } } }
  const offThread = !!factory || (browserCanWork() && !devServer())
  const make = factory || defaultFactory
  const entries = new Map()   // key -> { key, args, want, landed, subs: Set, asked }
  let worker = null
  let workerPermitted = null  // the permission the worker last latched (a latch only revokes)
  let running = null          // { entry, id, version, timer }
  let nextId = 1
  let asked = 0
  let idle = null
  const asks = new Map()      // askId -> { msg, resolve, posted }: messages the worker answers by `askId` (`ask`)
  let nextAskId = 1
  const counts = { builds: 0, posted: 0, answered: 0, shared: 0, superseded: 0, stopped: 0, watchdog: 0, died: 0, threw: 0, spawned: 0, relatched: 0 }

  function kill() {
    const w = worker
    worker = null
    workerPermitted = null
    if (!w) return
    told(null)
    w.onmessage = null
    w.onerror = null
    w.onmessageerror = null
    try { w.terminate() } catch { /* already gone */ }
  }

  function stopRunning() {
    const r = running
    running = null
    if (!r) return null
    if (r.timer !== null) clearTimeout(r.timer)
    kill()
    return r
  }

  /** An entry's answer, to every subscriber it has now. */
  function land(entry, v, landed) {
    if (landed && landed.offThread) mark(job.kind, 'land')
    entry.landed = { ...landed, version: v }
    for (const fn of [...entry.subs]) fn(entry.landed)
  }

  /** The next build the worker owes: the most recently asked-for script whose answer is not of its state. */
  function next() {
    let best = null
    for (const e of entries.values()) {
      if (!e.subs.size || (e.landed && e.landed.version === e.want)) continue
      if (!best || e.asked > best.asked) best = e
    }
    if (best) start(best)
  }

  function finish(r, landed) {
    if (running !== r) return
    running = null
    if (r.timer !== null) clearTimeout(r.timer)
    // the answer is for the state the build was asked in; a subscriber asking in a newer one has asked again
    if (entries.get(r.entry.key) === r.entry) land(r.entry, r.version, landed)
    next()
  }

  /** Every ask not answered yet, to the worker this service has now (once to each worker). */
  function postAsks() {
    if (!worker) return
    for (const a of asks.values()) {
      if (a.posted === worker) continue
      try { worker.postMessage(a.msg); a.posted = worker } catch { /* the next worker is sent it */ }
    }
  }

  /** Nobody subscribes and nothing is owed: the idle worker is let go after a while. */
  function idleLater() {
    if (!entries.size && !running && !asks.size && worker && idle === null) {
      idle = setTimeout(() => { idle = null; if (!entries.size && !running && !asks.size) kill() }, MEMBER_DOOR_IDLE_MS)
    }
  }

  function onReply(w, reply) {
    // ⭐ an answer to an ask (`ask`), by its id
    if (w === worker && reply && reply.type === 'ask-answer') {
      const a = asks.get(reply.askId)
      if (a) { asks.delete(reply.askId); a.resolve(reply); idleLater() }
      return
    }
    // ⭐ a message the worker sends unasked (the hub's status), not a reply to a job
    if (w === worker && reply && typeof reply.type === 'string') { if (onMessage) onMessage(reply); return }
    const r = running
    if (w !== worker || !r || !reply || reply.id !== r.id) return
    // ⭐ what the build did to the page, done on the page, in order, before anyone reads the answer
    replayRuntimeConsults(expandConsults(reply.consults, r.entry.args.source))
    if (reply.ok === true) counts.answered += 1
    else counts.threw += 1
    finish(r, job.fromReply(reply, r.entry, r.version))
  }

  function onDeath(w, why) {
    if (w !== worker) return
    const r = running
    kill()
    counts.died += 1
    mark(job.kind, 'died')
    if (r) finish(r, job.failed(why, r.entry, r.version))
    // ⭐ a question it had not answered is asked of a new worker (nothing else may start one)
    if (asks.size && !worker) spawn()
  }

  function spawn() {
    let w
    try { w = make() } catch { return null }
    if (!w) return null
    counts.spawned += 1
    w.onmessage = (e) => onReply(w, e && e.data)
    w.onerror = (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault()
      onDeath(w, 'it stopped with an error')
    }
    w.onmessageerror = () => onDeath(w, 'its answer could not be read')
    told(w)
    // ⭐ an ask the worker before this one did not answer is asked of this one (it holds the job's state again)
    worker = w
    postAsks()
    return w
  }

  function start(entry) {
    if (running) {
      // ⛔ THE NEWEST FIRST: the running build stops (its script is built again later if still wanted)
      counts.superseded += 1
      mark(job.kind, 'supersede')
      stopRunning()
    }
    counts.builds += 1
    const v = entry.want
    if (!offThread) {
      land(entry, v, job.runHere(entry.args, entry, v))
      return
    }
    const r = { entry, id: nextId++, version: v, timer: null }
    running = r
    let image = null
    try { image = memberDoorImage() } catch { image = null }
    const permitted = !!(image && image.permission && image.permission.permitted === true)
    // ⛔ a worker that latched "not permitted" cannot be told "permitted" (the latch only revokes): a fresh one is
    if (worker && workerPermitted === false && permitted) { counts.relatched += 1; kill() }
    if (!worker) worker = spawn()
    if (!worker) {
      counts.died += 1
    mark(job.kind, 'died')
      finish(r, job.failed('it could not be started', entry, v))
      return
    }
    try {
      if (!image) throw new Error('no image')
      worker.postMessage({ kind: job.kind, id: r.id, key: entry.key, version: v, args: entry.args, image })
      workerPermitted = permitted
    } catch {
      kill()
      counts.died += 1
    mark(job.kind, 'died')
      finish(r, job.failed('its job could not be sent', entry, v))
      return
    }
    counts.posted += 1
    mark(job.kind, 'post')
    r.timer = setTimeout(() => {
      r.timer = null
      if (running !== r) return
      // ⛔ THE WATCHDOG: past the door's deadline and its grace, the worker is stopped and the script refused with
      // the deadline's own answer, by name (`pine:timeout`), as a deadline the worker saw would have refused it
      counts.watchdog += 1
      mark(job.kind, 'watchdog')
      kill()
      finish(r, job.timedOut(r.entry, r.version))
    }, watchdogMs)
  }

  function subscribe(args, onAnswer) {
    const key = job.keyOf(args)
    if (idle !== null) { clearTimeout(idle); idle = null }
    const v = version()
    let entry = entries.get(key)
    if (!entry) {
      entry = { key, args: job.argsOf(args || {}), want: v, landed: null, subs: new Set(), asked: 0 }
      entries.set(key, entry)
    }
    entry.asked = ++asked
    entry.want = v
    const fn = (landed) => onAnswer(landed)
    entry.subs.add(fn)
    if (entry.landed && entry.landed.version === v) {
      counts.shared += 1
      onAnswer(entry.landed)
    } else if (running && running.entry === entry && running.version === v) {
      counts.shared += 1         // the build this subscriber needs is running: it waits for that one
    } else {
      start(entry)
    }
    let released = false
    return function release() {
      if (released) return
      released = true
      entry.subs.delete(fn)
      if (entry.subs.size) return
      // nobody reads this script now: its answer goes, and so does its build (the worker stops computing it)
      if (entries.get(key) === entry) entries.delete(key)
      if (running && running.entry === entry) {
        counts.stopped += 1
        mark(job.kind, 'stop')
        stopRunning()
        next()
      }
      // ⭐ nobody subscribes now: the idle worker is let go after a while (a member who pastes again respawns it)
      idleLater()
    }
  }

  /**
   * ⭐ A question for this service's worker that is not a job (`msg` with a `type`), answered by the worker as
   * `{type: 'ask-answer', askId, ...}`. A worker is started when there is none; a worker that stops before answering
   * (a newer job stopped it, it died) has the question asked of the next one. Resolves with the answer, or with null
   * where there are no workers or one cannot be started.
   */
  function ask(msg) {
    if (!offThread) return Promise.resolve(null)
    return new Promise((resolve) => {
      const askId = nextAskId++
      asks.set(askId, { msg: { ...msg, askId }, resolve, posted: null })
      if (idle !== null) { clearTimeout(idle); idle = null }
      if (!worker) spawn()
      if (!worker) { asks.delete(askId); resolve(null); return }
      postAsks()
    })
  }

  function dispose() {
    if (idle !== null) { clearTimeout(idle); idle = null }
    stopRunning()
    entries.clear()
    for (const a of asks.values()) a.resolve(null)
    asks.clear()
  }

  return {
    subscribe,
    dispose,
    stats: () => ({ ...counts, busy: !!running, alive: !!worker, held: entries.size }),
    offThread,
    keyOf: job.keyOf,
    /** ⭐ THE HUB: `fn(worker | null)` on every worker this service starts, and when it has none; returns the unsubscribe. */
    onWorker(fn) { workerListeners.add(fn); if (worker) fn(worker); return () => workerListeners.delete(fn) },
    ask,
    /** A message for this service's worker that is not a job (the hub's door answers); dropped when there is none. */
    notify(msg, transfer) {
      if (!worker) return false
      try { worker.postMessage(msg, transfer || []); return true } catch { return false }
    },
  }
}

let _service = null
/** The page's member door (one per page, created on first use; nothing is spawned until a build is asked for). */
export function memberDoorService() {
  if (!_service) _service = createMemberDoorService()
  return _service
}

/** ⛔ Rails only: put a service with a stand-in worker in the page's place (`null` restores the default). No member
 *  surface may import it. */
export function __setMemberDoorServiceForTests(service = null) {
  if (_service && _service !== service) _service.dispose()
  _service = service
}
