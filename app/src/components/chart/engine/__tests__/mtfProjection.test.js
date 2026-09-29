// app/src/components/chart/engine/__tests__/mtfProjection.test.js
//
// ─── HIGHER-TIMEFRAME VALUES ON LOWER-TIMEFRAME BARS — NO LOOKAHEAD, EVER ─────
//
// The rule under test is UCT's existing one (the formula `tf` node, the Pine VM's
// `runRequest`): a chart bar shows the value of the last higher-timeframe period
// that CLOSED BEFORE the chart bar's own period began. Every case below is built
// so that the WRONG answers (the bar's own period, a future period, an index
// alignment) produce a different number than the right one.

import { describe, it, expect } from 'vitest'
import {
  projectFrameColumns, etDateOf, weekKeyOf, periodKeyOf, frameBarsUsable, frameKey,
} from '../mtfProjection'

// ── fixtures ─────────────────────────────────────────────────────────────────

/** Weekday ISO dates from `start` for `n` sessions, skipping `holidays`. */
function sessions(start, n, holidays = []) {
  const out = []
  const d = new Date(`${start}T12:00:00Z`)
  while (out.length < n) {
    const dow = d.getUTCDay()
    const iso = d.toISOString().slice(0, 10)
    if (dow !== 0 && dow !== 6 && !holidays.includes(iso)) out.push(iso)
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const dailyBars = (isos) => isos.map((iso, i) => ({ t: iso, o: i, h: i, l: i, c: i, v: 1 }))

/** Unix seconds for an America/New_York wall-clock time (`hh:mm`) on `iso`. */
function etUnix(iso, hhmm) {
  // Find the UTC instant whose ET wall clock reads iso hh:mm (DST-correct).
  const [h, m] = hhmm.split(':').map(Number)
  const [Y, M, D] = iso.split('-').map(Number)
  for (const off of [4, 5]) {
    const t = Date.UTC(Y, M - 1, D, h + off, m) / 1000
    if (etDateOf(t) === iso) {
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' })
      if (fmt.format(new Date(t * 1000)) === `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`) return t
    }
  }
  throw new Error(`no instant for ${iso} ${hhmm}`)
}
/** 5-minute RTH bars for one session. */
function rth5m(iso, lastHhmm = '15:55') {
  const out = []
  let t = etUnix(iso, '09:30')
  const end = etUnix(iso, lastHhmm)
  while (t <= end) { out.push({ t, c: 0 }); t += 300 }
  return out
}

// ── the date helpers ─────────────────────────────────────────────────────────

describe('period keys — sortable, calendar-true', () => {
  it('a Friday-labelled weekly bar and every day of its week share ONE key (its Monday)', () => {
    for (const d of ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']) {
      expect(weekKeyOf(d)).toBe('2026-09-21')
    }
    expect(weekKeyOf('2026-09-28')).toBe('2026-09-28')
  })
  it('an ISO week that straddles a year keeps one key', () => {
    expect(weekKeyOf('2025-12-31')).toBe('2025-12-29')
    expect(weekKeyOf('2026-01-02')).toBe('2025-12-29')
  })
  it('the keys SORT as strings (the formula engine\'s `YYYY-Www` does not)', () => {
    expect(weekKeyOf('2026-02-02') > weekKeyOf('2026-01-26')).toBe(true)
    expect(periodKeyOf('2026-10-01', 'M') > periodKeyOf('2026-09-30', 'M')).toBe(true)
  })
  it('ET date of a unix time honours DST, not the UTC day', () => {
    // 21:00 ET on a summer day is already the NEXT day in UTC.
    const t = etUnix('2026-07-14', '21:00')
    expect(new Date(t * 1000).toISOString().slice(0, 10)).toBe('2026-07-15')
    expect(etDateOf(t)).toBe('2026-07-14')
    expect(etDateOf('2026-07-14')).toBe('2026-07-14')
    expect(etDateOf(20260714)).toBe('2026-07-14')
  })
  it('frame bar formats are checked, never guessed', () => {
    expect(frameBarsUsable([{ t: '2026-09-25' }], 'W')).toBe(true)
    expect(frameBarsUsable([{ t: 1780000000 }], '60')).toBe(true)
    expect(frameBarsUsable([], 'D')).toBe(false)
    expect(frameKey('D', 'qqq')).toBe('D|QQQ')
  })
})

// ── WEEKLY ON DAILY — the classic stair-step ─────────────────────────────────

describe('⭐⭐ WEEKLY ON DAILY — each week shows the PREVIOUS completed week', () => {
  // Five weeks of weekly bars (Friday labels), a column whose value IS the week's
  // index so every wrong alignment is visible as a wrong integer.
  const fridays = ['2026-08-28', '2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25']
  const weekly = fridays.map((iso, i) => ({ t: iso, c: 100 + i }))
  const col = { ma: Float64Array.from(fridays.map((_, i) => i + 1)) }   // week1=1 … week5=5
  // Daily chart: Sep 8 (Tue, after Labor Day Monday) … Sep 25.
  const days = sessions('2026-09-08', 14, ['2026-09-07'])

  it('Monday..Friday of week W read week W-1 — the step lands on the FIRST session of the week', () => {
    const { columns, stale } = projectFrameColumns(weekly, col, 'W', dailyBars(days), 'D', { newestFinal: false })
    const byDay = Object.fromEntries(days.map((d, i) => [d, columns.ma[i]]))
    // Week of Sep 7 (short: Labor Day) reads week ending Sep 4 (=2).
    for (const d of ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']) expect(byDay[d], d).toBe(2)
    // Week of Sep 14 reads week ending Sep 11 (=3) — INCLUDING Friday Sep 18.
    for (const d of ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']) expect(byDay[d], d).toBe(3)
    // Week of Sep 21 reads Sep 18 (=4); the FORMING week (Sep 25, =5) never shows.
    for (const d of ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']) expect(byDay[d], d).toBe(4)
    expect(stale).toBe(false)
  })

  it('⛔⛔ NO FRIDAY LEAKS INTO MONDAY — the bar\'s own week is never its value', () => {
    const { columns } = projectFrameColumns(weekly, col, 'W', dailyBars(days), 'D', { newestFinal: true })
    for (let i = 0; i < days.length; i++) {
      const own = periodKeyOf(days[i], 'W')
      const ownIdx = fridays.findIndex((f) => periodKeyOf(f, 'W') === own)
      expect(columns.ma[i], `${days[i]} read its own week`).not.toBe(ownIdx + 1)
      expect(columns.ma[i], `${days[i]} read a future week`).toBeLessThan(ownIdx + 1)
    }
  })

  it('a holiday-short week is still ONE step, landing on its first real session', () => {
    const { columns } = projectFrameColumns(weekly, col, 'W', dailyBars(days), 'D', {})
    expect(columns.ma[0], 'Tue after Labor Day').toBe(2)
    const changes = []
    for (let i = 1; i < days.length; i++) if (columns.ma[i] !== columns.ma[i - 1]) changes.push(days[i])
    expect(changes, 'steps must fall exactly on each week\'s first session').toEqual(['2026-09-14', '2026-09-21'])
  })

  it('a chart bar before any closed week has NO value — never a borrowed one', () => {
    const { columns } = projectFrameColumns(weekly, col, 'W', dailyBars(sessions('2026-08-24', 3)), 'D', {})
    expect([...columns.ma].every(Number.isNaN)).toBe(true)
  })
})

// ── MONTHLY ON WEEKLY — the chart bar's period BEGINS on its Monday ─────────

describe('MONTHLY ON WEEKLY — a week that straddles a month reads the month closed before it BEGAN', () => {
  const monthly = [{ t: '2026-07-01' }, { t: '2026-08-01' }, { t: '2026-09-01' }]
  const col = { v: Float64Array.from([7, 8, 9]) }
  it('week Mon Aug 31 – Fri Sep 4 (labelled Sep 4) reads JULY, not August', () => {
    const weekly = [{ t: '2026-08-28' }, { t: '2026-09-04' }, { t: '2026-09-11' }]
    const { columns } = projectFrameColumns(monthly, col, 'M', weekly, 'W', { newestFinal: false })
    // Aug 28 week began Aug 24 → reads July (7). Sep 4 week BEGAN Aug 31 → still
    // August's week → reads July (7), even though its label is September.
    expect([...columns.v]).toEqual([7, 7, 8])
  })
})

// ── DAILY ON INTRADAY ────────────────────────────────────────────────────────

describe('⭐⭐ DAILY ON 5-MINUTE — every bar of day D reads day D-1', () => {
  const daily = [{ t: '2026-03-05' }, { t: '2026-03-06' }, { t: '2026-03-09' }, { t: '2026-03-10' }]
  const col = { ema: Float64Array.from([105, 106, 109, 110]) }

  it('⛔ at 10:30 on Monday, Monday\'s own final EMA is NOT known', () => {
    const bars = [...rth5m('2026-03-06'), ...rth5m('2026-03-09')]
    const { columns } = projectFrameColumns(daily, col, 'D', bars, '5', { newestFinal: false })
    const at = (iso, hhmm) => columns.ema[bars.findIndex((b) => b.t === etUnix(iso, hhmm))]
    expect(at('2026-03-06', '09:30')).toBe(105)
    expect(at('2026-03-06', '15:55')).toBe(105)
    expect(at('2026-03-09', '10:30'), 'Monday read Monday').toBe(106)
    expect(at('2026-03-09', '15:55')).toBe(106)
  })

  it('across the DST change (Mar 8 2026) the day boundary is still the ET date', () => {
    const bars = [...rth5m('2026-03-06'), ...rth5m('2026-03-09')]
    const { columns } = projectFrameColumns(daily, col, 'D', bars, '5', {})
    const firstMon = bars.findIndex((b) => etDateOf(b.t) === '2026-03-09')
    expect(columns.ema[firstMon - 1]).toBe(105)
    expect(columns.ema[firstMon]).toBe(106)
  })

  it('pre- and post-market bars belong to their ET date (conservative on post)', () => {
    const iso = '2026-03-09'
    const bars = [{ t: etUnix(iso, '04:00') }, { t: etUnix(iso, '09:30') }, { t: etUnix(iso, '16:05') }, { t: etUnix(iso, '19:55') }]
    const { columns } = projectFrameColumns(daily, col, 'D', bars, '5', {})
    expect([...columns.ema]).toEqual([106, 106, 106, 106])
  })

  it('an EARLY CLOSE changes nothing — the day is still one period', () => {
    const d = [{ t: '2026-11-25' }, { t: '2026-11-27' }, { t: '2026-11-30' }]
    const c = { x: Float64Array.from([1, 2, 3]) }
    const bars = [...rth5m('2026-11-27', '12:55'), ...rth5m('2026-11-30', '10:00')]
    const { columns } = projectFrameColumns(d, c, 'D', bars, '5', { newestFinal: false })
    const early = bars.filter((b) => etDateOf(b.t) === '2026-11-27').map((b) => columns.x[bars.indexOf(b)])
    expect(new Set(early)).toEqual(new Set([1]))
    expect(columns.x[bars.length - 1]).toBe(2)
  })
})

// ── INTRADAY ON INTRADAY ─────────────────────────────────────────────────────

describe('⭐ 1H ON 5M — a 60m bar (anchored 09:30) is usable only once it has CLOSED', () => {
  const iso = '2026-09-22'
  const starts = ['09:30', '10:30', '11:30', '12:30'].map((h) => etUnix(iso, h))
  const hourly = starts.map((t) => ({ t }))
  const col = { rsi: Float64Array.from([41, 42, 43, 44]) }
  const bars = rth5m(iso, '13:25')

  it('10:25 has nothing closed today; 10:30 reads the 09:30 bar; 11:25 still reads it', () => {
    const { columns } = projectFrameColumns(hourly, col, '60', bars, '5', { newestFinal: false })
    const at = (hhmm) => columns.rsi[bars.findIndex((b) => b.t === etUnix(iso, hhmm))]
    expect(at('10:25')).toBeNaN()
    expect(at('10:30')).toBe(41)
    expect(at('11:25'), 'read the forming 10:30 bar').toBe(41)
    expect(at('11:30')).toBe(42)
    expect(at('12:30')).toBe(43)
  })

  it('⛔ the NEWEST frame bar is withheld unless the server said it closed', () => {
    const { columns, stale } = projectFrameColumns(hourly, col, '60', bars, '5', { newestFinal: false })
    expect([...columns.rsi].includes(44), 'the forming bar was shown').toBe(false)
    expect(stale, 'nothing asked for a refresh').toBe(false)   // chart has no bar past 13:30
    const late = [...bars, { t: etUnix(iso, '13:35') }]
    const r2 = projectFrameColumns(hourly, col, '60', late, '5', { newestFinal: false })
    expect(r2.columns.rsi[late.length - 1], 'a forming snapshot was treated as closed').toBeNaN()
    expect(r2.stale).toBe(true)
    const r3 = projectFrameColumns(hourly, col, '60', late, '5', { newestFinal: true })
    expect(r3.columns.rsi[late.length - 1]).toBe(44)
  })
})

// ── STALENESS: the chart is the witness ─────────────────────────────────────

describe('⛔⛔ A FRAME BEHIND THE CHART IS NaN + stale, never a held value', () => {
  it('daily frame missing yesterday → today reads NaN, and says so', () => {
    const daily = [{ t: '2026-09-21' }, { t: '2026-09-22' }]   // no Sep 23
    const col = { v: Float64Array.from([1, 2]) }
    const bars = [...rth5m('2026-09-23', '09:40'), ...rth5m('2026-09-24', '09:40')]
    const { columns, stale } = projectFrameColumns(daily, col, 'D', bars, '5', { newestFinal: true })
    const sep23 = bars.filter((b) => etDateOf(b.t) === '2026-09-23').map((b) => columns.v[bars.indexOf(b)])
    const sep24 = bars.filter((b) => etDateOf(b.t) === '2026-09-24').map((b) => columns.v[bars.indexOf(b)])
    expect(new Set(sep23)).toEqual(new Set([2]))
    expect(sep24.every(Number.isNaN), 'Sep 24 held Sep 22 as if it were the latest close').toBe(true)
    expect(stale).toBe(true)
  })
  it('a weekly frame whose newest week is still forming is fine for THIS week', () => {
    const weekly = [{ t: '2026-09-18' }, { t: '2026-09-25' }]
    const col = { v: Float64Array.from([4, 5]) }
    const r = projectFrameColumns(weekly, col, 'W', dailyBars(sessions('2026-09-21', 3)), 'D', { newestFinal: false })
    expect([...r.columns.v]).toEqual([4, 4, 4])
    expect(r.stale).toBe(false)
  })
})
