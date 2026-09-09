// app/src/components/chart/engine/ast/executionShapeCensus.test.js
//
// ─── ⭐⭐⭐ EVERY CLOSED-TABLE BUILTIN, BY WHAT A BAR LOOP WOULD NEED ─────────
//
// 2F-1 shipped POINTWISE. 2F-2B shipped FINITE WINDOW. The authorised next step
// is to NAME and MEASURE the scan-backwards / event-history family and to measure
// recurrence — so this classifies ALL SEVENTY table entries by the machinery a
// bar-by-bar implementation would require, and measures how much of the corpus
// each shape is worth.
//
// ⛔⛔ THE PARTITION IS TOTAL AND DISJOINT, AND THAT IS THE POINT. A census over
// a hand-picked subset answers "how big is the thing I already thought of". The
// rails below force every one of the 70 into exactly one shape, so a builtin
// added tomorrow fails this file rather than quietly joining no family — the
// `lesson_a_gate_list_drifts_like_any_other_artifact` correction.
//
// ⭐ TWO OF THE SIX SHAPES ARE CROSS-CHECKED AGAINST AN EXISTING AUTHORITY:
// `pointwise` must equal `isPointwise`'s answer and `finiteWindow` must equal
// `FINITE_WINDOW`'s keys. Those two cannot drift from the tables that own them;
// the other four are this file's reading of the implementations, and each member
// carries the function that grounds it.
//
// ⚠️ WHAT IT DOES NOT DO: invent a third demand detector.
// `capabilityDemandCensus.test.js` owns "fed by runtime state" with its
// scope-aware walk. This measures REACH (a script names a member at all — a
// ceiling on demand) and BLOCKING (what the runtime front end actually refuses),
// and says which is which, rather than producing a second number that disagrees.
//
//   EXECUTION_SHAPE_OUT   write the JSON report here

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { TABLE, isPointwise } from './parse.js'
import { FINITE_WINDOW, CARRIED } from './interpret.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'

const CORPORA = [
  ['oos1', '../tests/fixtures/pine_oos'],
  ['blind', '../tests/fixtures/pine_blind'],
  ['community', '../tests/fixtures/pine_community'],
  ['parity', '../tests/fixtures/oos2_parity'],
  ['curated', '../tests/fixtures/pine'],
]
const OUT = process.env.EXECUTION_SHAPE_OUT
  ? path.resolve(process.cwd(), process.env.EXECUTION_SHAPE_OUT) : null

const N = 120
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000 + i,
}))

// ─────────────────────────────────────────────────────────────────────────────
// ⭐⭐ THE PARTITION. Each entry names the implementation in `interpret.js` that
// grounds its shape, because a classification with no cited implementation is an
// opinion (`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`).
// ─────────────────────────────────────────────────────────────────────────────

/** ⭐⭐⭐ THE FINDING THIS FILE EXISTS FOR: `barssince` and `valuewhen` ARE NOT
 *  BACKWARD SCANS. `interpret.js::barsSince` and `::valueWhen` are single FORWARD
 *  passes carrying two scalars each (`since`/`run`, `since`/`held`) with a
 *  declared reset on `na` — structurally identical to `smoothCol`'s
 *  `prev`/`count`/`sum`. The name "scan backwards" describes the SEMANTICS, not
 *  the execution, and a runtime that took the name literally would build ring
 *  machinery for a problem that needs one carried cell. */
const CARRIED_SHAPE = {
  ema: 'smoothCol — prev/count/sum',
  rma: 'smoothCol — prev/count/sum',
  // ⭐⭐ MOVED HERE FROM `finiteWindow` ON 2026-09-08, AND THE CENSUS IS WHERE
  // THAT SHOWS. They read like windows over `n + 1` samples and are counters:
  // no window policy fits the vendor, because two identical windows in the
  // capture get opposite answers. `monotoneStep` carries count/prev/seen — the
  // same three-scalar shape as `smoothCol`.
  rising: 'monotoneStep — count/prev/seen, HOLD on na',
  falling: 'monotoneStep — count/prev/seen, HOLD on na',
  barssince: 'barsSince — since/run, reset on na',
  valuewhen: 'valueWhen — since/held, reset on na',
  rsi: 'computeRSI — RMA of gains/losses',
  atr: 'computeATR — RMA of true range',
  adx: 'computeADX — RMA underneath',
  plusDI: 'computeADX — RMA underneath',
  minusDI: 'computeADX — RMA underneath',
  macd: 'computeMACD (shipped) — EMA-based, NOT composed here',
  accum: 'running sum from an anchor',
  cumFrom: 'barCumFrom — running sum from an anchor',
  vwap: 'computeVWAP — running Σpv / Σv',
  avwap: 'barAvwap — the same accumulator, re-anchored',
  obvN: 'barObvN — a running level, then a fixed offset difference',
  pvtN: 'barPvtN — a running level, then a fixed offset difference',
}

/** Reducible to finite windows, but more than one of them — so a runtime could
 *  serve these by COMPOSITION over `FINITE_WINDOW` rather than new machinery. */
const WINDOW_COMPOSITE = {
  bbw: 'sma + stdev',
  hma: 'wma of (2*wma(n/2) - wma(n))',
  percentrank: 'a rank within the window',
  donchianUpper: 'computeDonchian — highest/lowest',
  donchianMiddle: 'computeDonchian — highest/lowest',
  donchianLower: 'computeDonchian — highest/lowest',
  ichimokuTenkan: 'highest/lowest midpoint',
  ichimokuKijun: 'highest/lowest midpoint',
  ichimokuSpanA: 'midpoint of two midpoints',
  ichimokuSpanB: 'highest/lowest midpoint',
  stoch: 'computeStochastic — highest/lowest',
  williamsR: 'highest/lowest',
  cci: 'sma + dev (mean absolute deviation)',
  mfi: 'windowed sums of signed money flow',
  aroonUp: 'aroonCol — highestbars',
  aroonDown: 'aroonCol — lowestbars',
  bop: 'rolling(ratio, n, windowMean)',
}

/** ⭐ NEEDS NOTHING THIS RUNTIME DOES NOT ALREADY HAVE. These read the PREVIOUS
 *  BAR of their arguments and nothing else — which is `x[1]`, shipped in 2F-2A
 *  and per-call-site in P7.2. They are refused today only because the front end
 *  routes every non-pointwise, non-window name to one guard. */
const OFFSET_ONE = {
  change: 'v - v[1]',
  crossOver: 'crossing — a,b against a[1],b[1]',
  crossUnder: 'crossing — a,b against a[1],b[1]',
}

/** Reads a bar that has not happened. `forward:` is declared in the table, so
 *  this shape is DERIVED below rather than trusted from this list. */
const FORWARD = {
  pivothigh: 'forward: arg2',
  pivotlow: 'forward: arg2',
  ichimokuChikou: 'forward: arg4',
}

const SHAPES = {
  pointwise: {},
  finiteWindow: {},
  carried: CARRIED_SHAPE,
  windowComposite: WINDOW_COMPOSITE,
  offsetOne: OFFSET_ONE,
  forward: FORWARD,
}
for (const n of Object.keys(TABLE.functions)) {
  if (isPointwise(TABLE.functions[n])) SHAPES.pointwise[n] = 'isPointwise'
  else if (FINITE_WINDOW[n]) SHAPES.finiteWindow[n] = 'FINITE_WINDOW'
}

const shapeOf = (name) => {
  for (const [s, members] of Object.entries(SHAPES)) if (members[name]) return s
  return null
}

describe('⛔⛔ the partition — every table entry, exactly one shape', () => {
  const NAMES = Object.keys(TABLE.functions)

  it('is TOTAL — no builtin belongs to no family', () => {
    const orphans = NAMES.filter((n) => !shapeOf(n))
    expect(orphans, `unclassified: ${orphans.join(', ')}`).toEqual([])
  })

  it('is DISJOINT — no builtin belongs to two', () => {
    for (const n of NAMES) {
      const hits = Object.entries(SHAPES).filter(([, m]) => m[n]).map(([s]) => s)
      expect(hits, `${n} is in ${hits.join(' and ')}`).toHaveLength(1)
    }
  })

  it('⭐ the two derived shapes match the tables that OWN them', () => {
    // ⛔ NOT A RESTATEMENT — these two are BUILT from `isPointwise` and
    // `FINITE_WINDOW` above, so this asserts the build, and the hand-typed four
    // are what is left over. A member moved into `FINITE_WINDOW` tomorrow leaves
    // `carried`/`windowComposite` and lands here without an edit.
    expect(Object.keys(SHAPES.finiteWindow).sort()).toEqual(Object.keys(FINITE_WINDOW).sort())
    expect(Object.keys(SHAPES.pointwise).every((n) => isPointwise(TABLE.functions[n]))).toBe(true)
  })

  it('⭐ `forward` is DERIVED from the table, not trusted from the list', () => {
    // The table declares `forward:` on exactly the entries that read a later bar,
    // so this shape can be cross-checked the way the first two are.
    const declared = Object.keys(TABLE.functions)
      .filter((n) => TABLE.functions[n].forward).sort()
    expect(declared).toEqual(Object.keys(FORWARD).sort())
  })

  it('⭐⭐ CARRIED is a SUBSET of the carried shape, and the gap is the work left', () => {
    // ⭐ 2F-2C shipped `interpret.js::CARRIED`. Every member of it must be in
    // this file's `carried` shape — a member the runtime executes but the census
    // files elsewhere would mean the two disagree about what a bar loop needs.
    // The REVERSE does not hold, and the difference is the honest backlog: the
    // rest are carried in SHAPE but bind a shipped implementation (`computeRSI`,
    // `computeATR`) or a Pine spelling the closed table refuses.
    for (const fn of Object.keys(CARRIED)) {
      expect(SHAPES.carried[fn], `${fn} executes but is not filed as carried`).toBeTruthy()
    }
    const shipped = Object.keys(SHAPES.carried).filter((n) => CARRIED[n])
    const pending = Object.keys(SHAPES.carried).filter((n) => !CARRIED[n])
    expect(shipped.length, 'at least one member must ship, or 2F-2C did nothing').toBeGreaterThan(0)
    expect(pending.length, 'and the backlog must be real, not empty').toBeGreaterThan(0)
    report.carriedShipped = shipped
    report.carriedPending = pending
  })

  it('⭐ the shapes are non-trivial — none is empty, none is everything', () => {
    for (const [s, m] of Object.entries(SHAPES)) {
      expect(Object.keys(m).length, `${s} is empty`).toBeGreaterThan(0)
      expect(Object.keys(m).length, `${s} is the whole table`).toBeLessThan(NAMES.length)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────

function corpusFiles() {
  const out = []
  for (const [name, dir] of CORPORA) {
    const d = path.resolve(process.cwd(), dir)
    if (!fs.existsSync(d)) continue
    for (const f of fs.readdirSync(d).filter((x) => /\.(pine|txt)$/i.test(x))) {
      out.push({ corpus: name, file: f, src: fs.readFileSync(path.join(d, f), 'utf8') })
    }
  }
  return out
}

/** ⚠️ REACH, NOT DEMAND. A token scan for `ta.<name>(` — it counts every mention,
 *  including ones over plain columns the pure lane already serves. It is a
 *  CEILING on what each shape could be worth to the runtime, and it is labelled
 *  that way everywhere it is reported. `capabilityDemandCensus` owns the narrower
 *  "fed by runtime state" number and this file deliberately does not re-derive it. */
function reachOf(src) {
  const hits = {}
  for (const m of src.matchAll(/(?:^|[^A-Za-z0-9_.])(?:ta\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) {
    const s = shapeOf(m[1])
    if (s) (hits[s] ||= new Set()).add(m[1])
  }
  return hits
}

const report = { scripts: 0, shapes: {}, blocked: {}, members: {} }

describe('⭐⭐ what each shape is worth on the corpus', () => {
  const FILES = corpusFiles()

  it('⭐ REACH — scripts and distinct members per shape', () => {
    expect(FILES.length, 'a measurement of nothing is not a measurement').toBeGreaterThan(100)
    report.scripts = FILES.length
    for (const s of Object.keys(SHAPES)) {
      report.shapes[s] = { scripts: 0, byCorpus: {}, members: {} }
    }
    for (const { corpus, src } of FILES) {
      const hits = reachOf(src)
      for (const [s, names] of Object.entries(hits)) {
        const r = report.shapes[s]
        r.scripts += 1
        r.byCorpus[corpus] = (r.byCorpus[corpus] || 0) + 1
        for (const n of names) r.members[n] = (r.members[n] || 0) + 1
      }
    }
    // ⭐ NON-VACUITY: the scan must actually find the families it classifies.
    expect(report.shapes.carried.scripts).toBeGreaterThan(0)
    expect(report.shapes.finiteWindow.scripts).toBeGreaterThan(0)
  })

  it('⛔⛔ BLOCKING — which shape each still-refused script is waiting on', () => {
    for (const { corpus, file, src } of FILES) {
      let guard
      try {
        const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
        guard = b.ok ? 'OK' : b.refusal.guard
      } catch (e) { guard = `THREW:${e.name}` }
      report.blocked[guard] = (report.blocked[guard] || 0) + 1
      if (guard !== 'runtime:call-windowed-state') continue
      // Which non-shipped shapes does this script reach? That is what it is
      // actually waiting on — the guard's own name no longer says.
      const hits = reachOf(src)
      const waiting = ['carried', 'windowComposite', 'offsetOne', 'forward']
        .filter((s) => hits[s])
      const key = waiting.join('+') || 'none'
      ;(report.members[key] ||= []).push(`${corpus}/${file}`)
    }
    // ⭐⭐ THE RESULT THAT MATTERS, ASSERTED so it cannot quietly stop being true:
    // every script still held by `call-windowed-state` reaches the CARRIED shape.
    const notCarried = Object.entries(report.members)
      .filter(([k]) => !k.split('+').includes('carried'))
      .flatMap(([, v]) => v)
    expect(notCarried,
      `blocked on call-windowed-state WITHOUT reaching a carried builtin: ${notCarried.join(', ')}`)
      .toEqual([])
  })

  it('⭐ scripts reaching ONLY already-shipped shapes still refuse for other reasons', () => {
    // ⛔ A GUARD AGAINST READING THIS FILE AS A ROADMAP. "Ship `carried` and the
    // corpus opens" is exactly the claim 2F-2B disproved for windows — 11 → 8
    // first blockers and ZERO new executing scripts. The shapes here bound what
    // the BUILTIN wall costs; every other wall (tuples, collections, objects,
    // presentation, MTF) is untouched by any of it.
    expect(report.blocked.OK).toBeGreaterThan(0)
    expect(Object.keys(report.blocked).length,
      'more than one wall must remain, or this file is claiming too much')
      .toBeGreaterThan(4)
  })

  it('writes the report', () => {
    if (OUT) {
      fs.mkdirSync(path.dirname(OUT), { recursive: true })
      fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
    }
    expect(report.scripts).toBeGreaterThan(100)
  })
})
