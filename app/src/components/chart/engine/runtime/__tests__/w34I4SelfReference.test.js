// app/src/components/chart/engine/runtime/__tests__/w34I4SelfReference.test.js
//
// ─── ⭐⭐ W34-I4 — A v1/v2 SELF-REFERENCING DEFINITION ON THE RUN ────────────────
//
// The residual `pine:state` shape named on `coral-trend-indicator-lazybear` (v1,
// sole blocker; refusals at lines 19/21/23, tokens `i2`/`i4`/`i6`): a
// fixed-coefficient recurrence whose driving input is ANOTHER recurrence. Pine
// runs each as a series whose `x[1]` is last bar's value (`na` on bar 0, so
// `nz(x[1])` is 0 there). The run now reads it as that series
// (`pineRuntimeFrontend.js::v2SelfReferenceStatements`) instead of the host
// lane's re-seeded `accum`, which refused it.
//
// ⛔ NO LICENCE-HELD TEXT. Every source below is a synthetic shape written for
// this rail: a six-stage cascade of one-pole smoothers and a combination of its
// stages, with constants of its own. The scripts are cited by name only.
//
// ⭐ THE GRADE IS THE HAND-UNROLLED RECURRENCE over 5,000 bars, from bar 0 (the
// reference's arithmetic: `nz` replaces the history operator's `na`).
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr, v2SelfReferenceStatements } from '../../ast/pineRuntimeFrontend.js'
import { lexPine, blockStatements } from '../../ast/pine.js'
import { probeRuntimeProgram } from '../runtimeColumns.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const NL = String.fromCharCode(10)
const N = 5000
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 12 * Math.sin(i * 0.037) + 4 * Math.cos(i * 0.29) + ((i * 7919) % 13) / 5
  return { t: 1500000000 + i * 86400, o: c - 0.7, h: c + 1.9, l: c - 2.3, c, v: 1000 + ((i * 104729) % 977) }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const CLOSE = BARS.map((b) => b.c)

const src = (lines, head = 'study("i4")') => [head, ...lines].join(NL)
function build(source, opts = {}) {
  return buildRuntimeIr(source, { bars: BARS, inputs: {}, ...opts })
}
function run(source, { listing = false } = {}) {
  const built = build(source, listing ? { historyFromListing: true } : {})
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir, listing ? { historyFromListing: true } : {})
  const r = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t),
  })
  return r.outputs.map((o) => Array.from(o))
}
const refusalOf = (source, opts) => {
  const built = build(source, opts)
  return built.ok ? null : built.refusal
}
const maxAbsDiff = (got, want) => {
  let worst = 0
  for (let i = 0; i < want.length; i += 1) {
    if (Number.isNaN(want[i])) { if (!Number.isNaN(got[i])) return Infinity; continue }
    if (!Number.isFinite(got[i])) return Infinity
    worst = Math.max(worst, Math.abs(got[i] - want[i]))
  }
  return worst
}

// The synthetic cascade: six one-pole stages, each driven by the previous one.
const LEN = 13
const CASCADE = [
  `len = input(${LEN})`,
  'w = 2 / (len + 1.0)',
  'v = 1 - w',
  's1 = w*close + v*nz(s1[1])',
  's2 = w*s1 + v*nz(s2[1])',
  's3 = w*s2 + v*nz(s3[1])',
  's4 = w*s3 + v*nz(s4[1])',
  's5 = w*s4 + v*nz(s5[1])',
  's6 = w*s5 + v*nz(s6[1])',
  'mix = 1.5*s3 - 0.75*s4 + 0.4*s5 - 0.15*s6',
  'plot(mix)',
  'plot(s2)',
]
/** The same arithmetic, unrolled by hand from bar 0 (every `nz(sK[1])` is 0 there). */
function cascadeByHand() {
  const w = 2 / (LEN + 1.0)
  const v = 1 - w
  const s = [0, 0, 0, 0, 0, 0]
  const mix = []
  const s2 = []
  for (let i = 0; i < N; i += 1) {
    s[0] = w * CLOSE[i] + v * s[0]
    for (let k = 1; k < 6; k += 1) s[k] = w * s[k - 1] + v * s[k]
    mix.push(1.5 * s[2] - 0.75 * s[3] + 0.4 * s[4] - 0.15 * s[5])
    s2.push(s[1])
  }
  return { mix, s2 }
}

describe('W34-I4: a recurrence driven by another recurrence (v1/v2 self-reference) runs on the run', () => {
  it('builds on the runtime lane (master: pine:state on the second stage)', () => {
    const p = probeRuntimeProgram(src(CASCADE))
    expect(p.ok, p.ok ? '' : `${p.refusal.guard}: ${p.refusal.message}`).toBe(true)
    expect(p.outputs.length).toBe(2)
  })

  it('differential: 5,000 bars equal the hand-unrolled recurrence from bar 0, off and on the listing', () => {
    const want = cascadeByHand()
    for (const listing of [false, true]) {
      const [mix, s2] = run(src(CASCADE), { listing })
      expect(mix.length).toBe(N)
      expect(maxAbsDiff(mix, want.mix)).toBeLessThanOrEqual(1e-9)
      expect(maxAbsDiff(s2, want.s2)).toBeLessThanOrEqual(1e-9)
      // bar 0 is a value, not a curtain: `nz(s1[1])` is 0 there by the reference
      expect(mix[0]).toBeCloseTo(want.mix[0], 12)
    }
  })

  it('v2 pragma: the same', () => {
    const [mix] = run(src(CASCADE, '//@version=2' + NL + 'study("i4")'))
    expect(maxAbsDiff(mix, cascadeByHand().mix)).toBeLessThanOrEqual(1e-9)
  })

  it('a running total by hand is the reference arithmetic too (nz(x[1]) + volume)', () => {
    const [x] = run(src(['x = nz(x[1]) + volume', 'plot(x)']))
    let t = 0
    const want = BARS.map((b) => (t += b.v))
    expect(maxAbsDiff(x, want)).toBe(0)
  })
})

describe('W34-I4: the slot seed is the history operator na, never 0 (v4 spelling, where it is stated)', () => {
  // The rewritten v1/v2 definition runs as this v4 slot. In v4, `x[1]` on bar 0 is
  // `na` (stated reference behaviour), so the fill is taken and bar 0 is `close`.
  // Seeded 0, `nz(0, close)` is 0 and bar 0 would be `0.5 * close`.
  it('v4 slot: nz(x[1], fill) takes the fill on bar 0', () => {
    const [x] = run(['//@version=4', 'study("i4")', 'float x = na', 'x := 0.5*close + 0.5*nz(x[1], close)', 'plot(x)'].join(NL))
    const want = []
    let prev = NaN
    for (let i = 0; i < N; i += 1) {
      prev = 0.5 * CLOSE[i] + 0.5 * (Number.isNaN(prev) ? CLOSE[i] : prev)
      want.push(prev)
    }
    expect(x[0]).toBe(CLOSE[0])
    expect(maxAbsDiff(x, want)).toBeLessThanOrEqual(1e-9)
  })
})

describe('W34-I4: a self read whose bar-0 value the reference does not state keeps its refusal BY NAME', () => {
  // ⛔ Named on `thelark-lma-v2-laguerre` (`col`, line 43): a bare `col[1]` in a
  // comparison. Whether v1/v2 starts it at `na` or 0 is capture row W34-I4-S1.
  it('a bare self read in a comparison refuses pine:state naming the variable', () => {
    const r = refusalOf(src(['m = sma(close, 5)', 'c = m == m[1] and c[1] == 1 ? 1 : m > m[1] ? 1 : 2', 'plot(c)']))
    expect(r && r.guard).toBe('pine:state')
    expect(r.token).toBe('c')
  })
  it('a bare self read in arithmetic refuses pine:state', () => {
    const r = refusalOf(src(['x = 0.25*close + 0.75*x[1]', 'plot(x)']))
    expect(r && r.guard).toBe('pine:state')
    expect(r.token).toBe('x')
  })
  // ⛔ B1 (review): `nz(x[k], fill)` in v1/v2 reads `fill` or 0 on bar 0 by the
  // unstated seed rule (row W34-I4-S1), so it is NOT rewritten.
  it('the fill form nz(x[1], fill) is not rewritten; a never-forgetting one refuses pine:state by name', () => {
    const r = refusalOf(src(['x = nz(x[1], close) + volume', 'plot(x)']))
    expect(r && r.guard).toBe('pine:state')
    expect(r.token).toBe('x')
  })
  it('the fill form never serves a guessed bar 0 (master answer: the window withholds it)', () => {
    const [x] = run(src(['x = 0.5*close + 0.5*nz(x[1], close)', 'plot(x)']))
    expect(Number.isNaN(x[0])).toBe(true)
  })
  // Mutation M2 survived the first batch: every bare read above ends the line or meets
  // `==`, so a bare read followed by `)` (the shape `nz(x[k])` also ends with) was unrailed.
  it('a bare self read closed by a parenthesis is not rewritten and refuses pine:state', () => {
    const body = ['x = 0.25*close + (0.75*x[1])', 'plot(x)']
    const l = lexPine(src(body))
    const st = blockStatements(l.tokens, l.indents, 0)
    expect(v2SelfReferenceStatements(st, l.version)).toBe(st)
    expect((refusalOf(src(body)) || {}).guard).toBe('pine:state')
  })
  it('one guarded and one bare read: not rewritten, refused', () => {
    const r = refusalOf(src(['x = 0.25*close + 0.5*nz(x[1]) + 0.25*x[2]', 'plot(x)']))
    expect(r && r.guard).toBe('pine:state')
  })
})

describe('W34-I4: scope of the rewrite', () => {
  const stmtsOf = (s) => { const l = lexPine(s); return { st: blockStatements(l.tokens, l.indents, 0), version: l.version } }
  it('leaves a script with no self-reference byte-identical (same array)', () => {
    const { st, version } = stmtsOf(src(['a = sma(close, 3)', 'b = nz(a[1])', 'plot(b)']))
    expect(v2SelfReferenceStatements(st, version)).toBe(st)
  })
  it('rewrites a guarded self-reference into `x = na` + `x := ...`', () => {
    const { st, version } = stmtsOf(src(['x = 0.5*close + 0.5*nz(x[1])', 'plot(x)']))
    const out = v2SelfReferenceStatements(st, version)
    expect(out.length).toBe(st.length + 1)
    expect(out[1].header.map((t) => t.value)).toEqual(['x', '=', 'na'])
    expect(out[2].header[1].value).toBe(':=')
  })
  it('v3 and later are untouched (self-reference left in v3; the host refusal stands)', () => {
    for (const v of [3, 4]) {
      const s = src(CASCADE, `//@version=${v}` + NL + 'study("i4")')
      const { st, version } = stmtsOf(s)
      expect(v2SelfReferenceStatements(st, version)).toBe(st)
      // ⭐ engine 49: the v3+ refusal is `pine:cycle` by name (a declaration that reads its own
      // history does not compile in v3+); it was `pine:state`, the accumulator's sentence
      expect((refusalOf(s) || {}).guard).toBe('pine:cycle')
    }
  })
  it('a read at offset 0, a self-referencing fill or any fill form is untouched', () => {
    for (const body of [['x = 0.5*close + 0.5*nz(x[0])', 'plot(x)'], ['x = 0.5*close + 0.5*nz(x[1], x[2])', 'plot(x)'],
      ['x = 0.5*close + 0.5*nz(x[1], close)', 'plot(x)']]) {
      const { st, version } = stmtsOf(src(body))
      expect(v2SelfReferenceStatements(st, version)).toBe(st)
    }
  })
  // ⛔ Measure-pair finding (`earnings-sr-levels-lazybear`, v1): a self-reference that
  // carries a `?:` keeps master's host fold, so its below-v4 test never reaches the VM's
  // unsettled `na` reading and the script stays drawn exactly as on master.
  it('a self-reference with a ?: or iff is untouched and still builds with no na-test', () => {
    for (const body of [
      ['flag = close > open ? 1 : 0', 'lvl = (nz(flag[1]) ? hl2 : nz(lvl[1]))', 'plot(lvl)'],
      ['flag = close > open ? 1 : 0', 'lvl = iff(nz(flag[1]), hl2, nz(lvl[1]))', 'plot(lvl)'],
    ]) {
      const { st, version } = stmtsOf(src(body))
      expect(v2SelfReferenceStatements(st, version)).toBe(st)
      const p = probeRuntimeProgram(src(body))
      expect(p.ok, p.ok ? '' : `${p.refusal.guard}: ${p.refusal.message}`).toBe(true)
      expect(p.naTests).toBe(0)
    }
  })
  // ⛔ Review N1: the `?:` sits in a function the definition CALLS, out of the token
  // scan's sight. The definition is not rewritten, so the build is master's own
  // (the same statement array): whatever master answers, the rewrite never changes it.
  it('a self-reference calling a script function is untouched (master builds it as before)', () => {
    const body = ['pick(a) => nz(a) ? hl2 : 0', 'flag = close > open ? 1 : 0', 'lvl = pick(flag[1]) + 0.5*nz(lvl[1])', 'plot(lvl)']
    const { st, version } = stmtsOf(src(body))
    expect(v2SelfReferenceStatements(st, version)).toBe(st)
    const p = probeRuntimeProgram(src(body))
    expect(p.ok, p.ok ? '' : `${p.refusal.guard}: ${p.refusal.message}`).toBe(true)
  })
  it('a name declared twice or reassigned is untouched', () => {
    for (const body of [['x = 1', 'x = 0.5*close + 0.5*nz(x[1])', 'plot(x)'], ['x = 0.5*close + 0.5*nz(x[1])', 'x := 2', 'plot(x)']]) {
      const { st, version } = stmtsOf(src(body))
      expect(v2SelfReferenceStatements(st, version)).toBe(st)
    }
  })
  it('the C18 object door keeps the master answer (pine:state on the second stage)', () => {
    const r = refusalOf(src(CASCADE), { objectDoor: true, objectTrees: [] })
    expect(r && r.guard).toBe('pine:state')
    expect(r.token).toBe('s2')
  })
})
