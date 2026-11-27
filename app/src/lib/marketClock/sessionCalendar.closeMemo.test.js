// closeTime computes each date's close ONCE (2026-11-27, chart speed). inExtendedSession (data/barStore/extendedSession.js)
// asks it once per new UTC HOUR, so about 24 times per trading date, when a deep intraday copy is first ingested, and
// every answer cost two Intl formatToParts: about 250 ms of a 357-419 ms task once per page life, profiled on the
// owner's board.
//   C1 (red first) asking one date's close 24 times computes it once (formatToParts calls bounded)
//   C2 every date 2024-2027 (DST edges, half days, holidays, weekends): the remembered answer equals the first, computed
//      answer, and both equal an independent Intl oracle (the dataset's close: 16:00 ET, the early close on a half day,
//      null on a closed day); pinned instants on both sides of each DST change and on half days
//   C3 a caller changing the Date it got does not change the next answer
import { describe, it, expect, vi } from 'vitest'
import DATA from './market_calendar.json'

async function fresh() {
  vi.resetModules()
  return import('./sessionCalendar.js')
}

const ORACLE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const EARLY = new Map(DATA.early_closes.map((e) => [e.date, e.close]))

/** The close of `k` found by trying both ET offsets and reading the wall clock back: no shared code with the module. */
function oracleMs(k, isTradingDay) {
  if (!isTradingDay(k)) return null
  const [hh, mm] = (EARLY.get(k) || DATA.sessions.close).split(':').map(Number)
  const [y, m, d] = k.split('-').map(Number)
  for (const off of [4, 5]) {
    const ms = Date.UTC(y, m - 1, d, hh + off, mm)
    const p = Object.fromEntries(ORACLE_FMT.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
    if (`${p.year}-${p.month}-${p.day}` === k && Number(p.hour) % 24 === hh && Number(p.minute) === mm) return ms
  }
  throw new Error(`no ET instant for ${k}`)
}

function* days(from, to) {
  for (let t = Date.UTC(...from); t <= Date.UTC(...to); t += 86_400_000) yield new Date(t).toISOString().slice(0, 10)
}

describe('sessionCalendar.closeTime memo', () => {
  it('C1 (red first) one date asked 24 times is computed once', async () => {
    const cal = await fresh()
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
    try {
      for (let i = 0; i < 24; i++) cal.closeTime('2026-03-09')
      expect(spy.mock.calls.length, 'formatToParts calls for 24 asks of one date').toBeLessThanOrEqual(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('C2 every date 2024-2027: the remembered answer is the computed one, and both match the oracle', async () => {
    const cal = await fresh()
    let trading = 0
    let half = 0
    for (const k of days([2024, 0, 1], [2027, 11, 31])) {
      const first = cal.closeTime(k)
      const again = cal.closeTime(k)
      const want = oracleMs(k, cal.isTradingDay)
      expect(first === null ? null : first.getTime(), `${k} computed`).toBe(want)
      expect(again === null ? null : again.getTime(), `${k} remembered`).toBe(want)
      if (want !== null) trading++
      if (EARLY.has(k)) half++
    }
    expect(trading).toBeGreaterThan(1000)
    expect(half).toBeGreaterThanOrEqual(8)
    // pinned: both sides of each 2024 DST change, and half days in summer (EDT) and late November (EST)
    expect(cal.closeTime('2024-03-08').toISOString()).toBe('2024-03-08T21:00:00.000Z')
    expect(cal.closeTime('2024-03-11').toISOString()).toBe('2024-03-11T20:00:00.000Z')
    expect(cal.closeTime('2024-11-01').toISOString()).toBe('2024-11-01T20:00:00.000Z')
    expect(cal.closeTime('2024-11-04').toISOString()).toBe('2024-11-04T21:00:00.000Z')
    expect(cal.closeTime('2024-07-03').toISOString()).toBe('2024-07-03T17:00:00.000Z')
    expect(cal.closeTime('2024-11-29').toISOString()).toBe('2024-11-29T18:00:00.000Z')
    expect(cal.closeTime('2024-12-25')).toBeNull()
    expect(cal.closeTime('2024-03-09')).toBeNull()
  })

  it('C3 changing the Date a caller got leaves the next answer alone', async () => {
    const cal = await fresh()
    const a = cal.closeTime('2026-03-09')
    const ms = a.getTime()
    a.setTime(0)
    expect(cal.closeTime('2026-03-09').getTime(), 'the remembered close was changed through a returned Date').toBe(ms)
  })
})
