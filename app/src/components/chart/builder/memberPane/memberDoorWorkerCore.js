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
import { memberPaneDefinition } from './memberPaneDefinition.js'
import { applyMemberDoorImage } from './memberDoorImage.js'
import { recordRuntimeConsults, runtimeConsultPendingOf } from '../../engine/runtimeKill.js'
import { runtimeLaneWarmAsks } from '../../engine/runtime/runtimeAsync.js'

/** The message kind a member-door job carries. */
export const MEMBER_DOOR_JOB = 'member-door'

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
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? undefined : value
  if (seen.has(value)) return seen.get(value)
  if (PASS_THROUGH(value)) return value
  if (Array.isArray(value)) {
    const out = []
    seen.set(value, out)
    for (let i = 0; i < value.length; i += 1) {
      const v = value[i]
      out.push(typeof v === 'function' ? undefined : plainAnswerOf(v, seen))
    }
    return out
  }
  if (value instanceof Map) {
    const out = new Map()
    seen.set(value, out)
    for (const [k, v] of value) if (typeof v !== 'function' && typeof k !== 'function') out.set(plainAnswerOf(k, seen), plainAnswerOf(v, seen))
    return out
  }
  if (value instanceof Set) {
    const out = new Set()
    seen.set(value, out)
    for (const v of value) if (typeof v !== 'function') out.add(plainAnswerOf(v, seen))
    return out
  }
  const out = {}
  seen.set(value, out)
  if (value instanceof Error) { out.name = value.name; out.message = value.message }
  for (const k of Object.keys(value)) {
    const v = value[k]
    if (typeof v === 'function') continue
    out[k] = plainAnswerOf(v, seen)
  }
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
    return {
      id: m.id,
      ok: true,
      answer: plainAnswerOf(built),
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
