// app/src/components/chart/engine/runtime/warmupProbe.js
//
// ⭐⭐⭐ UIE PHASE 3 (M1) — WHEN THE WARM-UP CURTAIN'S SECOND RUN MAY STOP EARLY.
//
// The curtain (`runtimeColumns.js::computeOffListing`) runs a script over every bar
// (A) and again from `shift` bars later (B), and draws A from the bar where the two
// agree through the LAST bar. Run to the end, B costs nearly a second full run.
//
// B may stop at the end of bar c (in A's bars) when, and only when, everything B
// would do from then on is PROVABLY what A did:
//
//   1. the SAME PROGRAM — both builds lowered to identical code, constants and slot
//      plans (a build reads the bars it is given, so this is checked, not assumed);
//   2. the SAME STATE at the end of bar c — every `var`, history ring (logically),
//      call-site cell and builtin's carried state, equal EXACTLY (`vmState.js`);
//      a tolerance would let two states one ulp apart branch apart later;
//   3. the SAME INPUTS on every later bar — the bar's series and clock are the same
//      bars in both runs, so what is checked is what a later bar can read that is
//      NOT the same in both:
//        * a precomputed COLUMN (the columnar lane's `ta.*`, `bar_index`, …) is
//          computed over each run's own bars; each column a later bar reads must be
//          bit-identical in A and B from the earliest bar that read can reach;
//        * a read of the PAST (`close[k]`, a column's `[k]`) may reach before B's
//          first bar, where B reads `na` and A a value. A constant offset is bounded
//          by the code; a DYNAMIC one by nothing, so A MEASURES the lowest bar every
//          dynamic read reached after c (the VM's probe) — A did run those bars,
//          and with the same state and inputs B would have read the same offsets;
//        * the history rings and windows must be full in B (`committed` ≥ every
//          ring's depth), so "not yet committed" reads `na` in neither run.
//
// By induction over the bars after c, B's outputs there EQUAL A's (bit for bit), so
// they are not computed. Anything not proven — a program that draws (its object
// store is not encoded), a state too large to encode, a column that never becomes
// identical — leaves B to run to its end exactly as before. The optimization can
// only remove work B would have repeated; it never changes what is drawn.
import { OP } from './program.js'
import { sameState } from './vmState.js'
import { isDrawingHandle } from './handles.js'

/** The checkpoint offsets after B's first bar: dense early, geometric later. */
export function warmupCheckpoints(n, shift) {
  const out = []
  for (let d = 32; shift + d - 1 < n - 1; d = Math.ceil(d * 1.5)) out.push(shift + d - 1)
  return out
}

/** The most encoded cells A keeps across all its checkpoints. */
export const PROBE_TOTAL_CELL_CAP = 1 << 20

// ⭐ UIE PHASE 5 (M2) — a constant that is a FROZEN DRAWING-HANDLE template (`{family,
// site}`, minted fresh by every build) is the same constant when its family and site
// are; every other constant is compared by `Object.is`.
const sameConst = (a, b) => Object.is(a, b) || (isDrawingHandle(a) && isDrawingHandle(b)
  && Object.isFrozen(a) && Object.isFrozen(b) && a.family === b.family && a.site === b.site && a.id === b.id)
const sameList = (x, y) => {
  if (!x || !y || x.length !== y.length) return false
  for (let i = 0; i < x.length; i += 1) if (!sameConst(x[i], y[i])) return false
  return true
}
const shapeOf = (p) => {
  try {
    return JSON.stringify([p.locals, p.persists, p.history, p.windows, p.carried, p.carried2,
      p.functions, p.callSites, p.outputs, p.pointwise, p.arrayOps, p.textOps, p.colourOps, p.recordTypes,
      p.fieldNames, (p.columns || []).length])
  } catch { return null }
}
/** Two lowered programs are the same program. */
export function sameProgram(a, b) {
  if (!a || !b) return false
  if (!sameList(a.code, b.code) || !sameList(a.consts, b.consts)) return false
  const sa = shapeOf(a)
  return sa !== null && sa === shapeOf(b)
}

/** What a program's code reads of the past: per column and for the series, the
 *  deepest CONSTANT offset, and whether any read's offset is dynamic. */
export function readsOf(program) {
  const code = program.code
  const cols = new Map()   // column → deepest constant offset
  const dynCols = new Set()
  let seriesDepth = 0
  let seriesDyn = false
  for (let pc = 0; pc * 3 < code.length; pc += 1) {
    const op = code[pc * 3]
    const a = code[pc * 3 + 1]
    const b = code[pc * 3 + 2]
    if (op === OP.READ_COLUMN) cols.set(a, Math.max(cols.get(a) || 0, 0))
    else if (op === OP.READ_HIST) cols.set(a, Math.max(cols.get(a) || 0, b))
    else if (op === OP.READ_HIST_DYN) dynCols.add(a)
    else if (op === OP.READ_SERIES_HIST) seriesDepth = Math.max(seriesDepth, b)
    else if (op === OP.READ_SERIES_HIST_DYN) seriesDyn = true
  }
  return { cols, dynCols, seriesDepth, seriesDyn }
}

/** The first bar (A's indices, ≥ shift) from which column `ca` of A and `cb` of B
 *  are identical through the end, or `Infinity` when the last bar already differs. */
export function columnAgreesFrom(ca, cb, shift) {
  if (!ca || !cb || ca.length - shift !== cb.length) return Infinity
  let c = ca.length
  for (let i = ca.length - 1; i >= shift; i -= 1) {
    if (!Object.is(ca[i], cb[i - shift])) break
    c = i
  }
  return c === ca.length ? Infinity : c
}

/**
 * The probe pair for one curtain: `forA` rides run A (records), `forB` rides run B
 * (decides). Each run's `onProgram` is handed to `programA` / `programB`.
 * `stoppedAt()` → the bar (A's indices) B stopped after, or null.
 */
export function makeWarmupProbe(n, shift) {
  const checks = warmupCheckpoints(n, shift)
  const snaps = new Map()
  const segLow = new Map()
  let kept = 0
  let finalLow = { dynLowSeries: Infinity, dynLowCol: Infinity }
  let progA = null
  let stopped = null
  // derived once B's program is known
  let lowAfter = null
  let colFrom = null
  let reads = null
  let ringDepth = 0

  const forA = {
    bars: checks,
    visit(bar, s) {
      segLow.set(bar, { s: s.dynLowSeries, c: s.dynLowCol })
      if (s.cells && kept + s.cells.length <= PROBE_TOTAL_CELL_CAP) {
        snaps.set(bar, s.cells)
        kept += s.cells.length
      }
      return false
    },
    done(low) { finalLow = low },
  }
  const forB = {
    bars: [],
    visit(barB, s) {
      const c = barB + shift
      const want = snaps.get(c)
      if (!want || !s.cells || !lowAfter) return false
      if (s.committed < ringDepth) return false
      // constant offsets: every series read after c lands on B's bars
      if (c + 1 - reads.seriesDepth < shift) return false
      // every column read after c lands where A and B agree
      for (const [col, depth] of reads.cols) if (colFrom.get(col) > c + 1 - depth) return false
      const low = lowAfter.get(c)
      if (reads.seriesDyn && low.s < shift) return false
      for (const col of reads.dynCols) if (colFrom.get(col) > low.c) return false
      if (!sameState(want, s.cells)) return false
      stopped = c
      return true
    },
  }
  return {
    forA,
    forB,
    programA(p) { progA = p },
    programB(p) {
      forB.bars = []
      if (!sameProgram(progA, p)) return
      reads = readsOf(p)
      colFrom = new Map()
      for (const col of new Set([...reads.cols.keys(), ...reads.dynCols])) {
        colFrom.set(col, columnAgreesFrom(progA.columns[col], p.columns[col], shift))
      }
      ringDepth = 0
      for (const h of p.history || []) ringDepth = Math.max(ringDepth, h.depth)
      for (const w of p.windows || []) ringDepth = Math.max(ringDepth, w.span)
      // the lowest dynamic reach AFTER each checkpoint: the segments that follow it
      lowAfter = new Map()
      let rs = finalLow.dynLowSeries
      let rc = finalLow.dynLowCol
      for (let j = checks.length - 1; j >= 0; j -= 1) {
        lowAfter.set(checks[j], { s: rs, c: rc })
        const seg = segLow.get(checks[j])
        if (seg) { rs = Math.min(rs, seg.s); rc = Math.min(rc, seg.c) }
      }
      forB.bars = checks.filter((c) => snaps.has(c)).map((c) => c - shift)
    },
    stoppedAt: () => stopped,
  }
}
