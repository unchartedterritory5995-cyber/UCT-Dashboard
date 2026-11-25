// app/src/components/chart/builder/memberPane/memberDoorWorkerCore.js
//
// ─── ⭐⭐ THE PASTE WORKER (2026-11-20) — WHAT THE MEMBER DOOR'S WORKER DOES WITH ONE JOB ────────────────
//
// docs/pine/evidence/2026-11-20-paste-worker/EVIDENCE.md. A pasted script's build (`memberPaneDefinition`, the
// door) ran on the page's main thread and held a member's tab for seconds to minutes on scripts the door
// serves (#2225's census: p90 4.3 s, p99 52 s, max 157 s). This is the same function, in a worker:
//
//   1. hold the page's state the door reads (`memberDoorImage.js`, the image the job carries);
//   2. run `memberPaneDefinition(args)`, unchanged, under its own deadline (#2225: one window per call);
//   3. answer with the door's answer as plain data (`plainAnswerOf`), the consults the build made of the
//      runtime lists (the page makes them again, for their effects on the page:
//      `runtimeKill.replayRuntimeConsults`), whether it asked for the runtime lane to be warmed (the page warms
//      it), and whether a consult it made left the script "still being checked" (`MemberPane`'s first-paste
//      rule reads that right after the build).
//
// ⛔ ONE COMPUTATION, NOT A SECOND: nothing here decides anything the door decides. ⛔ A PURE HANDLER,
// importable anywhere: the worker entry (`memberDoorWorker.js`) is the only module that touches `self`, so a
// rail runs this exact code over a structured clone of the exact message, in a fresh module graph.
import { memberPaneDefinition, runtimeLaneWarmAsks } from './memberPaneDefinition.js'
import { applyMemberDoorImage } from './memberDoorImage.js'
import { recordRuntimeConsults, runtimeConsultPendingOf } from '../../engine/runtimeKill.js'
import { inspectSource, inspectPine } from '../inspectSource.js'
import { inspectLibrary } from '../libraryIntake.js'
import { editorStatus } from '../editorStatus.js'
import { reportForPage, stampsForCrossing } from '../inspectView.js'
import { MEMBER_DOOR_JOB, INSPECT_JOB, INSPECT_LIBRARY_JOB, restoreFaithful, plainAnswerOf, faithfulAnswerOf, BEAT, MEMBER_DOOR_HEARTBEAT_MS } from './memberDoorProtocol.js'
import { setWorkPulse, restartWorkPulse } from '../../engine/workPulse.js'

export { MEMBER_DOOR_JOB, INSPECT_JOB, INSPECT_LIBRARY_JOB, plainAnswerOf, faithfulAnswerOf }
// ⛔⛔ THE REGISTRATIONS A CHART PAGE MAKES WHEN IT LOADS ARE MADE HERE TOO. On the page the door's graph is
// BuilderSheet's (the binder registers the run half's object rail, `runHalfObjectRail.js`, and with it the host lane's
// `runtime.error` stop, `runtimeErrorStop.js`); in the worker `vite.config.js` resolves the door's sheet imports to the
// pure modules, so nothing else would make them, and an answer computed without them is not the page's. Here, in the
// handler, so a rail's stand-in worker (this module in a fresh graph) holds them as the real worker does. The worker
// graph holds every load-time registration of the page's door graph that is not a page's own (streams, preferences,
// drawings): `memberDoorWorkerGraph.test.js`, with a control.
import '../../engine/runHalfObjectRail.js'

/** A consult's source, when it is the job's own script, crosses as a mark (`{job: true}`): a door consults
 *  about its own script several times, and the page holds that text already. */
function compactConsults(log, source) {
  return log.map((c) => {
    if (c.source === undefined || c.source !== source) return c
    const { source: _own, ...rest } = c
    return { ...rest, job: true }
  })
}

const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

// ─── ⭐⭐ THE HUB: THE CHART DOOR'S ANSWER AND PASTEBOX'S REPORT MEET IN THE REPORT'S WORKER ─────────────────────
//
// What crosses to the page is what the page reads (measured, #2254: a heavy script's door answer was 47.8 MB and its
// report 62.5 MB of structured clone, 0.8-1.2 s to receive on the page). The door's `translation` and the report's trees
// are read only by the editor status panel's status (`editorStatus`), so the status is made HERE, where the full report
// lives, from the full door answer the door's worker sends over a MessageChannel the page set up between the two
// (`setPeer`), and only the status (a few KB) crosses to the page. The door's worker keeps its last full answer and
// sends it again to a new port (a respawned report worker starts empty). A refusal the page made itself (a worker
// that died, the watchdog) reaches this worker as a message from the page (`acceptDoorAnswer`).
let PEER = null
let PEER_ROLE = null
let PAGE_POST = null
let LAST_DOOR = null
const REPORTS = new Map()      // report key -> { source, report, savedRow }
const DOORS = new Map()        // source -> { key, version, answer }
const KEEP = 3
const keep = (map, key, value) => {
  map.delete(key)
  map.set(key, value)
  while (map.size > KEEP) map.delete(map.keys().next().value)
}

// ─── ⭐⭐ e96 — THE HEARTBEAT: A WORKING WORKER SAYS SO (`memberDoorProtocol.js::BEAT`) ─────────────────────────────
// A job holds this worker's thread from its start to its answer, so the page hears nothing in between unless the work
// itself speaks. It does: `engine/workPulse.js` is driven by the work's own counted steps (the translator's step budget,
// the door window's walks, the VM's bars) and calls `beat` at most once per `MEMBER_DOOR_HEARTBEAT_MS` of this worker's
// clock; a job also beats once as it starts. The page treats a worker that owes an answer and has said nothing for
// `MEMBER_DOOR_SILENCE_MS` as dead (`memberDoorAsync.js`), so a slow check is never stopped and a hung one is.
let JOB = null                 // the job being answered: { id, t0 }
let PULSE_CLOCK = clock

function beat(t) {
  if (!PAGE_POST) return
  PAGE_POST({ type: BEAT, id: JOB ? JOB.id : null, ms: JOB ? Math.max(0, t - JOB.t0) : null })
}

/** How this worker speaks to the page unasked (the entry sets it: `self.postMessage`), and with it the heartbeat:
 *  `opts.clock` / `opts.everyMs` are a rail's (default: this worker's clock, every `MEMBER_DOOR_HEARTBEAT_MS`). */
export function setPagePost(fn, { clock: pulseClock = clock, everyMs = MEMBER_DOOR_HEARTBEAT_MS } = {}) {
  PAGE_POST = typeof fn === 'function' ? fn : null
  PULSE_CLOCK = typeof pulseClock === 'function' ? pulseClock : clock
  setWorkPulse(PAGE_POST ? beat : null, { everyMs, clock: PULSE_CLOCK })
}

/** The other worker's port (the page's MessageChannel), and which side this worker is. The door's side sends its last
 *  answer again; the report's side listens. */
export function setPeer(port, role) {
  if (PEER && PEER !== port) { try { PEER.onmessage = null; PEER.close() } catch { /* gone */ } }
  PEER = port || null
  PEER_ROLE = role || null
  if (!PEER) return
  if (PEER_ROLE === 'inspect') PEER.onmessage = (e) => acceptDoorAnswer(e && e.data)
  if (PEER_ROLE === 'door' && LAST_DOOR) { try { PEER.postMessage(LAST_DOOR) } catch { /* a closed port */ } }
}

/** The status of a report and (when one has landed) the chart door's answer for its text, as it crosses. */
function statusOf(entry, door) {
  const value = editorStatus({ report: entry.report, pane: door ? door.answer : null, savedRow: entry.savedRow ?? null,
    inspectedSource: entry.source })
  const crossing = faithfulAnswerOf(value)
  return { doorKey: door ? door.key : null, doorVersion: door ? door.version : null,
    answer: crossing.value, hidden: crossing.hidden, lost: crossing.lost }
}

/** A chart door answer for `source` (from the door's worker over the port, or one the page made): kept, and the
 *  status of every kept report of that text made and sent to the page. */
export function acceptDoorAnswer(msg) {
  const m = msg && typeof msg === 'object' ? msg : null
  if (!m || m.type !== 'door-answer' || typeof m.source !== 'string') return
  const door = { key: m.key, version: m.version, answer: restoreFaithful({ value: m.answer, hidden: m.hidden }) }
  keep(DOORS, m.source, door)
  if (!PAGE_POST) return
  for (const [reportKey, entry] of REPORTS) {
    if (entry.source !== m.source) continue
    try { PAGE_POST({ type: 'status', reportKey, ...statusOf(entry, door) }) } catch { /* the page is gone */ }
  }
}

/** The answer the page reads of a door build: the build without its `translation` (the status's, made here). Every
 *  other own property is kept as it is, its descriptor included. */
export function doorForPage(built) {
  if (!built || typeof built !== 'object') return built
  const light = {}
  for (const k of Reflect.ownKeys(built)) {
    if (k === 'translation') continue
    Object.defineProperty(light, k, Object.getOwnPropertyDescriptor(built, k))
  }
  return light
}

/**
 * Answer one job.
 * @param {{kind: string, id: number, args: object, image: object}} msg
 * @returns {{id: number, ok: true, answer: object, consults: object[], warmed: boolean,
 *            consultPending: boolean, ms: number} | {id: number, ok: false, error: {name, message},
 *            consults: object[], ms: number}}
 */
export function answerMemberDoorJob(msg) {
  const m = msg || {}
  const t0 = clock()
  const args = m.args && typeof m.args === 'object' ? m.args : {}
  const source = typeof args.source === 'string' ? args.source : undefined
  const log = []
  try {
    applyMemberDoorImage(m.image)
    const warm0 = runtimeLaneWarmAsks()
    recordRuntimeConsults(log)
    let built
    try {
      built = memberPaneDefinition(args)
    } finally {
      recordRuntimeConsults(null)
    }
    // ⭐ THE HUB: the full answer to the report's worker (its status is made there); the page gets the rest
    const full = faithfulAnswerOf(built)
    LAST_DOOR = { type: 'door-answer', key: m.key ?? null, version: m.version ?? null, source: source ?? null,
      answer: full.value, hidden: full.hidden }
    if (PEER && PEER_ROLE === 'door' && source !== undefined) {
      try { PEER.postMessage(LAST_DOOR) } catch { /* a closed port: the next one is sent the same answer */ }
    }
    const crossing = faithfulAnswerOf(doorForPage(built))
    return {
      id: m.id,
      key: m.key ?? null,
      version: m.version ?? null,
      ok: true,
      answer: crossing.value,
      hidden: crossing.hidden,
      lost: crossing.lost,
      consults: compactConsults(log, source),
      warmed: runtimeLaneWarmAsks() > warm0,
      consultPending: source !== undefined && runtimeConsultPendingOf({ source }),
      ms: clock() - t0,
    }
  } catch (err) {
    // ⛔ THE DOOR THREW (a defect of this engine, never the script's): said, never swallowed. Each consumer
    // words it as it always did (`memberDoorAsync.js`).
    return {
      id: m.id, ok: false,
      error: { name: (err && err.name) || 'Error', message: String((err && err.message) || err) },
      consults: compactConsults(log, source),
      ms: clock() - t0,
    }
  }
}

/** A job's answer, faithfully, over the page's state: `compute(args)` with the runtime lists' consult log open.
 *  `forPage(value)`: what of it crosses (default: all of it). */
function answerJob(m, compute, forPage = (v) => v) {   // forPage(value, args)
  const t0 = clock()
  const args = m.args && typeof m.args === 'object' ? m.args : {}
  const source = typeof args.source === 'string' ? args.source : undefined
  const log = []
  try {
    applyMemberDoorImage(m.image)
    recordRuntimeConsults(log)
    let value
    try {
      value = compute(args)
    } finally {
      recordRuntimeConsults(null)
    }
    const crossing = faithfulAnswerOf(forPage(value, args))
    return { id: m.id, ok: true, answer: crossing.value, hidden: crossing.hidden, lost: crossing.lost,
      consults: compactConsults(log, source), ms: clock() - t0 }
  } catch (err) {
    return { id: m.id, ok: false, error: { name: (err && err.name) || 'Error', message: String((err && err.message) || err) },
      consults: compactConsults(log, source), ms: clock() - t0 }
  }
}

/**
 * ⭐ PASTEBOX'S REPORT OF ONE TEXT, off the page's main thread: exactly what PasteBox asks of it
 * (`dialect` absent -> `inspectPine(source, opts)`, else `inspectSource(source, dialect, opts)`).
 * @param {{kind: string, id: number, args: {source: string, dialect?: string, opts?: object}, image: object}} msg
 */
export function answerInspectJob(msg) {
  const m = msg || {}
  let kept = null
  // ⭐ THE LIGHT REPORT: the page is sent what PasteBox reads (`inspectView.reportForPage`); the trees and the object
  // program stay here, with the full report (the status's, and the program a Use asks for: `answerObjectsAsk`)
  const reply = answerJob(m, (a) => {
    const report = a.dialect === undefined || a.dialect === null
      ? inspectPine(a.source, a.opts == null ? undefined : a.opts)
      : inspectSource(a.source, a.dialect, a.opts == null ? undefined : a.opts)
    kept = { source: a.source, report, savedRow: a.savedRow ?? null }
    return report
  }, (report, a) => stampsForCrossing(reportForPage(report), a.source))
  if (!reply.ok || !kept || m.key == null) return reply
  // ⭐ THE HUB: the full report stays here; the page is sent the status of it alone and, when the chart door's answer
  // for this text has come, with it
  keep(REPORTS, m.key, kept)
  const statuses = []
  try {
    statuses.push(statusOf(kept, null))
    const door = DOORS.get(kept.source)
    if (door) statuses.push(statusOf(kept, door))
  } catch (err) {
    statuses.push({ doorKey: null, doorVersion: null, error: { message: String((err && err.message) || err) } })
  }
  return { ...reply, key: m.key, version: m.version ?? null, statuses }
}

/** ⭐ The report of a paste holding several scripts (`libraryIntake.inspectLibrary`), off the main thread. */
export function answerInspectLibraryJob(msg) {
  return answerJob(msg || {}, (a) => inspectLibrary(a.scripts))
}

/**
 * ⭐ THE OBJECT PROGRAM OF A REPORT, asked for when the member presses Use (`inspectAsync.askHeldObjects`): from the
 * report this worker kept; when it has gone (this worker was started after the report landed: a newer text stopped
 * the one before it), the report is made again here from the page's arguments and image, never on the page.
 * Answered to the page as `{type: 'ask-answer', askId, ok, answer, hidden, remade}`.
 */
export function answerObjectsAsk(msg) {
  const m = msg && typeof msg === 'object' ? msg : {}
  let entry = typeof m.reportKey === 'string' ? REPORTS.get(m.reportKey) : null
  let remade = false
  if (!entry && m.args && typeof m.args === 'object') {
    const again = answerInspectJob({ kind: INSPECT_JOB, id: -1, key: m.reportKey, version: null, args: m.args, image: m.image })
    remade = again.ok === true
    entry = REPORTS.get(m.reportKey) || null
  }
  let reply
  if (!entry) {
    reply = { type: 'ask-answer', askId: m.askId, ok: false, remade }
  } else {
    const crossing = faithfulAnswerOf(entry.report && entry.report.objects ? entry.report.objects : null)
    reply = { type: 'ask-answer', askId: m.askId, ok: true, answer: crossing.value, hidden: crossing.hidden, lost: crossing.lost, remade }
  }
  if (PAGE_POST) { try { PAGE_POST(reply) } catch { /* the page is gone */ } }
  return reply
}

/** A message from the page that is not a job (`{type}`): a door answer the page made, or a Use's ask. */
export function acceptPageMessage(msg) {
  const type = msg && typeof msg === 'object' ? msg.type : null
  if (type === 'door-answer') return acceptDoorAnswer(msg)
  if (type === 'objects-ask') return answerObjectsAsk(msg)
  return undefined
}

/** One job, by its kind (`memberDoorProtocol.js`). ⭐ e96: the job beats once as it starts (the page hears that this
 *  worker took it), then from its own steps (`beat`), each beat naming the job. */
export function answerJobOfKind(msg) {
  const kind = msg && msg.kind
  let t0 = 0
  try { t0 = PULSE_CLOCK() } catch { t0 = 0 }
  JOB = { id: msg && msg.id, t0 }
  try {
    if (PAGE_POST) {
      try { beat(t0) } catch { /* the page is gone: the job goes on */ }
      restartWorkPulse()
    }
    if (kind === INSPECT_JOB) return answerInspectJob(msg)
    if (kind === INSPECT_LIBRARY_JOB) return answerInspectLibraryJob(msg)
    return answerMemberDoorJob(msg)
  } finally {
    JOB = null
  }
}
