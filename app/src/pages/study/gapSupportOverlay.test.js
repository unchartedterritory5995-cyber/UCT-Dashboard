/** gapSupportOverlay rails: the gap top + gap-day low rays every Gap Support chart carries. */
import { describe, it, expect } from 'vitest'
import { gapAnnotations, gapBars, isGapSupportItem, GAP_SUPPORT_SKILL_ID } from './gapSupportOverlay'
import { studyAnnotations, hasStudyOverlay } from './studyOverlays'

function bars(n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const day = String(i + 1).padStart(2, '0')
    out.push({ t: `2025-03-${day}`, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 100 })
  }
  return out
}
const GAP = { skill_id: GAP_SUPPORT_SKILL_ID, asof: '2025-03-08', reveal_json: { facts: { gap_asof: '2025-03-04', gap_top: 13.0 } } }

describe('gapSupportOverlay', () => {
  it('reads the skill id first, the setup name second', () => {
    expect(isGapSupportItem(GAP)).toBe(true)
    expect(isGapSupportItem({ skill_id: 'setup.vcp', reveal_json: { facts: { setup: 'Gap Support' } } })).toBe(true)
    expect(isGapSupportItem({ skill_id: 'setup.vcp' })).toBe(false)
  })
  it('finds the gap bar by facts.gap_asof (ISO or YYYYMMDD) and the bar before it', () => {
    expect(gapBars(GAP, bars(8)).gap.t).toBe('2025-03-04')
    expect(gapBars(GAP, bars(8)).prior.t).toBe('2025-03-03')
    const ints = bars(8).map((b) => ({ ...b, t: Number(b.t.replace(/-/g, '')) }))
    expect(gapBars(GAP, ints).gap.t).toBe(20250304)
    expect(gapBars({ ...GAP, reveal_json: { facts: {} } }, bars(8))).toBeNull()
  })
  it('draws a ray at the stored gap top and a fainter ray at the gap-day low, both from the gap day', () => {
    const out = gapAnnotations(GAP, bars(8))
    expect(out.map((a) => `${a.id}:${a.type}@${a.points[0].time}=${a.points[0].price}`))
      .toEqual(['study-gap-top:hray@2025-03-04=13', 'study-gap-low:hray@2025-03-04=12'])
    expect(out[0].showPriceLabel).toBe(true)
  })
  it('falls back to the prior bar high when no gap top is stored, and is null without a gap day', () => {
    const noTop = { ...GAP, reveal_json: { facts: { gap_asof: '2025-03-04' } } }
    expect(gapAnnotations(noTop, bars(8))[0].points[0].price).toBe(13)   // the 2025-03-03 bar's high
    expect(gapAnnotations({ skill_id: GAP_SUPPORT_SKILL_ID }, bars(8))).toBeNull()
  })
  it('studyOverlays dispatches: HVE, Gap Support, nothing else', () => {
    expect(hasStudyOverlay(GAP)).toBe(true)
    expect(hasStudyOverlay({ skill_id: 'setup.family3.hve' })).toBe(true)
    expect(hasStudyOverlay({ skill_id: 'setup.vcp' })).toBe(false)
    expect(studyAnnotations(GAP, bars(8)).length).toBe(2)
    expect(studyAnnotations({ skill_id: 'setup.family3.hve', asof: '2025-03-05' }, bars(8))[0].type).toBe('hray')
    expect(studyAnnotations({ skill_id: 'setup.vcp' }, bars(8))).toBeNull()
  })
})
