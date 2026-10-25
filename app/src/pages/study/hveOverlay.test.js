/** hveOverlay rails: the HVC ray + AVWAP every High Volume Edge chart carries (owner ruling 2026-10-25). */
import { describe, it, expect } from 'vitest'
import { HVE_SKILL_ID, hveAnchorBar, hveAnnotations, isHveItem } from './hveOverlay'

function bars(n, from = 1) {
  const out = []
  for (let i = 0; i < n; i++) {
    const day = String(from + i).padStart(2, '0')
    out.push({ t: `2025-03-${day}`, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 100 })
  }
  return out
}

describe('isHveItem', () => {
  it('reads the skill id first, the setup name second, and nothing else', () => {
    expect(isHveItem({ skill_id: HVE_SKILL_ID })).toBe(true)
    expect(isHveItem({ skill_id: 'setup.vcp', reveal_json: { facts: { setup: 'High Volume Edge' } } })).toBe(true)
    expect(isHveItem({ skill_id: 'setup.vcp', reveal_json: { facts: { setup: 'VCP' } } })).toBe(false)
    expect(isHveItem({ skill_id: 'setup.vcp' })).toBe(false)
    expect(isHveItem(null)).toBe(false)
  })
})

describe('hveAnchorBar', () => {
  it('is the bar dated asof, whether asof is ISO or a stored YYYYMMDD int', () => {
    const list = bars(6)
    expect(hveAnchorBar({ asof: '2025-03-04' }, list).c).toBe(13.5)
    expect(hveAnchorBar({ asof: 20250304 }, list).c).toBe(13.5)
  })
  it('falls back to the last VISIBLE bar when asof is missing (the forward strip is appended after it)', () => {
    const visible = bars(4)
    const withForward = [...visible, ...bars(2, 5)]
    expect(hveAnchorBar({ bars: { bars: visible } }, withForward).t).toBe('2025-03-04')
    expect(hveAnchorBar({ bars: visible }, withForward).t).toBe('2025-03-04')
    expect(hveAnchorBar({}, withForward).t).toBe('2025-03-06')
    expect(hveAnchorBar({ asof: '2025-03-04' }, [])).toBeNull()
  })
})

describe('hveAnnotations', () => {
  it('returns a horizontal ray at the HVE close and an AVWAP anchored on that bar, in the overlay shapes StockChart draws', () => {
    const list = bars(6)
    const out = hveAnnotations({ asof: '2025-03-03', skill_id: HVE_SKILL_ID }, list)
    expect(out.map((a) => a.id)).toEqual(['study-hvc-ray', 'study-hve-avwap'])
    const [ray, avwap] = out
    expect(ray.type).toBe('hray')
    expect(ray.points).toEqual([{ time: '2025-03-03', price: 12.5 }])
    expect(ray.showPriceLabel).toBe(true)
    expect(avwap.type).toBe('avwap')
    expect(avwap.points).toEqual([{ time: '2025-03-03' }])
  })
  it('is null with no bars, or a bar without a numeric close', () => {
    expect(hveAnnotations({ asof: '2025-03-03' }, [])).toBeNull()
    expect(hveAnnotations({ asof: '2025-03-03' }, [{ t: '2025-03-03', c: null }])).toBeNull()
  })
})
