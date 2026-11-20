// The drill chart's marks as labels (the owner, 2026-11-17: "the arrow and the text/font could look much better and be a
// lot more of a cool production"): where each pointer, stem and pill goes, without a chart. ChartMarkOverlay hands this
// the bar's pixel x, the pixel y of its high and low, the candles under a label's width and the price pane's box.
import { describe, it, expect } from 'vitest'
import { MARK_SIZES, estimatePillWidth, layoutMarks, markColors, markSize, parseColor } from './chartMarkLayout'

const FRAME = { left: 0, top: 0, right: 600, bottom: 300 }
const W = MARK_SIZES.wide
// a mark under (or over) a bar at x 300 whose high is at y 100 and low at y 140
const mark = (o = {}) => ({ key: 'm', x: 300, top: 100, bottom: 140, side: 'below', w: 120, h: W.h, ...o })

describe('layoutMarks: one mark', () => {
  it('a bottom mark: the pointer tip just under the low, the pill under the pointer, centred on the bar', () => {
    const [p] = layoutMarks([mark()], FRAME, 'wide')
    expect(p.hidden).toBeUndefined()
    expect(p.tipY).toBe(140 + W.gap)
    expect(p.pillY).toBe(140 + W.gap + W.caretH + W.stemMin)
    expect(p.pillX).toBe(300 - 60)
    expect(p.stem).toEqual([140 + W.gap + W.caretH, p.pillY])
    expect(p.caret).toBe(true)
  })

  it('a top mark: mirrored over the high, the pointer pointing down into it', () => {
    const [p] = layoutMarks([mark({ side: 'above' })], FRAME, 'wide')
    expect(p.side).toBe('above')
    expect(p.tipY).toBe(100 - W.gap)
    expect(p.pillY + p.h).toBe(100 - W.gap - W.caretH - W.stemMin)
    expect(p.stem[1]).toBe(100 - W.gap - W.caretH)
  })

  it('never covers a candle under its width: pushed past the lowest low there, the stem running to it', () => {
    // a candle under the label reaches y 200, far below the bar's own low
    const [p] = layoutMarks([mark({ w: 40 })], FRAME, 'wide', () => ({ top: 90, bottom: 200 }))
    expect(p.pillY).toBe(200 + W.clear)
    expect(p.stem[1] - p.stem[0]).toBeGreaterThan(40)
    // with that low candle well LEFT of the bar (an uptrend), the label leans right and sits just under its own bar
    const span = (x0) => (x0 < 270 ? { top: 90, bottom: 200 } : { top: 95, bottom: 141 })
    const [lean] = layoutMarks([mark()], FRAME, 'wide', span)
    expect(lean.pillX).toBeGreaterThan(300 - 60)
    expect(lean.pillX).toBeLessThan(300)                 // it still sits under its own bar
    expect(lean.pillY).toBe(140 + W.gap + W.caretH + W.stemMin)
  })

  it('stays centred when leaning would not bring it clearly closer', () => {
    const [p] = layoutMarks([mark()], FRAME, 'wide', () => ({ top: 95, bottom: 141 }))
    expect(p.pillX).toBe(240)
  })

  it('keeps the pill inside the plot at either edge, the pointer still on the bar', () => {
    const [r] = layoutMarks([mark({ x: 595 })], FRAME, 'wide')
    expect(r.pillX + r.w).toBeLessThanOrEqual(600 - W.edge)
    expect(r.x).toBe(595)
    const [l] = layoutMarks([mark({ x: 5 })], FRAME, 'wide')
    expect(l.pillX).toBe(W.edge)
  })

  it('a pill the pane bottom would push over its own bar takes the other side', () => {
    const [p] = layoutMarks([mark({ top: 250, bottom: 290 })], FRAME, 'wide')
    expect(p.side).toBe('above')
    expect(p.flipped).toBe(true)
    expect(p.pillY + p.h).toBeLessThanOrEqual(250)
  })

  it('a mark whose bar is not on the chart is hidden', () => {
    expect(layoutMarks([mark({ x: null })], FRAME, 'wide')[0].hidden).toBe(true)
    expect(layoutMarks([mark({ x: 900 })], FRAME, 'wide')[0].hidden).toBe(true)
    expect(layoutMarks([mark({ top: null })], FRAME, 'wide')[0].hidden).toBe(true)
  })

  it('a mark with no word is a dot just off the bar: no pointer, no stem', () => {
    const [p] = layoutMarks([mark({ dot: true })], FRAME, 'wide')
    expect(p.caret).toBe(false)
    expect(p.stem).toBe(null)
    expect(p.w).toBe(W.dot)
    expect(p.pillY).toBe(140 + W.gap)
  })
})

describe('layoutMarks: several marks', () => {
  it('a label landing on one already on its side stacks past it; none overlap', () => {
    const a = mark({ key: 'a' }), b = mark({ key: 'b', x: 310 })
    const [pa, pb] = layoutMarks([a, b], FRAME, 'wide')
    expect(pb.pillY).toBe(pa.pillY + pa.h + W.stack)
    const overlap = pa.pillX < pb.pillX + pb.w && pb.pillX < pa.pillX + pa.w && pa.pillY < pb.pillY + pb.h && pb.pillY < pa.pillY + pa.h
    expect(overlap).toBe(false)
  })

  it('labels on opposite sides of their bars do not stack', () => {
    const [pa, pb] = layoutMarks([mark({ key: 'a' }), mark({ key: 'b', x: 310, side: 'above' })], FRAME, 'wide')
    expect(pa.side).toBe('below')
    expect(pb.side).toBe('above')
    expect(pb.pillY + pb.h).toBe(100 - W.gap - W.caretH - W.stemMin)
  })
})

describe('the sizes', () => {
  it('a phone reads at 11 px or more, a wide screen at 12; the phone is a step smaller everywhere', () => {
    expect(markSize('phone').font).toBeGreaterThanOrEqual(11)
    expect(markSize('wide').font).toBe(12)
    expect(markSize('phone').h).toBeLessThan(markSize('wide').h)
    expect(markSize('anything else')).toBe(MARK_SIZES.wide)
  })

  it('a pill grows with its word and with the sign ahead of it', () => {
    expect(estimatePillWidth('DECISION DAY', 'wide')).toBeGreaterThan(estimatePillWidth('3R', 'wide'))
    expect(estimatePillWidth('BOUGHT', 'wide', true) - estimatePillWidth('BOUGHT', 'wide')).toBe(W.glyph + W.glyphGap)
    expect(estimatePillWidth('BOUGHT', 'phone')).toBeLessThan(estimatePillWidth('BOUGHT', 'wide'))
    expect(estimatePillWidth('', 'wide')).toBe(W.dot)
  })
})

describe('the colours', () => {
  it('reads a hex or an rgba hue', () => {
    expect(parseColor('#dcbb5e')).toEqual([220, 187, 94, 1])
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1])
    expect(parseColor('rgba(255, 255, 255, 0.55)')).toEqual([255, 255, 255, 0.55])
    expect(parseColor('not a colour')).toBe(null)
  })

  it('a mark wears its own hue: tinted fill, hairline edge, glow, lifted ink', () => {
    const c = markColors('#2faf68')
    expect(c.tone).toBe('rgb(47, 175, 104)')
    expect(c.edge).toBe('rgba(47, 175, 104, 0.66)')
    expect(c.fillTop).toBe('rgba(47, 175, 104, 0.26)')
    // the ink sits between the hue and white
    const ink = c.ink.match(/\d+/g).map(Number)
    expect(ink[0]).toBeGreaterThan(47)
    expect(ink[1]).toBeGreaterThan(175)
    expect(ink.every((v) => v < 255)).toBe(true)
  })

  it('a muted hue stays muted, and an unreadable one falls back to UCT gold', () => {
    expect(markColors('rgba(255, 255, 255, 0.55)').tone).toBe('rgba(255, 255, 255, 0.55)')
    expect(markColors('rgba(255, 255, 255, 0.55)').glow).toBe('rgba(255, 255, 255, 0.231)')
    expect(markColors(null).tone).toBe('rgb(220, 187, 94)')
  })
})
