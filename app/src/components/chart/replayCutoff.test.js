// D20 · Replay Mode's cutoff: the ONE visibility rule (replayCutoff.barVisible) against an INDEPENDENT oracle
// (__tests__/replayOracle.js: its own ET session table from market_calendar.json and its own DST rule), over generated
// bars × cutoffs × timeframes, across DST changes, a holiday and a half-day. Plus the pre-D20 compatibility rail and the
// weekly / monthly rule (AUDIT ruling 1: no W/M bar holds a session after the cutoff, day-only AND precise).
import { describe, it, expect } from 'vitest'
import { barVisible, cutoffDay, isPreciseCutoff, preciseCutoffAt, cutoffWords, lastCompleteDay } from './replayCutoff'
import * as O from './__tests__/replayOracle'

// two windows: the March DST change + Good Friday (2026-04-03), and the November DST change + Thanksgiving + its half-day
const DAYS = [...O.sessions('2026-03-02', '2026-04-10'), ...O.sessions('2026-10-26', '2026-12-04')]
const INTRA = ['1', '5', '15', '30', '60']

// the cutoffs tried: every session end-of-day, plus precise instants at session open / mid / the close / a half-day close
function cutoffs() {
  const out = []
  for (const d of DAYS) {
    out.push(d)
    for (const m of [570, 571, 600, 630, 721, 780, 959, 960]) if (m <= O.closeMin(d)) out.push(O.preciseOf(O.etToUnix(d, m)))
  }
  out.push('2026-04-03', '2026-04-04', '2026-11-26', '2026-11-29')                          // a holiday, weekend days
  return out
}
const CUTS = cutoffs()

describe('the cutoff forms', () => {
  it('day-only and precise values; the day part is the ET day; the precise string carries the ET offset in force', () => {
    expect(isPreciseCutoff('2026-01-15')).toBe(false)
    expect(isPreciseCutoff('2026-01-15T10:05-05:00')).toBe(true)
    expect(cutoffDay('2026-07-15T10:05-04:00')).toBe('2026-07-15')
    for (const [day, m] of [['2026-03-06', 600], ['2026-03-09', 600], ['2026-10-30', 600], ['2026-11-02', 600], ['2026-11-27', 780]]) {
      const sec = O.etToUnix(day, m)
      expect(preciseCutoffAt(sec * 1000), `${day} ${m}`).toBe(O.preciseOf(sec))
    }
    expect(cutoffWords('2026-01-15T10:05-05:00', Date.UTC(2026, 5, 1))).toBe('Thu, Jan 15, 10:05 ET')
    expect(cutoffWords('2026-01-15', Date.UTC(2026, 5, 1))).toBe('Thu, Jan 15')
    expect(lastCompleteDay('2026-11-27T13:00-05:00')).toBe('2026-11-27')                 // the half-day closed at 13:00
    expect(lastCompleteDay('2026-11-27T12:59-05:00')).toBe('2026-11-26')
  })
})

describe('barVisible == the independent oracle, every timeframe × every cutoff', () => {
  it.each(INTRA.flatMap(tf => [[tf, false], [tf, true]]))('intraday %s (extended %s)', (tf, extended) => {
    const byDay = new Map(DAYS.map(d => [d, O.intradayBars([d], tf, { extended })]))
    let n = 0
    for (const v of CUTS) {
      // the bars that can flip are the cutoff's own session and its neighbours; one far bar each side as a control
      const i = DAYS.findIndex(d => d >= v.slice(0, 10))
      const near = [DAYS[i - 1], DAYS[i], DAYS[i + 1]].filter(Boolean)
      const bars = [...near.flatMap(d => byDay.get(d)), byDay.get(DAYS[0])[0], byDay.get(DAYS[DAYS.length - 1]).at(-1)]
      for (const b of bars) {
      const want = O.visible(b, tf, v, { extended, allDays: DAYS })
      if (barVisible(b, tf, v, { extended }) !== want) throw new Error(`${tf} ext=${extended} cutoff ${v} bar ${O.preciseOf(b.t)}: want ${want}`)
      n++
      }
    }
    expect(n).toBeGreaterThan(5000)
  }, 180000)
  it.each(['D', 'W', 'M'])('%s', (tf) => {
    const bars = O.dwmBars(DAYS, tf)
    for (const v of CUTS) for (const b of bars) {
      const want = O.visible(b, tf, v, { allDays: DAYS })
      expect(barVisible(b, tf, v), `${tf} cutoff ${v} bar ${b.t}`).toBe(want)
    }
  })
})

describe('AUDIT ruling 1: no weekly / monthly bar holds a session after the cutoff (day-only AND precise)', () => {
  it.each(['W', 'M'])('%s', (tf) => {
    const bars = O.dwmBars(DAYS, tf)
    for (const v of CUTS) {
      const inst = v.length > 10 ? Date.parse(v) / 1000 : null
      for (const b of bars.filter(x => barVisible(x, tf, v))) {
        for (const s of O.sessionsOfBar(b, tf, DAYS)) {
          if (inst == null) expect(s <= v, `${tf} ${b.t} holds ${s} after ${v}`).toBe(true)
          else expect(O.etToUnix(s, O.closeMin(s)) <= inst, `${tf} ${b.t} holds ${s} after ${v}`).toBe(true)
        }
      }
    }
  })
  it('the period still forming is hidden; once its last session closes it shows (Good Friday week ends Thursday)', () => {
    const wk = { t: '2026-04-03' }                                      // the week of Good Friday: last session Thu Apr 2
    expect(barVisible(wk, 'W', '2026-04-01')).toBe(false)
    expect(barVisible(wk, 'W', '2026-04-02')).toBe(true)
    expect(barVisible(wk, 'W', '2026-04-02T15:59-04:00')).toBe(false)
    expect(barVisible(wk, 'W', '2026-04-02T16:00-04:00')).toBe(true)
    expect(barVisible({ t: '2026-11-01' }, 'M', '2026-11-27')).toBe(false)
  })
})

describe('compatibility: a DAY-ONLY cutoff keeps the pre-D20 rule exactly for intraday and daily bars', () => {
  // the pre-D20 inline filter (StockChart.jsx before D20), verbatim
  const legacy = (b, cut) => (typeof b.t === 'number'
    ? new Date(b.t * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) <= cut
    : String(b.t).slice(0, 10) <= cut)
  it.each([...INTRA, 'D', '45', '2D'])('%s', (tf) => {
    const bars = O.intradayBars(DAYS.slice(0, 12), INTRA.includes(tf) ? tf : '5').concat(O.dwmBars(DAYS, 'D'))
    for (const v of CUTS.filter(c => c.length === 10)) for (const b of bars) {
      if (typeof b.t !== 'number' && !['D', '2D'].includes(tf)) continue
      expect(barVisible(b, tf, v), `${tf} ${v} ${b.t}`).toBe(legacy(b, v))
    }
  }, 180000)
  it('no cutoff: every bar', () => {
    expect(barVisible({ t: 1 }, '5', null)).toBe(true)
    expect(barVisible({ t: '2026-01-01' }, 'W', '')).toBe(true)
  })
})
