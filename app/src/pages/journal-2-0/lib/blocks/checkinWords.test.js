// app/src/pages/journal-2-0/lib/blocks/checkinWords.test.js
//
// P2 Tier 3 Task 3: the mood and focus check-in's words and its ONE day rule (R-T3-2). `day` is the ET
// date of the first pick, never changed by a later pick, and cleared only when both are cleared.
import { describe, it, expect } from 'vitest'
import { MOOD_WORDS, FOCUS_WORDS, nextCheckinParams, checkinText, checkinDayText } from './checkinWords'

const EMPTY = Object.freeze({ mood: '', focus: '', day: '' })

describe('the check-in words (R-T3-2)', () => {
  it('are the ruling table, five each', () => {
    expect(MOOD_WORDS).toEqual({ 1: 'Rough', 2: 'Low', 3: 'Okay', 4: 'Good', 5: 'Great' })
    expect(FOCUS_WORDS).toEqual({ 1: 'Scattered', 2: 'Distracted', 3: 'Steady', 4: 'Focused', 5: 'Locked in' })
    expect(Object.isFrozen(MOOD_WORDS) && Object.isFrozen(FOCUS_WORDS)).toBe(true)
  })
})

describe('nextCheckinParams (R-T3-2 day rule)', () => {
  it('sets day from todayET on the first pick', () => {
    expect(nextCheckinParams({ mood: '', focus: '', day: '' }, 'mood', '4', '2026-10-17'))
      .toEqual({ mood: '4', focus: '', day: '2026-10-17' })
  })

  it('a later pick on another day keeps the first day', () => {
    const first = nextCheckinParams(EMPTY, 'mood', '2', '2026-10-17')
    const later = nextCheckinParams(first, 'focus', '5', '2026-10-18')
    expect(later).toEqual({ mood: '2', focus: '5', day: '2026-10-17' })
    // changing a value already picked keeps it too
    expect(nextCheckinParams(later, 'mood', '3', '2026-10-19').day).toBe('2026-10-17')
  })

  it('clearing both clears day; clearing one keeps it', () => {
    const both = { mood: '4', focus: '3', day: '2026-10-17' }
    const one = nextCheckinParams(both, 'mood', '', '2026-10-18')
    expect(one).toEqual({ mood: '', focus: '3', day: '2026-10-17' })
    expect(nextCheckinParams(one, 'focus', '', '2026-10-18')).toEqual({ mood: '', focus: '', day: '' })
  })

  it('is pure: a frozen input is never changed and a new object comes back', () => {
    const input = Object.freeze({ mood: '1', focus: '', day: '2026-10-16' })
    const out = nextCheckinParams(input, 'focus', '2', '2026-10-17')
    expect(out).not.toBe(input)
    expect(input).toEqual({ mood: '1', focus: '', day: '2026-10-16' })
    expect(out).toEqual({ mood: '1', focus: '2', day: '2026-10-16' })
    // same inputs, same answer
    expect(nextCheckinParams(input, 'focus', '2', '2026-10-17')).toEqual(out)
  })

  it("only '1'..'5' (or '' to clear) is a value; anything else changes nothing (R-T3-V1)", () => {
    const start = { mood: '4', focus: '', day: '2026-10-17' }
    for (const bad of ['0', '6', 4, 'Good', ' 4', null, undefined, '4.0']) {
      expect(nextCheckinParams(start, 'mood', bad, '2026-10-18'), String(bad)).toEqual(start)
    }
    // and an unknown key changes nothing
    expect(nextCheckinParams(start, 'day', '2026-10-01', '2026-10-18')).toEqual(start)
  })

  it('a stored value outside the levels reads as unpicked; a malformed day is replaced', () => {
    expect(nextCheckinParams({ mood: '9', focus: 'x', day: 'soon' }, 'focus', '3', '2026-10-17'))
      .toEqual({ mood: '', focus: '3', day: '2026-10-17' })
    expect(nextCheckinParams(undefined, 'mood', '5', '2026-10-17')).toEqual({ mood: '5', focus: '', day: '2026-10-17' })
  })
})

describe('the words a read-only check-in shows', () => {
  it('names the picks, mood first', () => {
    expect(checkinText({ mood: '4', focus: '3' })).toBe('Mood: Good · Focus: Steady')
    expect(checkinText({ mood: '', focus: '5' })).toBe('Focus: Locked in')
    expect(checkinText({ mood: '1', focus: '' })).toBe('Mood: Rough')
    expect(checkinText({})).toBe('')
    expect(checkinText({ mood: '7' })).toBe('')
  })

  it('the day reads as a month and a day, read from the string (no time zone can move it)', () => {
    expect(checkinDayText('2026-10-17')).toBe('Oct 17')
    expect(checkinDayText('2026-01-01')).toBe('Jan 1')
    expect(checkinDayText('2026-13-01')).toBe(null)
    expect(checkinDayText('')).toBe(null)
    expect(checkinDayText(undefined)).toBe(null)
  })
})
