// app/src/components/chart/engine/hostObjects.js
//
// ─── ⭐⭐ HOST WORKER — THE HOST OBJECT PROGRAM, EVALUATED: ONE PATH, HOST-NEUTRAL ────────────────
//
// `hostObjectRun` (ENGINE 54: the binder draws its `run.live`, the run half's object rail compares
// it) and the reader options a chart binding hands it, MOVED HERE UNCHANGED from
// `runHalfObjectRail.js` (which re-exports both) so the host lane's worker can evaluate a document's
// drawings with this exact code: this module's closure holds no chart registry, no network, no
// storage and no build flag (`hostLaneWorker.rail.test.js`).
import { objectReaderFor } from './objectColumns'
import { runtimeUnknownSentence } from './ast/objectLoss.js'
import { evaluateObjects } from './objectRuntime'

/** The object reader's options for a chart binding, from the bind's `ctx` and the instance's
 *  inputs — exactly what the binder hands it. */
export function hostObjectReaderOpts(ctx, inputs) {
  const c = ctx || {}
  return {
    inputs,
    tf: c.tf,
    symbol: c.symbol,
    newestBarIsForming: c.newestBarIsForming ?? null,
    secondary: c.secondary && typeof c.secondary.get === 'function' ? c.secondary : null,
    exchangeOf: c.exchangeOf,
    lowerTf: c.lowerTf && typeof c.lowerTf.get === 'function' ? c.lowerTf : null,
    ...(c.historyFromListing === true ? { historyFromListing: true } : {}),
    ...(c.barIndexFromFirstBar === true ? { barIndexFromFirstBar: true } : {}),
  }
}

/** ⭐ THE host object program over these bars: `{reader, run}`, or null when there is nothing
 *  to read. The binder draws `run.live`; the object rail compares it. */
export function hostObjectRun(def, bars, readerOpts) {
  const reader = objectReaderFor(def, bars, readerOpts)
  if (!reader) return null
  const run = evaluateObjects(reader.program, {
    barCount: bars.length,
    readNode: reader.readNode,
    readTime: reader.readTime,
    readUnknown: reader.readUnknown,
    readUnknownOther: reader.readUnknownOther,
    offListing: reader.historyFromListing !== true,
    // ⭐ ENGINE 55 — why the run half's values are unknown, said in the drawing note.
    unknownBecause: runtimeUnknownSentence(reader.runtime),
  })
  return { reader, run }
}
