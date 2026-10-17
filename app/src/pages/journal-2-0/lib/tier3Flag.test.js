// app/src/pages/journal-2-0/lib/tier3Flag.test.js
import { describe, expect, it, afterEach } from 'vitest'
import { TIER3_FLAG, tier3Enabled, isTier3Block } from './tier3Flag'
import { FLAG_FALLBACKS, __resetNotebookFlags, latchNotebookFlags } from './offline/notebookFlags'

describe('Tier 3 switch', () => {
  afterEach(() => { __resetNotebookFlags() })
  it('names the payload key', () => {
    expect(TIER3_FLAG).toBe('journal_tier3_enabled')
  })
  it('is an enablement gate: off until the payload says on', () => {
    expect(FLAG_FALLBACKS[TIER3_FLAG]).toBe(false)
    expect(tier3Enabled()).toBe(false)
  })
  it('follows the latched payload', () => {
    latchNotebookFlags({ [TIER3_FLAG]: true })
    expect(tier3Enabled()).toBe(true)
  })
  it('is false for a non-boolean value', () => {
    latchNotebookFlags({ [TIER3_FLAG]: 'yes' })
    expect(tier3Enabled()).toBe(false)
  })
})

describe('isTier3Block', () => {
  it('is true only for the mood check-in block', () => {
    expect(isTier3Block('moodCheckIn')).toBe(true)
  })
  it('is false for every other id, near-misses and non-strings included', () => {
    for (const id of ['alertChip', 'screenshotChip', 'moodcheckin', 'MoodCheckIn', ' moodCheckIn', '', null, undefined, 0, {}, ['moodCheckIn']]) {
      expect(isTier3Block(id), String(id)).toBe(false)
    }
  })
})
