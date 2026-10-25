/** SpotDrill rails: the HVE chart layer appears on reveal only, and only for a High Volume Edge item. */
import { describe, it, expect } from 'vitest'
import SpotDrill, { annotationsFor } from './SpotDrill'

function bars(n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const day = String(i + 1).padStart(2, '0')
    out.push({ t: `2025-03-${day}`, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 100 })
  }
  return out
}

const HVE = { id: 's1', type: 'spot', skill_id: 'setup.family3.hve', asof: '2025-03-05', prompt_json: { choices: ['High Volume Edge', 'VCP'] } }
const VCP = { ...HVE, skill_id: 'setup.vcp' }

describe('SpotDrill.annotationsFor', () => {
  it('is wired into the drill module the player reads', () => {
    expect(SpotDrill.annotationsFor).toBe(annotationsFor)
  })
  it('draws nothing before the reveal (a ray on the cutoff bar would answer the question)', () => {
    expect(annotationsFor({ choice: 'VCP' }, HVE, null, bars(8))).toBeNull()
  })
  it('on reveal draws the HVC ray at the cutoff close and the AVWAP from that bar, for an HVE item only', () => {
    const reveal = { correct: true, answer: { choice: 'High Volume Edge' } }
    const out = annotationsFor({ choice: 'High Volume Edge' }, HVE, reveal, bars(8))
    expect(out.map((a) => `${a.type}@${a.points[0].time}`)).toEqual(['hray@2025-03-05', 'avwap@2025-03-05'])
    expect(out[0].points[0].price).toBe(14.5)
    expect(annotationsFor({ choice: 'VCP' }, VCP, reveal, bars(8))).toBeNull()
  })
})
