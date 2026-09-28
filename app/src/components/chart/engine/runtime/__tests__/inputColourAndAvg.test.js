// app/src/components/chart/engine/runtime/__tests__/inputColourAndAvg.test.js
//
// ─── TWO VALUES THE COLUMNAR LANE SERVES AND THE RUNTIME LANE DID NOT ───────
//
// Both are walls a script hit only because a MUTABLE value sat next to them, which
// sends the subtree to this lane instead of the columnar one:
//
//   · `input.color(<colour>, …)` — the columnar lane refuses the KIND
//     (`pine:input-kind`: a colour is not a screenable number); this lane holds
//     colours. Its value is its DEFAULT, which is the host presentation's own rule
//     (`pine.js::staticColourOf`): a colour input is not a Track F kind, so no
//     member control can move it and the loss is disclosed by `skippedInputs`.
//     Walled kernel-channel, nadaraya-watson-rqk, deadband-hysteresis,
//     trend-targets and elliot-wave.
//   · `math.avg(a, b, …)` — the columnar lane expands it through
//     `pine.js::BUILTIN_CALL_TREE.avg` during RESOLUTION, which a subtree reading a
//     slot never gets. Walled trend-targets and implied-volatility-suite.
//
// Every expectation is computed by hand from the bars below.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { colourHexByName } from '../../ast/pine.js'
import { hexToPacked } from '../colours.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

// close 100, 101, 102, 103 — so a running sum `m` is 100, 201, 303, 406
const N = 4
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'
const RUNNING_SUM = 'var float m = 0.0\nm := m + close\n'

function run(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return res.outputs.map((o) => Array.from(o))
}
const build = (src) => buildRuntimeIr(head + src, { bars: BARS, inputs: {} })

const GREEN = hexToPacked('#00ff00', 0)
const GRAY = hexToPacked(colourHexByName('color.gray', 5), 0)

describe('⭐ `input.color(<colour>)` is its default colour in the runtime lane', () => {
  it('⭐⭐ as one arm of a ternary over MUTABLE state — the kernel-channel shape', () => {
    // m > 250 on bars 2 and 3 only
    const [colour] = run(`color c = input.color(#00ff00, "Long")\n${RUNNING_SUM}`
      + 'bgcolor(m > 250 ? c : color.gray)\nplot(m)\n')
    expect(colour.map((v) => v >>> 0)).toEqual([GRAY, GRAY, GREEN, GREEN])
  })

  it('⭐ `defval =` by name, a built-in colour name as the default, and `na` as the other arm', () => {
    const [colour] = run(`color c = input.color(defval = color.gray, title = "x")\n${RUNNING_SUM}`
      + 'bgcolor(m > 250 ? c : na)\nplot(m)\n')
    expect(Number.isNaN(colour[0]) && Number.isNaN(colour[1])).toBe(true)
    expect([colour[2] >>> 0, colour[3] >>> 0]).toEqual([GRAY, GRAY])
  })

  it('⭐ `color.new(<input colour>, t)` keeps the default\'s channels', () => {
    const [colour] = run(`color c = input.color(#00ff00, "L")\n${RUNNING_SUM}`
      + 'bgcolor(m > 250 ? color.new(c, 80) : na)\nplot(m)\n')
    expect(colour[2] & 0x00ffffff).toBe(GREEN & 0x00ffffff)
    expect(colour[2] >>> 24).not.toBe(0)
  })

  it('⛔ a default that is NOT a colour is still refused, and never painted', () => {
    const b = build(`color c = input.color(close, "L")\n${RUNNING_SUM}bgcolor(m > 250 ? c : na)\nplot(m)\n`)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:colour')
  })

  it('⛔ CONTROL — `plot` still refuses to draw an input colour as a price', () => {
    const b = build(`color c = input.color(#00ff00, "L")\n${RUNNING_SUM}plot(m > 250 ? c : color.gray)\n`)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:colour')
  })
})

describe('⭐ `math.avg(…)` over mutable state is the mean of its arguments', () => {
  it('⭐⭐ two arguments: (m + close) / 2', () => {
    // bar 0: (100+100)/2 = 100 · bar 1: (201+101)/2 = 151 · bar 2: (303+102)/2 = 202.5 · bar 3: (406+103)/2 = 254.5
    const [out] = run(`${RUNNING_SUM}plot(math.avg(m, close))\n`)
    expect(out).toEqual([100, 151, 202.5, 254.5])
  })

  it('⭐ three arguments, the v4 bare `avg` spelling', () => {
    // (m + close + 1) / 3 → 67, 101, 135.333…, 170
    const [out] = run(`${RUNNING_SUM}plot(avg(m, close, 1))\n`)
    expect(out[0]).toBe(67)
    expect(out[1]).toBe(101)
    expect(out[2]).toBeCloseTo(406 / 3, 12)
    expect(out[3]).toBe(170)
  })

  it('⭐ an `na` argument propagates, exactly as the columnar expansion does', () => {
    const [out] = run(`${RUNNING_SUM}plot(math.avg(m, close[1]))\n`)
    expect(Number.isNaN(out[0])).toBe(true)
    expect(out[1]).toBe((201 + 100) / 2)
  })

  it('⭐ a CALL and a HISTORY READ as arguments pass the canonical bridge untouched', () => {
    // `fromCanonical` spells `call` and `offset` like the parser does; a parse
    // node embedded by the builder must not be re-read as a canonical one.
    // (m + nz(close[1])) / 2 → (100+0)/2 = 50, (201+100)/2 = 150.5, (303+101)/2 = 202, (406+102)/2 = 254
    const [out] = run(`${RUNNING_SUM}plot(math.avg(m, nz(close[1])))\n`)
    expect(out).toEqual([50, 150.5, 202, 254])
  })

  it('⛔ one argument is refused by name, and a user function named `avg` keeps its own meaning', () => {
    const b = build(`${RUNNING_SUM}plot(math.avg(m))\n`)
    expect(b.ok).toBe(false)
    expect(b.refusal.message).toMatch(/averages two or more values/)
    const [out] = run(`avg(a, b) => a - b\n${RUNNING_SUM}plot(avg(m, close))\n`)
    expect(out).toEqual([0, 100, 201, 303])
  })
})
