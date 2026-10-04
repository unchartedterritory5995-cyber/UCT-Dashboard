// app/src/components/chart/engine/__tests__/strTostringFormat.vendor.test.js
//
// ─── ⭐⭐ `str.tostring(x, format)` IN A DRAWING — READ OFF THE VENDOR'S OWN TEXT (F3) ─
//
// Lane F3, 2026-10-02. Two drawing divergences from CAP2 had one cause: the object
// lane printed a number through `str.tostring` with a format it did not read, and
// printed SOMETHING instead of refusing:
//
//   trend-targets-algoalpha   `str.tostring(TP1_lvl, format.mintick)` drew
//                             "177.5276604489" (no format at all) where
//                             TradingView draws "177.53";
//   swing-highlow-zigzag      `str.tostring(y, "Swing H  (#,###.####)")` was
//                             refused outright, so the two swing labels were
//                             never drawn.
//
// Every expectation below is a TradingView string. Where a label's own `y` IS
// the number its text printed, the vendor supplies both sides of the check:
//
//   A  `format.mintick` — four captures, eleven labels, ticks 0.01;
//   B  literal words around a pattern — the zigzag labels on RDDT and SPY;
//   C  what no capture pins is WITHHELD (`null`), never guessed;
//   D  the grammar the translator admits, and the formats it refuses by name;
//   E  the tick is settled per BINDING, from the witnessed `syminfo.mintick`.
import { describe, it, expect } from 'vitest'
import path from 'node:path'

import {
  tickNumberText, formatPatternedNumber, formatPlainNumber, tostringPatternOf,
  isPlainNumberPattern, TOSTRING_GROUPING_LIMIT, volumeNumberText,
} from '../pineTextFormat.js'
import { translatePine } from '../ast/pine'
import { bindObjectProgram } from '../ast/objectProgram.js'
import { loadCapture, HARNESS_DIR, gradeCapture } from './vendorHarness/harness'
import { buildObjectLane, runObjectLane } from '../runtime/objectLane.js'
import { OBJECT_STATUS } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'

const capture = (id) => {
  const loaded = loadCapture(path.join(HARNESS_DIR, `${id}.json`))
  if (!loaded.capture) throw new Error(`${id}: ${loaded.reason}`)
  return loaded.capture
}
/** A capture's own tick, as the vendor states it (`minmov / pricescale`). */
const tickOf = (cap) => {
  const { minmov, pricescale } = cap.symbol
  expect(minmov, 'the capture states minmov').toBe(1)
  expect(pricescale, 'the capture states pricescale').toBe(100)
  return '0.01'
}

// [capture, the text before the number] — each label prints `prefix + tostring(y, format.mintick)`
const MINTICK = [
  ['trend-targets-algoalpha-rddt-1d-2026-10-02', /^(Entry ▸ |✘ SL ▸ | ✔ TP[123] ▸ )/],
  ['trend-targets-algoalpha-spy-1d-2026-10-02', /^(Entry ▸ |✘ SL ▸ | ✔ TP[123] ▸ )/],
  ['trend-lines-supports-and-resistances-rddt-1d-2026-09-28', /^(Uptrend : |Support : |Resistance : )/],
  ['htf-candle-footprint-cartel-console-rddt-1d-2026-09-28', /^(High: |Low: )/],
]

describe('A — `format.mintick`: rounded to the tick, the tick\'s decimals, trailing zeros KEPT', () => {
  it.each(MINTICK)('%s: every label\'s text is its own y through tickNumberText', (id, prefix) => {
    const cap = capture(id)
    const tick = tickOf(cap)
    const labels = cap.objects.records.labels.filter((l) => prefix.test(l.t))
    expect(labels.length, 'non-vacuity: the capture holds format.mintick labels').toBeGreaterThan(0)
    for (const l of labels) {
      const head = prefix.exec(l.t)[0]
      expect(`${head}${tickNumberText(l.y, tick)}`, `${id} y=${l.y}`).toBe(l.t)
    }
  })

  it('⭐ the two witnesses that settle "trailing zeros kept" and "rounded, not truncated"', () => {
    expect(tickNumberText(222.80298134677545, '0.01')).toBe('222.80') // trend-targets RDDT TP3
    expect(tickNumberText(263.4999, '0.01')).toBe('263.50') // trend-lines RDDT Resistance
    // ⛔ control: the ten-decimal default would have drawn something else
    expect(String(177.52766044892513)).not.toBe('177.53')
  })

  it('a tick that is not a power of ten rounds to a multiple of itself', () => {
    expect(tickNumberText(10.13, '0.25')).toBe('10.25')
    expect(tickNumberText(10.1, '0.25')).toBe('10.00')
    expect(tickNumberText(7.4, '1')).toBe('7')
  })
})

describe('B — literal words around a pattern (Java DecimalFormat prefix / suffix)', () => {
  it.each([
    'swing-highlow-zigzag-chartprime-rddt-1d-2026-10-02',
    'swing-highlow-zigzag-chartprime-spy-1d-2026-10-02',
  ])('%s: "Swing H  (#,###.####)" over each label\'s own y', (id) => {
    const labels = capture(id).objects.records.labels
    expect(labels.length).toBe(2)
    for (const l of labels) {
      const fmt = l.t.startsWith('Swing H') ? 'Swing H  (#,###.####)' : 'Swing L  (#,###.####)'
      expect(formatPatternedNumber(l.y, fmt), `${id} ${l.t}`).toBe(l.t)
    }
  })

  it('the pattern parses into prefix, plain core, suffix and a group size', () => {
    expect(tostringPatternOf('Swing H  (#,###.####)')).toEqual({ prefix: 'Swing H  (', suffix: ')', core: '####.####', grouping: 3 })
    expect(tostringPatternOf('$#.##')).toEqual({ prefix: '$', suffix: '', core: '#.##', grouping: 0 })
    expect(tostringPatternOf('#.## pts')).toEqual({ prefix: '', suffix: ' pts', core: '#.##', grouping: 0 })
  })

  it('⛔ a plain pattern keeps its own path (unchanged C13 rendering)', () => {
    expect(isPlainNumberPattern('0.00')).toBe(true)
    expect(isPlainNumberPattern('Swing (#.##)')).toBe(false)
    expect(formatPlainNumber(45.5, '0.00')).toBe('45.50')
    expect(formatPlainNumber(6.2, '#.##')).toBe('6.2')
    expect(formatPlainNumber(6, '#.##')).toBe('6')
  })
})

describe('C — WITHHELD where no capture pins the rendering', () => {
  it('a grouping separator that would APPEAR', () => {
    expect(formatPatternedNumber(999.5, 'H (#,###.##)')).toBe('H (999.5)')
    expect(formatPatternedNumber(1000, 'H (#,###.##)')).toBeNull()
  })
  it('a negative value under a literal prefix (Java puts the minus before it)', () => {
    expect(formatPatternedNumber(-2.5, 'H (#.##)')).toBeNull()
    expect(formatPatternedNumber(-2.5, '#.## pts')).toBe('-2.5 pts')
  })
  it('a negative zero', () => {
    expect(formatPatternedNumber(-0.001, '#.## pts')).toBeNull()
    expect(tickNumberText(-0.001, '0.01')).toBeNull()
  })
  it('format.mintick at 1000 or more, at an exact tie, or with no tick settled', () => {
    expect(TOSTRING_GROUPING_LIMIT).toBe(1000)
    expect(tickNumberText(1000.123, '0.01')).toBeNull()
    expect(tickNumberText(10.125, '0.01')).toBeNull() // exact decimal tie (81/8 is exact in binary)
    expect(tickNumberText(10.124, '0.01')).toBe('10.12') // control: one off the tie is drawn
  })
  it('a tie at a non-decimal tick, an unsettled tick, and na', () => {
    expect(tickNumberText(10.125, '0.25')).toBeNull()
    expect(tickNumberText(10.2, undefined)).toBeNull()
    expect(tickNumberText(10.2, 'x')).toBeNull()
    expect(tickNumberText(NaN, '0.01')).toBe('NaN')
  })
  it('a special character in the affix, or a malformed core', () => {
    for (const f of ['#.##%', '#.##‰', "'x'#.##", '#.##;(#.##)', '¤#.##', '1#.##', '#,,###', '#,', 'no digits']) {
      expect(tostringPatternOf(f), f).toBeNull()
      expect(formatPatternedNumber(12.5, f), f).toBeNull()
    }
  })
})

describe('D — the translator: `format.mintick` becomes a tick node; any other non-literal format is refused BY NAME', () => {
  const textOfLabel = (src) => {
    const t = translatePine(src)
    const ops = (t.objects && t.objects.ops) || []
    const create = ops.find((o) => o.k === 'create' && o.family === 'label')
    return { t, create }
  }
  const findNum = (node) => {
    if (!node || typeof node !== 'object') return null
    if (node.t === 'num') return node
    for (const v of Object.values(node)) {
      const hit = findNum(v)
      if (hit) return hit
    }
    return null
  }
  it('⭐ str.tostring(close, format.mintick) carries tick: syminfo.mintick', () => {
    const { create } = textOfLabel('//@version=6\nindicator("t", overlay=true)\nif barstate.islast\n    label.new(bar_index, close, "C " + str.tostring(close, format.mintick))\n')
    expect(create, 'the label create is carried').toBeTruthy()
    const num = findNum(create.props)
    expect(num).toMatchObject({ t: 'num', tick: 'syminfo.mintick' })
    expect(num.fmt).toBeUndefined()
  })
  // ⭐ H5 (step 84) re-pin: `format.volume` is READ now (`volumeNumberText`, the M / B
  // renderings multicator-table's capture pins); `format.percent` is the format
  // still carried as unread.
  it('⛔ str.tostring(volume, format.percent) is carried with the format NAMED as unread, never as ten decimals', () => {
    const { t, create } = textOfLabel('//@version=6\nindicator("t", overlay=true)\nif barstate.islast\n    label.new(bar_index, close, "V " + str.tostring(volume, format.percent))\n')
    expect(create).toBeTruthy()
    expect(findNum(create.props)).toMatchObject({ t: 'num', fmtUnread: 'tostring:format.percent' })
    expect(findNum(create.props).fmt).toBeUndefined()
    expect(t.objectDiagnostics.textFormatUnread).toMatchObject({ 'tostring:format.percent': 1 })
  })
  it('⭐ H5 — str.tostring(volume, format.volume) is a VOLUME node (no ten decimals, nothing unread)', () => {
    const { t, create } = textOfLabel('//@version=6\nindicator("t", overlay=true)\nif barstate.islast\n    label.new(bar_index, close, "V " + str.tostring(volume, format.volume))\n')
    expect(findNum(create.props)).toMatchObject({ t: 'num', volume: true })
    expect(findNum(create.props).fmtUnread).toBeUndefined()
    expect((t.objectDiagnostics.textFormatUnread || {})['tostring:format.volume']).toBeUndefined()
  })
  it('control: a literal pattern is unchanged', () => {
    const { create } = textOfLabel('//@version=6\nindicator("t", overlay=true)\nif barstate.islast\n    label.new(bar_index, close, str.tostring(close, "#.##"))\n')
    expect(findNum(create.props)).toMatchObject({ t: 'num', fmt: '#.##' })
  })
})

describe('E — the tick settles per BINDING from the witnessed syminfo.mintick', () => {
  const program = {
    trees: [{ type: 'name', name: 'close' }],
    ops: [{ k: 'create', family: 'label', reg: 0, props: { text: { v: 'text', node: { t: 'num', tree: 0, tick: 'syminfo.mintick' } } } }],
  }
  const textNode = (bound) => bound.ops[0].props.text.node
  it('a settled tick is carried as its decimal text', () => {
    const bound = bindObjectProgram(program, (i) => i, { 'syminfo.mintick': '0.01' })
    expect(textNode(bound)).toMatchObject({ t: 'num', node: 0, tick: 'syminfo.mintick', tickText: '0.01' })
  })
  it('⛔ no settled tick ⇒ no tickText (the runtime withholds), and a re-bind never keeps another symbol\'s', () => {
    const first = bindObjectProgram(program, (i) => i, { 'syminfo.mintick': '0.01' })
    const rebound = bindObjectProgram(first, (i) => i, {})
    expect(textNode(rebound).tickText).toBeUndefined()
    expect(textNode(bindObjectProgram(program, (i) => i, null)).tickText).toBeUndefined()
    expect(textNode(bindObjectProgram(program, (i) => i, { 'syminfo.mintick': 'abc' })).tickText).toBeUndefined()
  })
})

describe('F — the object runtime draws what the vendor draws, and holds back the rest', () => {
  const LF = String.fromCharCode(10)
  const N = 30
  const BARS = Array.from({ length: N }, (_, i) => ({
    t: 1700000000 + i * 86400, o: 100, h: 104, l: 96, c: 100 + i / 8, v: 1000000,
  }))
  const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
  const run = (text) => {
    const src = `//@version=6${LF}indicator("t", overlay = true)${LF}`
      + `if barstate.islast${LF}    label.new(bar_index, close, ${text})${LF}`
    const lane = buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars: BARS })
    expect(lane.ok, lane.ok ? '' : `refused ${(lane.refusal || {}).guard}`).toBe(true)
    const r = runObjectLane(lane, { bars: N, series: SERIES, confirmed: true, readTime: (i) => BARS[i].t })
    expect(r.status, r.reason).toBe(OBJECT_STATUS.OK)
    const state = toRenderState(r.live, { bars: BARS.map((b) => ({ ...b })), tf: 'D' })
    return { r, held: r.live.filter((o) => o.family === 'label'), state }
  }
  it('⭐ literal words around a pattern are drawn ("Swing H  (#,###.####)")', () => {
    const { held, state } = run('str.tostring(close, "Swing H  (#,###.####)")') // 103.625
    expect(held.map((o) => o.props.text)).toEqual(['Swing H  (103.625)'])
    expect(state.labels.map((l) => l.text)).toEqual(['Swing H  (103.625)'])
  })
  it('⛔ a grouping separator that would appear: HELD, NOT DRAWN, counted', () => {
    const { r, held, state } = run('str.tostring(close * 100, "Swing H  (#,###.####)")') // 10362.5
    expect(held).toHaveLength(1)
    expect(held[0].props.text).toBeNull()
    expect(state.labels).toHaveLength(0)
    expect(state.dropped.label).toBe(1)
    expect(r.stats.textsWithheld).toBeGreaterThan(0)
  })
  it('⛔ an unread format (format.percent) withholds a finite value; `na` prints NaN', () => {
    const fin = run('str.tostring(volume, format.percent)')
    expect(fin.held[0].props.text).toBeNull()
    expect(fin.state.labels).toHaveLength(0)
    const na = run('str.tostring(close / 0 * 0, format.percent)')
    expect(na.held[0].props.text).toBe('NaN')
  })
  it('⭐ through the member door: position-size-calculator RDDT still MATCHES ("Position Size : NaN" under a computed format)', () => {
    const v = gradeCapture(capture('position-size-calculator-rddt-1d-2026-09-28')).verdict
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
  }, 600000)
})

describe('⭐ H5 — `format.volume` (`volumeNumberText`): the witnessed M / B rendering, the rest withheld', () => {
  it('the multicator-table witnesses, each its own value computed off the capture bars', () => {
    expect(volumeNumberText(3125951)).toBe('3.126M') // RDDT volume, last bar
    expect(volumeNumberText(46335295)).toBe('46.335M') // SPY volume, last bar
    expect(volumeNumberText(-29983517)).toBe('-29.984M') // RDDT OBV from the listing
    expect(volumeNumberText(10801000123)).toBe('10.801B') // SPY OBV: the suffix and three decimals
  })
  it('withheld: below a million, a trailing zero, an exact tie, a unit roll-over, 10^12', () => {
    expect(volumeNumberText(999999)).toBeNull()
    expect(volumeNumberText(3100000)).toBeNull()
    expect(volumeNumberText(3125500)).toBeNull()
    expect(volumeNumberText(999999600)).toBeNull()
    expect(volumeNumberText(1e12)).toBeNull()
    expect(volumeNumberText(NaN)).toBe('NaN')
  })
})
