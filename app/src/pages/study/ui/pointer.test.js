import { describe, expect, it } from 'vitest'
import { spotlight, spotlightChip, withAlpha } from './pointer'

// 90 daily bars: a quiet base around 100 (the base swings 98-102), then a candle to light
function bars(n = 90, last = { o: 100, h: 101.2, l: 99.3, c: 100.8 }) {
  const out = []
  for (let i = 0; i < n - 1; i++) {
    const base = 100 + Math.sin(i / 9) * 2
    out.push({ t: 1700000000 + i * 86400, o: base, h: base + 1.2, l: base - 1.1, c: base + 0.4 })
  }
  out.push({ t: 1700000000 + (n - 1) * 86400, ...last })
  return out
}

describe('spotlight: the candle\'s own column lit, a chip above every candle', () => {
  it('lights the candle\'s column: a translucent band and a centre line on the candle\'s own time', () => {
    const b = bars()
    const i = b.length - 1
    const d = spotlight(b, i, { view: 90, barPx: 6.6 })
    const verticals = d.filter((x) => x.type === 'vertical')
    expect(verticals).toHaveLength(2)
    for (const v of verticals) expect(v.points[0].time).toBe(b[i].t)
    const [band, line] = verticals
    expect(band.lineWidth).toBeGreaterThan(line.lineWidth)
    expect(band.color).toMatch(/^rgba\(220,187,94,0\.16\)$/)
    expect(d.some((x) => x.type === 'arrow')).toBe(false)            // nothing points across the chart any more
  })
  it('parks the chip in the pane\'s bottom margin, under every candle in the window, its right end at the band', () => {
    const b = bars()
    const i = b.length - 1
    const d = spotlight(b, i, { label: 'the answer', view: 90, barPx: 6.6 })
    const chip = spotlightChip(d)
    const shown = b.slice(b.length - 90)
    const top = Math.max(...shown.map((x) => x.h)), bot = Math.min(...shown.map((x) => x.l))
    expect(chip.points[0].price).toBeLessThan(bot)
    expect(chip.points[0].price).toBeGreaterThan(bot - (top - bot) * 0.1)   // inside the pane's own bottom margin
    expect(chip.points[0].time).toBeLessThan(b[i].t)                       // it starts left of the band and runs to it
    expect(chip.text).toBe(' THE ANSWER ')
  })
  it('a candle at the bottom of its window still gets its chip under it, inside the margin', () => {
    const b = bars(90, { o: 95, h: 95.5, l: 90, c: 90.4 })
    const i = b.length - 1
    const chip = spotlightChip(spotlight(b, i, { view: 90 }))
    expect(chip.points[0].price).toBeLessThan(90)
    expect(chip.points[0].price).toBeGreaterThan(90 - (103.2 - 90) * 0.1)
  })
  it('a phone packs bars tighter, so the chip spans more of them and the band is narrower', () => {
    const b = bars()
    const i = b.length - 1
    const desk = spotlight(b, i, { barPx: 6.6 }), phone = spotlight(b, i, { barPx: 3.8 })
    expect(spotlightChip(phone).points[0].time).toBeLessThan(spotlightChip(desk).points[0].time)
    expect(phone[0].lineWidth).toBeLessThan(desk[0].lineWidth)
  })
  it('is empty for a missing bar and locked for an editable chart', () => {
    expect(spotlight(null, 0)).toEqual([])
    expect(spotlight(bars(), 500)).toEqual([])
    expect(spotlight(bars(), 10).every((x) => x.locked)).toBe(true)
  })
  it('withAlpha turns a hex colour into rgba and leaves anything else alone', () => {
    expect(withAlpha('#dcbb5e', 0.5)).toBe('rgba(220,187,94,0.5)')
    expect(withAlpha('rgb(1,2,3)', 0.5)).toBe('rgb(1,2,3)')
  })
})
