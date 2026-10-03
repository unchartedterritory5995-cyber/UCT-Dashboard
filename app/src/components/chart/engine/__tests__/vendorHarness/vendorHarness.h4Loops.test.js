// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h4Loops.test.js
//
// ─── ⭐⭐ H4 (step 76) — LOOPS: THE RUNTIME LANE'S WALLS IN FRONT OF THEM ────
//
// Ruling R7 puts a numeric accumulator in a counted `for` on the RUNTIME lane
// (the per-bar VM, which executes the loop as written). That lane already runs a
// counted `for`; what stopped the loop scripts were walls IN FRONT of the loop:
//
//   (1) a call-site length that is constant ARITHMETIC (`pine_wma(v, vl1 + vl2)`,
//       volume-divergence-by-mm) — `constantArgOf` folded a bare input, not a sum;
//   (2) a helper whose body ENDS in an `if` around a loop (`f_init` in
//       kalman-price-filter-backquant) — only a bare trailing loop was valueless;
//   (3) `array.size(array.from(src))` as a loop bound (nadaraya-watson) — the
//       argument count, a constant on every bar;
//   (4) a REFUSED row's `display.none` / `offset` never reached the runtime
//       document (a spread dropped the non-enumerable facts), so it drew a plot
//       TradingView hides and a shifted plot on the wrong bar.
//
// No TradingView capture of any loop script exists. The evidence is the program's
// second rule: the runtime lane's columns on NYSE:RDDT's 631 listing bars against
// a HAND REPLAY written from Pine's semantics (a `for` runs `from` to `to`
// inclusive; `x[i]` before the first bar is `na`; `na` in `+` is `na`; an `na`
// comparison is false).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { loadCapture } from './harness'
import { toProductBars, enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import { computeRuntimeColumns, probeRuntimeProgram } from '../../runtime/runtimeColumns'

const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const BARS_FROM = 'trendlines-rddt-1d-2026-09-27.json' // RDDT 1D, starts at the listing

const corpus = (slug) => {
  const f = fs.readdirSync(CORPUS).find((x) => x.split('__')[0] === slug)
  return fs.readFileSync(path.join(CORPUS, f), 'utf8')
}
let CAP = null
const cap = () => {
  if (CAP) return CAP
  const loaded = loadCapture(path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', BARS_FROM))
  if (!loaded.capture) throw new Error(loaded.reason)
  expect(loaded.capture.history.startsAtBar0).toBe(true)
  CAP = loaded.capture
  return CAP
}
const isNa = (v) => v === null || v === undefined || Number.isNaN(v)
const plotIndex = (source, nth = 0) => {
  const probe = probeRuntimeProgram(source)
  expect(probe.ok, JSON.stringify(probe.refusal)).toBe(true)
  const ks = probe.outputs.map((o, k) => (o.call === 'plot' ? k : -1)).filter((k) => k >= 0)
  return ks[nth]
}
const runtime = (source, k) => computeRuntimeColumns(
  { id: 'h4', compute: { fn: 'h4', source, outputs: { v: k } } },
  toProductBars(cap()), { tf: 'D', newestBarIsForming: false, historyFromListing: true }).v

/** Same na-ness, and equal to 1e-9 relative where drawn. Returns the drawn count. */
const sameColumn = (got, want, label) => {
  expect(got.length).toBe(want.length)
  let drawn = 0
  for (let i = 0; i < want.length; i += 1) {
    expect(isNa(got[i]), `${label} bar ${i} na-ness`).toBe(isNa(want[i]))
    if (!isNa(want[i])) {
      drawn += 1
      expect(Math.abs(got[i] - want[i]), `${label} bar ${i}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want[i])))
    }
  }
  return drawn
}
const series = () => {
  const rows = cap().bars.rows
  return {
    n: rows.length,
    open: rows.map((r) => r[1]),
    close: rows.map((r) => r[4]),
    volume: rows.map((r) => r[5]),
  }
}
const at = (arr, t, i) => (t - i >= 0 ? arr[t - i] : NaN)

afterEach(() => {
  registry.uninstallUserDefinition(HARNESS_DEF_ID)
  vi.unstubAllEnvs()
})

const WMA_BODY = `pine_wma(x, y) =>
    norm = 0.0
    sum = 0.0
    for i = 0 to y - 1
        weight = (y - i) * y
        norm := norm + weight
        factor = close[i] < open[i] ? -1 : 1
        sum := sum + (x[i] * weight * factor)
    sum / norm
`
const wmaScript = (lenExpr) => `//@version=4
study("t")
vl1 = input(defval=5, title="F", type=input.integer)
vl2 = input(defval=8, title="G", type=input.integer)
vl3 = vl1 + vl2
${WMA_BODY}plot(pine_wma(volume, ${lenExpr}))
`

describe('H4 (1) — a call-site length that is constant arithmetic', () => {
  it('⭐ `pine_wma(volume, vl1 + vl2)` runs a 13-pass loop, equal to the hand replay on every bar', () => {
    const src = wmaScript('vl3')
    const got = runtime(src, plotIndex(src))
    const { n, open, close, volume } = series()
    const y = 13
    const want = Array.from({ length: n }, (_, t) => {
      let norm = 0
      let sum = 0
      for (let i = 0; i <= y - 1; i += 1) {
        const w = (y - i) * y
        norm += w
        const f = at(close, t, i) < at(open, t, i) ? -1 : 1 // an na comparison is false
        sum += at(volume, t, i) * w * f // na + … is na
      }
      return sum / norm
    })
    expect(sameColumn(got, want, 'pine_wma(volume, 13)')).toBe(n - 12)
  })

  it('the sum written inline at the call site folds the same', () => {
    const a = wmaScript('vl3')
    const b = wmaScript('vl1 + vl2')
    sameColumn(runtime(b, plotIndex(b)), runtime(a, plotIndex(a)), 'inline sum')
  })

  it('⛔ a `/` or `%` length keeps its refusal (Pine\'s integer division is version-dependent)', () => {
    for (const e of ['vl3 / 2', 'vl3 % 5']) {
      const p = probeRuntimeProgram(wmaScript(e))
      expect(p.ok, e).toBe(false)
      expect(p.refusal.guard, e).toBe('runtime:history-dynamic-offset')
    }
  })

  it('volume-divergence-by-mm is past the length wall (its next wall is `pivotlow` over state)', () => {
    const p = probeRuntimeProgram(corpus('volume-divergence-by-mm'))
    expect(p.ok).toBe(false)
    expect(p.refusal.guard).toBe('runtime:call-windowed-state')
  })
})

describe('H4 (2) — a helper whose body ends in an `if` around a loop is valueless', () => {
  it('⭐ kalman-price-filter-backquant builds, and its filter equals the hand replay on every bar', () => {
    const src = corpus('kalman-price-filter-backquant')
    const got = runtime(src, plotIndex(src))
    const { n, close } = series()
    const N = 5
    const pn = 0.01
    const mn = 3.0
    let state = new Array(N).fill(NaN)
    let cov = new Array(N).fill(100.0)
    const want = []
    for (let t = 0; t < n; t += 1) {
      const price = close[t]
      if (Number.isNaN(state[0])) { state = state.map(() => price); cov = cov.map(() => 1.0) }
      const pred = state.slice()
      const pcov = cov.map((c) => c + pn)
      for (let i = 0; i < N; i += 1) {
        const kg = pcov[i] / (pcov[i] + mn)
        state[i] = pred[i] + kg * (price - pred[i])
        cov[i] = (1 - kg) * pcov[i]
      }
      want.push(state[0])
    }
    expect(sameColumn(got, want, 'Kalman')).toBe(n)
  })

  it('⛔ reading such a helper\'s value is refused by name at the call site', () => {
    const src = `//@version=5
indicator("t")
f(x) =>
    y = 0.0
    if x > 0
        for i = 0 to 2
            y := y + i
v = f(close)
plot(v)
`
    const p = probeRuntimeProgram(src)
    expect(p.ok).toBe(false)
    expect(p.refusal.guard).toBe('runtime:function')
    expect(p.refusal.message).toMatch(/`f`/)
  })

  it('control: a helper whose trailing `if` ends in a VALUE still returns it', () => {
    const src = `//@version=5
indicator("t")
f(x) =>
    if x > 0
        x * 2
    else
        x
plot(f(close))
`
    const got = runtime(src, plotIndex(src))
    const { close } = series()
    sameColumn(got, close.map((c) => (c > 0 ? c * 2 : c)), 'if-valued helper')
  })
})

describe('H4 (3) — `array.size(array.from(…))` is the argument count', () => {
  it('⭐ nadaraya-watson\'s kernel (a 27-pass loop bounded by it) equals the hand replay', () => {
    const src = corpus('nadaraya-watson-rational-quadratic-kernel-non-repainting')
    const got = runtime(src, plotIndex(src, 0))
    const { n, close } = series()
    const h = 8
    const r = 8
    const x0 = 25
    const size = 1
    const want = Array.from({ length: n }, (_, t) => {
      let cw = 0
      let cum = 0
      for (let i = 0; i <= size + x0; i += 1) {
        const w = (1 + (i ** 2) / ((h ** 2) * 2 * r)) ** -r
        cw += at(close, t, i) * w
        cum += w
      }
      return cw / cum
    })
    expect(sameColumn(got, want, 'yhat1')).toBe(n - 26)
  })

  it('a three-element `array.from` is 3, read through a once-bound name', () => {
    const src = `//@version=5
indicator("t")
n = array.size(array.from(open, high, close))
s = 0.0
for i = 0 to n - 1
    s := s + close[i]
plot(s)
`
    const got = runtime(src, plotIndex(src))
    const { close } = series()
    sameColumn(got, close.map((_, t) => at(close, t, 0) + at(close, t, 1) + at(close, t, 2)), 'from-3')
  })

  it('⛔ a PARAMETER spelled like a once-bound global is the argument, never the global count', () => {
    const src = `//@version=5
indicator("t")
n = array.size(array.from(open, high, close))
f(n) =>
    s = 0.0
    for i = 0 to n - 1
        s := s + close[i]
    s
plot(f(2))
`
    const got = runtime(src, plotIndex(src))
    const { close } = series()
    sameColumn(got, close.map((_, t) => at(close, t, 0) + at(close, t, 1)), 'shadowed n')
  })

  it('⛔ an element that is a CALL is not folded by the lowering (its effects would be skipped)', () => {
    const src = `//@version=5
indicator("t")
n = array.size(array.from(ta.sma(close, 3)))
plot(n)
`
    const p = probeRuntimeProgram(src)
    expect(p.ok).toBe(false)
  })
})

describe('H4 (4) — a refused row\'s `display.none` and `offset` reach the runtime document', () => {
  const SRC = `//@version=5
indicator("t")
s = 0.0
for i = 0 to 2
    s := s + close[i]
plot(s, "vis")
plot(s * 2, "hid", display=display.none)
plot(s, "shift", offset=-2)
`
  it('⭐ the hidden plot is not drawn, the shifted one is withheld by name, the visible one is drawn', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const door = enterMemberDoor(SRC)
    expect(door.def, door.refusal).toBeTruthy()
    expect(door.built.lane).toBe('runtime')
    expect((door.built.rows || []).map((r) => r.label)).toEqual(['vis'])
    expect(door.built.withheld).toEqual(['shift'])
  })

  it('⭐ R7 by the runtime lane: the counted-`for` running total is close + close[1] + close[2]', () => {
    const got = runtime(SRC, plotIndex(SRC, 0))
    const { close } = series()
    sameColumn(got, close.map((_, t) => at(close, t, 0) + at(close, t, 1) + at(close, t, 2)), 'running total')
  })
})
