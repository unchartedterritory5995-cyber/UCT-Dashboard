// app/src/components/chart/engine/runtime/__tests__/l4dArmShapes.test.js
//
// ─── L4d — THE TWO ARM SHAPES L4c STILL REFUSED, WITNESSED BY Q-RS5 ──────────
//
// L4c serves `t = c ? label.new(…) : na` / `line.new` as a jump. Q-RS5
// (`tools/visual_conformance/probes/rs-arm-label-last-bar.pine`, v5) captured, on RDDT and
// SPY 1D (s10, 2026-11-15):
//   E01  `e1 = bar_index % 7 != 0 ? na : label.new(bar_index, low, "E01|" + …)` — a label in
//        the ELSE arm: 96 labels on RDDT, every bar (through the capture's x map), y and text
//        equal ours; the newest 502 on SPY equal.
//   X01  `x1 = bar_index % 10 == 0 ? box.new(bar_index, high, bar_index + 1, low) : na` — a box
//        in the THEN arm: 67 boxes on RDDT, every left, right, top and bottom equal ours; the
//        newest 503 on SPY equal.
// Both are now served (`DRAW_ARM_WITNESSED`, one table with L4c's pairs). Every pair no capture
// shows (a line or a box in the ELSE arm, a table, both arms) keeps `runtime:object-op`.
//
// The always-on rails run the committed probe over Q-RT5a's committed RDDT bars (the
// capture's first 636 bars, row for row) and compare with the digest of the vendor records
// made before bar 636 (`docs/pine/evidence/2026-11-15-w3n-d1/evidence.json`, `qrs5`).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const REPO = path.resolve(process.cwd(), '..')
const EVIDENCE = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/pine/evidence/2026-11-15-w3n-d1/evidence.json'), 'utf8'))
const RT5A = JSON.parse(fs.readFileSync(path.join(REPO,
  'tests/fixtures/vendor/harness/vw-rt5-arm-draw-block-history-rddt-1d-2026-10-03.json'), 'utf8'))
const PROBE = fs.readFileSync(path.join(REPO, 'tools/visual_conformance/probes/rs-arm-label-last-bar.pine'), 'utf8')
const T = 60000

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const canon = (list) => sha(JSON.stringify(list.map((t) => t.map((v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(12)) : v)))))
const nn = (y) => (y == null || Number.isNaN(y) ? null : y)
const barsOf = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const BARS = barsOf(RT5A.bars.rows)
const OBJECTS = ['o', 'h', 'l', 'c', 'v']

const build = (src, bars = BARS) => buildRuntimeIr(src, { bars, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
function live(src, bars = BARS) {
  const built = build(src, bars)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const series = OBJECTS.map((k) => Float64Array.from(bars.map((b) => b[k])))
  const res = execute(program, { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t) })
  return res.objects.finish().live.slice().sort((a, b) => a.id - b.id)
}
const pre = (t) => String(t).split('|')[0]
const e01Of = (objs) => objs.filter((o) => o.family === 'label' && pre(o.props.text) === 'E01').map((o) => [o.props.x, nn(o.props.y), o.props.text])
const x01Of = (objs) => objs.filter((o) => o.family === 'box').map((o) => [o.props.left, o.props.right, o.props.top, o.props.bottom])
const RDDT = EVIDENCE.qrs5.find((r) => r.capture.includes('-rddt-'))

describe('L4d — the evidence is what these rails say it is', () => {
  it('Q-RS5 RDDT: E01 and X01 graded MATCH on both symbols, with a prefix over the 636 committed bars', () => {
    for (const r of EVIDENCE.qrs5) for (const k of ['E01', 'X01']) expect(r.shapes[k].verdict).toBe('MATCH')
    expect(RDDT.shapes.E01.compared).toMatchObject({ vendor: 96, ours: 96, differ: 0 })
    expect(RDDT.shapes.X01.compared).toMatchObject({ vendor: 67, ours: 67, differ: 0 })
    expect(RDDT.shapes.E01.prefix.labels).toBe(Math.ceil(636 / 7))     // bar_index % 7 == 0 below 636
    expect(RDDT.shapes.X01.prefix.boxes).toBe(Math.ceil(636 / 10))
  })
})

describe('L4d — Q-RS5 over the committed 636 RDDT bars: the vendor records, exactly', () => {
  let held = null
  const objs = () => (held ??= live(PROBE))
  it('E01, a label in the ELSE arm: made only on the bars the test is false; every bar, y and text equal the vendor', () => {
    const e01 = e01Of(objs())
    expect(e01).toHaveLength(RDDT.shapes.E01.prefix.labels)
    expect(e01.every(([bar]) => bar % 7 === 0)).toBe(true)
    expect(canon(e01)).toBe(RDDT.shapes.E01.prefix.digest)
  }, T)
  it('X01, a box in the THEN arm: one per 10th bar; every left, right, top and bottom equal the vendor', () => {
    const x01 = x01Of(objs())
    expect(x01).toHaveLength(RDDT.shapes.X01.prefix.boxes)
    expect(canon(x01)).toBe(RDDT.shapes.X01.prefix.digest)
  }, T)
  it('A01 / R01 (L4c\'s shape, already served) still make one label each, on the last bar', () => {
    const last = BARS.length - 1
    const a = objs().filter((o) => o.family === 'label' && pre(o.props.text) === 'A01')
    expect(a.map((o) => [o.props.x, o.props.text])).toEqual([[last, `A01|${last}`]])
  }, T)
  it('CONTROL: the arms swapped (`c ? label.new : na` with the same test) draw on the OTHER bars, so the rail can tell them apart', () => {
    const swapped = e01Of(live(PROBE.replace('bar_index % 7 != 0 ? na : label.new(bar_index, low, "E01|" + str.tostring(bar_index))',
      'bar_index % 7 != 0 ? label.new(bar_index, low, "E01|" + str.tostring(bar_index)) : na')))
    expect(swapped.length).toBeGreaterThan(RDDT.shapes.E01.prefix.labels)
    expect(canon(swapped)).not.toBe(RDDT.shapes.E01.prefix.digest)
  }, T)
})

describe('L4d — every pair no capture shows keeps runtime:object-op', () => {
  const W = (...lines) => ['//@version=5', 'indicator("t", overlay = true)', ...lines].join('\n') + '\n'
  const refusalOf = (src) => { const b = build(src); return b.ok ? null : b.refusal.guard }
  it.each([
    ['a line in the ELSE arm', 't = close > open ? na : line.new(bar_index, high, bar_index + 1, high)'],
    ['a box in the ELSE arm', 't = close > open ? na : box.new(bar_index, high, bar_index + 1, low)'],
    ['a table in the THEN arm', 't = barstate.islast ? table.new(position.top_right, 1, 1) : na'],
    ['a linefill in the THEN arm', 'a = line.new(bar_index, high, bar_index + 1, high)\nb = line.new(bar_index, low, bar_index + 1, low)\nt = close > open ? linefill.new(a, b, color.red) : na'],
    ['a label in both arms', 't = close > open ? label.new(bar_index, high) : label.new(bar_index, low)'],
    ['an ELSE label whose THEN is not `na`', 'var label k = na\nt = close > open ? k : label.new(bar_index, high)'],
    ['an ELSE label inside an `if` block', 'if bar_index % 2 == 0\n    t = close > open ? na : label.new(bar_index, high)'],
    ['a THEN box inside a function body', 'f() =>\n    close > open ? box.new(bar_index, high, bar_index + 1, low) : na\nt = f()'],
  ])('%s', (_, body) => {
    expect(refusalOf(W(body))).toBe('runtime:object-op')
  })
  it('an ELSE label whose argument keeps state refuses runtime:conditional-history', () => {
    expect(refusalOf(W('t = close > open ? na : label.new(bar_index, ta.sma(close, 5))'))).toBe('runtime:conditional-history')
  })
  it.each([
    ['an ELSE label', 't = close > open ? na : label.new(bar_index, high)'],
    ['a THEN box', 't = close > open ? box.new(bar_index, high, bar_index + 1, low) : na'],
  ])('CONTROL (served): %s builds', (_, body) => {
    expect(refusalOf(W(body))).toBe(null)
  })
})

// ─── where the captures are on disk, both symbols in full, through the x map ──
const RUN = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'uct-vendor-batch/runs/s10-2026-11-15') : null
const HAVE = !!RUN && fs.existsSync(path.join(RUN, 'xmap'))
describe.skipIf(!HAVE)('L4d — the Q-RS5 captures in full (local only)', () => {
  it.each(EVIDENCE.qrs5.map((r) => [r.capture]))('%s: E01 and X01 equal the vendor, newest end', (id) => {
    const r = EVIDENCE.qrs5.find((x) => x.capture === id)
    const buf = fs.readFileSync(path.join(RUN, 'captures', `${id}.json`))
    expect(sha(buf)).toBe(r.sha256)
    const cap = JSON.parse(buf)
    const xm = JSON.parse(fs.readFileSync(path.join(RUN, 'xmap', `${id}.json`), 'utf8'))
    const vl = cap.objects.records.labels.slice().sort((a, b) => a.id - b.id)
    const vE01 = vl.filter((x) => pre(x.t) === 'E01').map((x) => [xm.barIndex[x.x], nn(x.y), x.t])
    const vX01 = cap.objects.records.boxes.slice().sort((a, b) => a.id - b.id).map((x) => [xm.barIndex[x.x1], xm.barIndex[x.x2], x.y1, x.y2])
    const objs = live(cap.source.text, barsOf(cap.bars.rows))
    expect(canon(e01Of(objs))).toBe(canon(vE01))
    expect(canon(x01Of(objs))).toBe(canon(vX01))
    expect(canon(vE01)).toBe(r.shapes.E01.vendorDigest)
  }, T)
})
