// app/src/components/chart/engine/__tests__/objectWindowPositions.test.js
//
// ─── ⭐⭐ C22 — A BOUNDED WINDOW, READ WHERE EACH READ STANDS ───────────────────
//
// trend-duration-forecast-chartprime keeps two windows and reads each INSIDE the
// statement that adds to the other:
//
//     if trend != trend[1]
//         if trend
//             bearishCount.push(TrendCount)
//             TrendUP := label.new(…, str.tostring(bullishCount.avg(), "##") …)
//         else
//             bullishCount.push(TrendCount)
//             TrendDN := label.new(…, str.tostring(bearishCount.avg(), "##") …)
//     if not trend … bearishCount.avg() …          ← between the adds and removals
//     if bullishCount.size() > samples             ← an input cap
//         bullishCount.shift()
//
// C11b refused such a window whole: an add in an `else`, a read inside a
// writing statement, a read before the last write, a cap that is an input. The
// model (`arrayWindows.js`) is the window as the BAR leaves it; C22 places each
// read and serves it only where it sees exactly that:
//
//   * an add in any arm of an `if … else if … else` chain (its guard: the arm's
//     condition beside the negation of every earlier one);
//   * a read in an arm that EXCLUDES the add's arm — it runs only on bars
//     without an add, where the window is last bar's, which is the model;
//   * a read after the last writing statement;
//   * a cap written as an input the member's chart cannot move — read at the
//     value it holds there — never one declared as a knob or read elsewhere;
//   and everything else is refused WHERE IT STANDS (`windowReadVerdict`).
//
// Every expectation is Pine's own arrays run by hand over the same bars.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { evaluateObjects } from '../objectRuntime'
import { objectReaderFor } from '../objectColumns'

const LF = String.fromCharCode(10)
const Q = String.fromCharCode(34)
const HEAD = `//@version=5${LF}indicator(${Q}w${Q}, overlay=true, max_labels_count=500)${LF}`
const tr = (lines, opts) => translatePine(`${HEAD}${lines.join(LF)}${LF}plot(close)${LF}`, opts)

const N = 150
const BARS = Array.from({ length: N }, (_, i) => {
  const d = new Date(Date.UTC(2021, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  const c = 100 + 9 * Math.sin(i / 5) + 3 * Math.sin(i / 1.7)
  const o = 100 + 9 * Math.sin((i - 1) / 5) + 2 * Math.cos(i / 2.1)
  return { t: d, o, h: Math.max(o, c) + 1 + (i % 5) * 0.25, l: Math.min(o, c) - 1 - (i % 3) * 0.5, c, v: 1 }
})
const run = (t) => {
  const reader = t.objects ? objectReaderFor({ objects: t.objects }, BARS, { tf: 'D', newestBarIsForming: false }) : null
  // a program with every drawing refused is no program at all
  if (!reader) return { live: [], stats: {} }
  return evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
}
const labels = (r, text) => r.live.filter((o) => o.family === 'label' && (text === undefined || o.props.text === text))
  .sort((a, b) => a.createdBar - b.createdBar).map((o) => [o.createdBar, o.props.y])
const up = (i) => BARS[i].c > BARS[i].o
const rise = (i) => i > 0 && BARS[i].c > BARS[i - 1].c
/** Pine's `array.avg` over a list of finite numbers. */
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length

// Two windows, each added to in one arm of `if rise` inside `if up`, and each
// read (avg) in the OTHER arm — the trend-duration shape. Capped at 3.
const TWO = [
  'var float[] ups = array.new_float()',
  'var float[] dns = array.new_float()',
  'if close > open',
  '    if close > close[1]',
  '        ups.push(high)',
  '        if dns.size() > 0',
  '            label.new(bar_index, dns.avg(), "U")',
  '    else',
  '        dns.push(low)',
  '        if ups.size() > 0',
  '            label.new(bar_index, ups.avg(), "D")',
  'if ups.size() > 3',
  '    ups.shift()',
  'if dns.size() > 3',
  '    dns.shift()',
]
const replayTwo = () => {
  const ups = []
  const dns = []
  const out = { U: [], D: [] }
  for (let i = 0; i < N; i += 1) {
    if (up(i)) {
      if (rise(i)) {
        ups.push(BARS[i].h)
        if (dns.length > 0) out.U.push([i, avg(dns)])
      } else {
        dns.push(BARS[i].l)
        if (ups.length > 0) out.D.push([i, avg(ups)])
      }
    }
    if (ups.length > 3) ups.shift()
    if (dns.length > 3) dns.shift()
  }
  return out
}

describe('⭐⭐ C22 — an add in an `else` arm, read in the arm that excludes it', () => {
  it('both windows, bar for bar against Pine', () => {
    const t = tr(TWO)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const r = run(t)
    const want = replayTwo()
    expect(want.U.length).toBeGreaterThan(5)
    expect(want.D.length).toBeGreaterThan(5)
    expect(labels(r, 'U')).toEqual(want.U)
    expect(labels(r, 'D')).toEqual(want.D)
  })

  it('an `else if` arm carries the negation of every earlier arm', () => {
    const t = tr([
      'var float[] w = array.new_float()',
      'if close > open + 2',
      '    label.new(bar_index, high, "A")',
      'else if close > close[1]',
      '    label.new(bar_index, high, "B")',
      'else',
      '    w.push(low)',
      'if w.size() > 2',
      '    w.shift()',
      'if w.size() == 2',
      '    label.new(bar_index, w.avg(), "W")',
    ])
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const r = run(t)
    const w = []
    const want = []
    for (let i = 0; i < N; i += 1) {
      if (BARS[i].c > BARS[i].o + 2) { /* A */ } else if (rise(i)) { /* B */ } else w.push(BARS[i].l)
      if (w.length > 2) w.shift()
      if (w.length === 2) want.push([i, avg(w)])
    }
    expect(want.length).toBeGreaterThan(10)
    expect(labels(r, 'W')).toEqual(want)
  })
})

describe('⛔ C22 — a read anywhere else is refused WHERE IT STANDS, never the whole window', () => {
  it('a read in the SAME arm as the add (the window may hold one more element there) — refused; a read after the removal still served', () => {
    const t = tr([
      'var float[] w = array.new_float()',
      'if close > open',
      '    w.push(high)',
      '    label.new(bar_index, w.avg(), "SAME")',
      'if w.size() > 3',
      '    w.shift()',
      'if w.size() > 0',
      '    label.new(bar_index, w.avg(), "AFTER")',
    ])
    const r = run(t)
    expect(labels(r, 'SAME')).toEqual([])
    expect(t.objectDiagnostics.droppedOps).toBeGreaterThan(0)
    const w = []
    const want = []
    for (let i = 0; i < N; i += 1) {
      if (up(i)) w.push(BARS[i].h)
      if (w.length > 3) w.shift()
      if (w.length > 0) want.push([i, avg(w)])
    }
    expect(labels(r, 'AFTER')).toEqual(want)
  })

  it('a read BETWEEN the add and the removal — refused; the read after it served (was: the whole window refused)', () => {
    const t = tr([
      'var float[] w = array.new_float()',
      'if close > open',
      '    w.push(high)',
      'if w.size() > 0',
      '    label.new(bar_index, w.avg(), "BETWEEN")',
      'if w.size() > 3',
      '    w.shift()',
      'if w.size() > 0',
      '    label.new(bar_index, w.avg(), "AFTER")',
    ])
    const r = run(t)
    expect(labels(r, 'BETWEEN')).toEqual([])
    expect(labels(r, 'AFTER').length).toBeGreaterThan(10)
  })

  it('a nested condition that reads a name its own statement changed above it — the window is refused', () => {
    const t = tr([
      'var float[] w = array.new_float()',
      'x = 0.0',
      'if close > open',
      '    x := high',
      '    if x > 101',
      '        w.push(high)',
      'if w.size() > 3',
      '    w.shift()',
      'if w.size() > 0',
      '    label.new(bar_index, w.avg(), "W")',
    ])
    expect(labels(run(t), 'W')).toEqual([])
  })
})

describe('⭐⭐ C22 — a cap written as an input', () => {
  const CAPPED = [
    'k = input.int(3, "k")',
    'var float[] w = array.new_float()',
    'if close > open',
    '    w.push(high)',
    'if w.size() > k',
    '    w.shift()',
    'if w.size() > 0',
    '    label.new(bar_index, w.avg(), "W")',
  ]
  const replayCap = (k) => {
    const w = []
    const out = []
    for (let i = 0; i < N; i += 1) {
      if (up(i)) w.push(BARS[i].h)
      if (w.length > k) w.shift()
      if (w.length > 0) out.push([i, avg(w)])
    }
    return out
  }

  it('an input with no knob holds its default on every chart — served at it, and no parameter is minted', () => {
    const t = tr(CAPPED, { paramManifest: true })
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    expect(labels(run(t), 'W')).toEqual(replayCap(3))
    expect((t.inputParams || []).map((p) => p.sourceName)).not.toContain('k')
  })

  it('the member\'s own value, when the caller carries it (`inputValues`)', () => {
    const t = tr(CAPPED, { inputValues: { k: 5 } })
    expect(labels(run(t), 'W')).toEqual(replayCap(5))
  })

  it('⛔ a DECLARED knob is refused — it is set after the window is laid out', () => {
    const t = tr(CAPPED, { declareInputs: 'all' })
    expect(labels(run(t), 'W')).toEqual([])
    expect(t.objectDiagnostics.droppedOps).toBeGreaterThan(0)
  })
})

describe('⭐⭐ C22 — a reduction read only in a VALUE marks that value, and a clean write clears it', () => {
  // trend-duration's create text reads an average that is unmeasured on an EMPTY
  // window (its first flip), and the same bar re-texts the label. Pine draws the
  // label with the second text; so do we — the create runs, its text is marked,
  // the `set_text` writes it clean.
  const SET = [
    'var float[] w = array.new_float()',
    'var label l = na',
    'if close > open and bar_index > 20',
    '    w.push(high)',
    'else',
    '    l := label.new(bar_index, low, "avg " + str.tostring(w.avg()))',
    '    l.set_text("bar " + str.tostring(bar_index))',
    'if w.size() > 3',
    '    w.shift()',
  ]
  const pushes = (i) => up(i) && i > 20
  it('the create runs on the empty window and the same-bar `set_text` makes it Pine\'s', () => {
    const t = tr(SET)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const r = run(t)
    const want = []
    for (let i = 0; i < N; i += 1) if (!pushes(i)) want.push([i, `bar ${i}`])
    const got = r.live.filter((o) => o.family === 'label').sort((a, b) => a.createdBar - b.createdBar)
      .map((o) => [o.createdBar, o.props.text])
    expect(got).toEqual(want)
    // non-vacuity: the early creates DID read an empty window
    expect(r.stats.propsUnmeasured).toBeGreaterThan(10)
  })

  it('⛔ CONTROL — without the clean write, a label made off the empty window is held, not drawn', () => {
    const t = tr(SET.filter((l) => !l.includes('set_text')))
    const r = run(t)
    const drawn = r.live.filter((o) => o.family === 'label').map((o) => o.createdBar)
    expect(drawn.filter((b) => b <= 20)).toEqual([])
    expect(drawn.length).toBeGreaterThan(10)
  })
})
