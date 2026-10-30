// The multi-state recurrence (`accum2` / `accum3` / `accum4`,
// `closedTable.json::_functions_multi_state`, 2026-10-30).
//
// ⛔ THE REFERENCE HERE IS INDEPENDENT OF THE ENGINE. `referenceWindow` below is a
// plain loop written from the manifest's own sentence — seed every state at
// `i - W`, step all K together across `(i - W, i]` — and calls nothing in
// `interpret.js`. Comparing the engine to itself would agree with any shared
// mistake; comparing it to a loop that re-derives the definition does not.
//
// ⭐ THE FIXTURE IS THE CROSS-LANE AUTHORITY. `tests/fixtures/ast/multi_state_parity.json`
// is written from this lane (`MULTI_STATE_FIXTURE_WRITE=1`) and read by
// `tests/test_ast_multi_state_parity.py`, which holds the Python lane to it. This
// file ALSO asserts the committed fixture still matches, so neither lane can drift.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFormula, TABLE, MULTI_STATES, MULTI_STATE_BINDINGS, RECURRENCE_BINDINGS } from './parse.js'
import { interpret, nodeCount, maxLookback, MAX_RECURRENCE_STEPS } from './interpret.js'
import { astReach } from './lint.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(HERE, '../../../../../../tests/fixtures/ast/multi_state_parity.json')

/** A deterministic, gap-free synthetic series (no market data). */
function bars(n, { seed = 7, nanAt = [] } = {}) {
  let x = seed
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648 }
  let c = 100
  const out = []
  for (let i = 0; i < n; i++) {
    c = c * (1 + (rnd() - 0.5) * 0.04)
    const h = c * (1 + rnd() * 0.01)
    const l = c * (1 - rnd() * 0.01)
    const close = nanAt.includes(i) ? NaN : c
    out.push({ t: i, o: c, h, l, c: close, v: 1000 + Math.floor(rnd() * 500) })
  }
  return out
}
const col = (r) => Array.from(r)
const ast = (s) => {
  const r = parseFormula(s)
  if (!r.ok) throw new Error(`${s}: ${r.error}`)
  return r.ast
}
const refusal = (s, b = bars(40)) => {
  try { interpret(ast(s), b, {}); return null } catch (e) { return e }
}

/** The definition, written as a plain loop. `step(prev, bar) → next` returns all K. */
function referenceWindow(b, W, seeds, step) {
  const out = b.map(() => null)
  for (let i = W; i < b.length; i++) {
    let s = seeds(b[i - W])
    for (let j = i - W + 1; j <= i; j++) s = step(s, b[j], b[j - 1])
    out[i] = s
  }
  return out
}
const near = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) < 1e-9

describe('the declaration is DATA, and every reader derives from it', () => {
  it('three entries, each with K seeds, K updates and K binds, read off the manifest', () => {
    expect(Object.keys(MULTI_STATES).sort()).toEqual(['accum2', 'accum3', 'accum4'])
    for (const [name, ms] of Object.entries(MULTI_STATES)) {
      const K = ms.binds.length
      expect(ms.seeds).toHaveLength(K)
      expect(ms.updates).toHaveLength(K)
      expect(TABLE.functions[name].args).toHaveLength(2 + 2 * K)
      expect(TABLE.functions[name].args[ms.output]).toBe('int')
      expect(TABLE.functions[name].args[ms.warmup]).toBe('int')
      expect(TABLE.functions[name].lookback).toBe(`arg${ms.warmup}`)
    }
  })
  it('the binds are reserved names, never sayable series', () => {
    expect(MULTI_STATE_BINDINGS).toEqual(['state1', 'state2', 'state3', 'state4'])
    for (const b of MULTI_STATE_BINDINGS) {
      expect(RECURRENCE_BINDINGS).toContain(b)
      expect(Object.prototype.hasOwnProperty.call(TABLE.series, b)).toBe(false)
    }
  })
})

describe('the arithmetic — against an independent reference', () => {
  it('Fibonacci: both states step together from (0, 1)', () => {
    const b = bars(30)
    const a = col(interpret(ast('accum2(1, 5, 0, 1, state2, state1 + state2)'), b, {}))
    const c = col(interpret(ast('accum2(2, 5, 0, 1, state2, state1 + state2)'), b, {}))
    expect(a.slice(0, 5).every(Number.isNaN)).toBe(true)
    expect(a.slice(5).every((v) => v === 5)).toBe(true)
    expect(c.slice(5).every((v) => v === 8)).toBe(true)
  })

  it('a price-tracking two-state filter matches the plain loop on every bar', () => {
    const b = bars(260)
    const W = 40
    const src = `accum2(OUT, ${W}, close, 0, state1 + 0.3 * (close - state1) + state2, 0.1 * (close - state1))`
    const ref = referenceWindow(b, W, (s0) => [s0.c, 0], (s, bar) => [
      s[0] + 0.3 * (bar.c - s[0]) + s[1],
      0.1 * (bar.c - s[0]),
    ])
    for (const out of [1, 2]) {
      const got = col(interpret(ast(src.replace('OUT', String(out))), b, {}))
      for (let i = 0; i < b.length; i++) {
        if (i < W) { expect(Number.isNaN(got[i]), `bar ${i} is warm-up`).toBe(true); continue }
        expect(near(got[i], ref[i][out - 1]), `out ${out} bar ${i}: ${got[i]} vs ${ref[i][out - 1]}`).toBe(true)
      }
    }
  })

  it('a four-state conditional machine (trend flips with an extreme) matches the plain loop', () => {
    const b = bars(300, { seed: 11 })
    const W = 60
    // state1 trend (1 up / -1 down), state2 extreme, state3 count of bars in trend, state4 flips
    const up = '(state1 == 1 && close < state2 * 0.97)'
    const dn = '(state1 == -1 && close > state2 * 1.03)'
    const flip = `(${up} || ${dn})`
    const src = (out) => `accum4(${out}, ${W}, 1, close, 0, 0, `
      + `${flip} ? -state1 : state1, `
      + `${flip} ? close : (state1 == 1 ? max(state2, close) : min(state2, close)), `
      + `${flip} ? 0 : state3 + 1, `
      + `${flip} ? state4 + 1 : state4)`
    const ref = referenceWindow(b, W, (s0) => [1, s0.c, 0, 0], (s, bar) => {
      const f = (s[0] === 1 && bar.c < s[1] * 0.97) || (s[0] === -1 && bar.c > s[1] * 1.03)
      return [
        f ? -s[0] : s[0],
        f ? bar.c : (s[0] === 1 ? Math.max(s[1], bar.c) : Math.min(s[1], bar.c)),
        f ? 0 : s[2] + 1,
        f ? s[3] + 1 : s[3],
      ]
    })
    let flips = 0
    for (const out of [1, 2, 3, 4]) {
      const got = col(interpret(ast(src(out)), b, {}))
      for (let i = W; i < b.length; i++) {
        expect(near(got[i], ref[i][out - 1]), `out ${out} bar ${i}`).toBe(true)
        if (out === 4) flips = Math.max(flips, got[i])
      }
    }
    // ⛔ NON-VACUITY: the machine must actually flip, or the conditional arms went untested.
    expect(flips).toBeGreaterThan(0)
  })

  it('updates read LAST bar\'s values — a swap really swaps', () => {
    const b = bars(20)
    const one = col(interpret(ast('accum2(1, 3, 1, 2, state2, state1)'), b, {}))
    // three swaps from (1, 2): (2,1) (1,2) (2,1) → state1 = 2
    expect(one.slice(3).every((v) => v === 2)).toBe(true)
  })
})

describe('bounded, deterministic, window-independent', () => {
  const SRC = 'accum2(1, 30, close, 0, state1 + 0.2 * (close - state1) + state2, 0.05 * (close - state1))'

  it('the same bar has the same value whichever bar the fetch started at (panning)', () => {
    const b = bars(200)
    const full = col(interpret(ast(SRC), b, {}))
    const later = col(interpret(ast(SRC), b.slice(50), {}))
    for (let i = 50 + 30; i < 200; i++) expect(near(full[i], later[i - 50]), `bar ${i}`).toBe(true)
  })

  it('an incremental bar leaves every earlier value unchanged (incremental == full)', () => {
    const b = bars(201)
    const before = col(interpret(ast(SRC), b.slice(0, 200), {}))
    const after = col(interpret(ast(SRC), b, {}))
    for (let i = 0; i < 200; i++) expect(near(before[i], after[i]), `bar ${i}`).toBe(true)
  })

  it('a missing close poisons only the windows that contain it, then the value recovers', () => {
    const W = 10
    const b = bars(80, { nanAt: [40] })
    const got = col(interpret(ast(SRC.replace('30', String(W))), b, {}))
    // The window for bar i is the W + 1 bars [i - W, i] — the seed bar included.
    expect(Number.isNaN(got[39])).toBe(false)
    for (let i = 40; i <= 40 + W; i++) expect(Number.isNaN(got[i]), `bar ${i} contains the hole`).toBe(true)
    expect(Number.isNaN(got[41 + W])).toBe(false)
  })

  it('0 / 0 inside an update is a hole, never a zero', () => {
    const got = col(interpret(ast('accum2(1, 5, 1, 0, state1 / state2, state2)'), bars(20), {}))
    expect(got.slice(5).every(Number.isNaN)).toBe(true)
  })

  it('the two outputs of one run are computed once (one step record per run)', () => {
    const b = bars(60)
    const sink = []
    interpret(ast('accum2(1, 10, close, 0, state1 + state2, state2) + accum2(2, 10, close, 0, state1 + state2, state2)'), b, {}, undefined, undefined, { stepSink: sink })
    expect(sink.filter((r) => r.name === 'accum2')).toHaveLength(1)
  })

  it('the static readers agree: the window is the warm-up, and the badge is non-repainting', () => {
    const a = ast('accum2(1, 30, close, 0, state1 + close[1], state2)')
    expect(maxLookback(a)).toBe(31)
    expect(astReach(a)).toMatchObject({ back: 31, forward: 0 })
    expect(nodeCount(a)).toBeGreaterThan(0)
  })
})

describe('refused BY NAME — never a silent number', () => {
  const guard = (e) => e && e.guard
  it('a bind in a seed', () => expect(guard(refusal('accum2(1, 5, state1, 0, 1, 2)'))).toBe('interpret:recurrence'))
  it('a bind under an offset', () => expect(guard(refusal('accum2(1, 5, close, 0, state1[1], 2)'))).toBe('interpret:recurrence'))
  it('a bind under a windowed call', () => expect(guard(refusal('accum2(1, 5, close, 0, sma(state1, 3), 2)'))).toBe('interpret:recurrence'))
  it('a bind inside a nested recurrence', () => expect(guard(refusal('accum2(1, 5, close, 0, accum(close, self + state1, 3), 2)'))).toBe('interpret:recurrence'))
  it('a bind outside any update', () => expect(guard(refusal('state1 + 1'))).toBe('interpret:recurrence'))
  it('an output past K', () => expect(guard(refusal('accum2(3, 5, 0, 1, state2, state1)'))).toBe('resolve:window'))
  it('an output of zero', () => expect(guard(refusal('accum2(0, 5, 0, 1, state2, state1)'))).toBe('resolve:window'))
  it('a computed warm-up', () => expect(guard(refusal('accum2(1, 2 + 3, 0, 1, state2, state1)'))).toBe('resolve:window'))
  it('work past the ceiling, counted as it is done', () => {
    // Seeded from each window's own close and counting up, so no two windows ever
    // share a state and every window is stepped in full (`close[k] + (t - k)`).
    const W = 600
    const n = Math.ceil(MAX_RECURRENCE_STEPS / (W * 4)) + W + 10   // the first W bars do no work
    const e = refusal(`accum4(1, ${W}, close, close, close, close, state1 + 1, state2 + 1, state3 + 1, state4 + 1)`, bars(n))
    expect(guard(e)).toBe('interpret:steps')
  })

  it('merged windows are cheap AND identical to stepping every window in full', () => {
    // A clamp merges every window into its neighbour on the first step, so the work
    // is ~2K per bar instead of W·K — and the answer is the naive one.
    const b = bars(3000)
    const sink = []
    const got = col(interpret(ast('accum2(1, 400, 10, 0, min(state1, 5), state2)'), b, {}, undefined, undefined, { stepSink: sink }))
    expect(sink[0].steps).toBeLessThan(b.length * 2 * 4)
    expect(sink[0].worst).toBe(b.length * 400 * 2)
    expect(got.slice(400).every((v) => v === 5)).toBe(true)
    // ⛔ and a recurrence that NEVER merges (a swap: neighbouring windows sit one step
    // out of phase) is stepped in full and still exact: 400 swaps from (1, 2) read 1.
    const swap = []
    const sw = col(interpret(ast('accum2(1, 400, 1, 2, state2, state1)'), b, {}, undefined, undefined, { stepSink: swap }))
    expect(swap[0].steps).toBe((b.length - 400) * 400 * 2)
    expect(sw.slice(400).every((v) => v === 1)).toBe(true)
  })
  it('a NESTED independent accumK inside an update is fine — it binds its own names', () => {
    const b = bars(40)
    const inner = 'accum2(1, 4, 0, 1, state2, state1 + state2)'
    const got = col(interpret(ast(`accum2(1, 5, 0, 0, state1 + ${inner}, state2)`), b, {}))
    expect(got.slice(9).every((v) => v === 15)).toBe(true) // 5 steps × inner value 3
  })
})

// ─── THE CROSS-LANE FIXTURE ────────────────────────────────────────────────
const PARITY_CASES = [
  'accum2(1, 40, close, 0, state1 + 0.3 * (close - state1) + state2, 0.1 * (close - state1))',
  'accum2(2, 40, close, 0, state1 + 0.3 * (close - state1) + state2, 0.1 * (close - state1))',
  'accum3(3, 25, high, low, 0, max(state1, high), min(state2, low), state1 - state2)',
  'accum4(2, 60, 1, close, 0, 0, (state1 == 1 && close < state2 * 0.97) || (state1 == -1 && close > state2 * 1.03) ? -state1 : state1, (state1 == 1 && close < state2 * 0.97) || (state1 == -1 && close > state2 * 1.03) ? close : (state1 == 1 ? max(state2, close) : min(state2, close)), state3 + 1, state4)',
  'accum2(1, 10, 0, 0, nz(state1 / state2, close), state2 + 1)',
]
function fixtureNow() {
  const b = bars(240, { seed: 23, nanAt: [100] })
  return {
    _: 'Written by app/src/components/chart/engine/ast/multiState.test.js (MULTI_STATE_FIXTURE_WRITE=1); read by tests/test_ast_multi_state_parity.py. Synthetic bars only.',
    bars: b.map((x) => ({ t: x.t, o: x.o, h: x.h, l: x.l, c: Number.isNaN(x.c) ? null : x.c, v: x.v })),
    cases: PARITY_CASES.map((source) => ({
      source,
      ast: ast(source),
      expected: col(interpret(ast(source), b, {})).map((v) => (Number.isFinite(v) ? v : null)),
    })),
  }
}
describe('the cross-lane fixture', () => {
  it('matches this lane (and is rewritten on request)', () => {
    const now = fixtureNow()
    if (process.env.MULTI_STATE_FIXTURE_WRITE === '1') {
      fs.writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`)
    }
    const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    expect(committed.cases.map((c) => c.source)).toEqual(PARITY_CASES)
    for (let k = 0; k < now.cases.length; k++) {
      const a = now.cases[k].expected
      const b = committed.cases[k].expected
      expect(a.length).toBe(b.length)
      for (let i = 0; i < a.length; i++) {
        if (b[i] === null) { expect(a[i], `case ${k} bar ${i}`).toBe(null); continue }
        expect(Math.abs(a[i] - b[i]) < 1e-9, `case ${k} bar ${i}`).toBe(true)
      }
    }
    // ⛔ NON-VACUITY — a fixture of holes would pass any comparison.
    for (const c of committed.cases) expect(c.expected.filter((v) => v !== null).length).toBeGreaterThan(100)
  })
})
