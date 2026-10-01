// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c31Loops.test.js
//
// ─── C31 — LOOP-SCOPED NAMES AND LOOP-BUILT TEXT, AGAINST TRADINGVIEW ────────
//
// The object lane's block reader (`foldStatements`, run by the block harvest)
// used to THROW at the first `for` of a block, and every local declared below it
// was bound by nobody: htf-candle-footprint's `indxBar` (`pine:undefined`@120),
// artemis' `fTxt` (@621), poor-man's `row0_color`s. It now STEPS OVER the loop:
// exactly the names the body can change refuse (`loopWrites` → the top-level
// walk's own `loopWriteRefusal`), everything else folds. ⛔ The main walk still
// refuses the block at its loop — a chain it folds reaches inputs a refused one
// never did, and a saved script's parameter ids are an address.
//
// A counted `for` whose bounds are ascending integer literals and whose body only
// appends to TEXT is folded pass by pass (`unrollTextLoop`, ema-ribbon's
// `f_strengthBar`), and a helper's own locals are visible to the text reader.
//
// ⭐ AND THE WALL THE FOLD EXPOSED, served as a refusal: ema-ribbon's strength
// bar reads `maxSpread = ta.highest(spread, 50)` declared inside
// `if showTable and barstate.islast`. A `ta.*` call there sees only the bars its
// block runs on (one), so TradingView draws `██████████`; the every-bar maximum
// would draw `██████░░░░`. The capture witnesses the difference; the block local
// is MARKED (`condCall`) and the object lane refuses it, so neither is drawn.
//
// Captures: NYSE:RDDT 1D, 632 bars, 2026-09-28 (tests/fixtures/vendor/harness).
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const cap = (slug) => loadCapture(path.join(DIR, `${slug}-rddt-1d-2026-09-28.json`)).capture
const ARTEMIS = 'artemis-oscillator-pro'
const EMA = 'ema-ribbon-trend-filter-strixedge'
const HTF = 'htf-candle-footprint-cartel-console'
const POOR = 'poor-man039s-volume-profile'

afterEach(() => { vi.unstubAllEnvs() })

/** The member door, objects pane on, over the capture's own bars. */
function run(capture, source = capture.source.text) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const bars = toProductBars(capture)
  const d = memberPaneDefinition({ source, id: 'u_c31', name: 'c31' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: capture.newestBarIsForming ?? null,
    historyFromListing: true,
  })
  const r = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  const state = toRenderState(r.live, { bars, tf: 'D' })
  const cells = new Map(state.tables.flatMap((t) => t.cells.map((c) => [`${t.position}|${c.col}|${c.row}`, c.text])))
  return { d, bars, live: r.live, state, cells }
}

/** TradingView's cell text at every table address. */
const vendorCells = (capture) => {
  const pos = new Map(capture.objects.records.tables.map((t) => [t.id, t.pos]))
  return new Map(capture.objects.records.tableCells.map((c) => [`${pos.get(c.tid)}|${c.col}|${c.row}`, c.t]))
}

/** Every drawn cell holds TradingView's text at its address — nothing drawn the vendor lacks. */
const expectOnlyVendorCells = (capture, cells) => {
  const vendor = vendorCells(capture)
  for (const [key, text] of cells) {
    expect(vendor.has(key), key).toBe(true)
    expect(text, key).toBe(vendor.get(key))
  }
}

describe('C31 — artemis-oscillator-pro: a block local below an unfoldable `for`', () => {
  it('⭐ `fTxt` (declared after the kNN loops) is drawn with TradingView\'s text, and every drawn cell is the vendor\'s', () => {
    const c = cap(ARTEMIS)
    const { cells } = run(c)
    expect(cells.get('bottom_right|0|3')).toBe('O-  V-  S-')
    expectOnlyVendorCells(c, cells)
  })

  it('⛔ the text the loops build (`bar_str`) and the values they write stay withheld', () => {
    const { cells } = run(cap(ARTEMIS))
    expect(cells.has('bottom_right|0|2')).toBe(false)   // bar_str — `for _i = 0 to filled - 1`
    expect(cells.has('bottom_right|1|0')).toBe(false)   // knnVal — written below `kBull`'s loop
    // CONTROL — the panel is drawn, so the rail cannot pass by drawing nothing
    expect(cells.get('bottom_right|0|0')).toBe('KNN AI')
    expect(cells.get('bottom_right|1|3')).toBe('K=5')
  })
})

describe('C31 — htf-candle-footprint: `indxBar` below a `for … in`', () => {
  it('⭐ the three body boxes are drawn at TradingView\'s bars and prices', () => {
    const c = cap(HTF)
    const { bars, live } = run(c)
    const boxes = live.filter((o) => o.family === 'box').sort((a, b) => a.id - b.id)
    // The vendor's x is a dense RANK over every drawn x; its label at `indxBar`
    // (`deltaLabel`, x = 8) anchors the rank to the bar index.
    const vBoxes = c.objects.records.boxes
    const anchor = c.objects.records.labels.find((l) => l.t === '0')
    const indxBar = (bars.length - 1) + 15 + 5              // bar_index + offset + 5
    const rankOf = (x) => x - indxBar + anchor.x
    const byRank = new Map(vBoxes.map((b) => [`${b.x1}|${b.x2}`, b]))
    expect(boxes).toHaveLength(3)
    for (const o of boxes) {
      const v = byRank.get(`${rankOf(o.props.left)}|${rankOf(o.props.right)}`)
      expect(v, `box ${o.props.left}..${o.props.right}`).toBeTruthy()
      expect(o.props.top).toBeCloseTo(v.y1, 9)
      expect(o.props.bottom).toBeCloseTo(v.y2, 9)
    }
    // the body box's own colour is carried: `bgcolor = BarColor`
    const body = boxes.find((o) => o.props.right - o.props.left === 1)
    expect(body.props.bgcolor.toUpperCase()).toBe('#FD0318')
  })

  it('⛔ what the loops fill stays withheld: no wick line reads `HL`\'s max, no profile box, no label', () => {
    const { live } = run(cap(HTF))
    expect(live.filter((o) => o.family === 'line')).toHaveLength(0)
    expect(live.filter((o) => o.family === 'label')).toHaveLength(0)
  })
})

describe('C31 — ema-ribbon: a text loop folds, and a conditional call is refused by name', () => {
  it('⭐ every drawn cell is TradingView\'s; the strength bar is withheld, never the every-bar six', () => {
    const c = cap(EMA)
    const { d, cells } = run(c)
    expectOnlyVendorCells(c, cells)
    expect(cells.has('top_right|2|3')).toBe(false)
    expect(vendorCells(c).get('top_right|2|3')).toBe('██████████')
    expect(d.translation.objectDiagnostics.dropReasons['cell:text']).toBeGreaterThanOrEqual(1)
  })

  it('⭐ the SAME helper over an every-bar maximum folds to exactly the text Pine builds from these bars', () => {
    const c = cap(EMA)
    const src = [
      '//@version=6',
      'indicator("c31 strength", overlay=true)',
      'f_strengthBar(float _val, float _max) =>',
      '    int n = _max > 0 ? math.min(math.round(_val / _max * 10), 10) : 0',
      '    string r = ""',
      '    for i = 0 to 9',
      '        r += i < n ? "█" : "░"',
      '    r',
      'float mx = ta.highest(close, 50)',
      'var table d = table.new(position.top_right, 2, 1)',
      'if barstate.islast',
      '    table.cell(d, 0, 0, f_strengthBar(close, mx))',
    ].join('\n')
    const { bars, cells } = run(c, src)
    const closes = bars.map((b) => b.c)
    const last = closes.length - 1
    const max = Math.max(...closes.slice(last - 49, last + 1))
    const n = Math.min(Math.round(closes[last] / max * 10), 10)
    const expected = '█'.repeat(n) + '░'.repeat(10 - n)
    // the vendor's own cell witnesses the pass count: ten glyphs for `0 to 9`
    expect([...vendorCells(c).get('top_right|2|3')]).toHaveLength(10)
    expect(cells.get('top_right|0|0')).toBe(expected)
  })

  it('⛔ a `ta.*` local inside a last-bar block is refused; the same call at the top level is read (control)', () => {
    const c = cap(EMA)
    const src = [
      '//@version=6',
      'indicator("c31 cond", overlay=true)',
      'float top = ta.highest(close, 50)',
      'var table d = table.new(position.top_right, 2, 1)',
      'if barstate.islast',
      '    float inner = ta.highest(close, 50)',
      '    table.cell(d, 0, 0, str.tostring(top))',
      '    table.cell(d, 1, 0, str.tostring(inner))',
    ].join('\n')
    const { cells } = run(c, src)
    expect(cells.has('top_right|0|0')).toBe(true)
    expect(cells.has('top_right|1|0')).toBe(false)
  })
})

describe('C31 — the step-over, in the object lane: what the loop writes refuses, the rest folds', () => {
  const block = (...body) => [
    '//@version=6',
    'indicator("c31 scope", overlay=true)',
    'var table t = table.new(position.top_right, 4, 1)',
    'if barstate.islast',
    ...body.map((l) => `    ${l}`),
  ].join('\n')

  // ⭐ A name the loop WRITES is refused by the columnar reader (`pine:reassign`)
  // and, on the last bar, answered by the runtime lane, which runs the loop as
  // written (C18). So the rail is the VALUE: Pine's own, never the pre-loop one.
  it('⭐ a local declared below a loop is bound; the scalar the loop accumulates is the sum Pine holds, never its seed', () => {
    const c = cap(EMA)
    const { bars, cells } = run(c, block(
      'float acc = 0.0',
      'for i = 0 to 4',
      '    acc += close[i]',
      'string after = "B" + str.tostring(bar_index)',
      'table.cell(t, 0, 0, after)',
      'table.cell(t, 1, 0, str.tostring(acc))',
    ))
    expect(cells.get('top_right|0|0')).toBe(`B${bars.length - 1}`)
    const sum = bars.slice(-5).reduce((a, b) => a + b.c, 0)
    expect(sum).not.toBe(0)
    if (cells.has('top_right|1|0')) expect(Number(cells.get('top_right|1|0'))).toBeCloseTo(sum, 2)
    expect(cells.get('top_right|1|0')).not.toBe('0')
  })

  it('⛔ a name the loop writes in a nested `if` of its body is never read at its seed either', () => {
    const { bars, cells } = run(cap(EMA), block(
      'float best = 0.0',
      'for i = 0 to 5',
      '    if high[i] > best',
      '        best := high[i]',
      'table.cell(t, 0, 0, str.tostring(best))',
      'table.cell(t, 1, 0, "ctl")',
    ))
    const best = Math.max(...bars.slice(-6).map((b) => b.h))
    if (cells.has('top_right|0|0')) expect(Number(cells.get('top_right|0|0'))).toBeCloseTo(best, 2)
    expect(cells.get('top_right|0|0')).not.toBe('0')
    expect(cells.get('top_right|1|0')).toBe('ctl')
  })

  it('⭐ a text loop in a block folds; a DESCENDING one is withheld (no capture witnesses the count-down)', () => {
    const { cells } = run(cap(EMA), block(
      'string up = ""',
      'for i = 0 to 2',
      '    up += "x"',
      'string down = ""',
      'for j = 2 to 0',
      '    down += "y"',
      'table.cell(t, 0, 0, up)',
      'table.cell(t, 1, 0, down)',
    ))
    expect(cells.get('top_right|0|0')).toBe('xxx')
    expect(cells.has('top_right|1|0')).toBe(false)
  })
})

describe('C31 — poor-man\'s volume profile: its row texts stay withheld', () => {
  it('⛔ no label is drawn: each text is built by a loop to a width a running total decides', () => {
    const { d, live } = run(cap(POOR))
    expect(live.filter((o) => o.family === 'label')).toHaveLength(0)
    // the colours below each text loop are bound now (they were `pine:undefined`)
    expect(d.translation.objectDiagnostics.unboundLocalNames || []).toEqual([])
    // CONTROL — its two range lines are drawn, so the run is not empty
    expect(live.filter((o) => o.family === 'line')).toHaveLength(2)
  })
})
