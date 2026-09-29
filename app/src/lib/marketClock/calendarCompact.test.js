// ⭐ The rail for `calendarCompact.js`: the production bundle's compact copy of
// `market_calendar.json` rebuilds the file EXACTLY, and the real session
// calendar answers the same from it. See that module's header for why it exists.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import FULL from './market_calendar.json'
import { compactCalendar, expandCalendar } from './calendarCompact'

const withoutComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')

describe('market_calendar.json in the bundle — interned, and rebuilt exactly', () => {
  it('the round trip is lossless on the real file', () => {
    // non-vacuity: the file really holds rows, and rows with names
    expect(FULL.holidays.length).toBeGreaterThan(100)
    expect(FULL.early_closes.length).toBeGreaterThan(10)
    expect(FULL.holidays.every((h) => typeof h.name === 'string' && h.name)).toBe(true)
    expect(expandCalendar(compactCalendar(FULL).doc)).toEqual(FULL)
  })

  it('the compact form is really smaller (the build step is not a no-op)', () => {
    const { doc, savedBytes } = compactCalendar(FULL)
    expect(savedBytes).toBeGreaterThan(JSON.stringify(FULL).length / 3)
    expect(doc.holidays).toBeUndefined()
    expect(typeof doc._compact.holidays).toBe('object')
  })

  it('refuses a date outside 2000-2099 instead of re-dating it a century off', () => {
    const row = { date: '1999-12-31', name: 'Millennium' }
    expect(() => compactCalendar({ ...FULL, holidays: [row] })).toThrow(/outside 2000-2099/)
  })

  it('a full document passes through unchanged (dev and tests read the file itself)', () => {
    expect(expandCalendar(FULL)).toBe(FULL)
  })

  it('⛔ CONTROL — a corrupted name table is SEEN by the equality above', () => {
    const { doc } = compactCalendar(FULL)
    const [first, second] = Object.keys(doc._compact.holidays)
    const bad = { ...doc, _compact: { ...doc._compact, holidays: {
      ...doc._compact.holidays, [first]: doc._compact.holidays[second], [second]: doc._compact.holidays[first],
    } } }
    expect(expandCalendar(bad)).not.toEqual(FULL)
  })

  it('the vite build applies it to this file, in code rather than prose', () => {
    const cfg = withoutComments(fs.readFileSync(path.resolve(__dirname, '../../../vite.config.js'), 'utf8'))
    expect(cfg).toMatch(/\/lib\/marketClock\/market_calendar\.json/)
    expect(cfg).toMatch(/compactCalendar\(JSON\.parse\(code\)\)/)
  })

  it('⭐⭐ the real session calendar answers the SAME from the compact document', async () => {
    const snapshot = (m) => ({
      holidays: m.HOLIDAY_ROWS,
      early: m.EARLY_CLOSE_ROWS,
      start: m.COVERAGE_START,
      version: m.CALENDAR_VERSION,
      names: m.HOLIDAY_ROWS.map((h) => m.holidayName(h.date)),
      closes: m.EARLY_CLOSE_ROWS.map((e) => m.closeTime(e.date)),
    })
    vi.resetModules()
    const want = snapshot(await import('./sessionCalendar.js'))
    expect(want.names.every(Boolean)).toBe(true)

    vi.resetModules()
    vi.doMock('./market_calendar.json', () => ({ default: compactCalendar(FULL).doc }))
    const got = snapshot(await import('./sessionCalendar.js'))
    vi.doUnmock('./market_calendar.json')
    expect(got).toEqual(want)
  })
})
