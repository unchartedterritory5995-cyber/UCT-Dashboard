// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c48IntAvgNeg.test.js
//
// ─── C48 — A FLOAT HANDED TO AN `int` X, WHEN IT IS NEGATIVE ───────────────────
//
// C43 served `l.set_x2(l.get_x1() + a.avg() + 1)` with the fraction dropped, for
// a NON-NEGATIVE sum only: its capture's sums were all positive, where truncation
// toward zero and floor are the same number. The probe that tells them apart was
// taken — `vw-int-array-avg-neg-spy-1d-2026-10-01` (AMEX:SPY 1D, probe
// `tools/visual_conformance/probes/vw-int-array-avg-neg.pine`):
//
//   Z01  x1 = 0, mean −1.5:  x1 + mean + 1 = −0.5  →  0    (floor: −1)
//   Z02  mean −2.5:  −1.5 → −1  (floor: −2)      Z04  mean −3.5:  −2.5 → −2  (floor: −3)
//   Z03  mean −0.5:  0.5 → 0  (control: the same either way)
//   Y01–Y03  `l.set_x2(a.avg())`, means −1.5 / −2.5 / −0.5  →  −1, −2, 0
//   N01–N03  the same means on a line whose x1 is far from 0  →  −1, −2, 0
//   P01  control, mean 1.5, x1 = 0  →  2
//   A14–A16  `int(-1.5)` = −1, `math.floor(-1.5)` = −2, `math.round(-1.5)` = −2
//
// TRUNCATION TOWARD ZERO — and no runtime error: a line anchored at a negative
// bar index exists (11 lines held).
//
// ⛔ As in C43, the probe itself is not graded end to end: the door refuses its
// `array.from(…)` arrays read through a method and a drawing function called in
// an expression, by name. The rail REPLAYS the probe's arithmetic in the
// spelling the door serves (`var` arrays filled by `push`, the line made once
// and moved), over the capture's own bars; every expectation is READ OFF THE
// FIXTURE, never typed.
import { describe, it, expect } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { translatePine } from '../../ast/pine'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/vw-int-array-avg-neg-spy-1d-2026-10-01.json')
const load = () => {
  const loaded = loadCapture(FILE)
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}
/** `Z01 x2 mean -1.5 x1 0|0` → `{ Z01: '0', … }`, off the capture's label texts. */
const answers = (cap) => Object.fromEntries(cap.objects.records.labels.map((l) => {
  const [head, value] = String(l.t).split('|')
  return [head.split(' ')[0], value]
}))

const LF = String.fromCharCode(10)
// The probe's five int arrays, as `var` arrays filled by `push` on the first two bars.
const ARRAYS = [
  ['m15', '0 - (bar_index + 1)'],   // [-1, -2]  mean −1.5
  ['m25', '0 - (bar_index + 2)'],   // [-2, -3]  mean −2.5
  ['m05', '0 - bar_index'],         // [0, -1]   mean −0.5
  ['m35', '0 - (bar_index + 3)'],   // [-3, -4]  mean −3.5
  ['p15', 'bar_index + 1'],         // [1, 2]    mean 1.5
]
// row → [line name, how it is made (`f_zero` / `f_bare` / `f_far` in the probe), the array]
const ROWS = [
  ['Z01', 'zero', 'm15'], ['Z02', 'zero', 'm25'], ['Z03', 'zero', 'm05'], ['Z04', 'zero', 'm35'], ['P01', 'zero', 'p15'],
  ['Y01', 'bare', 'm15'], ['Y02', 'bare', 'm25'], ['Y03', 'bare', 'm05'],
  ['N01', 'far', 'm15'], ['N02', 'far', 'm25'], ['N03', 'far', 'm05'],
]
const SCRIPT = [
  '//@version=6',
  'indicator("c48 int avg neg", overlay = true, max_labels_count = 100, max_lines_count = 50)',
  ...ARRAYS.flatMap(([w, v]) => [
    `var ${w} = array.new<int>()`,
    'if bar_index < 2',
    `    ${w}.push(${v})`,
    `if ${w}.size() > 5`,
    `    ${w}.shift()`,
  ]),
  ...ROWS.flatMap(([row, how, w]) => {
    const l = `l_${row}`
    const made = how === 'far' ? 'line.new(bar_index - 20, close, bar_index - 10, close)' : 'line.new(0, close, 10, close)'
    const moved = how === 'bare' ? `${l}.set_x2(${w}.avg())` : `${l}.set_x2(${l}.get_x1() + ${w}.avg() + 1)`
    return [`var line ${l} = na`, 'if bar_index == 30', `    ${l} := ${made}`, 'if bar_index > 30', `    ${moved}`]
  }),
  'plot(close)',
  '',
].join(LF)

const runReplay = (cap) => {
  const bars = toProductBars(cap)
  const t = translatePine(SCRIPT, { strict: true })
  expect(t.objects, JSON.stringify(t.objectDiagnostics && t.objectDiagnostics.dropReasons)).toBeTruthy()
  const reader = objectReaderFor({ objects: t.objects }, bars, { tf: 'D', newestBarIsForming: false })
  const run = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return { t, run, bars }
}

describe('C48 — the capture: a negative float handed to an `int` x is truncated TOWARD ZERO', () => {
  it('⭐ Z / Y / N / P are what truncation reads, and Z01 / Z02 / Z04 / Y01–Y03 are NOT what floor reads', () => {
    const r = answers(load())
    expect([r.Z01, r.Z02, r.Z03, r.Z04]).toEqual(['0', '-1', '0', '-2'])
    expect([r.Y01, r.Y02, r.Y03]).toEqual(['-1', '-2', '0'])
    expect([r.N01, r.N02, r.N03]).toEqual(['-1', '-2', '0'])
    expect(r.P01).toBe('2')
    const sums = { Z01: -0.5, Z02: -1.5, Z03: 0.5, Z04: -2.5, Y01: -1.5, Y02: -2.5, Y03: -0.5, P01: 2.5 }
    for (const [row, sum] of Object.entries(sums)) expect(r[row], row).toBe(String(Math.trunc(sum) + 0))
    const floorDiffers = Object.entries(sums).filter(([row, sum]) => String(Math.floor(sum)) !== r[row]).map(([row]) => row)
    expect(floorDiffers).toEqual(['Z01', 'Z02', 'Z04', 'Y01', 'Y02', 'Y03'])
    // the controls the probe prints beside them
    expect([r.A14, r.A15, r.A16]).toEqual(['-1', '-2', '-2'])
    expect([r.A10, r.A11, r.A12, r.A13]).toEqual(['-1.5', '-2', '-3', '-1'])
  })

  it('⭐ a line anchored at a negative bar index is not an error: the study ran, and holds its eleven lines', () => {
    const cap = load()
    expect(cap.study.status.type).toBe(2)
    expect(cap.objects.counts.lines).toBe(11)
    expect(cap.objects.counts.labels).toBe(18)
  })
})

describe('C48 — replayed on the capture\'s bars: our lines end where TradingView\'s do', () => {
  it('⭐⭐ every row: `get_x2()` (Z, Y, P) and `get_x2() - get_x1()` (N) are TradingView\'s numbers', () => {
    const cap = load()
    const want = answers(cap)
    const { t, run } = runReplay(cap)
    expect(t.objectDiagnostics.droppedOps, JSON.stringify(t.objectDiagnostics.dropReasons)).toBe(0)
    expect(run.status).toBe('ok')
    const lines = run.live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)
    // ⛔ nothing is held any more: all eleven are served, the negative ones included
    expect(lines).toHaveLength(ROWS.length)
    expect(run.stats.objectsTainted || 0).toBe(0)
    expect(run.stats.truncNegative).toBeUndefined()
    ROWS.forEach(([row, how], i) => {
      const l = lines[i]
      const ours = how === 'far' ? l.props.x2 - l.props.x1 : l.props.x2
      expect(String(ours), row).toBe(want[row])
      expect(Number.isInteger(l.props.x2), row).toBe(true)
      // −0.5 is 0, never −0
      expect(Object.is(l.props.x2, -0), row).toBe(false)
    })
  }, 120000)

  it('🔴 CONTROL — floor is a different picture: six of the eleven rows would move', () => {
    const cap = load()
    const want = answers(cap)
    const { run } = runReplay(cap)
    const lines = run.live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)
    const means = { m15: -1.5, m25: -2.5, m05: -0.5, m35: -3.5, p15: 1.5 }
    const moved = ROWS.filter(([row, how, w]) => {
      const floored = how === 'bare' ? Math.floor(means[w]) : how === 'far' ? Math.floor(10 + means[w] + 1) - 10 : Math.floor(means[w] + 1)
      return String(floored) !== want[row]
    }).map(([row]) => row)
    expect(moved).toEqual(['Z01', 'Z02', 'Z04', 'Y01', 'Y02', 'Y03'])
    expect(lines.filter((l) => l.props.x2 < 0).length).toBeGreaterThanOrEqual(4)
  }, 120000)
})
