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
import { MEMBER_DOOR_JOB, INSPECT_JOB, INSPECT_LIBRARY_JOB, STATUS_JOB, restoreFaithful } from './memberDoorProtocol.js'

export { MEMBER_DOOR_JOB, INSPECT_JOB, INSPECT_LIBRARY_JOB, STATUS_JOB }
// ⛔⛔ THE REGISTRATIONS A CHART PAGE MAKES WHEN IT LOADS ARE MADE HERE TOO. On the page the door's graph is
// BuilderSheet's (the binder registers the run half's object rail, `runHalfObjectRail.js`, and with it the host lane's
// `runtime.error` stop, `runtimeErrorStop.js`); in the worker `vite.config.js` resolves the door's sheet imports to the
// pure modules, so nothing else would make them, and an answer computed without them is not the page's. Here, in the
// handler, so a rail's stand-in worker (this module in a fresh graph) holds them as the real worker does. The worker
// graph holds every load-time registration of the page's door graph that is not a page's own (streams, preferences,
// drawings): `memberDoorWorkerGraph.test.js`, with a control.
import '../../engine/runHalfObjectRail.js'

const PASS_THROUGH = (v) => v instanceof Date || v instanceof RegExp || ArrayBuffer.isView(v) || v instanceof ArrayBuffer

/**
 * ⭐ THE DOOR'S ANSWER AS PLAIN DATA, the way it crosses to the page. A structured clone refuses a function and
 * keeps neither a class's prototype nor an error's own fields, and the answer's working object (`translation`,
 * which the editor's status panel reads) holds all three. So, before it is posted: every own ENUMERABLE field
 * whose value is not a function, at every depth; a Map and a Set as a Map and a Set; an error or any other
 * class instance as a plain object of its own enumerable fields (an error keeps its `name` and `message` too);
 * and ONE copy of an object reached twice, so `a === b` in the answer is `a === b` on the page (the status
 * panel finds a row's output by its tree's identity). Exactly what JSON and a structured clone agree an object
 * IS; the census proves the page reads the same document and the same status from it.
 */
export function plainAnswerOf(value, seen = new Map()) {
  return copyOf(value, seen, null)
}

/**
 * ⭐ THE ANSWER AS IT CROSSES, FAITHFULLY (`memberDoorProtocol.js`): `plainAnswerOf`'s copy, plus every NON-ENUMERABLE
 * own property of an object or array in it (`hidden`: the copy it belongs to, its key, its value copied the same way,
 * and its descriptor's `writable` / `configurable`), which the page puts back before anyone reads the answer
 * (`restoreFaithful`). `lost` counts what no clone can carry (a function or an accessor held non-enumerably, a symbol
 * key); a rail holds it at zero for what the door and PasteBox answer. An error is copied as `plainAnswerOf` copies it.
 * @returns {{value: any, hidden: object[], lost: number}}
 */
export function faithfulAnswerOf(value) {
  const acc = { hidden: [], lost: 0 }
  const out = copyOf(value, new Map(), acc)
  return { value: out, hidden: acc.hidden, lost: acc.lost }
}

function copyHidden(value, out, seen, acc) {
  if (!acc || value instanceof Error) return
  acc.lost += Object.getOwnPropertySymbols(value).length
  for (const k of Object.getOwnPropertyNames(value)) {
    if (Object.prototype.propertyIsEnumerable.call(value, k)) continue
    if (Array.isArray(value) && k === 'length') continue
    const d = Object.getOwnPropertyDescriptor(value, k)
    if (!d || !('value' in d) || typeof d.value === 'function') { acc.lost += 1; continue }
    acc.hidden.push({ node: out, key: k, value: copyOf(d.value, seen, acc), writable: d.writable, configurable: d.configurable })
  }
}

function copyOf(value, seen, acc) {
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? undefined : value
  if (seen.has(value)) return seen.get(value)
  if (PASS_THROUGH(value)) return value
  if (Array.isArray(value)) {
    const out = []
    seen.set(value, out)
    for (let i = 0; i < value.length; i += 1) {
      const v = value[i]
      out.push(typeof v === 'function' ? undefined : copyOf(v, seen, acc))
    }
    copyHidden(value, out, seen, acc)
    return out
  }
  if (value instanceof Map) {
    const out = new Map()
    seen.set(value, out)
    for (const [k, v] of value) if (typeof v !== 'function' && typeof k !== 'function') out.set(copyOf(k, seen, acc), copyOf(v, seen, acc))
    return out
  }
  if (value instanceof Set) {
    const out = new Set()
    seen.set(value, out)
    for (const v of value) if (typeof v !== 'function') out.add(copyOf(v, seen, acc))
    return out
  }
  const out = {}
  seen.set(value, out)
  if (value instanceof Error) { out.name = value.name; out.message = value.message }
  for (const k of Object.keys(value)) {
    const v = value[k]
    if (typeof v === 'function') continue
    out[k] = copyOf(v, seen, acc)
  }
  copyHidden(value, out, seen, acc)
  return out
}

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
    const crossing = faithfulAnswerOf(built)
    return {
      id: m.id,
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

/** A job's answer, faithfully, over the page's state: `compute(args)` with the runtime lists' consult log open. */
function answerJob(m, compute) {
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
    const crossing = faithfulAnswerOf(value)
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
  return answerJob(msg || {}, (a) => (a.dialect === undefined || a.dialect === null
    ? inspectPine(a.source, a.opts == null ? undefined : a.opts)
    : inspectSource(a.source, a.dialect, a.opts == null ? undefined : a.opts)))
}

/** ⭐ The report of a paste holding several scripts (`libraryIntake.inspectLibrary`), off the main thread. */
export function answerInspectLibraryJob(msg) {
  return answerJob(msg || {}, (a) => inspectLibrary(a.scripts))
}

/**
 * ⭐ THE EDITOR STATUS PANEL'S STATUS, off the main thread: `editorStatus` of PasteBox's report and the chart door's
 * answer, each restored here as faithfully as it reached the page (the page hands on the tables it was given,
 * `memberDoorProtocol.hiddenTableOf`).
 * @param {{args: {report, reportHidden?, pane?, paneHidden?, savedRow?, inspectedSource?}}} msg
 */
export function answerStatusJob(msg) {
  return answerJob(msg || {}, (a) => editorStatus({
    report: restoreFaithful({ value: a.report, hidden: a.reportHidden }),
    pane: a.pane ? restoreFaithful({ value: a.pane, hidden: a.paneHidden }) : null,
    savedRow: a.savedRow ?? null,
    inspectedSource: a.inspectedSource ?? null,
  }))
}

/** One job, by its kind (`memberDoorProtocol.js`). */
export function answerJobOfKind(msg) {
  const kind = msg && msg.kind
  if (kind === INSPECT_JOB) return answerInspectJob(msg)
  if (kind === INSPECT_LIBRARY_JOB) return answerInspectLibraryJob(msg)
  if (kind === STATUS_JOB) return answerStatusJob(msg)
  return answerMemberDoorJob(msg)
}
