import { describe, it, expect } from 'vitest'
import { skillChip } from './DrillPlayer'

// The chip over a drill chart names the skill in the member's words (bank v2's Chart IQ families, 2026-11-06).
describe('skillChip', () => {
  it('names the Chart IQ families', () => {
    expect(skillChip('read.cycle')).toBe('Cycle of price action')
    expect(skillChip('read.events')).toBe('Chart event')
    expect(skillChip('read.bases')).toBe('Base')
    expect(skillChip('read.levels')).toBe('Levels and lines')
    expect(skillChip('read.rs')).toBe('Relative strength')
  })
  it('keeps the older names', () => {
    expect(skillChip('vocab.candle')).toBe('Candle name')
    expect(skillChip('setup.family3.kicker')).toBe('Kicker')
    expect(skillChip('')).toBe('')
  })
})
