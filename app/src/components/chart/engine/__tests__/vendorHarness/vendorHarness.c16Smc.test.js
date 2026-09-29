// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c16Smc.test.js
//
// ─── C16 — INSTITUTIONAL SMC'S ORDER-BLOCK ZONES, AGAINST TRADINGVIEW'S OWN ────
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars). The
// zones are the corpus's list-editing idiom end to end (source lines 116-149):
//
//   var box[] bull_boxes = array.new_box()
//   if show_zones and is_bull_fvg
//       if array.size(bull_boxes) >= 3
//           box.delete(array.shift(bull_boxes))          ← bounded eviction
//       box b = box.new(…, text=zone_text_val, …)       ← an `input.string` caption
//       array.push(bull_boxes, b)
//   if show_zones and array.size(bull_boxes) > 0
//       for i = array.size(bull_boxes) - 1 to 0         ← a loop over the list
//           box b = array.get(bull_boxes, i)            ← a handle copied out
//           if low < box.get_bottom(b)                  ← a getter, per iteration
//               box.delete(b)
//               array.remove(bull_boxes, i)             ← the list edited in the loop
//           else
//               box.set_right(b, bar_index + 8)
//   …and the same for bear_boxes.
//
// TradingView holds TWO boxes at the last bar. Before C16 we held none: every
// read of `bull_boxes`/`bear_boxes` was refused.
//
// ⭐ WHAT IS PINNED, AND WHY IT IS STRONGER THAN A COUNT. The capture's ids are
// TradingView's one creation counter across lines, labels and boxes, and ours is
// too (`nextId`). Our side withholds 10 early objects (five BOS/CHoCH line+label
// pairs made before bar 250 — the owner-gated warm-up curtain, `PINE_STATE_WARMUP`),
// and EVERY object we do hold is TradingView's, in TradingView's order, at its
// price and with its caption — the two boxes included, sitting between the
// labels and lines exactly where TradingView made them. And the capture's `x` is
// a dense rank of the distinct x positions it holds, so our x positions must map
// onto TradingView's ranks one-to-one and in order: a box whose left or right
// edge were a bar off would break that map.
import { describe, it, expect } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { runOurSide, toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/institutional-smc-order-flow-matrix-pro-rddt-1d-2026-09-28.json')
const capture = () => {
  const loaded = loadCapture(FILE)
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}

function memberRun(cap) {
  const bars = toProductBars(cap)
  const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c16_smc', name: 'smc' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
  })
  const run = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return { d, run }
}

/** One record per object: family, id, the numbers the capture keeps, caption. */
const vendorObjects = (cap) => {
  const r = cap.objects.records
  return [
    ...r.lines.map((l) => ({ f: 'line', id: l.id, y: [l.y1, l.y2], x: [l.x1, l.x2], t: null })),
    ...r.labels.map((l) => ({ f: 'label', id: l.id, y: [l.y], x: [l.x], t: String(l.t) })),
    ...r.boxes.map((b) => ({ f: 'box', id: b.id, y: [b.y1, b.y2], x: [b.x1, b.x2], t: String(b.t) })),
  ].sort((a, b) => a.id - b.id)
}
const ourObjects = (run) => run.live.map((o) => {
  const p = o.props
  if (o.family === 'line') return { f: 'line', id: o.id, y: [p.y1, p.y2], x: [p.x1, p.x2], t: null }
  if (o.family === 'label') return { f: 'label', id: o.id, y: [p.y], x: [p.x], t: String(p.text) }
  return { f: 'box', id: o.id, y: [p.top, p.bottom], x: [p.left, p.right], t: String(p.text) }
}).sort((a, b) => a.id - b.id)
const key = (o) => `${o.f}|${o.t}|${o.y.map((v) => Math.round(v * 1e4) / 1e4).join(',')}`

describe('C16 — institutional-smc: the order-block zones TradingView holds', () => {
  const cap = capture()

  it('⛔ CONTROL — the capture holds two zones, captioned by the `input.string` default', () => {
    expect(cap.objects.counts.boxes).toBe(2)
    expect(cap.objects.records.boxes.map((b) => b.t)).toEqual(['Order Block', 'Order Block'])
  })

  it('⭐ the member door converts the zone logic WHOLE — nothing dropped', () => {
    const { d } = memberRun(cap)
    expect(d.translation.objectDiagnostics.dropReasons).toEqual({})
  }, 60000)

  it('⭐ the harness grades the boxes family AGREE: 2 held, as TradingView holds', () => {
    const ours = runOurSide(cap)
    expect(ours.ok, ours.refusal).toBe(true)
    expect(ours.objects.counts.boxes).toBe(2)
    expect([...ours.objects.texts.boxes].sort()).toEqual(['Order Block', 'Order Block'])
  }, 60000)

  it('⭐⭐ every object we hold is TradingView\'s — order, family, price, caption — boxes included', () => {
    const { run } = memberRun(cap)
    const V = vendorObjects(cap)
    const O = ourObjects(run)
    // the ten we withhold are TradingView's first ten structure objects; after
    // the ITH/ITL pair, the rest is the vendor's tail one for one
    const vendorKeys = V.map(key)
    const ourKeys = O.map(key)
    const headWithheld = V.filter((v) => v.f !== 'box' && v.id < 56 && !['ITH', 'ITL'].includes(v.t))
    expect(headWithheld).toHaveLength(10)
    const kept = V.filter((v) => !headWithheld.includes(v))
    expect(ourKeys).toEqual(kept.map(key))
    expect(vendorKeys.filter((k) => k.startsWith('box|'))).toEqual(ourKeys.filter((k) => k.startsWith('box|')))
    // ⭐ the id counter agrees, offset by exactly the ten withheld creates
    const boxes = O.filter((o) => o.f === 'box').map((o) => o.id)
    expect(boxes.map((id) => id + 10)).toEqual(V.filter((v) => v.f === 'box').map((v) => v.id))
  }, 60000)

  it('⭐ x positions map one-to-one, in order, onto TradingView\'s x ranks — every left and right edge', () => {
    const { run } = memberRun(cap)
    const V = vendorObjects(cap)
    const headWithheld = V.filter((v) => v.f !== 'box' && v.id < 56 && !['ITH', 'ITL'].includes(v.t))
    const kept = V.filter((v) => !headWithheld.includes(v))
    const O = ourObjects(run)
    const map = new Map()
    O.forEach((o, i) => o.x.forEach((x, j) => {
      const vx = kept[i].x[j]
      if (map.has(x)) expect(map.get(x), `our x ${x}`).toBe(vx)
      else map.set(x, vx)
    }))
    const ours = [...map.keys()].sort((a, b) => a - b)
    for (let i = 1; i < ours.length; i += 1) expect(map.get(ours[i])).toBeGreaterThan(map.get(ours[i - 1]))
    // both zones end at TradingView's rightmost x — `box.set_right(b, bar_index + 8)` on the last bar
    const bars = toProductBars(cap)
    for (const b of O.filter((o) => o.f === 'box')) expect(b.x[1]).toBe(bars.length - 1 + 8)
  }, 60000)
})
