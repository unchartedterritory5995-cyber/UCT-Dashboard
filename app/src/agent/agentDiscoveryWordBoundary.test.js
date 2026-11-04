// Integrator fix on train2: the calendar / journal topic regexes held literal backspace bytes (0x08) where `\b`
// was meant (commit 3f7ca744df), so neither topic could ever match. Pin the word-boundary behaviour.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { matchTopic } from './discovery.js'

describe('discovery topic word boundaries', () => {
  it('the calendar and journal topics match their own words', () => {
    expect(matchTopic('what can you do on the calendar')?.id).toBe('calendar')
    expect(matchTopic('can you help with my journal')?.id).toBe('journal')
  })
  it('matches stay whole-word ("notesy" / "calendars2" style substrings do not count)', () => {
    expect(matchTopic('xjournalx')?.id).not.toBe('journal')
  })
  it('discovery.js holds no control characters', () => {
    const src = fs.readFileSync(path.join(__dirname, 'discovery.js'), 'latin1')
    expect(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(src)).toBe(false)
  })
})
