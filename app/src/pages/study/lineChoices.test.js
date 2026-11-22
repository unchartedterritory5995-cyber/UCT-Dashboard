import { describe, it, expect } from 'vitest'
import { lineAnnotations, keyedLabel, hasLines } from './lineChoices'

const bars = Array.from({ length: 20 }, (_, i) => ({ t: `2020-01-${String(i + 1).padStart(2, '0')}`, o: 10, h: 11, l: 9, c: 10, v: 1 }))
const item = { answer_json: { answer: 'Line B' }, prompt_json: { chart: { lines: [
  { label: 'A', price: 12, from: '2020-01-05' }, { label: 'B', price: 9.5, from: '20200103' }, { label: 'C', price: 8 }] } } }

describe('lineChoices', () => {
  it('draws a dashed ray and a label chip per line, neutral before the answer', () => {
    const a = lineAnnotations(item, bars, null)
    expect(a).toHaveLength(6)
    const rays = a.filter((d) => d.type === 'hray')
    expect(rays.map((d) => d.points[0].price)).toEqual([12, 9.5, 8])
    expect(rays[1].points[0].time).toBe('2020-01-03')
    expect(rays[2].points[0].time).toBe('2020-01-01')
    expect(rays.every((d) => d.color !== '#dcbb5e' && d.lineStyle === 'dashed')).toBe(true)
    expect(a.filter((d) => d.type === 'text').map((d) => d.text)).toEqual(['A', 'B', 'C'])
  })
  it('turns the keyed line gold once revealed (member reveal or the reviewer card)', () => {
    for (const rev of [{ answer: 'Line B' }, { answer: { answer: 'Line B' } }, true]) {
      const rays = lineAnnotations(item, bars, rev).filter((d) => d.type === 'hray')
      expect(rays.find((d) => d.id === 'study-line-B').color).toBe('#dcbb5e')
      expect(rays.filter((d) => d.color === '#dcbb5e')).toHaveLength(1)
    }
  })
  it('draws nothing for an item without lines', () => {
    expect(lineAnnotations({ prompt_json: {} }, bars)).toBeNull()
    expect(hasLines({ prompt_json: { chart: {} } })).toBe(false)
    expect(keyedLabel('Line c')).toBe('C')
  })
})
