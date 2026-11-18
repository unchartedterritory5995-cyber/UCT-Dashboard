// ─── THE REGULAR SESSION'S OWN VALUES ───────────────────────────────────────
//
// `regularhours` / `regularfirst` (the clock's two leaves) and the five readers built on them:
// `sessionOpen()`, `sessionHigh()`, `sessionLow()`, `openingRangeHigh(minutes)`,
// `openingRangeLow(minutes)`.
//
// Every expectation here is computed INDEPENDENTLY from the committed bars (a New York wall
// clock from `Intl`, the half-day named by its date), never read back from the code under test:
//   1. the two leaves on bars that hold extended hours, an early close and a cut window;
//   2. the readers against that independent calculation, bar by bar;
//   3. what a bar outside regular hours reads (the last regular session's value);
//   4. a window cut anywhere never changes a number it answers (it may only blank more);
//   5. the opening range refuses by name on bars it cannot be read from, and says so;
//   6. a real daily chart answers the bar's own values; a key that is not an instant is blank.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeClock, computeSessionRegular, openingRangeRefusal,
  OPENING_RANGE_BARS_LONGER, OPENING_RANGE_BARS_DO_NOT_DIVIDE,
} from '../../indicators.js'
import { interpret, BAR_FN, CHART_CLOCK_WITHHELD, CHART_CLOCK_WHOLE, OPENING_RANGE_CALLS, SESSION_CLOCK_LEAVES } from './interpret.js'
import { TABLE, BAR_READERS } from './parse.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..', '..', '..', '..', '..')
const replay = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'alerts', 'replay_bars.json'), 'utf8'))
const NVDA = replay.fixtures.nvda_5m_extended.bars        // 5-minute, extended hours, a first session cut at 07:15
const HALF = replay.fixtures.halfday_30m.bars             // 30-minute, extended hours, 2025-11-28 closes at 13:00
const HOURLY = replay.fixtures.hourly_open_60m.bars       // 60-minute, its first bar opens mid-session

// ── the independent clock: New York wall time straight from Intl ──────────────
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
const wall = (t) => {
  const p = Object.fromEntries(NY.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]))
  return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday }
}
const EARLY_CLOSES = { '2025-11-28': 13 * 60 }             // the one half-day these fixtures hold
const regular = (t) => {
  const w = wall(t)
  if (w.weekday === 'Sat' || w.weekday === 'Sun') return false
  return w.minute >= 570 && w.minute < (EARLY_CLOSES[w.day] || 16 * 60)
}
/** The independent reading of one reader over `bars`: null where it is unknown. */
function expected(bars, kind, minutes = null) {
  const field = { open: 'o', high: 'h', low: 'l' }[kind]
  const out = []
  let value = null
  let known = false
  let openT = 0
  let day = null
  bars.forEach((b, i) => {
    const w = wall(b.t)
    const inReg = regular(b.t)
    const firstOfDay = inReg && day !== w.day
    if (firstOfDay && w.minute !== 570 && i === 0) { known = false; day = w.day }   // a cut window
    else if (firstOfDay) { known = true; day = w.day; openT = b.t; value = b[field] }
    else if (known && inReg && (minutes === null || b.t < openT + minutes * 60)) {
      if (kind === 'high') value = Math.max(value, b[field])
      if (kind === 'low') value = Math.min(value, b[field])
    }
    out.push(known ? value : null)
  })
  return out
}
const clean = (col) => Array.from(col, (v) => (Number.isNaN(v) ? null : v))
const call = (name, ...args) => ({ type: 'call', name, args })
const num = (value) => ({ type: 'num', value })
const run = (tree, bars, tf, sink) => clean(interpret(tree, bars, null, undefined, undefined, { tf, ...(sink ? { chartClockSink: sink } : {}) }))

describe('the clock: regularhours and regularfirst', () => {
  it('are declared, and are session clock leaves (a time of day, not a date)', () => {
    expect(TABLE.clock.regularhours).toMatchObject({ lookback: 0, yields: 'bool' })
    expect(TABLE.clock.regularfirst).toMatchObject({ lookback: 1, yields: 'bool' })
    expect(SESSION_CLOCK_LEAVES).toEqual(expect.arrayContaining(['regularhours', 'regularfirst']))
  })

  it('regularhours is the calendar\'s regular session on every bar, the early close included', () => {
    for (const [bars, tf] of [[NVDA, '5'], [HALF, '30'], [HOURLY, '60']]) {
      const got = clean(computeClock(bars, tf).regularhours)
      expect(got).toEqual(bars.map((b) => (regular(b.t) ? 1 : 0)))
    }
    // the half-day by name: 12:30 is the last regular bar, 13:00 and the 16:00 prints are not
    const at = (hhmm) => HALF.findIndex((b) => wall(b.t).day === '2025-11-28' && wall(b.t).minute === hhmm)
    const col = computeClock(HALF, '30').regularhours
    expect([col[at(750)], col[at(780)], col[at(960)]]).toEqual([1, 0, 0])
  })

  it('regularfirst is 1 on the first regular bar of each day and nowhere else', () => {
    for (const [bars, tf] of [[NVDA, '5'], [HALF, '30']]) {
      const got = clean(computeClock(bars, tf).regularfirst)
      const seen = new Set()
      const want = bars.map((b) => {
        const w = wall(b.t)
        if (!regular(b.t) || seen.has(w.day)) return 0
        seen.add(w.day)
        return 1
      })
      expect(got).toEqual(want)
      expect(got.filter((v) => v === 1).length).toBe(seen.size)
    }
  })

  it('⛔ is BLANK on an oldest bar that opens mid-session, and 0 on the bars after it that day', () => {
    expect(wall(HOURLY[0].t).minute).toBeGreaterThan(570)                 // the fixture's own first bar
    expect(regular(HOURLY[0].t)).toBe(true)
    const col = clean(computeClock(HOURLY, '60').regularfirst)
    expect(col[0]).toBeNull()
    const sameDay = HOURLY.map((b, i) => i).filter((i) => i > 0 && wall(HOURLY[i].t).day === wall(HOURLY[0].t).day && regular(HOURLY[i].t))
    expect(sameDay.length).toBeGreaterThan(0)
    for (const i of sameDay) expect(col[i]).toBe(0)
    // the same series cut at a 09:30 bar is NOT blank: no earlier regular bar can exist
    const at930 = NVDA.findIndex((b) => wall(b.t).minute === 570)
    expect(clean(computeClock(NVDA.slice(at930), '5').regularfirst)[0]).toBe(1)
  })

  it('a daily chart: every bar is a regular session of its own', () => {
    const daily = [{ t: '2025-11-26', o: 1, h: 3, l: 0.5, c: 2, v: 10 }, { t: '2025-11-28', o: 2, h: 4, l: 1, c: 3, v: 10 }]
    const clock = computeClock(daily, 'D')
    expect(clean(clock.regularhours)).toEqual([1, 1])
    expect(clean(clock.regularfirst)).toEqual([1, 1])
  })
})

describe('the readers', () => {
  it('are bar readers of the closed table, bound in this lane, session-anchored and live', () => {
    for (const name of ['sessionOpen', 'sessionHigh', 'sessionLow', 'openingRangeHigh', 'openingRangeLow']) {
      expect(BAR_READERS).toContain(name)
      expect(typeof BAR_FN[name]).toBe('function')
      expect(TABLE.functions[name]).toMatchObject({ reads: 'bars', lookback: 'session', cadence: 'live', yields: 'num' })
    }
    expect(OPENING_RANGE_CALLS).toEqual(['openingRangeHigh', 'openingRangeLow'])
    expect(TABLE.functions.openingRangeHigh.args).toEqual(['int'])
  })

  it('equal an independent calculation on every bar (extended hours, a cut first session, a half-day)', () => {
    for (const [bars, tf, m] of [[NVDA, '5', 30], [HALF, '30', 60]]) {
      expect(clean(computeSessionRegular(bars, tf, 'open')), `${tf} open`).toEqual(expected(bars, 'open'))
      expect(clean(computeSessionRegular(bars, tf, 'high')), `${tf} high`).toEqual(expected(bars, 'high'))
      expect(clean(computeSessionRegular(bars, tf, 'low')), `${tf} low`).toEqual(expected(bars, 'low'))
      expect(clean(computeSessionRegular(bars, tf, 'high', m)), `${tf} range high`).toEqual(expected(bars, 'high', m))
      expect(clean(computeSessionRegular(bars, tf, 'low', m)), `${tf} range low`).toEqual(expected(bars, 'low', m))
    }
  })

  it('through the interpreter, by name, give the same columns', () => {
    expect(run(call('sessionHigh'), NVDA, '5')).toEqual(expected(NVDA, 'high'))
    expect(run(call('sessionOpen'), NVDA, '5')).toEqual(expected(NVDA, 'open'))
    expect(run(call('openingRangeLow', num(30)), NVDA, '5')).toEqual(expected(NVDA, 'low', 30))
    // and in ordinary maths: a close above the opening range's high
    const above = run({ type: 'op', name: '>', args: [{ type: 'series', name: 'close' }, call('openingRangeHigh', num(30))] }, NVDA, '5')
    const want = expected(NVDA, 'high', 30)
    expect(above.filter((v) => v === 1).length).toBe(NVDA.filter((b, i) => want[i] !== null && b.c > want[i]).length)
    expect(above.filter((v) => v === 1).length).toBeGreaterThan(0)
  })

  it('a bar outside regular hours reads the last regular session\'s value; nothing is known before the first open', () => {
    const hi = clean(computeSessionRegular(NVDA, '5', 'high'))
    expect(wall(NVDA[0].t).minute).toBeLessThan(570)                       // the series opens in pre-market
    expect(hi[0]).toBeNull()
    const days = [...new Set(NVDA.map((b) => wall(b.t).day))]
    const lastOf = (day) => NVDA.map((b, i) => i).filter((i) => wall(NVDA[i].t).day === day).pop()
    const firstOf = (day) => NVDA.findIndex((b) => wall(b.t).day === day)
    const ownHigh = (day) => Math.max(...NVDA.filter((b) => wall(b.t).day === day && regular(b.t)).map((b) => b.h))
    expect(hi[lastOf(days[0])]).toBe(ownHigh(days[0]))                     // after-hours: today's regular high
    expect(wall(NVDA[firstOf(days[1])].t).minute).toBeLessThan(570)
    expect(hi[firstOf(days[1])]).toBe(ownHigh(days[0]))                    // next pre-market: still yesterday's
    // the early close: the half-day's high is over its regular bars only (to 12:30), though bars print later
    const halfHi = clean(computeSessionRegular(HALF, '30', 'high'))
    const dayBars = HALF.map((b, i) => i).filter((i) => wall(HALF[i].t).day === '2025-11-28')
    const regHigh = Math.max(...dayBars.filter((i) => regular(HALF[i].t)).map((i) => HALF[i].h))
    expect(halfHi[dayBars[dayBars.length - 1]]).toBe(regHigh)
  })

  it('⛔ a window cut anywhere never changes a number: a cut series agrees wherever it answers', () => {
    const full = clean(computeSessionRegular(NVDA, '5', 'high', 30))
    for (const cut of [1, 37, 120, 153, 200, 421]) {
      const part = clean(computeSessionRegular(NVDA.slice(cut), '5', 'high', 30))
      let answered = 0
      part.forEach((v, i) => { if (v !== null) { answered += 1; expect(v, `cut ${cut} bar ${i}`).toBe(full[cut + i]) } })
      expect(answered, `cut ${cut}`).toBeGreaterThan(0)
    }
    // cut mid-session: unknown until the next regular open, never the partial session's high
    const mid = NVDA.findIndex((b) => wall(b.t).minute === 600)            // a 10:00 bar
    const part = clean(computeSessionRegular(NVDA.slice(mid), '5', 'high'))
    const nextOpen = NVDA.slice(mid).findIndex((b, i) => i > 0 && wall(b.t).minute === 570)
    expect(part.slice(0, nextOpen).every((v) => v === null)).toBe(true)
    expect(part[nextOpen]).toBe(NVDA[mid + nextOpen].h)
  })

  it('a price that is not a number makes the rest of that session unknown, and the next session clean', () => {
    const open = NVDA.findIndex((b) => wall(b.t).minute === 570)
    const bars = NVDA.map((b, i) => (i === open + 3 ? { ...b, h: NaN } : b))
    const hi = clean(computeSessionRegular(bars, '5', 'high'))
    expect(hi[open + 2]).not.toBeNull()
    const nextOpen = bars.findIndex((b, i) => i > open && wall(b.t).minute === 570)
    expect(hi.slice(open + 3, nextOpen).every((v) => v === null)).toBe(true)
    expect(hi[nextOpen]).toBe(bars[nextOpen].h)
  })
})

describe('an opening range on bars it cannot be read from', () => {
  it('the rule: bars longer than the range, or that do not divide it', () => {
    expect(openingRangeRefusal(300, 30)).toBeNull()
    expect(openingRangeRefusal(1800, 30)).toBeNull()
    expect(openingRangeRefusal(900, 45)).toBeNull()
    expect(openingRangeRefusal(3600, 30)).toBe(OPENING_RANGE_BARS_LONGER)
    expect(openingRangeRefusal(86400, 30)).toBe(OPENING_RANGE_BARS_LONGER)
    expect(openingRangeRefusal(1800, 45)).toBe(OPENING_RANGE_BARS_DO_NOT_DIVIDE)
    expect(openingRangeRefusal(NaN, 30)).toBe(OPENING_RANGE_BARS_LONGER)   // an unknown bar length is not a range
  })

  it('the reader itself answers nothing there, for a caller that states no channel to name it on', () => {
    expect(clean(computeSessionRegular(HOURLY, '60', 'high', 30)).every((v) => v === null)).toBe(true)
    expect(clean(computeSessionRegular(HALF, '30', 'low', 45)).every((v) => v === null)).toBe(true)
    expect(clean(computeSessionRegular(NVDA, undefined, 'high', 30)).every((v) => v === null)).toBe(true)   // no timeframe stated
    expect(clean(computeSessionRegular(NVDA, undefined, 'high')).some((v) => v !== null)).toBe(true)        // the session itself needs none
  })

  it('is withheld whole and NAMED in a member\'s words, never answered with a whole bar', () => {
    for (const [bars, tf, minutes, code] of [
      [HOURLY, '60', 30, OPENING_RANGE_BARS_LONGER], [HALF, '30', 45, OPENING_RANGE_BARS_DO_NOT_DIVIDE]]) {
      const sink = new Map()
      const col = run(call('openingRangeHigh', num(minutes)), bars, tf, sink)
      expect(col.every((v) => v === null), code).toBe(true)
      expect([...sink.keys()]).toEqual([code])
      expect(CHART_CLOCK_WHOLE).toContain(code)
      const said = sink.get(code)
      expect(said).toBe(CHART_CLOCK_WITHHELD[code](tf))
      expect(said).toMatch(/withheld on this chart/)
      expect(said).not.toMatch(/periodseconds|openingRange|NaN|interpret/)
    }
    // the same call on bars that divide the range says nothing and answers
    const sink = new Map()
    const col = run(call('openingRangeHigh', num(60)), HALF, '30', sink)
    expect(sink.size).toBe(0)
    expect(col).toEqual(expected(HALF, 'high', 60))
  })

  it('a daily chart: the range is withheld by name; the session\'s own values are the bar\'s', () => {
    const daily = [{ t: '2025-11-25', o: 10, h: 13, l: 9, c: 12, v: 100 }, { t: '2025-11-26', o: 12, h: 15, l: 11, c: 14, v: 100 },
      { t: '2025-11-28', o: 14, h: 16, l: 13, c: 15, v: 100 }]
    const sink = new Map()
    expect(run(call('openingRangeHigh', num(30)), daily, 'D', sink)).toEqual([null, null, null])
    expect([...sink.keys()]).toEqual([OPENING_RANGE_BARS_LONGER])
    expect(run(call('sessionHigh'), daily, 'D')).toEqual([13, 15, 16])
    expect(run(call('sessionLow'), daily, 'D')).toEqual([9, 11, 13])
    expect(run(call('sessionOpen'), daily, 'D')).toEqual([10, 12, 14])
  })

  it('⛔ a key that is not an instant is blank, whatever the timeframe says (the server sweep\'s integer day)', () => {
    const swept = [{ t: 20251125, o: 10, h: 13, l: 9, c: 12, v: 100 }, { t: 20251126, o: 12, h: 15, l: 11, c: 14, v: 100 }]
    for (const tf of ['D', '5', undefined]) {
      expect(clean(computeSessionRegular(swept, tf, 'high'))).toEqual([null, null])
      expect(clean(computeSessionRegular(swept, tf, 'high', 30))).toEqual([null, null])
    }
  })
})
