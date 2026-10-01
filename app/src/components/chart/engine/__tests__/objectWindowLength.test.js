// app/src/components/chart/engine/__tests__/objectWindowLength.test.js
//
// ─── ⭐⭐ C32 — A WINDOW'S LENGTH, READ ABOVE ITS WRITER AND PAST THE CAP ─────
//
// artemis-oscillator-pro keeps a KNN training memory of the last `knnLen`
// (an input, 100) bars in four arrays filled in step, and shows its length:
//
//     int   kSize  = array.size(knnF1)          ← ABOVE the statement that adds
//     …
//     if bar_index > 1
//         array.push(knnF1, kf1) …               (four arrays, in step)
//         if array.size(knnF1) > knnLen
//             array.shift(knnF1) …
//     …
//     table.cell(knnTable, 1, 2, str.tostring(kSize) + " bars")
//
// Two things the window model refused, both general Pine:
//   * a read ABOVE the first writing statement sees the array as LAST bar left
//     it, so its length there is the model's length one bar back (`sizePrev`)
//     — and unknown on the first bar, where it is withheld, never guessed;
//   * a window WIDER than `MAX_WINDOW_CAP` (64) is still a window for its
//     LENGTH: `cap` once the cap-th most recent add exists (one `valuewhen`,
//     nothing unrolled), unknown before — withheld there. Every other read of
//     such a window is refused by name; the cap is unchanged.
// And one reader bug: a cap declared with a type word (`int knnLen = …`) was
// counted as a stray read of itself, refusing the whole window.
//
// Every expectation is Pine's own arrays run by hand over the same bars.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { evaluateObjects, OBJECT_STATUS } from '../objectRuntime'
import { objectReaderFor } from '../objectColumns'
import { MAX_WINDOW_CAP } from '../ast/arrayWindows'

const LF = String.fromCharCode(10)
const Q = String.fromCharCode(34)
const HEAD = `//@version=6${LF}indicator(${Q}w${Q}, overlay=true, max_labels_count=500)${LF}`
const tr = (lines) => translatePine(`${HEAD}${lines.join(LF)}${LF}plot(close)${LF}`)

const N = 160
const BARS = Array.from({ length: N }, (_, i) => {
  const d = new Date(Date.UTC(2021, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  const c = 100 + 9 * Math.sin(i / 5) + 3 * Math.sin(i / 1.7)
  const o = 100 + 9 * Math.sin((i - 1) / 5) + 2 * Math.cos(i / 2.1)
  return { t: d, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1 }
})
const run = (t) => {
  const reader = objectReaderFor({ objects: t.objects }, BARS, { tf: 'D', newestBarIsForming: false, historyFromListing: true })
  return evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
}
/** `[bar, text]` of every label drawn, in bar order. */
const labels = (r) => r.live.filter((o) => o.family === 'label')
  .sort((a, b) => a.createdBar - b.createdBar).map((o) => [o.createdBar, o.props.text])
const up = (i) => BARS[i].c > BARS[i].o

/** The artemis shape, parameterised: cap, and whether the length is read above
 *  the writer or after it. A label every bar carries the length it read. */
const SRC = ({ cap, above, typed = true }) => [
  `${typed ? 'int    ' : ''}len = input.int(${cap}, ${Q}Training Window${Q}, minval=2, maxval=300)`,
  'var array<float> f1 = array.new<float>()',
  'var array<float> f2 = array.new<float>()',
  ...(above ? ['int n = array.size(f1)'] : []),
  'if close > open',
  '    array.push(f1, close)',
  '    array.push(f2, open)',
  '    if array.size(f1) > len',
  '        array.shift(f1)',
  '        array.shift(f2)',
  ...(above ? [] : ['int n = array.size(f1)']),
  'label.new(bar_index, close, str.tostring(n))',
]
/** Pine's arrays by hand: the length each bar's label reads. */
const replay = ({ cap, above }) => {
  const f1 = []
  const out = []
  for (let i = 0; i < N; i += 1) {
    const before = f1.length
    if (up(i)) { f1.push(BARS[i].c); if (f1.length > cap) f1.shift() }
    out.push([i, String(above ? before : f1.length)])
  }
  return out
}

describe('⭐⭐ C32 — a window length read above its writer (`sizePrev`)', () => {
  it('each bar reads LAST bar\'s length; the first bar is withheld, never guessed', () => {
    const t = tr(SRC({ cap: 5, above: true }))
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const r = run(t)
    expect(r.status).toBe(OBJECT_STATUS.OK)
    const want = replay({ cap: 5, above: true })
    // bar 0 is withheld (what the array held before the series is not in it)
    expect(labels(r)).toEqual(want.slice(1))
    // ⛔ NON-VACUITY: above and after the writer really read different lengths
    const after = replay({ cap: 5, above: false })
    expect(want.slice(1).some(([i, s]) => after[i][1] !== s)).toBe(true)
  })

  it('control: the same read AFTER the writer is the model itself, every bar', () => {
    const r = run(tr(SRC({ cap: 5, above: false })))
    expect(labels(r)).toEqual(replay({ cap: 5, above: false }))
  })

  it('⛔ a SLOT read above the writer keeps its refusal — only the length is served there', () => {
    const lines = SRC({ cap: 5, above: true }).map((l) => (l === 'int n = array.size(f1)'
      ? 'float n = array.size(f1) > 0 ? array.get(f1, 0) : na' : l))
    const t = tr(lines)
    expect(t.objectDiagnostics.droppedOps).toBeGreaterThan(0)
  })
})

describe(`⭐⭐ C32 — a window wider than MAX_WINDOW_CAP (${MAX_WINDOW_CAP}) is read for its length`, () => {
  const cap = MAX_WINDOW_CAP + 6
  it('its length is `cap` once full, and withheld before — above the writer and after it', () => {
    for (const above of [false, true]) {
      const t = tr(SRC({ cap, above }))
      expect(t.objectDiagnostics.droppedOps, `above=${above}`).toBe(0)
      const r = run(t)
      expect(r.status).toBe(OBJECT_STATUS.OK)
      const want = replay({ cap, above }).filter(([, s]) => s === String(cap))
      // ⛔ NON-VACUITY: the series fills the window, so something is drawn
      expect(want.length, `above=${above}`).toBeGreaterThan(10)
      expect(labels(r), `above=${above}`).toEqual(want)
    }
  })

  it('⛔ an element read of such a window stays refused, by name', () => {
    const lines = SRC({ cap, above: false }).map((l) => (l === 'int n = array.size(f1)'
      ? 'float n = array.get(f1, 0)' : l))
    const t = tr(lines)
    expect(t.objectDiagnostics.droppedOps).toBeGreaterThan(0)
  })

  it('the cap is unchanged: a window at the cap still unrolls its elements', () => {
    const lines = SRC({ cap: MAX_WINDOW_CAP, above: false }).map((l) => (l === 'int n = array.size(f1)'
      ? 'float n = array.size(f1) > 0 ? array.get(f1, 0) : na' : l))
    const t = tr(lines)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
  })
})

describe('⭐ C32 — a cap declared with a type word is the cap, not a stray read of it', () => {
  it('`int len = input.int(…)` and `len = input.int(…)` build the same window', () => {
    const typed = run(tr(SRC({ cap: 5, above: false, typed: true })))
    const bare = run(tr(SRC({ cap: 5, above: false, typed: false })))
    expect(labels(typed)).toEqual(replay({ cap: 5, above: false }))
    expect(labels(typed)).toEqual(labels(bare))
  })
})
