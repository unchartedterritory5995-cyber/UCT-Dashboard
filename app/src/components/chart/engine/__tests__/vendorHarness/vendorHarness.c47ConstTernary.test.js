// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c47ConstTernary.test.js
//
// ─── C47 — A `?:` WHOSE TEST IS A CONSTANT TAKES ONE ARM (the runtime lane) ───
//
// volume-profile, line 146:
//
//     var int lookback_bars = vp_use_visible_range
//          ? math.round((last_bar_time - chart.left_visible_bar_time) / timeframe_minutes)
//          : vp_lookback_depth
//
// `vp_use_visible_range` is `input.bool(false)`. The arm it never takes reads
// `chart.left_visible_bar_time` — what is on the member's screen, which this
// engine has no answer for — and the runtime lane lowered BOTH arms of every
// `?:`, so the script was refused (`pine:builtin@146`) for a line it does not run.
//
// ⭐ WHAT IS SERVED (`pineRuntimeFrontend.js::fixedTestOf`): a test that is one
// finite number before bar 0 — a literal, constant arithmetic, a numeric or bool
// input at the value in force — takes its arm at compile time, and the other arm
// is not lowered. The columnar lane has always done this; this is the same rule
// where the expression reads a slot. ⛔ The MEMBER'S value decides: with the knob
// on, the other arm is the one lowered, and this script refuses by name.
//
// ⛔ WHAT IT DOES NOT MOVE. volume-profile stops on its NEXT wall, by name, and the
// run still does not start: `runtime:statement@154` — `ta.highest(lookback_bars)`,
// the one-argument form, over a length held in a `var`. Behind that stand
// `array.fill` (`runtime:array`), a line array updated in a function
// (`runtime:object-op`) — and the ceiling itself: the profile's own double loop
// (200 bars x 200 rows, on the last bar) costs 1,674,010 VM instructions against
// `INSTRUCTIONS_PER_BAR` = 200,000. Measured below on the vendor's loop lifted to
// the top level; the ceiling is an engine limit and is not raised.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock'
import { lowerIrProgram } from '../../runtime/lowerIr'
import { execute } from '../../runtime/vm'
import { Budget, DEFAULT_LIMITS } from '../../runtime/limits'

const HARNESS = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const VP = 'volume-profile-rddt-1d-2026-09-28.json'
const capture = (name) => {
  const loaded = loadCapture(path.join(HARNESS, name))
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}

afterEach(() => { vi.unstubAllEnvs() })

const BARS = Array.from({ length: 40 }, (_, i) => ({
  t: 20240102 + i, o: 10 + i, h: 12 + i, l: 9 + i, c: 11 + (i % 7), v: 1000 + 10 * i,
}))
const build = (lines, opts = {}) => buildRuntimeIr(['//@version=5', 'indicator("c47 ternary")', ...lines, ''].join('\n'),
  { bars: BARS, inputs: {}, pane: true, basePeriod: 'D', tf: 'D', ...runtimeClockOpts(false, { tf: 'D' }), ...opts })
const run = (built, bars = BARS, budget = undefined) => {
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  return execute(program, { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t) },
    undefined, budget ? { budget } : undefined)
}
const plotOf = (lines, opts) => {
  const built = build(lines, opts)
  expect(built.ok, JSON.stringify(built.refusal && { g: built.refusal.guard, m: built.refusal.message })).toBe(true)
  return Array.from(run(built).outputs[0])
}
const refusalOf = (lines, opts) => {
  const built = build(lines, opts)
  expect(built.ok).toBe(false)
  return built.refusal
}

// a counter: a slot, so every expression over it is lowered by the runtime lane
const N = ['var int n = 0', 'n := n + 1']
const DEAD = 'chart.left_visible_bar_time + n'

describe('⭐ C47 — a constant test takes one arm, and the other is not lowered', () => {
  it('`input.bool(false) ? <an arm this engine cannot read> : live` is `live`', () => {
    const got = plotOf(['flag = input.bool(false, "Use visible range")', ...N, `v = flag ? ${DEAD} : n * 2`, 'plot(v)'])
    const want = plotOf([...N, 'v = n * 2', 'plot(v)'])
    expect(got).toEqual(want)
    expect(got.slice(0, 3)).toEqual([2, 4, 6])               // non-vacuity: the counter runs
  })

  it('`input.bool(true) ? live : <dead>` is `live`', () => {
    const got = plotOf(['flag = input.bool(true, "On")', ...N, `v = flag ? n * 3 : ${DEAD}`, 'plot(v)'])
    expect(got.slice(0, 3)).toEqual([3, 6, 9])
  })

  it('a literal and constant arithmetic are the same case', () => {
    expect(plotOf([...N, `v = false ? ${DEAD} : n + 5`, 'plot(v)']).slice(0, 2)).toEqual([6, 7])
    expect(plotOf([...N, `v = (1 > 2) ? ${DEAD} : n + 5`, 'plot(v)']).slice(0, 2)).toEqual([6, 7])
    expect(plotOf(['k = input.int(3, "k")', ...N, `v = k > 10 ? ${DEAD} : n + k`, 'plot(v)']).slice(0, 2)).toEqual([4, 5])
  })

  it('the shape itself: a `var` seeded through the ternary, as volume-profile writes it', () => {
    const got = plotOf(['use = input.bool(false, "Use Visible Range")', 'depth = input.int(200, "Depth")',
      'var int tfm = 1000 * timeframe.in_seconds()',
      'var int look = use ? math.round((last_bar_time - chart.left_visible_bar_time) / tfm) : depth',
      ...N, 'plot(look + n)'])
    expect(got.slice(0, 3)).toEqual([201, 202, 203])
  })

  it('both arms readable: the answer is what it was (the taken arm), with and without the dead one', () => {
    const a = plotOf(['flag = input.bool(false, "f")', ...N, 'v = flag ? n * 100 : n * 2', 'plot(v)'])
    expect(a.slice(0, 3)).toEqual([2, 4, 6])
  })
})

describe('⛔ C47 — what a constant test does NOT fold', () => {
  it('⛔ the member turns the knob ON: the other arm is lowered, and it refuses by name', () => {
    const lines = ['flag = input.bool(false, "Use visible range")', ...N, `v = flag ? ${DEAD} : n * 2`, 'plot(v)']
    const r = refusalOf(lines, { inputs: { flag: 1 } })
    expect(r.guard).toBe('pine:builtin')
    expect(String(r.message)).toContain('chart.left_visible_bar_time')
    // control: the same build with the knob where the author left it compiles
    expect(build(lines).ok).toBe(true)
    expect(build(lines, { inputs: { flag: 0 } }).ok).toBe(true)
  })

  it('⛔ a test that reads a slot is not a constant: both arms are still lowered', () => {
    const r = refusalOf([...N, `v = n > 5 ? ${DEAD} : n * 2`, 'plot(v)'])
    expect(r.guard).toBe('pine:builtin')
  })

  it('⛔ a PARAMETER that shares a spelling with a top-level constant is the parameter (the frame answers, not the program)', () => {
    // `k` is 3 at the top level and 1 at this call: `1 > 2` is false, so `k * 2`
    const got = plotOf(['k = 3', 'f(k) => k > 2 ? k * 100 : k * 2', ...N, 'plot(f(1) + n)'])
    expect(got.slice(0, 3)).toEqual([3, 4, 5])
  })

  it('⛔ the LIVE arm\'s refusal is still the answer', () => {
    const r = refusalOf(['flag = input.bool(true, "On")', ...N, `v = flag ? ${DEAD} : n * 2`, 'plot(v)'])
    expect(r.guard).toBe('pine:builtin')
  })

  it('⛔ a test that depends on a TEXT input is not folded here (the columnar lane cannot see the member\'s text)', () => {
    const r = refusalOf(['mode = input.string("A", "Mode", options = ["A", "B"])', ...N, `v = mode == "B" ? ${DEAD} : n * 2`, 'plot(v)'])
    expect(r.guard).toBe('pine:builtin')
  })

  it('a test that is `na` is left to the runtime: the `?:` answers `na`, as it did', () => {
    const got = plotOf([...N, 'float q = na', 'v = q > 1 ? n * 100 : n * 2', 'plot(v)'])
    const direct = plotOf([...N, 'v = n * 2', 'plot(v)'])
    // `na > 1` is a comparison against na (0 in this lane): the else arm, on every bar
    expect(got).toEqual(direct)
  })
})

describe('C47 — volume-profile: past the dead arm, onto its next wall (by name)', () => {
  it('the runtime lane no longer stops at `chart.left_visible_bar_time`@146; it stops at `ta.highest(lookback_bars)`@154', () => {
    const cap = capture(VP)
    const built = buildRuntimeIr(cap.source.text, {
      bars: toProductBars(cap), inputs: {}, pane: true, basePeriod: 'D', tf: 'D', ...runtimeClockOpts(false, { tf: 'D' }),
    })
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('runtime:statement')
    expect(built.refusal.line).toBe(154)
    expect(String(built.refusal.message)).toContain('`ta.highest` takes a source and a length, given 1')
  }, 60000)

  it('⛔ with the member\'s knob ON it is `pine:builtin`@146 again — the arm they asked for', () => {
    const cap = capture(VP)
    const built = buildRuntimeIr(cap.source.text, {
      bars: toProductBars(cap), inputs: { vp_use_visible_range: 1 }, pane: true, basePeriod: 'D', tf: 'D',
      ...runtimeClockOpts(false, { tf: 'D' }),
    })
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('pine:builtin')
    expect(built.refusal.line).toBe(146)
  }, 60000)

  it('⛔ graded: lines 203 / 0 (the 200 held lines withheld), DIVERGE, the run not started', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const cap = capture(VP)
    const { verdict, integrity } = gradeCapture(cap)
    expect(integrity.ok).toBe(true)
    const counts = Object.fromEntries(verdict.objects.counts.map((c) => [c.family, [c.vendor, c.ours]]))
    // wave 12 (C45, integrator ruling): the 200 lines were HELD at their creation point (bar 0,
    // first close) with every later move lost - a position-unknown object. They are withheld now.
    expect(counts.lines).toEqual([203, 0])
    expect(verdict.objects.verdict).toBe('DIVERGE')
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c47_vp', name: 'c47' })
    expect(d.ok, d.reason).toBe(true)
    expect(d.translation.objectDiagnostics.runtimeRefused).toBe('runtime:statement')
    expect(d.definition.objects.runtime).toBeFalsy()
  }, 60000)

  it('⛔ and the ceiling behind the walls: the profile\'s own loop is 1,674,010 instructions on the last bar, against 200,000', () => {
    const cap = capture(VP)
    const bars = toProductBars(cap)
    // the vendor's loop body, verbatim from the captured source (lines 168–174),
    // lifted out of `calculate_vp()` to the top level; `include_vol` is what the
    // default 'Both' makes it. `array.fill` (not in this lane) is left out — it
    // would only add to the count.
    const src = cap.source.text.split(/\r?\n/)
    const at = src.findIndex((l) => l.startsWith('calculate_vp() =>'))
    expect(at).toBeGreaterThan(0)
    expect(src[at + 1].trim()).toBe('array.fill(volumes, 0)')
    const loop = src.slice(at + 2, at + 9)
    expect(loop[0]).toBe('    for i = 0 to (lookback_bars - 1)')
    expect(loop[6].trim()).toBe('array.set(volumes, j, volumes.get(j) + volume[i])')
    const body = loop.map((l) => l.replace("vp_volume_type == 'Both' ? true : (vp_volume_type == 'Bullish' ? is_bullish : not is_bullish)", 'true'))
    expect(body.join('\n')).not.toBe(loop.join('\n'))
    const script = ['//@version=5', 'indicator("c47 vp loop", overlay = true, max_bars_back = 300)',
      'int vp_num_bars = 200', 'int lookback_bars = 200',
      'var array<float> volumes = array.new_float(vp_num_bars, 0)',
      'float highest_price = ta.highest(high, lookback_bars)',
      'float lowest_price = ta.lowest(low, lookback_bars)',
      'float price_interval = (highest_price - lowest_price) / (vp_num_bars - 1)',
      'if barstate.islast', ...body, 'plot(array.max(volumes))', ''].join('\n')
    const built = buildRuntimeIr(script, { bars, inputs: {}, pane: true, basePeriod: 'D', tf: 'D', ...runtimeClockOpts(false, { tf: 'D' }) })
    expect(built.ok, JSON.stringify(built.refusal && { g: built.refusal.guard, l: built.refusal.line, m: built.refusal.message })).toBe(true)
    // ⚠️ A TEST-ONLY CEILING, to read the count; the product runs at DEFAULT_LIMITS (below).
    const budget = new Budget({ INSTRUCTIONS_PER_BAR: 50000000, TOTAL_INSTRUCTIONS: 200000000, LOOP_ITERATIONS: 50000000, ARRAY_OPERATIONS: 50000000 })
    run(built, bars, budget)
    expect(DEFAULT_LIMITS.INSTRUCTIONS_PER_BAR).toBe(200000)
    expect(budget.counts.INSTRUCTIONS_PER_BAR).toBe(1674010)
    expect(budget.counts.LOOP_ITERATIONS).toBe(40401)
    // on the product path: refused by the ceiling's own name
    let err = null
    try { run(built, bars) } catch (e) { err = e }
    expect(err && err.name).toBe('RuntimeLimitError')
    expect(String(err.message)).toContain('INSTRUCTIONS_PER_BAR')
  }, 120000)
})
