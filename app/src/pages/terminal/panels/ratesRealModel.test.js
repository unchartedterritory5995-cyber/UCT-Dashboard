// RATES, the real yield block of the pure half (`realRead` and its words). Rails:
//   * every state of the block (ok, computing, unavailable with its reason, failed, a block that is
//     not this shape, no block at all) is told apart, and none of them touches the nominal answer;
//   * a real yield, a nominal yield or a breakeven that is missing stays null, never 0, and a
//     breakeven is the SERVER's figure: it is never worked out from the two yields here;
//   * a breakeven without its own day, or for another day than the block names, is not shown;
//   * the block's date and the breakevens' own date are each said, and said apart when they differ.
// Every figure is invented.
import { describe, it, expect } from 'vitest'
import {
  REAL_SOURCE, breakevenSentence, ratesRead, realAsOfSentence, realCheckWords, realMissingWords, realRead,
} from './ratesModel'

const mat = (key, label, months, y, d1 = null, w1 = null) => (
  { key, label, months, yield: y, was: { d1: null, w1: null }, change_bp: { d1, w1 } })
const be = (key, nominal, real, value, date = '2026-11-17') => ({ key, label: key, months: 1, date, nominal, real, value })
const REAL = (over = {}) => ({
  status: 'ok', as_of: '2026-11-17', ref_dates: { d1: '2026-11-16', w1: '2026-11-10' },
  maturities: [
    mat('5y', '5-year', 60, 1.21, -4, 10), mat('7y', '7-year', 84, 1.43, 0, 2.5), mat('10y', '10-year', 120, 1.64, 4, 14),
    mat('20y', '20-year', 240, 2.02, 1, null), mat('30y', '30-year', 360, null),
  ],
  breakevens: { as_of: '2026-11-17', rows: [be('5y', 3.85, 1.21, 2.64), be('7y', 3.99, 1.43, 2.56), be('10y', 4.12, 1.64, 2.48),
    be('20y', null, 2.02, null), be('30y', 4.61, null, null)] },
  rows: 7, read_at: '2026-11-17T23:21:10+00:00', basis: 'end_of_day', source: REAL_SOURCE, check: null, ...over,
})
const NOMINAL = { status: 'ok', as_of: '2026-11-17', maturities: [{ key: '10y', label: '10-year', months: 120, yield: 4.12 }] }

describe('realRead', () => {
  it('reads the block: each maturity with its real yield, changes, nominal yield and breakeven', () => {
    const real = realRead(REAL())
    expect(real.state).toBe('ok')
    expect(real.asOf).toBe('2026-11-17')
    expect(real.breakevenAsOf).toBe('2026-11-17')
    expect(real.refDates).toEqual({ d1: '2026-11-16', w1: '2026-11-10' })
    expect(real.rows.map((r) => r.key)).toEqual(['5y', '7y', '10y', '20y', '30y'])
    const ten = real.rows[2]
    expect([ten.label, ten.yield, ten.changeBp.d1, ten.changeBp.w1, ten.nominal, ten.breakeven]).toEqual(['10-year', 1.64, 4, 14, 4.12, 2.48])
    expect(real.readAt).toBe('2026-11-17T23:21:10+00:00')
    expect(real.check).toBeNull()
  })

  it('a missing side leaves the breakeven null: never 0, and never the other side', () => {
    const real = realRead(REAL())
    const [twenty, thirty] = [real.rows[3], real.rows[4]]
    expect([twenty.yield, twenty.nominal, twenty.breakeven]).toEqual([2.02, null, null])
    expect([thirty.yield, thirty.nominal, thirty.breakeven]).toEqual([null, 4.61, null])
    expect(real.rows[3].changeBp.w1).toBeNull()
  })

  it('never works a breakeven out here: a null from the server stays null beside both yields', () => {
    const rows = REAL().breakevens.rows.map((r) => (r.key === '10y' ? { ...r, value: null } : r))
    const ten = realRead(REAL({ breakevens: { as_of: '2026-11-17', rows } })).rows[2]
    expect([ten.yield, ten.nominal, ten.breakeven]).toEqual([1.64, 4.12, null])
  })

  it('a breakeven without its own day, or for another day than the block names, is not shown', () => {
    const none = realRead(REAL({ breakevens: { as_of: null, rows: REAL().breakevens.rows } }))
    expect(none.breakevenAsOf).toBeNull()
    expect(none.rows.every((r) => r.breakeven == null && r.nominal == null)).toBe(true)
    const other = REAL().breakevens.rows.map((r) => (r.key === '10y' ? { ...r, date: '2026-11-13' } : r))
    const mixed = realRead(REAL({ breakevens: { as_of: '2026-11-17', rows: other } }))
    expect(mixed.rows[2].breakeven).toBeNull()
    expect(mixed.rows[0].breakeven).toBe(2.64)
    expect(realRead(REAL({ breakevens: undefined })).rows.every((r) => r.breakeven == null)).toBe(true)
  })

  it('the breakevens keep their own date when the real curve is a day ahead', () => {
    const rows = REAL().breakevens.rows.map((r) => ({ ...r, date: '2026-11-16' }))
    const real = realRead(REAL({ breakevens: { as_of: '2026-11-16', rows } }))
    expect([real.asOf, real.breakevenAsOf]).toEqual(['2026-11-17', '2026-11-16'])
    expect(real.rows[2].breakeven).toBe(2.48)
  })

  it('tells computing, unavailable and failed apart, with the reason', () => {
    expect(realRead({ status: 'computing' })).toEqual({ state: 'computing' })
    expect(realRead({ status: 'unavailable', reason: 'refused', http_status: 403 })).toEqual({ state: 'unavailable', reason: 'refused', httpStatus: 403 })
    expect(realRead({ status: 'unavailable', reason: 'shape', http_status: 200 })).toEqual({ state: 'unavailable', reason: 'shape', httpStatus: 200 })
    expect(realRead({ status: 'failed', reason: 'timeout', http_status: null })).toEqual({ state: 'failed', reason: 'timeout', httpStatus: null })
  })

  it('a block that is not this shape is failed, and no block at all is null', () => {
    expect(realRead({ status: 'ok' }).state).toBe('failed')
    expect(realRead(REAL({ as_of: 'yesterday' })).state).toBe('failed')
    expect(realRead(REAL({ maturities: REAL().maturities.map((m) => ({ ...m, yield: null })) })).state).toBe('failed')
    expect(realRead({}).state).toBe('failed')
    for (const none of [undefined, null, 'ok', 7, []]) expect(realRead(none)).toBeNull()
  })

  it('keeps a look that did not go well beside the figures', () => {
    const real = realRead(REAL({ check: { state: 'failed', reason: 'source', http_status: 503, at: '2026-11-18T23:20:00+00:00' } }))
    expect(real.state).toBe('ok')
    expect(real.check).toEqual({ state: 'failed', reason: 'source', httpStatus: 503 })
  })
})

describe('ratesRead with the real block', () => {
  it('carries the block beside an ok answer, and an answer without one still reads', () => {
    expect(ratesRead({ ...NOMINAL, real: REAL() }).real.state).toBe('ok')
    expect(ratesRead({ ...NOMINAL, real: { status: 'computing' } }).real).toEqual({ state: 'computing' })
    const bare = ratesRead(NOMINAL)
    expect(bare.state).toBe('ok')
    expect(bare.real).toBeNull()
  })

  it('a real block that failed never fails the nominal answer', () => {
    const view = ratesRead({ ...NOMINAL, real: { status: 'failed', reason: 'error', http_status: null } })
    expect(view.state).toBe('ok')
    expect(view.maturities[0].yield).toBe(4.12)
    expect(view.real.state).toBe('failed')
  })

  it('a nominal answer that is not ok carries no real block', () => {
    expect(ratesRead({ status: 'computing', real: REAL() })).toEqual({ state: 'computing' })
    expect(ratesRead({ status: 'unavailable', reason: 'refused', http_status: 403, real: REAL() }).real).toBeUndefined()
  })
})

describe('the real block in words', () => {
  it('says its date, that it is an end-of-day figure and its own source', () => {
    expect(REAL_SOURCE).toBe('US Treasury daily par real yield curve')
    expect(realAsOfSentence(realRead(REAL()))).toBe(
      'End-of-day real yields for Nov 17, 2026: what Treasury inflation-protected securities yield above inflation. '
      + 'Source: US Treasury daily par real yield curve.',
    )
  })

  it('says the breakevens\' own date, and that it is an older day when it is', () => {
    expect(breakevenSentence(realRead(REAL()))).toBe(
      'Breakevens are for Nov 17, 2026: the nominal yield minus the real yield at the same maturity, '
      + 'which is the inflation rate the bond market is pricing over that many years.',
    )
    const rows = REAL().breakevens.rows.map((r) => ({ ...r, date: '2026-11-16' }))
    expect(breakevenSentence(realRead(REAL({ breakevens: { as_of: '2026-11-16', rows } })))).toContain(
      'Breakevens are for Nov 16, 2026, the newest day both curves have a figure: ',
    )
    expect(breakevenSentence(realRead(REAL({ breakevens: { as_of: null, rows: [] } })))).toBe(
      'No breakeven can be worked out: the two curves have no day in common in what the site holds.',
    )
  })

  it('a block with nothing to show says why, in words', () => {
    expect(realMissingWords({ state: 'computing' })).toBe("Real yields are being read from the Treasury's website. This part fills in on its own.")
    expect(realMissingWords({ state: 'unavailable', reason: 'refused', httpStatus: 403 })).toBe(
      "Real yields and breakevens are not available right now: the Treasury's website refused the server's request (it answered 403). That is not the same as no figures.",
    )
    expect(realMissingWords({ state: 'unavailable', reason: 'refused', httpStatus: null })).not.toContain('it answered')
    expect(realMissingWords({ state: 'unavailable', reason: 'shape', httpStatus: 200 })).toContain('answered, but not with figures this screen can read')
    expect(realMissingWords({ state: 'failed', reason: 'timeout' })).toBe(
      'Real yields and breakevens could not be read just now. That is not the same as no figures. The server tries again by itself.',
    )
  })

  it('a look that did not go well names the last good date', () => {
    expect(realCheckWords({ state: 'failed', reason: 'source', httpStatus: 503 }, '2026-11-14')).toBe(
      'The last look for newer real yields did not get an answer. These are the last real yields the site read, for Nov 14, 2026.',
    )
    expect(realCheckWords({ state: 'unavailable', reason: 'refused', httpStatus: 403 }, '2026-11-14')).toBe(
      "The Treasury's website refused the last look for newer real yields (it answered 403). These are the last real yields the site read, for Nov 14, 2026.",
    )
    expect(realCheckWords({ state: 'unavailable', reason: 'shape', httpStatus: 200 }, '2026-11-14')).toContain('but not with figures this screen can read')
  })
})
