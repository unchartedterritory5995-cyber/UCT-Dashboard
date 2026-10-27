// Notebook widgets phase 2, wave 11 (Task 11.14, ruling W11-R14): the client twin of the server's template day
// binding (api/services/journal_two/tool_binding.py, tests/test_tool_binding_vectors.py), run over the ONE vector file
// both sides read. The expected values are typed by hand in that file; nothing here derives one from the code under
// test. ⛔ The client has no bindDay export in phase 2 (the server binds at instantiation), so the binder below is a
// test-local helper over toolDays' own functions: readKeyOf is the path a routine or tracker block actually reads.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { forDayLabel, noteDayOf, readKeyOf, toolSearchText, weekMonday } from './toolDays'
import { horizon } from '../../../../lib/marketClock/sessionCalendar'

const FILE = path.resolve(__dirname, '../../../../../../tests/fixtures/toolBindingVectors.json')
const RAW = fs.readFileSync(FILE)
const VECTORS = JSON.parse(RAW.toString('utf8'))
const BINDS = ['note-day', 'next-trading-day', 'week']

/** The server's bind_day: refuses a bind outside BINDS and a note day that is not a real YYYY-MM-DD. */
function bindDay(noteDay, bind) {
  if (!BINDS.includes(bind)) throw new Error("A template binds to the note's day, the next trading day or the week.")
  if (weekMonday(noteDay) === '') throw new Error("The note's day is not a date.")
  return readKeyOf({ bind }, noteDay)
}

afterEach(() => { vi.useRealTimers() })

describe('the shared day-binding vectors', () => {
  it('reads version 1, LF, and the calendar horizon the vectors assume', () => {
    expect(VECTORS.version).toBe(1)
    expect(RAW.includes(13)).toBe(false)
    // W11-R15: the server's test_vector_file_horizon_matches_the_calendar, mirrored. The past-horizon rows
    // (2028-12-29, 2029-01) only test the weekday fallback while the client's calendar ends where the file says.
    expect(horizon()).toBe(VECTORS.assumes_horizon)
    // Non-vacuity: the parametrised checks below pass over an empty list.
    expect(VECTORS.bind.length).toBeGreaterThanOrEqual(20)
    expect(VECTORS.label.length).toBeGreaterThanOrEqual(10)
    expect(VECTORS.search.length).toBeGreaterThanOrEqual(8)
    expect(VECTORS.note_day.length).toBeGreaterThanOrEqual(6)
    expect(new Set(VECTORS.bind.map((c) => c.bind))).toEqual(new Set(BINDS))
  })

  it('bind_vectors_match_server', () => {
    for (const c of VECTORS.bind) {
      if (c.raises) {
        expect(() => bindDay(c.note_day, c.bind), c.why).toThrow()
        continue
      }
      expect(bindDay(c.note_day, c.bind), `${c.note_day} ${c.bind}: ${c.why}`).toBe(c.expected)
    }
    // The helper refuses what a template may never hold.
    expect(() => bindDay('2026-10-27', 'today')).toThrow()
  })

  it('label_vectors', () => {
    for (const c of VECTORS.label) expect(forDayLabel(c.day, c.bind), `${c.day} ${c.bind}`).toBe(c.expected)
  })

  it('search_vectors', () => {
    for (const c of VECTORS.search) {
      expect(toolSearchText(c.kind, c.name, c.day, c.bind), `${c.kind} ${c.name}`).toBe(c.expected)
    }
  })

  it('note_day_vectors', () => {
    vi.useFakeTimers()
    for (const c of VECTORS.note_day) {
      vi.setSystemTime(new Date(c.now))
      const got = noteDayOf({ dailyDate: c.daily_date, createdAt: c.created_at })
      expect(got, `${c.daily_date} ${c.created_at} @ ${c.now}: ${c.why}`).toBe(c.expected)
    }
  })
})

describe('the server rules the vectors do not reach (ruling W11-R15)', () => {
  it('a naive created-at is UTC, whatever the browser zone', () => {
    // 03:30 naive = 03:30 UTC = 23:30 ET the evening before; a local-time read on a US machine gives the 28th.
    expect(noteDayOf({ createdAt: '2026-10-28T03:30:00' })).toBe('2026-10-27')
    expect(noteDayOf({ createdAt: '2026-10-28 03:30:00' })).toBe('2026-10-27')
    expect(noteDayOf({ createdAt: '2026-10-28T03:30:00Z' })).toBe('2026-10-27')            // control: zoned
    expect(noteDayOf({ createdAt: '2026-10-28T03:30:00+00:00' })).toBe('2026-10-27')
    expect(noteDayOf({ createdAt: '2026-10-27T23:30:00-04:00' })).toBe('2026-10-27')
  })

  it('an impossible bare created day or a non-stamp falls back to today ET, as the server does', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-30T15:00:00Z'))
    expect(noteDayOf({ createdAt: '2026-02-30' })).toBe('2026-10-30')
    expect(noteDayOf({ createdAt: 'Oct 27 2026' })).toBe('2026-10-30')
    expect(noteDayOf({ createdAt: '2026-10-24' })).toBe('2026-10-24')                       // control
  })

  it('a week with no session binds the previous week\'s last session', async () => {
    vi.resetModules()
    // A calendar where Mon 2026-10-19 .. Fri 10-23 are all closed (a hypothetical week-long closure).
    vi.doMock('../../../../lib/marketClock/sessionCalendar', async (orig) => {
      const real = await orig()
      const closed = new Set(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'])
      return { ...real, isTradingDay: (d) => !closed.has(d) && real.isTradingDay(d) }
    })
    try {
      const td = await import('./toolDays')
      expect(td.weekLastSession('2026-10-21')).toBe('2026-10-16')
      expect(td.weekLastSession('2026-10-25')).toBe('2026-10-16')                           // its Sunday too
      expect(td.weekLastSession('2026-10-28')).toBe('2026-10-30')                           // control: next week
    } finally {
      vi.doUnmock('../../../../lib/marketClock/sessionCalendar')
      vi.resetModules()
    }
  })
})
