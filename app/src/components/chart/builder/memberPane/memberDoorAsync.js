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
//   · a door that THREW is said to each consumer in its own words, as it always was;
//   · ⭐⭐ (e96) THE SILENCE BOUND: a worker that owes an answer (a job, or an ask) and has sent NOTHING for
//     `MEMBER_DOOR_SILENCE_MS` is dead. A working worker beats at least every `MEMBER_DOOR_HEARTBEAT_MS` from its own
//     counted steps (`memberDoorProtocol.js::BEAT`, `engine/workPulse.js`), so only a hung one goes quiet. It is
//     terminated and replaced, the job refused by name (`MEMBER_DOOR_SILENT_GUARD`, the one sentence
//     `doorSilentSentence`), and every ask it owed answered null: nothing is left spinning. The 25-minute deadline and
//     its watchdog stay the budget for real work, which beats all the way.
// ⛔ WITHOUT `Worker` (tests, a non-browser host) the build runs here, synchronously, as it always did (still
// once per script and state).
import {
  memberPaneDefinition, doorAnswer, MEMBER_DOOR_BUDGET_MS, MEMBER_PANE_DEF_PREFIX, warmRuntimeLane,
} from './memberPaneDefinition'
import { memberDoorImage, memberDoorStateVersion } from './memberDoorImage'
import { MEMBER_DOOR_JOB, restoreFaithful, BEAT } from './memberDoorProtocol'
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

/** ⭐⭐ e96 — THE SILENCE BOUND (coordinator ruling 2026-11-23): how long a worker that owes an answer may send nothing
 *  (no heartbeat, no answer) before it is taken for dead, in ms. Six heartbeats (`MEMBER_DOOR_HEARTBEAT_MS`). It also
 *  covers a fresh worker's bundle load before its first job's first beat, and a stretch of work no step loop counts: the
 *  longest known is one parse of a printed formula (jsep, untickable), ~0.3 s of a ~19 s door call on the synthetic chain
 *  of `doorDeadline.test.js`, depth 17. Both double per line of the chain; IF that 1/60 share holds deeper (not measured
 *  past depth 17), a call that fits the 25-minute deadline stays under this bound. ⛔ Lowering it kills slow scripts
 *  that are working: a ruling, not a tuning. */
export const MEMBER_DOOR_SILENCE_MS = 30000

/** The guard a job is refused by when its worker went silent. */
export const MEMBER_DOOR_SILENT_GUARD = 'pine:door-silent'

/** ⭐ THE ONE SENTENCE a member reads when the background check went silent (the chart door's refusal, the report's
 *  fault, the several-scripts summary's error): every surface says this, and only this. */
export function doorSilentSentence(silenceMs = MEMBER_DOOR_SILENCE_MS) {
  return `The background check of this script stopped responding (nothing from it for ${Math.round(silenceMs / 1000)} seconds), `
    + 'so it was stopped and nothing is guessed in its place; reloading the page starts a fresh check.'
}

/** The chart door's answer when its worker went silent: refused by name, and marked as a fact about the CHECK
 *  (`DOOR_WORKER_STOPPED`), never about the script. */
export function doorWorkerSilentAnswer(silenceMs = MEMBER_DOOR_SILENCE_MS) {
  return { ...refusal(doorSilentSentence(silenceMs), MEMBER_DOOR_SILENT_GUARD), [DOOR_WORKER_STOPPED]: true }
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

/** The page's clock for how long a check has run (`sinceOf`): the wall clock, which a rail's fake timers drive. */
const pageNow = () => Date.now()

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
    // ⛔ e96 — THE SILENCE BOUND'S ANSWER: the worker went quiet while it owed this build (`MEMBER_DOOR_SILENT_GUARD`)
    silent: (entry, version, silenceMs) => ({ built: doorWorkerSilentAnswer(silenceMs), error: null, consultPending: false, offThread: true }),
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
 * @param {number} [opts.silenceMs] how long a worker that owes an answer may send nothing before it is taken for dead
 * @param {number} [opts.budgetMs] the door deadline the watchdog's refusal names
 * @param {() => string} [opts.version] the state a build is made in (`memberDoorStateVersion`)
 * @param {() => number} [opts.now] the page's clock a build's start is read on (`sinceOf`)
 * @returns {{subscribe: Function, stats: () => object, dispose: () => void, offThread: boolean}}
 *   `subscribe(args, onAnswer)` -> `release()`. `onAnswer(landed)` gets `{built, error, consultPending,
 *   offThread, ms}`: `built` the door's answer (null when the door threw, `error` then holds `{message}`),
 *   `consultPending` whether a consult the build made left the script "still being checked".
 */
export function createMemberDoorService({ factory = null, watchdogMs = MEMBER_DOOR_WATCHDOG_MS,
  silenceMs = MEMBER_DOOR_SILENCE_MS, budgetMs = MEMBER_DOOR_BUDGET_MS, version = memberDoorStateVersion, now = pageNow } = {}) {
  return createKeyedWorkerService({ job: doorJob(budgetMs), factory, watchdogMs, silenceMs, version, now })
}

/**
 * ⭐⭐ ONE KEYED, SHARED, OFF-THREAD COMPUTATION PER (ARGS, PAGE STATE): the member door's service, for any job the
 * member door's worker answers (`memberDoorProtocol.js`). `job` names what is the job's own: its message `kind`, its
 * `keyOf(args)` and `argsOf(args)`, how it runs on this thread where there are no workers (`runHere(args)`), what a
 * reply lands as (`fromReply(reply, entry)`), and what a member reads when the worker died (`failed(why, entry)`),
 * went silent (`silent(entry, version, silenceMs)`; default: `failed` with the silence sentence) or the watchdog
 * stopped it (`timedOut(entry)`). The consults a job made are replayed here, in order, before anyone reads its answer.
 * Each service holds its OWN worker, so two services compute at once.
 */
export function createKeyedWorkerService({ job, factory = null, watchdogMs = MEMBER_DOOR_WATCHDOG_MS,
  silenceMs = MEMBER_DOOR_SILENCE_MS, version = memberDoorStateVersion, onMessage = null, now = pageNow } = {}) {
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
  let silence = null          // ⭐ e96: the silence bound's timer, armed while the worker owes an answer (`listen`)
  const counts = { builds: 0, posted: 0, answered: 0, shared: 0, superseded: 0, stopped: 0, watchdog: 0, died: 0, threw: 0, spawned: 0, relatched: 0, silent: 0, beats: 0 }
  const silentOf = typeof job.silent === 'function'
    ? job.silent
    : (entry, v, ms) => job.failed(doorSilentSentence(ms), entry, v)

  // ─── ⭐⭐ e96 — THE SILENCE BOUND ───────────────────────────────────────────────────────────────────────────────
  /** Does the worker owe an answer: a build it is running, or an ask posted to it? */
  function owes() {
    if (!worker) return false
    if (running) return true
    for (const a of asks.values()) if (a.posted === worker) return true
    return false
  }

  /** (Re)starts the silence bound from now while the worker owes an answer; stops it when it owes none. Every word from
   *  the worker (a heartbeat, a status, an answer) calls this, so only a worker that says NOTHING for `silenceMs` trips it. */
  function listen() {
    if (silence !== null) { clearTimeout(silence); silence = null }
    if (!owes()) return
    const w = worker
    silence = setTimeout(() => { silence = null; onSilent(w) }, silenceMs)
  }

  /** ⛔ A WORKER THAT OWED AN ANSWER AND SAID NOTHING FOR `silenceMs` IS DEAD: terminated, the build it owed refused by
   *  name (`silent`), every ask it owed answered null (its caller falls back), and a fresh worker put in its place, so
   *  nothing is left spinning and nothing more is asked of the silent one. */
  function onSilent(w) {
    if (w !== worker || !owes()) return
    counts.silent += 1
    mark(job.kind, 'silent')
    const r = running
    kill()
    for (const [askId, a] of [...asks]) { asks.delete(askId); a.resolve(null) }
    if (r) finish(r, silentOf(r.entry, r.version, silenceMs))
    // ⭐ REPLACED: the next build or ask goes to a fresh worker (`finish` may have started one already)
    if (!worker) spawn()   // (the replacement)
    idleLater()
  }

  function kill() {
    const w = worker
    worker = null
    workerPermitted = null
    if (silence !== null) { clearTimeout(silence); silence = null }
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
    // ⭐ e96: the check of what it wants is over (`sinceOf`); an answer for an older state leaves it running
    if (v === entry.want) entry.since = null
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
    listen()
  }

  /** Nobody subscribes and nothing is owed: the idle worker is let go after a while. */
  function idleLater() {
    if (!entries.size && !running && !asks.size && worker && idle === null) {
      idle = setTimeout(() => { idle = null; if (!entries.size && !running && !asks.size) kill() }, MEMBER_DOOR_IDLE_MS)
    }
  }

  function onReply(w, reply) {
    // (a word from a worker this service has stopped is nobody's)
    if (w !== worker) return
    try {
      answerOf(w, reply)
    } finally {
      // ⭐⭐ e96 — ANY WORD FROM THE WORKER IS A SIGN OF LIFE: the silence bound starts again from now while it still owes
      // an answer (and stops once it owes none)
      if (w === worker) listen()
    }
  }

  function answerOf(w, reply) {
    // ⭐ e96 — a heartbeat (`memberDoorProtocol.js::BEAT`): the worker is working; it says nothing else
    if (reply && reply.type === BEAT) { counts.beats += 1; return }
    // ⭐ an answer to an ask (`ask`), by its id
    if (reply && reply.type === 'ask-answer') {
      const a = asks.get(reply.askId)
      if (a) { asks.delete(reply.askId); a.resolve(reply); idleLater() }
      return
    }
    // ⭐ a message the worker sends unasked (the hub's status), not a reply to a job
    if (reply && typeof reply.type === 'string') { if (onMessage) onMessage(reply); return }
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
    // ⭐ e96: when the check of what this entry wants began (kept through a restart; cleared when it lands, `land`)
    if (entry.since == null) entry.since = now()
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
    // ⭐⭐ e96 — the silence bound runs from the post: the worker's first word (its load, then the job's first beat) is
    // owed within `silenceMs`, and every word after starts it again (`onReply`)
    listen()
  }

  function subscribe(args, onAnswer) {
    const key = job.keyOf(args)
    if (idle !== null) { clearTimeout(idle); idle = null }
    const v = version()
    let entry = entries.get(key)
    if (!entry) {
      entry = { key, args: job.argsOf(args || {}), want: v, landed: null, subs: new Set(), asked: 0, since: null }
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
    if (silence !== null) { clearTimeout(silence); silence = null }
    stopRunning()
    entries.clear()
    for (const a of asks.values()) a.resolve(null)
    asks.clear()
  }

  /** ⭐ e96 — when the check of `key` (a `keyOf` value) that is still owed began, on the page's clock (`now`), or null
   *  (none held, or its answer is of the state it wants). What the "Checking your script... 0:42" line counts from. */
  function sinceOf(key) {
    const e = typeof key === 'string' ? entries.get(key) : null
    if (!e || e.since == null || (e.landed && e.landed.version === e.want)) return null
    return e.since
  }

  return {
    subscribe,
    dispose,
    stats: () => ({ ...counts, busy: !!running, alive: !!worker, held: entries.size, listening: silence !== null }),
    offThread,
    keyOf: job.keyOf,
    sinceOf,
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

/**
 * ⭐ ONE BUILD, ASKED ONCE: the door's answer for `args` through `service` (the page's by default), as a promise of what
 * lands (`{built, error, consultPending, offThread, ms}`); the subscription is released once it has. For a caller that
 * is not a component and needs one answer (Indicator House's copy, inspect-a-bar). A build another subscriber is reading
 * goes on for it (a release stops a build only when its last reader leaves).
 */
export function doorBuildOnce(args, service = memberDoorService()) {
  return new Promise((resolve) => {
    let release = null
    let landed = false
    release = service.subscribe(args, (answer) => {
      if (landed) return
      landed = true
      // (an answer made here, where there are no workers, lands before `subscribe` returns its release)
      Promise.resolve().then(() => { if (release) release() })
      resolve(answer)
    })
  })
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
