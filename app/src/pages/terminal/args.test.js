// UCT Terminal — args.js: the per-variant argument kinds (timeframe, calendarDay, code) and
// `applyArgs`/`argsEcho`'s never-silent contract (every token is APPLIED or ECHOED as not
// applied). This file pins the `calendarDay` kind's date validation (2026-10-05 fix): the
// shape regex alone let native `Date` auto-rollover accept an impossible date like
// `2026-02-30` and silently apply the week of Mar 2 — rejected now, after confirming the
// parsed y/m/d round-trips through `Date` unchanged.
import { describe, it, expect } from 'vitest'
import { ARG_KINDS, applyArgs, argsEcho } from './args'

describe('calendarDay: TODAY / NEXT / PREV / a real date', () => {
  it('TODAY resolves to the day with no week shift', () => {
    expect(ARG_KINDS.calendarDay.parse('TODAY', { today: '2026-10-05' }))
      .toEqual({ week: null, d: '2026-10-05' })
  })
  it('NEXT / PREV shift a full week from the current Monday', () => {
    expect(ARG_KINDS.calendarDay.parse('NEXT', { today: '2026-10-05' }))
      .toMatchObject({ d: null })
    expect(ARG_KINDS.calendarDay.parse('PREV', { today: '2026-10-05' }))
      .toMatchObject({ d: null })
  })
  it('a REAL date (YYYY-MM-DD) resolves to its week + day', () => {
    expect(ARG_KINDS.calendarDay.parse('2026-10-07', { today: '2026-10-05' }))
      .toEqual({ week: null, d: '2026-10-07' })   // same week as today -> week:null
    expect(ARG_KINDS.calendarDay.parse('2026-11-03', { today: '2026-10-05' }))
      .toEqual({ week: '2026-11-02', d: '2026-11-03' })
  })
  it('an IMPOSSIBLE date is rejected, never auto-rolled by native Date', () => {
    // 2026-02-30 does not exist; native `new Date('2026-02-30T12:00:00')` rolls it to
    // 2026-03-02 (a Monday) rather than throwing — that rollover is the bug.
    expect(ARG_KINDS.calendarDay.parse('2026-02-30', { today: '2026-10-05' })).toBeNull()
    // Other shapes of impossible date: month 13, day 32, Feb 29 on a non-leap year.
    expect(ARG_KINDS.calendarDay.parse('2026-13-01', { today: '2026-10-05' })).toBeNull()
    expect(ARG_KINDS.calendarDay.parse('2026-01-32', { today: '2026-10-05' })).toBeNull()
    expect(ARG_KINDS.calendarDay.parse('2026-02-29', { today: '2026-10-05' })).toBeNull()   // 2026 is not a leap year
    expect(ARG_KINDS.calendarDay.parse('2024-02-29', { today: '2026-10-05' })).not.toBeNull()  // 2024 IS a leap year
  })
  it('a malformed shape never reaches the real-date check (null, not a throw)', () => {
    expect(ARG_KINDS.calendarDay.parse('not-a-date', { today: '2026-10-05' })).toBeNull()
    expect(ARG_KINDS.calendarDay.parse('2026/10/05', { today: '2026-10-05' })).toBeNull()
  })
})

describe('applyArgs + argsEcho: the impossible date is echoed as NOT APPLIED, never silently', () => {
  it('CAL 2026-02-30 is not applied, and the echo says so — never a false "applied day" line', () => {
    const variant = { panel: 'Calendar', args: [{ kind: 'calendarDay', param: true }] }
    const result = applyArgs(variant, ['2026-02-30'], { today: '2026-10-05' })
    expect(result.applied).toEqual([])
    expect(result.ignored).toEqual(['2026-02-30'])
    const echo = argsEcho('CAL', result)
    expect(echo).toContain('Not applied')
    expect(echo).toContain('2026-02-30')
    expect(echo).not.toContain('applied day')
  })
  it('CAL 2026-10-07 (a real date) IS applied, with a true "applied day" echo', () => {
    const variant = { panel: 'Calendar', args: [{ kind: 'calendarDay', param: true }] }
    const result = applyArgs(variant, ['2026-10-07'], { today: '2026-10-05' })
    expect(result.ignored).toEqual([])
    expect(result.params).toEqual({ week: null, d: '2026-10-07' })
    const echo = argsEcho('CAL', result)
    expect(echo).toContain('applied day 2026-10-07')
  })
})
