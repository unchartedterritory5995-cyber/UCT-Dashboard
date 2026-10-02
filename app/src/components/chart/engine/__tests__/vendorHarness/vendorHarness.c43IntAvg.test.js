// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c43IntAvg.test.js
//
// ─── C43 — `array.avg` OF AN `array<int>`, AND A FLOAT HANDED TO AN `int` X ─────
//
// Captured on a live TradingView chart 2026-09-30 (AMEX:SPY 1D, 4,800 bars),
// probe `tools/visual_conformance/probes/vw-int-array-avg.pine` (Q-C32-1). C32
// left trend-duration's line unbuilt because nothing said how Pine rounds
// `LengthLine.get_x1() + bullishCount.avg() + 1` into the `int` that `set_x2`
// takes. The capture says:
//
//   * `array<int>.avg()` is the EXACT FLOAT MEAN — 1.5, 1.33…, 1.67…, 2.5, −1.5
//     as plot values, equal to the `array<float>` control and to a `var` array
//     filled by `push`;
//   * `str.tostring(mean)` prints it to TEN DECIMALS (`1.3333333333`, not ten
//     significant digits — ⚰️ this lane printed `1.333333333` until C43);
//     `str.tostring(mean, "##")` rounds HALF AWAY FROM ZERO — `2`, `1`, `2`, `3`, `-2`;
//   * `l.set_x2(l.get_x1() + a.avg() + 1)` then `l.get_x2() - l.get_x1()` is 2,
//     2, 2 for means 1.5 / 1.33 / 1.67 and 3 for 2.5 — the float is TRUNCATED.
//     ⚠️ Every measured sum is positive: truncation and floor are not told apart,
//     so a NEGATIVE result is not served — the coordinate is held, by name.
//
// ⛔ The probe itself is not graded end to end: this door refuses its
// `array.from(…)` arrays read through a method (`pine:type i1.avg`), by name.
// So the rail REPLAYS the probe's arithmetic in the spelling the door serves —
// `var` arrays filled by `push`, trend-duration's own (the capture's P01–P03 and
// R18 / R19 / X05 / X06 witness that spelling reads the same) — over the
// capture's own bars, and every expectation is READ OFF THE FIXTURE, never typed.
import { describe, it, expect } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { translatePine } from '../../ast/pine'
import { assertObjectProgram, OBJECT_PROGRAM_VERSION } from '../../ast/objectProgram'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/vw-int-array-avg-spy-1d-2026-09-30.json')

const load = () => {
  const loaded = loadCapture(FILE)
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}
/** `R06 int[1,2] ##|2` → `{ R06: '2', … }`, off the capture's label texts. */
const answers = (cap) => Object.fromEntries(cap.objects.records.labels.map((l) => {
  const [head, value] = String(l.t).split('|')
  return [head.split(' ')[0], value]
}))
/** The capture's constant plot rows, by title. */
const plotValue = (cap, title) => {
  const p = cap.study.plots.find((x) => String(x.title || x.name || '').startsWith(title))
    || null
  const styles = cap.study.styles || {}
  const id = p ? p.id : Object.keys(styles).find((k) => String(styles[k].title || '').startsWith(title))
  const col = cap.plotValues.fields.indexOf(id)
  if (col < 0) throw new Error(`no plot ${title}`)
  const seen = new Set(cap.plotValues.rows.map((r) => r[col]))
  if (seen.size !== 1) throw new Error(`${title} is not constant`)
  return [...seen][0]
}

const LF = String.fromCharCode(10)
// The probe's five int arrays, as `var` arrays filled by `push` on the first bars.
const WINDOWS = [
  ['i1', 2, 'bar_index + 1'],                 // [1, 2]      mean 1.5
  ['i2', 3, 'bar_index < 2 ? 1 : 2'],         // [1, 1, 2]   mean 1.33…
  ['i3', 3, 'bar_index < 1 ? 1 : 2'],         // [1, 2, 2]   mean 1.67…
  ['i4', 2, 'bar_index + 2'],                 // [2, 3]      mean 2.5
  ['i5', 2, '0 - (bar_index + 1)'],           // [-1, -2]    mean −1.5
]
const SCRIPT = [
  '//@version=6',
  'indicator("c43 int avg", overlay = true, max_labels_count = 100, max_lines_count = 50)',
  ...WINDOWS.flatMap(([w, n, v]) => [
    `var ${w} = array.new<int>()`,
    `if bar_index < ${n}`,
    `    ${w}.push(${v})`,
    `if ${w}.size() > 5`,
    `    ${w}.shift()`,
  ]),
  ...WINDOWS.flatMap(([w]) => [
    `var line l_${w} = na`,
    'if bar_index == 30',
    `    l_${w} := line.new(bar_index, close, bar_index + 9, close)`,
    'if bar_index > 30',
    // i5's mean is negative: `+ 1` keeps the sum positive (x1 + −1.5 + 1), so the
    // NEGATIVE case below subtracts past zero instead
    `    l_${w}.set_x2(l_${w}.get_x1() + ${w}.avg() + 1)`,
  ]),
  'var line l_neg = na',
  'if bar_index == 30',
  '    l_neg := line.new(bar_index, close, bar_index + 9, close)',
  'if bar_index > 30',
  '    l_neg.set_x2(l_neg.get_x1() + i5.avg() - 100)',
  'if barstate.islast',
  ...WINDOWS.flatMap(([w]) => [
    `    label.new(bar_index, close, "PLAIN ${w}|" + str.tostring(${w}.avg()))`,
    `    label.new(bar_index, close, "HASH ${w}|" + str.tostring(${w}.avg(), "##"))`,
  ]),
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

describe('C43 — the capture itself: an int array\'s average is the float mean', () => {
  it('⭐ A01–A07 are the exact means, equal to the float control and to the `var` + `push` spelling', () => {
    const cap = load()
    expect(cap.plotValues.rows.length).toBe(4800)
    const a = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07'].map((k) => plotValue(cap, k))
    expect(a).toEqual([1.5, 4 / 3, 5 / 3, 2.5, -1.5, -4 / 3, -5 / 3])
    expect(['B01', 'B02', 'B03'].map((k) => plotValue(cap, k))).toEqual(a.slice(0, 3))
    expect(['P01', 'P02', 'P03'].map((k) => plotValue(cap, k))).toEqual(a.slice(0, 3))
    // no rounding inside `avg`: twice 1.5 is 3 (4 if it had been rounded, 2 if truncated)
    expect(['D01', 'D02', 'D03'].map((k) => plotValue(cap, k))).toEqual([3, 4, 5])
  })

  it('⭐ the texts: the float printed, `"##"` half away from zero, the x difference truncated', () => {
    const r = answers(load())
    expect([r.R01, r.R02, r.R03, r.R04, r.R05]).toEqual(['1.5', '1.3333333333', '1.6666666667', '2.5', '-1.5'])
    expect([r.R06, r.R07, r.R08, r.R09, r.R10]).toEqual(['2', '1', '2', '3', '-2'])
    // the float control formats the same, and so does the `var` + `push` array
    expect([r.R14, r.R15, r.R16, r.R17]).toEqual(['2', '1', '2', '3'])
    expect([r.R18, r.R19]).toEqual([r.R01, r.R06])
    expect([r.X01, r.X02, r.X03, r.X04, r.X05, r.X06]).toEqual(['2', '2', '2', '3', '2', '2'])
  })
})

describe('C43 — replayed on the capture\'s bars: our texts and our line are TradingView\'s', () => {
  it('⭐ `str.tostring(avg)` and `str.tostring(avg, "##")` print what TradingView printed', () => {
    const cap = load()
    const want = answers(cap)
    const { t, run } = runReplay(cap)
    expect(t.objectDiagnostics.droppedOps, JSON.stringify(t.objectDiagnostics.dropReasons)).toBe(0)
    expect(run.status).toBe('ok')
    const ours = Object.fromEntries(run.live.filter((o) => o.family === 'label')
      .map((o) => String(o.props.text).split('|')))
    // probe label ↔ replay label, by the array each reads
    const plain = { i1: 'R01', i2: 'R02', i3: 'R03', i4: 'R04', i5: 'R05' }
    const hash = { i1: 'R06', i2: 'R07', i3: 'R08', i4: 'R09', i5: 'R10' }
    for (const [w, k] of Object.entries(plain)) expect(ours[`PLAIN ${w}`], `${k} (${w})`).toBe(want[k])
    for (const [w, k] of Object.entries(hash)) expect(ours[`HASH ${w}`], `${k} (${w})`).toBe(want[k])
    // ⛔ NON-VACUITY: the halves are in play, both signs (a round-half-even or a
    // round-half-up formatter prints `2` for 2.5 or `-1` for −1.5)
    expect(ours['HASH i4']).toBe('3')
    expect(ours['HASH i5']).toBe('-2')
  }, 120000)

  it('⭐ `l.set_x2(l.get_x1() + a.avg() + 1)`: `get_x2() - get_x1()` is TradingView\'s — the fraction dropped', () => {
    const cap = load()
    const want = answers(cap)
    const { run } = runReplay(cap)
    const lines = run.live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)
    // six served lines, in creation order i1 … i5, then the negative one (below)
    expect(lines).toHaveLength(6)
    const dx = lines.map((l) => l.props.x2 - l.props.x1)
    expect(dx.slice(0, 4).map(String)).toEqual([want.X01, want.X02, want.X03, want.X04])
    // ⛔ NON-VACUITY: rounding would say 3 for 1.5 + 1 and 1.67 + 1; a ceiling 3 for all
    expect(dx.slice(0, 4)).toEqual([2, 2, 2, 3])
    // and the capture's own line records agree: x2 − x1 is one rank step for the
    // first three and two for `[2, 3]` (the probe's four `array.from` lines)
    const ranks = cap.objects.records.lines.slice(0, 4).map((l) => l.x2 - l.x1)
    expect(ranks).toEqual([1, 1, 1, 2])
    // i5: x1 + (−1.5) + 1 = x1 − 0.5, a positive sum whose fraction is dropped
    expect(dx[4]).toBe(-1)
    for (const l of lines) expect(Number.isInteger(l.props.x2)).toBe(true)
  }, 120000)

  // ⭐ C48 re-pin — this read "a NEGATIVE sum is not served … the line is held".
  // This capture could not tell truncation from floor (its sums are positive);
  // `vw-int-array-avg-neg-spy-1d-2026-10-01` does — toward zero, and a line at a
  // negative bar index is no error (`vendorHarness.c48IntAvgNeg`). So the sixth
  // line is served: x1 + (−1.5) − 100 = −71.5 on a line made at bar 30 → −71.
  it('⭐ C48 — a NEGATIVE sum is truncated toward zero and served: the sixth line ends at bar −71', () => {
    const cap = load()
    const { run } = runReplay(cap)
    expect(run.stats.truncNegative).toBeUndefined()
    const lines = run.live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)
    expect(lines).toHaveLength(6)
    expect(lines[5].props.x1).toBe(30)
    expect(lines[5].props.x2).toBe(-71)
    expect(Math.floor(30 - 1.5 - 100)).toBe(-72)   // what floor would have written
    expect(run.stats.objectsTainted || 0).toBe(0)
    expect(run.status).toBe('ok')
  }, 120000)
})

describe('C43 — a getter in arithmetic is a BAR coordinate, and nothing wider', () => {
  const tr = (lines) => translatePine(['//@version=6', 'indicator("c43", overlay = true)', ...lines, 'plot(close)', ''].join(LF),
    { strict: true })
  const ops = (t) => (t.objects ? t.objects.ops : [])
  const HEAD = ['var line l = na', 'if bar_index == 5', '    l := line.new(bar_index, close, bar_index + 1, close)']

  it('⭐ `get + number`, `int(math.avg(get, get))` and a bare `get` in `x2`: one `trunc` over the value operators', () => {
    const t = tr([...HEAD, 'if bar_index > 5', '    l.set_x2(l.get_x1() + 3)',
      'var label b = na', 'if bar_index == 5', '    b := label.new(bar_index, close, "m")',
      'if bar_index > 5', '    b.set_x(int(math.avg(l.get_x1(), l.get_x2())))'])
    expect(t.objectDiagnostics.droppedOps, JSON.stringify(t.objectDiagnostics.dropReasons)).toBe(0)
    const sets = ops(t).filter((o) => o.k === 'update')
    expect(sets.map((o) => Object.values(o.props)[0].op)).toEqual(['trunc', 'trunc'])
    // ⛔ never doubled: `int(…)` IS the truncation
    expect(sets[1].props.x.args[0].op).toBe('/')
  })

  it('⛔ a PRICE read off a getter in arithmetic stays refused, by name', () => {
    const t = tr([...HEAD, 'if bar_index > 5', '    l.set_y2(l.get_y1() + 1)'])
    expect(ops(t).some((o) => o.k === 'update' && o.props && o.props.y2 && !o.propWithhold)).toBe(false)
    expect(t.objectDiagnostics.dropReasons['update:props']).toBe(1)
  })

  it('⛔ `*` over a getter, and a getter\'s own arithmetic inside a loop body, stay refused', () => {
    const t = tr([...HEAD, 'if bar_index > 5', '    l.set_x2(l.get_x1() * 2)'])
    expect(t.objectDiagnostics.dropReasons['update:props']).toBe(1)
    const u = tr([...HEAD, 'if bar_index > 5', '    for i = 0 to 1', '        l.set_x2(l.get_x1() + i)'])
    expect(JSON.stringify(ops(u))).not.toContain('"trunc"')
  })

  it('⛔ the validator: state arithmetic is legal in a bar coordinate only, and never in a loop body', () => {
    const GET = { v: 'get', target: { r: 'reg', id: 'r0' }, prop: 'x1' }
    const arith = { v: 'op', op: 'trunc', args: [{ v: 'op', op: '+', args: [GET, { v: 'const', value: 1 }] }] }
    const P = (opList) => ({
      programVersion: OBJECT_PROGRAM_VERSION, regs: [{ id: 'r0', family: 'line' }], colls: [], ops: opList, trees: [],
    })
    const create = { k: 'create', family: 'line', site: 's1', into: 'r0', when: null,
      props: { x1: { v: 'bar' }, y1: { v: 'const', value: 1 }, x2: { v: 'bar' }, y2: { v: 'const', value: 1 } } }
    const upd = (props) => ({ k: 'update', target: { r: 'reg', id: 'r0' }, when: null, props })
    expect(() => assertObjectProgram(P([create, upd({ x2: arith })]))).not.toThrow()
    expect(() => assertObjectProgram(P([create, upd({ y2: arith })]))).toThrow(/legal only in a guard/)
    const loop = { k: 'loop', id: 'i', from: { v: 'const', value: 0 }, to: { v: 'const', value: 1 }, body: [upd({ x2: arith })] }
    expect(() => assertObjectProgram(P([create, loop]))).toThrow()
    // an unknown one-argument operator is still refused
    expect(() => assertObjectProgram(P([create, upd({ x2: { v: 'op', op: 'floor', args: [GET] } })]))).toThrow(/unknown value operator/)
  })
})
