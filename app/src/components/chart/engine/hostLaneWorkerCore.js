// app/src/components/chart/engine/hostLaneWorkerCore.js
//
// ─── ⭐⭐ HOST WORKER — WHAT THE HOST LANE'S WORKER DOES WITH ONE JOB ─────────────────────────────
//
// docs/pine/evidence/2026-11-17-host-lane-worker/EVIDENCE.md. The worker computes a host document's
// VALUES with `astColumns.js::astColumnsGiven`, the function the chart's own thread runs through
// `astColumnsFor`, over the rows, scalars and context the job carries (`hostLaneWire.js`), with the
// `runtime.error` stop the chart's thread decided (its evaluator reaches the chart registry, which
// this closure may not). ⛔ Nothing else: the member's settings were written into the document, the
// window taken and the scalars resolved before the job was posted (`astColumns.js::astLanePlan`), and
// the run-read parts are applied after it lands (`astLaneFinish`), on the chart's thread.
//
// Documents are sent once and kept here by id (`docId`), in the order the chart's thread keeps them
// (`hostLaneAsync.js` sends `evict` with the id it dropped), so a poll posts its bars and not the
// document again.
//
// ⛔ A PURE HANDLER, importable anywhere: the worker entry (`hostLaneWorker.js`) is the only module
// that touches `self`, so a test can run this exact code over a structured clone of the exact message.
import { astColumnsGiven, astSideRecordsOf } from './astColumns.js'
import { hostObjectRun } from './hostObjects.js'
import { unpackRows, ctxFromImage, answerImageOf, errorImageOf } from './hostLaneWire.js'

const _docs = new Map()

const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : 0)

/**
 * Answer one job.
 * @param {{id: number, docId: number, def?: object, evict?: number[], rows: object, scalars: object,
 *          ctx: object, stop: object|null}} msg
 * @param {Map<number, object>} [docs] the documents this worker holds (a test's stand-in worker
 *          passes its own, so a "restarted" worker holds none, as a real one would)
 * @returns {{reply: object, transfer: ArrayBuffer[]}}
 */
export function answerHostLaneJob(msg, docs = _docs) {
  const m = msg || {}
  for (const id of m.evict || []) docs.delete(id)
  if (m.def) docs.set(m.docId, m.def)
  const def = docs.get(m.docId)
  // ⛔ A document this worker does not hold is said, never guessed at (the chart's thread resends it).
  if (!def) return { reply: { id: m.id, ok: false, missing: true }, transfer: [] }
  const t0 = clock()
  if (m.kind === 'objects') return answerObjects(m, def, t0)
  try {
    const out = astColumnsGiven(def, unpackRows(m.rows), m.scalars, ctxFromImage(m.ctx), m.stop || null)
    const { answer, transfer } = answerImageOf(out, astSideRecordsOf)
    return { reply: { id: m.id, ok: true, answer, ms: clock() - t0 }, transfer }
  } catch (err) {
    // ⭐ THE COMPUTE'S OWN THROW (a refusal of a single-tree document, a document defect): the chart's
    // thread rethrows it, as `astColumnsFor` would have thrown it there.
    return { reply: { id: m.id, ok: false, error: errorImageOf(err), ms: clock() - t0 }, transfer: [] }
  }
}

/** ⭐ A document's DRAWINGS: `hostObjects.js::hostObjectRun`, the function the binder draws from, over
 *  the rows and the reader options the chart's thread would have handed it (its inputs and context,
 *  imaged like the values' context). The answer is the run (plain data: the binder draws `run.live`)
 *  and the reader facts the binder reads; its functions stay here. */
function answerObjects(m, def, t0) {
  try {
    const opts = { ...ctxFromImage(m.ctx), inputs: m.inputs }
    const host = hostObjectRun(def, unpackRows(m.rows), opts)
    const objects = host ? {
      run: host.run,
      reader: {
        program: { pineVersion: host.reader.program ? host.reader.program.pineVersion : undefined },
        form: host.reader.form, failed: host.reader.failed, refusals: host.reader.refusals, chartClock: host.reader.chartClock,
      },
    } : null
    return { reply: { id: m.id, ok: true, objects, ms: clock() - t0 }, transfer: [] }
  } catch (err) {
    return { reply: { id: m.id, ok: false, error: errorImageOf(err), ms: clock() - t0 }, transfer: [] }
  }
}

/** Test seam: forget every document. */
export function __resetHostLaneWorkerDocs() { _docs.clear() }
