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
import { MEMBER_DOOR_JOB } from './memberDoorWorkerCore'
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

/** What a member reads when the worker building the script died or could not answer. */
export function doorWorkerFailedAnswer(why) {
  return refusal(`this script is not drawn: the background check of it stopped before it answered (${why}), `
    + 'so nothing is drawn rather than a guess. Reloading the page starts a fresh check.', MEMBER_DOOR_WORKER_GUARD)
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
const defaultFactory = () => new Worker(new URL('./memberDoorWorker.js', import.meta.url), { type: 'module' })

/** A consult the worker sent with its source as a mark (`{job: true}`) gets the job's source back. */
function expandConsults(list, source) {
  return (Array.isArray(list) ? list : []).map((c) => {
    if (!c || c.job !== true) return c
    const { job: _mark, ...rest } = c
    return { ...rest, source }
  })
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
  const offThread = !!factory || browserCanWork()
  const make = factory || defaultFactory
  const entries = new Map()   // key -> { key, args, want, landed, subs: Set, asked }
  let worker = null
  let workerPermitted = null  // the permission the worker last latched (a latch only revokes)
  let running = null          // { entry, id, version, timer }
  let nextId = 1
  let asked = 0
  let idle = null
  const counts = { builds: 0, posted: 0, answered: 0, shared: 0, superseded: 0, stopped: 0, watchdog: 0, died: 0, threw: 0, spawned: 0, relatched: 0 }

  function kill() {
    const w = worker
    worker = null
    workerPermitted = null
    if (!w) return
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

  function onReply(w, reply) {
    const r = running
    if (w !== worker || !r || !reply || reply.id !== r.id) return
    // ⭐ what the build did to the page, done on the page, in order, before anyone reads the answer
    replayRuntimeConsults(expandConsults(reply.consults, r.entry.args.source))
    if (reply.ok === true) {
      counts.answered += 1
      if (reply.warmed === true) warmRuntimeLane()
      finish(r, { built: reply.answer, error: null, consultPending: reply.consultPending === true, offThread: true, ms: reply.ms })
      return
    }
    counts.threw += 1
    finish(r, { built: null, error: { message: (reply.error && reply.error.message) || 'no message' }, consultPending: false, offThread: true })
  }

  function onDeath(w, why) {
    if (w !== worker) return
    const r = running
    kill()
    counts.died += 1
    if (r) finish(r, { built: doorWorkerFailedAnswer(why), error: null, consultPending: false, offThread: true })
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
    return w
  }

  function start(entry) {
    if (running) {
      // ⛔ THE NEWEST FIRST: the running build stops (its script is built again later if still wanted)
      counts.superseded += 1
      stopRunning()
    }
    counts.builds += 1
    const v = entry.want
    if (!offThread) {
      // ⭐ no workers here: the build and the read right after it, on this thread, exactly as before
      let built = null
      let error = null
      try {
        built = memberPaneDefinition(entry.args)
      } catch (err) {
        error = { message: String((err && err.message) || err) }
      }
      land(entry, v, { built, error, consultPending: runtimeConsultPendingOf({ source: entry.args.source }), offThread: false })
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
      finish(r, { built: doorWorkerFailedAnswer('it could not be started'), error: null, consultPending: false, offThread: true })
      return
    }
    try {
      if (!image) throw new Error('no image')
      worker.postMessage({ kind: MEMBER_DOOR_JOB, id: r.id, args: entry.args, image })
      workerPermitted = permitted
    } catch {
      kill()
      counts.died += 1
      finish(r, { built: doorWorkerFailedAnswer('its job could not be sent'), error: null, consultPending: false, offThread: true })
      return
    }
    counts.posted += 1
    r.timer = setTimeout(() => {
      r.timer = null
      if (running !== r) return
      // ⛔ THE WATCHDOG: past the door's deadline and its grace, the worker is stopped and the script refused with
      // the deadline's own answer, by name (`pine:timeout`), as a deadline the worker saw would have refused it
      counts.watchdog += 1
      kill()
      finish(r, { built: doorAnswer({ value: null, tripped: true }, budgetMs), error: null, consultPending: false, offThread: true })
    }, watchdogMs)
  }

  function subscribe(args, onAnswer) {
    const key = memberDoorKeyOf(args)
    if (idle !== null) { clearTimeout(idle); idle = null }
    const v = version()
    let entry = entries.get(key)
    if (!entry) {
      const a = args || {}
      // ⭐ the build's arguments are the KEY's, whoever asked first: the id the door would default to, named
      entry = { key, args: { source: a.source, id: a.id || MEMBER_PANE_DEF_PREFIX, ...(a.name != null ? { name: a.name } : {}) },
        want: v, landed: null, subs: new Set(), asked: 0 }
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
        stopRunning()
        next()
      }
      // ⭐ nobody subscribes now: the idle worker is let go after a while (a member who pastes again respawns it)
      if (!entries.size && !running && worker && idle === null) {
        idle = setTimeout(() => { idle = null; if (!entries.size && !running) kill() }, MEMBER_DOOR_IDLE_MS)
      }
    }
  }

  function dispose() {
    if (idle !== null) { clearTimeout(idle); idle = null }
    stopRunning()
    entries.clear()
  }

  return {
    subscribe,
    dispose,
    stats: () => ({ ...counts, busy: !!running, alive: !!worker, held: entries.size }),
    offThread,
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
