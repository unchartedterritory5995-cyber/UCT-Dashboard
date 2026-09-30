import { describe, test, expect } from 'vitest'
import {
  economicSubtitle, econFacts, frequencyLabel, agencyShort, nextReleaseText, economicStatusLine,
  observationReadout, clock12, shortDate,
} from './econUi'
import { economicCurrentness } from '../engine/economicSeries'
import { CATALOG, metaOf } from './__fixtures__/econCatalog'

describe('econUi — the words a member reads', () => {
  test('subtitle is agency · frequency · units, from either row shape', () => {
    expect(economicSubtitle(metaOf('USCPI'))).toBe('BLS · Monthly · Index')
    expect(economicSubtitle(metaOf('USICSA'))).toBe('Dept. of Labor · Weekly · Count')
    expect(economicSubtitle(metaOf('USRGDPQA'))).toBe('BEA · Quarterly · Percent')
    // the /api/ticker-search row shape (agency + units flattened)
    expect(economicSubtitle({ ticker: 'ECON:UST10Y', symbol: 'UST10Y', agency: 'Board of Governors of the Federal Reserve System',
      frequency: 'D', units: '%' })).toBe('Federal Reserve · Daily · Percent')
  })

  test('facts never promote a provider id to the name', () => {
    for (const row of CATALOG.series) {
      const f = econFacts(row)
      expect(f.name).toBe(row.name)
      expect(f.name).not.toMatch(/CUSR0000|RIFLGFCY|A191RL/i)
      expect(f.id).toBe(`ECON:${row.symbol}`)
    }
  })

  test('frequency + agency labels', () => {
    expect(frequencyLabel('W (week ending Saturday)')).toBe('Weekly')
    expect(frequencyLabel('IRREG')).toBe('As announced')
    expect(agencyShort('UCT (derived from BLS)')).toBe('UCT (derived from BLS)')
  })

  test('clock + dates', () => {
    expect(clock12('08:30')).toBe('8:30 AM')
    expect(clock12('14:00')).toBe('2:00 PM')
    expect(clock12('00:05')).toBe('12:05 AM')
    expect(shortDate('2026-10-14', { nowIso: '2026-09-30' })).toBe('Oct 14')
    expect(shortDate('2027-01-12', { nowIso: '2026-09-30' })).toBe('Jan 12, 2027')
  })
})

describe('next release — never invents a time', () => {
  const now = { nowIso: '2026-09-30' }
  test('exact', () => {
    expect(nextReleaseText({ date: '2026-10-14', time: '08:30', tz: 'America/New_York', precision: 'exact' }, now))
      .toBe('Oct 14, 8:30 AM ET')
  })
  test('time_configured says (typical)', () => {
    expect(nextReleaseText({ date: '2026-10-14', time: '08:30', tz: 'America/New_York', precision: 'time_configured' }, now))
      .toBe('Oct 14, 8:30 AM ET (typical)')
  })
  test('rule is an estimate', () => {
    expect(nextReleaseText({ date: '2026-10-30', time: '08:30', tz: 'America/New_York', precision: 'rule' }, now))
      .toBe('Oct 30, ~8:30 AM ET (est.)')
  })
  test('date_only prints no time', () => {
    expect(nextReleaseText({ date: '2026-10-30', time: null, tz: null, precision: 'date_only' }, now)).toBe('Oct 30')
  })
  test('unknown prints nothing', () => {
    expect(nextReleaseText({ date: null, time: null, precision: 'unknown' }, now)).toBe('')
  })
})

describe('status line — "Up to date" ONLY when the backend said CURRENT', () => {
  const nr = { date: '2026-10-14', time: '08:30', tz: 'America/New_York', precision: 'exact' }
  const line = (state, extra = {}) => economicStatusLine(economicCurrentness({ state, next_release: nr, ...extra }), { nowIso: '2026-09-30' })

  test('CURRENT', () => {
    expect(line('CURRENT')).toEqual({ tone: 'ok', text: 'Up to date · next release Oct 14, 8:30 AM ET' })
  })
  test('CHECKING / UNCONFIRMED -> checking', () => {
    expect(line('CHECKING').text).toBe('Update expected — checking')
    expect(line('UNCONFIRMED').text).toBe('Update expected — checking')
  })
  test('DELAYED / SOURCE_UNAVAILABLE / VALIDATION_FAILED', () => {
    expect(line('DELAYED').text).toMatch(/^Delayed/)
    expect(line('SOURCE_UNAVAILABLE').text).toMatch(/^Source unavailable/)
    expect(line('VALIDATION_FAILED').text).toMatch(/^Source unavailable/)
  })
  test('NO_EXPECTATION / unknown -> Not scheduled, never up to date', () => {
    for (const s of ['NO_EXPECTATION', 'UNINITIALIZED', 'NOT_PRODUCTION', 'SOMETHING_NEW', null, 42]) {
      const l = line(s)
      expect(l.text).toMatch(/^Not scheduled/)
      expect(l.text).not.toMatch(/up to date/i)
    }
  })
  test('an as-of / historical view never says up to date — even over a CURRENT block', () => {
    const v = economicCurrentness({ state: 'CURRENT', next_release: nr }, { asof: 1790000000 })
    const l = economicStatusLine(v)
    expect(l.text).toMatch(/^Historical view/)
    expect(l.text).not.toMatch(/up to date/i)
  })
  test('negative control: a view that claims CURRENT without claimsCurrent is not trusted', () => {
    expect(economicStatusLine({ state: 'current', claimsCurrent: false, historical: false, nextRelease: nr }).text).toBe('Not scheduled')
  })
})

describe('observation readout', () => {
  test('value · period · change · released', () => {
    const meta = metaOf('USCPI')
    const p = { t: Date.parse('2026-09-11T12:30:00Z') / 1000, v: 334.13, ps: '2026-08-01', pe: '2026-08-31' }
    const q = { t: 0, v: 333.73, ps: '2026-07-01', pe: '2026-07-31' }
    const r = observationReadout(p, q, meta, { nowIso: '2026-09-30' })
    expect(r).toMatchObject({ value: '334.130', period: 'Aug 2026', released: 'released Sep 11', change: '+0.400', up: true })
    expect(r.changePct).toBe('+0.12%')
  })
  test('a rate prints no percent-of-a-percent', () => {
    const r = observationReadout({ t: 1, v: 4.25, ps: '2026-09-18', pe: '2026-09-18' }, { t: 0, v: 4.5, ps: '2026-07-30', pe: '2026-07-30' },
      metaOf('USFEDFUNDSU'))
    expect(r.change).toBe('−0.25 pp')
    expect(r.changePct).toBeNull()
  })
  test('a gap is no readout, never zero', () => {
    expect(observationReadout({ t: 1, v: null, ps: '2025-10-01', pe: '2025-10-31' }, null, metaOf('USCPI'))).toBeNull()
  })
})
