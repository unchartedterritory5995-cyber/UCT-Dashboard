// app/src/components/chart/engine/runtime/__tests__/l4dDrawingHistory.test.js
//
// ─── L4d — W3N-D1: A DRAWING READS THE PER-CALL-SITE `ta.*` OF AN `if` BLOCK ──
//
// W3W4-D1 built the drawing build's per-call-site history (`servedCondCall`, the plot
// lane's ONE served set) and gated it off until a capture showed a DRAWING reading it.
// The s10 captures (2026-11-15) graded each probe row with the gate open:
//
//   W3N-D1a  `s = ta.sma(close, 3)` in `if close > open`, `label.new(bar_index, s, …)`   MATCH
//   W3N-D1b  the same for `ta.ema`                                                        MATCH
//   W3N-D1c  the same for `ta.rma`                                                        MATCH
//   W3N-D1d  a block local's `x[1]` read by the label                                      DIVERGE
//
// So the gate is now PER SHAPE (`DRAWING_HISTORY_WITNESSED`): sma / ema / rma are served,
// and a block local's `[1]` is refused by name (`runtime:conditional-history`). TradingView
// reads it as the previous RUN's value (RDDT bar 2: vendor 100.88), where the every-bar
// column this build used to read gives the previous BAR's (92).
//
// The evidence (`docs/pine/evidence/2026-11-15-w3n-d1/evidence.json`) holds each row's
// digest. The captures are local only, so the always-on rails run the committed probe
// sources over Q-RT5a's committed RDDT bars, which are the captures' first 636 bars row for
// row, and compare with the digest of the vendor records made before bar 636. Where the
// captures are on disk (`$LOCALAPPDATA/uct-vendor-batch/runs/s10-2026-11-15`), every row is
// graded in full through the capture's x map as well.
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
const PROBE = (s) => fs.readFileSync(path.join(REPO, `tools/visual_conformance/probes/vw-w3n-draw-block-history-${s}.pine`), 'utf8')
const R4 = 'runtime:conditional-history'
const T = 60000

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
/** The evidence file's digest: 12 significant digits for a non-integer, na as null. */
const canon = (list) => sha(JSON.stringify(list.map((t) => t.map((v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(12)) : v)))))
const nn = (y) => (y == null || Number.isNaN(y) ? null : y)
const barsOf = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))

function build(src, bars) {
  return buildRuntimeIr(src, { bars, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
}
/** `[bar, y, text]` of every live label, in creation order. */
function labelsOf(src, bars) {
  const built = build(src, bars)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const res = execute(program, { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t) })
  return res.objects.finish().live.filter((o) => o.family === 'label').sort((a, b) => a.id - b.id)
    .map((o) => [o.props.x, nn(o.props.y), o.props.text])
}
const rowOf = (row, sym) => EVIDENCE.w3n.find((r) => r.row === row && r.capture.includes(`-${sym}-`))
const BARS = barsOf(RT5A.bars.rows)

describe('L4d — the evidence is what these rails say it is', () => {
  it('Q-RT5a holds 636 bars from the listing; every W3N-D1 RDDT row records its prefix over those 636 bars', () => {
    expect(RT5A.history.startsAtBar0).toBe(true)
    expect(BARS).toHaveLength(636)
    for (const s of ['a', 'b', 'c', 'd']) {
      const r = rowOf(`W3N-D1${s}`, 'rddt')
      expect(r.prefix.bars).toBe(636)
      expect(r.prefix.labels).toBe(BARS.filter((b) => b.c > b.o).length)   // one label per UP bar, none collected
    }
  })
  it('a/b/c graded MATCH on both symbols; d DIVERGED, and its witness is the previous RUN on every paired label', () => {
    for (const s of ['a', 'b', 'c']) for (const sym of ['rddt', 'spy']) expect(rowOf(`W3N-D1${s}`, sym).verdict).toBe('MATCH')
    for (const sym of ['rddt', 'spy']) {
      const d = rowOf('W3N-D1d', sym)
      expect(d.verdict).toMatch(/^DIVERGE/)
      expect(d.readings.previousRun.differ).toBe(0)
      expect(d.readings.previousBar.differ).toBeGreaterThan(0)
    }
    expect(rowOf('W3N-D1d', 'rddt').readings.previousBar.first).toEqual({ vendor: [2, 100.88], ours: [2, 92] })
  })
})

describe('L4d — W3N-D1a/b/c: the drawing build serves sma / ema / rma in an `if` block, equal to the vendor', () => {
  it.each(['a', 'b', 'c'])('W3N-D1%s over the committed 636 RDDT bars: every label equals the vendor (bar, y, text; warm-up `na` included)', (s) => {
    const ours = labelsOf(PROBE(s), BARS)
    const want = rowOf(`W3N-D1${s}`, 'rddt').prefix
    expect(ours).toHaveLength(want.labels)
    expect(ours[0][1]).toBe(null)                // the first UP bar is warm-up on both sides
    expect(canon(ours)).toBe(want.digest)
  }, T)
  it('CONTROL: the every-bar sma (not the per-run one) does NOT equal the vendor digest, so the rail can tell them apart', () => {
    const every = labelsOf(PROBE('a').replace('if close > open\n    s = ta.sma(close, 3)', 's = ta.sma(close, 3)\nif close > open'), BARS)
    expect(every).toHaveLength(rowOf('W3N-D1a', 'rddt').prefix.labels)
    expect(canon(every)).not.toBe(rowOf('W3N-D1a', 'rddt').prefix.digest)
  }, T)
})

describe('L4d — W3N-D1d: a block local\'s `[1]` read by a drawing is refused by name', () => {
  it('the probe refuses runtime:conditional-history in the product build', () => {
    const b = build(PROBE('d'), BARS)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe(R4)
  })
  it('CONTROL: the vendor witness is the previous RUN, which the every-bar column (the previous BAR) is not', () => {
    const want = rowOf('W3N-D1d', 'rddt').prefix.yDigest
    const prevBar = []
    const prevRun = []
    let last = null
    BARS.forEach((b, i) => {
      if (!(b.c > b.o)) return
      prevBar.push([i, i > 0 ? BARS[i - 1].c * 2 : null])
      prevRun.push([i, last])
      last = b.c * 2
    })
    expect(canon(prevRun)).toBe(want)
    expect(canon(prevBar)).not.toBe(want)
  })
})

describe('L4d — only the witnessed kinds, and only in an `if` block of the main body', () => {
  const SRC = (...lines) => ['//@version=6', 'indicator("t", overlay = true)', ...lines].join('\n')
  const refusal = (...lines) => { const b = build(SRC(...lines), BARS); return b.ok ? null : b.refusal.guard }
  it.each([
    ['ta.stdev', ['if close > open', '    label.new(bar_index, ta.stdev(close, 3), "x")']],
    ['ta.wma', ['if close > open', '    label.new(bar_index, ta.wma(close, 3), "x")']],
    ['ta.change (served to a PLOT in a `?:` arm only)', ['if close > open', '    label.new(bar_index, ta.change(close), "x")']],
    ['a block local [1]', ['if close > open', '    x = close * 2', '    label.new(bar_index, x[1], "x")']],
    ['ta.sma in a `?:` arm (the witnesses are `if` blocks)', ['label.new(bar_index, close > open ? ta.sma(close, 3) : na, "x")']],
  ])('%s refuses runtime:conditional-history', (_n, body) => {
    expect(refusal(...body)).toBe(R4)
  })
  it.each([
    ['ta.sma', 'ta.sma(close, 3)'], ['ta.ema', 'ta.ema(close, 3)'], ['ta.rma', 'ta.rma(close, 4)'], ['sma inside arithmetic', 'ta.sma(close, 3) + 1'],
  ])('CONTROL (served): %s in an `if` block builds', (_n, expr) => {
    expect(refusal('if close > open', `    label.new(bar_index, ${expr}, "x")`)).toBe(null)
  })
})

// ─── where the captures are on disk, every row in full, through the x map ──
const RUN = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'uct-vendor-batch/runs/s10-2026-11-15') : null
const HAVE = !!RUN && fs.existsSync(path.join(RUN, 'xmap'))
describe.skipIf(!HAVE)('L4d — the s10 captures in full (local only)', () => {
  const load = (dir, id) => {
    const buf = fs.readFileSync(path.join(RUN, dir, `${id}.json`))
    return { json: JSON.parse(buf), sha: sha(buf) }
  }
  it.each(EVIDENCE.w3n.filter((r) => r.verdict === 'MATCH').map((r) => [r.capture]))('%s: the capture is the one graded, and every label equals ours', (id) => {
    const r = EVIDENCE.w3n.find((x) => x.capture === id)
    const cap = load('captures', id)
    const xm = load('xmap', id).json
    expect(cap.sha).toBe(r.sha256)
    const vendor = cap.json.objects.records.labels.slice().sort((a, b) => a.id - b.id).map((x) => [xm.barIndex[x.x], nn(x.y), x.t])
    expect(canon(vendor)).toBe(r.vendorDigest)
    const ours = labelsOf(cap.json.source.text, barsOf(cap.json.bars.rows))
    expect(canon(ours)).toBe(r.vendorDigest)
  }, T)
})
