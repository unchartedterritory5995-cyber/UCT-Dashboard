/** bearGapOverlay rails: the gap-fill level + gap-day high rays every Bear Gap off the Highs chart carries. */
import { describe, it, expect } from 'vitest'
import { bearGapAnnotations, bearGapBars, isBearGapItem, BEAR_GAP_SKILL_ID } from './bearGapOverlay'
import { studyAnnotations, hasStudyOverlay } from './studyOverlays'

// five daily bars; the fourth is the gap day (its high under the prior low), the fifth is forward
const BARS = [
  { t: '2022-01-14', o: 520, h: 530, l: 515, c: 525, v: 100 },
  { t: '2022-01-18', o: 524, h: 528, l: 512, c: 516, v: 100 },
  { t: '2022-01-20', o: 517, h: 522, l: 505, c: 508, v: 100 },
  { t: '2022-01-21', o: 400, h: 410, l: 380, c: 397, v: 900 },
  { t: '2022-01-24', o: 395, h: 405, l: 360, c: 387, v: 400 },
]
const BEAR = {
  skill_id: BEAR_GAP_SKILL_ID, asof: '2022-01-21',
  reveal_json: { facts: { gap_fill_level: 505, gap_day_high: 410 } },
}

describe('bearGapOverlay', () => {
  it('is a bear gap item by skill, or by the setup name in the facts', () => {
    expect(isBearGapItem(BEAR)).toBe(true)
    expect(isBearGapItem({ skill_id: 'setup.vcp', reveal_json: { facts: { setup: 'Bear Gap off the Highs' } } })).toBe(true)
    expect(isBearGapItem({ skill_id: 'setup.family3.gap_support', reveal_json: { facts: { setup: 'Gap Support' } } })).toBe(false)
    expect(isBearGapItem(null)).toBe(false)
  })
  it('finds the gap bar by the item asof (ISO or yyyymmdd keys) and the bar before it', () => {
    expect(bearGapBars(BEAR, BARS).gap.t).toBe('2022-01-21')
    expect(bearGapBars(BEAR, BARS).prior.t).toBe('2022-01-20')
    const num = BARS.map((b) => ({ ...b, t: Number(b.t.replace(/-/g, '')) }))
    expect(bearGapBars(BEAR, num).gap.t).toBe(20220121)
    expect(bearGapBars({ ...BEAR, asof: '2022-01-14' }, BARS)).toBeNull()
    expect(bearGapBars({ ...BEAR, asof: '2099-01-01' }, BARS)).toBeNull()
  })
  it('draws the gap-day high faint and the gap-fill level gold with the price label, rays from the gap day', () => {
    const out = bearGapAnnotations(BEAR, BARS)
    expect(out.map((a) => a.id)).toEqual(['study-bear-gap-high', 'study-bear-gap-fill'])
    expect(out[0]).toMatchObject({ type: 'hray', points: [{ time: '2022-01-21', price: 410 }], lineWidth: 1 })
    expect(out[0].showPriceLabel).toBeUndefined()
    expect(out[1]).toMatchObject({ type: 'hray', points: [{ time: '2022-01-21', price: 505 }], lineWidth: 2, showPriceLabel: true })
    expect(out[1].color).not.toBe(out[0].color)
  })
  it('falls back to the bars themselves when the facts carry no levels', () => {
    const out = bearGapAnnotations({ ...BEAR, reveal_json: { facts: {} } }, BARS)
    expect(out[0].points[0].price).toBe(410)
    expect(out[1].points[0].price).toBe(505)
  })
  it('is reachable through the one study overlay door both screens ask', () => {
    expect(hasStudyOverlay(BEAR)).toBe(true)
    expect(studyAnnotations(BEAR, BARS).map((a) => a.id)).toEqual(['study-bear-gap-high', 'study-bear-gap-fill'])
    expect(studyAnnotations(BEAR, [])).toBeNull()
  })
})
