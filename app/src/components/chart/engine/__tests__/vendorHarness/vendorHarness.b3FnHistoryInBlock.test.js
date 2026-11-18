// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.b3FnHistoryInBlock.test.js
//
// ─── LEGACY SEMANTICS (B3, G7) — A FUNCTION'S `high[k]`, CALLED INSIDE AN `if`, BY PINE VERSION ─────
//
// Witnesses (our probes `tools/visual_conformance/probes/vw-fn-history-in-if-v2/-v3/-v4/-v5.pine`,
// NYSE:RDDT 1D from the listing, committed beside their captures): `f2() => high[2]` and
// `f1() => high[1]` called only in an `if` every third bar, with the three candidate readings plotted
// beside them (C = high[2] EVERY BAR, D = high[3] CARRY, E = high[6] SKIP).
//   s22 v3, s23 v2: CARRY on 221 of 221 call bars — the function's own copy of `high` advances every
//                   bar and repeats its last value on bars the call does not run; before the first call
//                   it has no history (`na`, bar 2).
//   s22 v5, s23 v4: EVERY BAR on 222 of 222 — the chart's own history, what this engine always read.
// v1 (no pragma) is not yet captured: refused by name on both lanes.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine, FN_HISTORY_IN_BLOCK, CARRY_VERSIONS } from '../../ast/pine.js'
import { interpret } from '../../ast/interpret.js'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns.js'

const REPO = path.resolve(process.cwd(), '..')
const CAP = (v) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness',
  `vw-fn-history-in-if-${v}-rddt-1d-2026-11-15.json`), 'utf8'))
const PROBE = (v) => fs.readFileSync(path.join(REPO, 'tools/visual_conformance/probes', `vw-fn-history-in-if-${v}.pine`), 'utf8')
const barsOf = (d) => d.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const same = (a, b) => (b === null || b === undefined ? !Number.isFinite(a)
  : Number.isFinite(a) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)))
const tvCol = (d, k) => d.plotValues.rows.map((r) => r[k + 1])
const mismatches = (ours, tv) => tv.map((x, i) => (same(ours[i], x) ? null : i)).filter((i) => i !== null)

function runCols(src, bars, n) {
  const outputs = Object.fromEntries(Array.from({ length: n }, (_, k) => [`p${k}`, k]))
  try {
    const cols = computeRuntimeColumns({ id: 'b3', meta: { runtimeHistory: 'listing' },
      compute: { kind: 'runtime', fn: 'runtime:b3', outputs, source: src } }, bars,
    { tf: 'D', newestBarIsForming: false, historyFromListing: true })
    return Object.keys(outputs).map((k) => Array.from(cols[k]))
  } catch (err) { return { err } }
}
function hostCols(src, bars) {
  const t = translatePine(src, { strict: true, basePeriod: 'D' })
  if (!t.ok) return { refusal: t.refusal }
  return t.outputs.filter((o) => o.kind !== 'alertcondition')
    .map((o) => Array.from(interpret(o.ast, bars, undefined, undefined, undefined, { tf: 'D', historyFromListing: true })))
}
const A = 1
const B = 2

describe('the committed captures are what they say', () => {
  for (const v of ['v2', 'v3', 'v4', 'v5']) {
    it(`${v}: our probe, from the listing, seven columns over 666 bars`, () => {
      const d = CAP(v)
      expect(d.source.text).toBe(PROBE(v))
      expect(d.history.startsAtBar0).toBe(true)
      expect(d.study.plots.map((p) => p.title)).toEqual(['T', 'A_f2_in_if', 'B_f1_in_if', 'C_high2_EVERY_BAR',
        'D_high3_CARRY', 'E_high6_SKIP', 'BI'])
      expect(d.plotValues.rows).toHaveLength(666)
    })
  }
  it('⭐ TradingView: v2/v3 read CARRY on every call bar, v4/v5 read the chart on every call bar', () => {
    for (const [v, col] of [['v2', 4], ['v3', 4], ['v4', 3], ['v5', 3]]) {
      const d = CAP(v)
      const T = tvCol(d, 0)
      const call = T.map((t, i) => (t === 1 ? i : null)).filter((i) => i !== null)
      const agree = call.filter((i) => tvCol(d, A)[i] === tvCol(d, col)[i] || (tvCol(d, A)[i] === null && tvCol(d, col)[i] === null))
      expect(call.length, v).toBeGreaterThan(200)
      expect(agree.length, v).toBe(call.length)
    }
    // before the first call the copy has no history: `na` at v2/v3, the chart's at v4/v5
    expect(tvCol(CAP('v3'), A)[2]).toBeNull()
    expect(tvCol(CAP('v2'), A)[2]).toBeNull()
    expect(tvCol(CAP('v4'), A)[2]).toBe(57.8)
  })
})

describe('⭐⭐ the runtime lane draws every column TradingView draws, at every captured version', () => {
  for (const v of ['v2', 'v3', 'v4', 'v5']) {
    it(`${v}: all seven columns, all 666 bars`, () => {
      const d = CAP(v)
      const cols = runCols(d.source.text, barsOf(d), 7)
      expect(cols.err, String(cols.err && cols.err.message)).toBeUndefined()
      for (let k = 0; k < 7; k += 1) expect(mismatches(cols[k], tvCol(d, k)), `${v} ${d.study.plots[k].title}`).toEqual([])
    })
  }
  it('the CARRY versions are exactly 2 and 3', () => {
    expect([...CARRY_VERSIONS].sort()).toEqual([2, 3])
  })
})

describe('⭐ the host lane reads every bar: right at v4/v5, refused by name where the read is CARRY', () => {
  for (const v of ['v4', 'v5']) {
    it(`${v}: all seven columns, all 666 bars`, () => {
      const d = CAP(v)
      const cols = hostCols(d.source.text, barsOf(d))
      expect(cols.refusal, JSON.stringify(cols.refusal || null)).toBeUndefined()
      for (let k = 0; k < 7; k += 1) expect(mismatches(cols[k], tvCol(d, k)), `${v} ${d.study.plots[k].title}`).toEqual([])
    })
  }
  for (const v of ['v2', 'v3']) {
    it(`⛔ ${v}: refused \`${FN_HISTORY_IN_BLOCK}\`, naming the call`, () => {
      const r = hostCols(CAP(v).source.text, barsOf(CAP(v)))
      expect(r.refusal && r.refusal.guard, JSON.stringify(r)).toBe(FN_HISTORY_IN_BLOCK)
      expect(r.refusal.message).toMatch(/`f2`/)
    })
  }
})

describe('⛔ v1 (no pragma) is not captured: refused by name on both lanes', () => {
  const v1 = PROBE('v3').replace('//@version=3\n', '').replace('//@version=3\r\n', '')
  it('the source is a v1 script (no pragma, `study(`)', () => {
    expect(v1).not.toMatch(/^\/\/@version=/m)
    expect(v1).toMatch(/^study\(/m)
  })
  it('host lane', () => {
    const r = hostCols(v1, barsOf(CAP('v3')))
    expect(r.refusal && r.refusal.guard, JSON.stringify(r)).toBe(FN_HISTORY_IN_BLOCK)
  })
  it('runtime lane', () => {
    const r = runCols(v1, barsOf(CAP('v3')), 7)
    expect(r.err && r.err.guard, String(r.err && r.err.message)).toBe(FN_HISTORY_IN_BLOCK)
  })
  it('a call on every bar is not this shape, at any version', () => {
    const every = PROBE('v3').replace('if (t)\n    a := f2()\n    b := f1()', 'a := f2()\nb := f1()')
      .replace('if (t)\r\n    a := f2()\r\n    b := f1()', 'a := f2()\r\nb := f1()')
    expect(every).not.toMatch(/if \(t\)/)
    for (const src of [every, every.replace(/\/\/@version=3\r?\n/, '')]) {
      const r = hostCols(src, barsOf(CAP('v3')))
      expect(r.refusal, JSON.stringify(r.refusal || null)).toBeUndefined()
    }
  })
})

describe('⭐⭐ s24 — a call in a TERNARY ARM reads the chart every bar, at v1 and at v3 (not a block, never CARRY)', () => {
  const TERN = (v) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness',
    `vw-fn-history-in-tern-${v}-rddt-1d-2026-11-15.json`), 'utf8'))
  const TPROBE = (v) => fs.readFileSync(path.join(REPO, 'tools/visual_conformance/probes', `vw-fn-history-in-tern-${v}.pine`), 'utf8')
  for (const v of ['v1', 'v3']) {
    it(`${v}: the committed capture is our probe; TradingView's A is EVERY BAR on every call bar`, () => {
      const d = TERN(v)
      expect(d.source.text).toBe(TPROBE(v))
      expect(d.history.startsAtBar0).toBe(true)
      const T = tvCol(d, 0)
      const call = T.map((t, i) => (t === 1 ? i : null)).filter((i) => i !== null)
      expect(call.length).toBeGreaterThan(200)
      expect(call.filter((i) => tvCol(d, A)[i] === tvCol(d, 3)[i])).toHaveLength(call.length)
    })
    it(`⭐ ${v}: the runtime lane, all seven columns, all 666 bars`, () => {
      const d = TERN(v)
      const cols = runCols(d.source.text, barsOf(d), 7)
      expect(cols.err, String(cols.err && cols.err.message)).toBeUndefined()
      for (let k = 0; k < 7; k += 1) expect(mismatches(cols[k], tvCol(d, k)), `${v} ${d.study.plots[k].title}`).toEqual([])
    })
    it(`⭐ ${v}: the host lane, all seven columns, all 666 bars (nothing refused)`, () => {
      const d = TERN(v)
      const cols = hostCols(d.source.text, barsOf(d))
      expect(cols.refusal, JSON.stringify(cols.refusal || null)).toBeUndefined()
      for (let k = 0; k < 7; k += 1) expect(mismatches(cols[k], tvCol(d, k)), `${v} ${d.study.plots[k].title}`).toEqual([])
    })
  }
  it('⛔ v3: one function called in a block AND in a ternary arm is refused by name on the runtime lane (uncaptured mix)', () => {
    const mixed = PROBE('v3').replace(/^b = 0\.0$/m, 'b = t ? f2() : 0.0')
    expect(mixed).toMatch(/^b = t \? f2\(\) : 0\.0$/m)
    const r = runCols(mixed, barsOf(CAP('v3')), 7)
    expect(r.err && r.err.guard, String(r.err && r.err.message)).toBe(FN_HISTORY_IN_BLOCK)
    expect(String(r.err.message)).toMatch(/conditional arm/)
  })
})
