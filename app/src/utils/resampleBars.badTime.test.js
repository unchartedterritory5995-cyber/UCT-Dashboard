import { describe, it, expect } from 'vitest'
import {
  resample, resampleDailyToMonthly, resampleDailyToWeekly, resampleForSpec,
  resampleIntradaySession, resampleNDaily, resampleNMonthly, resampleNWeekly,
} from './resampleBars'
import { resampleSpec } from '../components/chart/timeframes'

// Synthetic values only. Intraday `t` is unix seconds, as /api/bars returns it.
const OPEN = Math.floor(Date.UTC(2026, 6, 15, 13, 30, 0) / 1000) // Wed 09:30 ET (EDT)
const minuteBars = n => Array.from({ length: n }, (_, i) => ({
  t: OPEN + i * 60, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 10,
}))
const dailyBar = t => ({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 })

describe('a bad bar time never takes the chart down', () => {
  const spec = resampleSpec('47')

  it('47m is the path that crashed: it resamples from 1m as a session bucket', () => {
    expect(spec).toEqual({ base: '1', kind: 'intradaySession', minutes: 47 })
  })

  it('daily-shaped bars on a 47m interval yield no bars instead of throwing', () => {
    const daily = ['2026-07-13', '2026-07-14', '2026-07-15'].map(dailyBar)
    expect(resampleForSpec(daily, spec)).toEqual([])
  })

  it('a date-string bar inside a real-shaped 1m payload costs that bar only', () => {
    const clean = minuteBars(100)
    const dirty = [...clean.slice(0, 50), dailyBar('2026-07-15'), ...clean.slice(50)]
    expect(resampleForSpec(dirty, spec)).toEqual(resampleForSpec(clean, spec))
  })

  it.each([
    ['a word', 'abc'], ['an empty string', ''], ['NaN', NaN], ['Infinity', Infinity],
    ['a time past the Date range', 1e20], ['an object', {}], ['a missing time', undefined],
  ])('skips %s', (_name, t) => {
    const clean = minuteBars(10)
    const out = resampleIntradaySession([{ ...clean[0], t }, ...clean], 47)
    expect(out).toEqual(resampleIntradaySession(clean, 47))
  })

  it('skips a null entry anywhere in the array', () => {
    const clean = minuteBars(10)
    const out = resampleIntradaySession([clean[0], null, ...clean.slice(1)], 47)
    expect(out).toEqual(resampleIntradaySession(clean, 47))
  })

  it('valid output is unchanged: 47 one-minute bars form one bucket at the open', () => {
    const out = resampleIntradaySession(minuteBars(48), 47)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ t: OPEN, o: 100, h: 147, l: 99, c: 146.5, v: 470 })
    expect(out[1]).toMatchObject({ t: OPEN + 47 * 60, o: 147, v: 10 })
  })

  it('the numeric-string time that already worked keeps working', () => {
    const [b] = minuteBars(1)
    const out = resampleIntradaySession([{ ...b, t: String(b.t) }], 47)
    expect(out).toEqual([{ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }])
  })
})

describe('the date-keyed resamplers skip a unix time the same way', () => {
  const daily = ['2026-07-13', '2026-07-14', '2026-07-15'].map(dailyBar)
  const dirty = [daily[0], dailyBar(OPEN), daily[1], dailyBar('not-a-date'), daily[2]]

  it.each([
    ['weekly', b => resampleDailyToWeekly(b)],
    ['monthly', b => resampleDailyToMonthly(b)],
    ['3-day', b => resampleNDaily(b, 3)],
    ['2-week', b => resampleNWeekly(b, 2)],
    ['3-month', b => resampleNMonthly(b, 3)],
    ['the D to W dispatcher', b => resample(b, 'D', 'W')],
  ])('%s drops the bad bars and matches the clean run', (_name, run) => {
    const out = run(dirty)
    expect(out.length).toBeGreaterThan(0)
    expect(out).toEqual(run(daily))
  })
})
