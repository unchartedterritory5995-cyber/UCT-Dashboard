import { describe, it, expect } from 'vitest'
import {
  ACTUALS_POLL_MS, IMMINENT_LEAD_MINUTES, computeLifecycle, countdownText,
  etParts, shouldPollActuals, windowStart,
} from './earningsLifecycle'

// 2026-08-06 is a Thursday; ET is UTC-4 (EDT) on that date.
const at = (etHour, etMin = 0) => Date.parse(`2026-08-06T${String(etHour).padStart(2, '0')}:${String(etMin).padStart(2, '0')}:00-04:00`)
const base = { reportDate: '2026-08-06', timing: 'amc', timeEt: null,
               reported: false, recapPresent: false, callStartMs: null }

describe('etParts', () => {
  it('reports ET wall clock regardless of the host timezone', () => {
    expect(etParts(at(16, 5))).toEqual({ date: '2026-08-06', minutes: 16 * 60 + 5 })
  })
  it('is DST-correct across the standard-time boundary', () => {
    // 2026-01-15 12:00 ET is UTC-5.
    expect(etParts(Date.parse('2026-01-15T12:00:00-05:00')))
      .toEqual({ date: '2026-01-15', minutes: 12 * 60 })
  })
})

describe('windowStart', () => {
  it('anchors AMC at 16:00 ET and BMO at 07:00 ET', () => {
    expect(windowStart({ reportDate: '2026-08-06', timing: 'amc' }))
      .toEqual({ date: '2026-08-06', minutes: 16 * 60 })
    expect(windowStart({ reportDate: '2026-08-06', timing: 'bmo' }))
      .toEqual({ date: '2026-08-06', minutes: 7 * 60 })
  })
  it('treats an unknown session as AMC rather than inventing a time', () => {
    expect(windowStart({ reportDate: '2026-08-06', timing: null }).minutes).toBe(16 * 60)
  })
  it('uses time_et ONLY when it carries an explicit offset', () => {
    expect(windowStart({ reportDate: '2026-08-06', timing: 'amc',
                         timeEt: '2026-08-06T16:35:00-04:00' }).minutes).toBe(16 * 60 + 35)
    // No offset -> ambiguous -> the session anchor wins, NOT a local-time parse.
    expect(windowStart({ reportDate: '2026-08-06', timing: 'amc',
                         timeEt: '2026-08-06T16:35:00' }).minutes).toBe(16 * 60)
    expect(windowStart({ reportDate: '2026-08-06', timing: 'amc',
                         timeEt: 'not a date' }).minutes).toBe(16 * 60)
  })
  it('returns null without a report date', () => {
    expect(windowStart({ reportDate: null, timing: 'amc' })).toBeNull()
  })
})

describe('computeLifecycle (§4.5)', () => {
  it('PRE more than the lead time before the window', () => {
    expect(computeLifecycle({ ...base, nowMs: at(12, 0) })).toBe('PRE')
    expect(computeLifecycle({ ...base, nowMs: at(15, 44) })).toBe('PRE')
  })

  it('IMMINENT from lead-time-before the window until actuals land', () => {
    expect(IMMINENT_LEAD_MINUTES).toBe(15)
    expect(computeLifecycle({ ...base, nowMs: at(15, 45) })).toBe('IMMINENT')
    expect(computeLifecycle({ ...base, nowMs: at(16, 30) })).toBe('IMMINENT')
    // no stale "Reports tonight" survives past T0
    expect(computeLifecycle({ ...base, nowMs: at(19, 0) })).toBe('IMMINENT')
  })

  it('PRINTED as soon as actuals are present', () => {
    expect(computeLifecycle({ ...base, nowMs: at(16, 20), reported: true })).toBe('PRINTED')
  })

  it('CALL_LIVE once the call start passes with actuals but no recap', () => {
    expect(computeLifecycle({ ...base, nowMs: at(17, 5), reported: true,
                             callStartMs: at(17, 0) })).toBe('CALL_LIVE')
    // the call time alone, with nothing printed, is NOT call-live
    expect(computeLifecycle({ ...base, nowMs: at(17, 5), reported: false,
                             callStartMs: at(17, 0) })).toBe('IMMINENT')
    // before the call start it is still just PRINTED
    expect(computeLifecycle({ ...base, nowMs: at(16, 40), reported: true,
                             callStartMs: at(17, 0) })).toBe('PRINTED')
  })

  it('POST once a recap exists, whatever else is true', () => {
    expect(computeLifecycle({ ...base, nowMs: at(18, 0), reported: true,
                              recapPresent: true, callStartMs: at(17, 0) })).toBe('POST')
    expect(computeLifecycle({ ...base, nowMs: at(18, 0), reported: false,
                              recapPresent: true })).toBe('POST')
  })

  it('a BMO name is IMMINENT in the morning, not at 4pm', () => {
    const bmo = { ...base, timing: 'bmo' }
    expect(computeLifecycle({ ...bmo, nowMs: at(6, 30) })).toBe('PRE')
    expect(computeLifecycle({ ...bmo, nowMs: at(6, 50) })).toBe('IMMINENT')
  })

  it('a future report date stays PRE all of today', () => {
    expect(computeLifecycle({ ...base, reportDate: '2026-08-20', nowMs: at(23, 30) }))
      .toBe('PRE')
  })

  it('falls back to PRE when the report date is unknown', () => {
    expect(computeLifecycle({ ...base, reportDate: null, nowMs: at(20, 0) })).toBe('PRE')
  })
})

describe('countdownText', () => {
  it('renders hours and minutes, then minutes, then nothing', () => {
    const w = { date: '2026-08-06', minutes: 16 * 60 }
    expect(countdownText(at(12, 0), w)).toBe('in 4h 0m')
    expect(countdownText(at(15, 12), w)).toBe('in 48m')
    expect(countdownText(at(16, 1), w)).toBeNull()
    expect(countdownText(at(12, 0), null)).toBeNull()
  })
  it('spans a date boundary without going negative', () => {
    const w = { date: '2026-08-07', minutes: 7 * 60 }
    expect(countdownText(at(20, 0), w)).toBe('in 11h 0m')
  })
})

describe('shouldPollActuals', () => {
  it('polls ONLY for an open modal on a today-reporter in IMMINENT', () => {
    const on = { lifecycle: 'IMMINENT', isTodayReporter: true, modalOpen: true }
    expect(shouldPollActuals(on)).toBe(true)
    expect(shouldPollActuals({ ...on, modalOpen: false })).toBe(false)
    expect(shouldPollActuals({ ...on, isTodayReporter: false })).toBe(false)
    expect(shouldPollActuals({ ...on, lifecycle: 'PRE' })).toBe(false)
    expect(shouldPollActuals({ ...on, lifecycle: 'PRINTED' })).toBe(false)
  })
  it('polls inside the spec band of 30-60s', () => {
    expect(ACTUALS_POLL_MS).toBeGreaterThanOrEqual(30000)
    expect(ACTUALS_POLL_MS).toBeLessThanOrEqual(60000)
  })
})
