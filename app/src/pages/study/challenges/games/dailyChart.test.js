/**
 * Daily Chart rules (docs/study/GAMES.md, kind `daily`). The ET day and the countdown across the clock changes; the
 * deal of four setup names, the same for every member on a day; what a pick posts and how an answer is read; the day
 * kept on the device (written after each answer, read back strictly, resumed, cleared when old); the share line in plain
 * characters; the streak of days played; the words on the screens.
 */
import { describe, it, expect } from 'vitest'
import {
  ANSWER_FAILED, ANSWER_SIGNED_OUT, DAILY_KIND, DAILY_TOTAL, DAILY_URL, DAILY_VIEW, DAY_PREFIX, EMPTY_LINE, FAILED_LINE, HIT, KEEP_DAYS, MISS,
  RULE_MAX, STREAK_KEY, addDays, addRow, clockText, copyNote, dailyAnswer, dailyChoices, dateLabel, dayKey, dayLabel, dayOf, emptyRecord,
  etClock, etDay, headline, howSteps, logRows, marks, mergeDay, msToNextDay, nextEtMidnight, nextStreak, peakOf, planRun, poolItems,
  readAnswer, readSaved, readStreak, ruleLabel, ruleLine, ruleParts, runOf, shareLine, shownStreak, staleKeys, startLabel, startLead, streakText, tally, whatFired,
  whereText, withTotal,
} from './dailyChart'
import { SETUP_NAMES } from '../challengeBank'
import { RUN_AFTER_PEAK, RUN_MIN, RUN_NOTHING } from '../hardMode'

const at = (iso) => new Date(iso)
const H = 3600000
const row = (id, ok, extra = {}) => ({ id, name: 'Kicker', said: ok ? 'Kicker' : 'Gap Support', ok, fired: true, ticker: 'JBI', date: '2025-03-04', xp: ok ? 10 : 0, ...extra })

describe('the constants', () => {
  it('is the daily game: three charts, the shared spot-setup draw, keys under study.daily', () => {
    expect(DAILY_KIND).toBe('daily')
    expect(DAILY_TOTAL).toBe(3)
    expect(DAILY_VIEW).toBe(90)
    expect(DAILY_URL).toBe('/api/study/spot-setup')
    expect(DAY_PREFIX).toBe('study.daily.')
    expect(STREAK_KEY).toBe('study.daily.streak')
    expect(dayKey('2026-11-09')).toBe('study.daily.2026-11-09')
    expect([HIT, MISS]).toEqual(['X', '-'])
  })
})

describe('the ET day', () => {
  it('reads the New York calendar day, not the UTC one, in winter and in summer', () => {
    expect(etDay(at('2026-11-09T04:59:59Z'))).toBe('2026-11-08')   // 11:59:59 PM EST
    expect(etDay(at('2026-11-09T05:00:00Z'))).toBe('2026-11-09')   // midnight EST
    expect(etDay(at('2026-07-01T03:59:59Z'))).toBe('2026-06-30')   // 11:59:59 PM EDT
    expect(etDay(at('2026-07-01T04:00:00Z'))).toBe('2026-07-01')   // midnight EDT
    expect(etDay(at('2026-11-09T15:00:00Z'))).toBe('2026-11-09')
  })
  it('reads the wall clock, midnight as hour 0', () => {
    expect(etClock(at('2026-11-09T05:00:00Z'))).toEqual({ y: 2026, m: 11, d: 9, hh: 0, mm: 0, ss: 0 })
    expect(etClock(at('2026-07-01T16:30:15Z'))).toEqual({ y: 2026, m: 7, d: 1, hh: 12, mm: 30, ss: 15 })
    expect(etClock(Date.UTC(2026, 10, 9, 15))).toEqual({ y: 2026, m: 11, d: 9, hh: 10, mm: 0, ss: 0 })
  })
  it('says nothing for a time that is not one', () => {
    expect(etDay(new Date('nope'))).toBe('')
    expect(etDay(undefined)).toBe('')
    expect(etClock('2026-11-09')).toBe(null)
  })
  it('steps calendar days across months, leap years and years', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-11-09', -60)).toBe('2026-09-10')
    expect(addDays('bad', 1)).toBe('')
  })
})

describe('the countdown to the next charts', () => {
  it('runs to the next midnight in New York', () => {
    expect(new Date(nextEtMidnight(at('2026-11-09T15:00:00Z'))).toISOString()).toBe('2026-11-10T05:00:00.000Z')
    expect(msToNextDay(at('2026-11-09T15:00:00Z'))).toBe(14 * H)
    expect(new Date(nextEtMidnight(at('2026-07-01T12:00:00Z'))).toISOString()).toBe('2026-07-02T04:00:00.000Z')
    expect(msToNextDay(at('2026-07-01T12:00:00Z'))).toBe(16 * H)
  })
  it('one second before midnight is one second; at midnight it is the whole next day', () => {
    expect(msToNextDay(at('2026-11-10T04:59:59Z'))).toBe(1000)
    expect(msToNextDay(at('2026-11-10T05:00:00Z'))).toBe(24 * H)
  })
  it('is right across the clock changes: a 23-hour day in March, a 25-hour day in November', () => {
    // the day before the spring change: midnight is still EST
    expect(new Date(nextEtMidnight(at('2026-03-07T12:00:00Z'))).toISOString()).toBe('2026-03-08T05:00:00.000Z')
    // March 8, 2026: from midnight EST to midnight EDT is 23 hours
    expect(new Date(nextEtMidnight(at('2026-03-08T05:00:00Z'))).toISOString()).toBe('2026-03-09T04:00:00.000Z')
    expect(msToNextDay(at('2026-03-08T05:00:00Z'))).toBe(23 * H)
    expect(msToNextDay(at('2026-03-08T06:00:00Z'))).toBe(22 * H)            // 1 AM EST
    // the day before the fall change: midnight is still EDT
    expect(new Date(nextEtMidnight(at('2026-10-31T12:00:00Z'))).toISOString()).toBe('2026-11-01T04:00:00.000Z')
    // November 1, 2026: from midnight EDT to midnight EST is 25 hours
    expect(msToNextDay(at('2026-11-01T04:00:00Z'))).toBe(25 * H)
  })
  it('never counts below zero and reads as a clock, rounded up to the second', () => {
    expect(clockText(14 * H)).toBe('14:00:00')
    expect(clockText(3723000)).toBe('01:02:03')
    expect(clockText(999)).toBe('00:00:01')
    expect(clockText(0)).toBe('00:00:00')
    expect(clockText(-5000)).toBe('00:00:00')
    expect(clockText(25 * H)).toBe('25:00:00')
    expect(msToNextDay(new Date('nope'))).toBe(0)
    expect(Number.isNaN(nextEtMidnight(new Date('nope')))).toBe(true)
  })
})

describe('days and dates in words', () => {
  it('names the day and the chart date', () => {
    expect(dayLabel('2026-11-09')).toBe('Monday, Nov 9')
    expect(dayLabel('2026-03-08')).toBe('Sunday, Mar 8')
    expect(dayLabel('x')).toBe('')
    expect(dayOf('2025-03-04')).toBe('2025-03-04')
    expect(dayOf('20250304')).toBe('2025-03-04')
    expect(dayOf(20250304)).toBe('2025-03-04')
    expect(dayOf('2025-03-04T00:00:00')).toBe('2025-03-04')
    expect(dayOf('2025-13-04')).toBe('')
    expect(dayOf('2025-02-30')).toBe('')        // not on the calendar
    expect(dayOf('2024-02-29')).toBe('2024-02-29')
    expect(dayOf(1741100000)).toBe('')          // an intraday unix second is not a day
    expect(dayOf(1741101500)).toBe('')          // nor one whose digits happen to read as a month and a day
    expect(dayOf('202503041')).toBe('')
    expect(dateLabel('2025-03-04')).toBe('Mar 4, 2025')
    expect(dateLabel(null)).toBe('')
  })
})

describe('the charts', () => {
  const LOOK = { real: 1, lookalikes: [] }
  const set = {
    session_id: 's1',
    items: [
      { id: 'k1', type: 'spot', skill_id: 'setup.family3.kicker', prompt_json: { q: 'Does it fire?', choices: ['Yes', 'No'] }, look: LOOK, bars: { bars: [{ t: 1 }, { t: 2 }] } },
      { id: 'k1', type: 'spot', skill_id: 'setup.family3.kicker', look: LOOK, bars: { bars: [{ t: 1 }, { t: 2 }] } },        // the same chart twice
      { id: 'o1', type: 'spot', skill_id: 'setup.family4.oops', look: LOOK, bars: { bars: [{ t: 1 }] } },                     // one bar: no last candle to read
      { id: 'r1', type: 'recall', skill_id: 'vocab.candle', look: LOOK, bars: { bars: [{ t: 1 }, { t: 2 }] } },               // not a chart item
      { id: 'h1', type: 'spot', skill_id: 'setup.family3.hve', bars: { bars: [{ t: 1 }, { t: 2 }] } },                        // not verified by the server: never asked
      { id: 'g1', type: 'spot', skill_id: 'setup.family3.gap_support', look: LOOK, bars: { bars: [{ t: 1 }, { t: 2 }, { t: 3 }] } },
    ],
  }
  it("keeps the server's order, each chart once, named by its setup, in its session", () => {
    const p = poolItems(set, (b) => b.bars.map((x) => ({ ...x, n: true })))
    expect(p.map((x) => x.id)).toEqual(['k1', 'g1'])
    expect(p[0]).toMatchObject({ skill: 'setup.family3.kicker', name: 'Kicker', choices: ['Yes', 'No'], sessionId: 's1' })
    expect(p[0].bars[0]).toEqual({ t: 1, n: true })
    expect(p[1]).toMatchObject({ name: 'Gap Support', choices: ['Yes', 'No'] })
    expect(poolItems(null)).toEqual([])
  })
  it('deals four setup names: its own and three others, the same for the same day and chart', () => {
    const item = { id: 'k1', name: 'Kicker' }
    const a = dailyChoices(item, '2026-11-09')
    expect(a).toHaveLength(4)
    expect(new Set(a).size).toBe(4)
    expect(a).toContain('Kicker')
    expect(a.every((x) => SETUP_NAMES.includes(x))).toBe(true)
    expect(dailyChoices({ id: 'k1', name: 'Kicker' }, '2026-11-09')).toEqual(a)   // every member, every render
    expect(a).not.toContain('Nothing fired')                                       // something always fired here
    // the deal moves with the day: across a fortnight the same chart is not dealt one way
    const deals = new Set(Array.from({ length: 14 }, (_, i) => dailyChoices(item, addDays('2026-11-09', i)).join('|')))
    expect(deals.size).toBeGreaterThan(1)
  })
  it('posts the bank\'s Yes for the chart\'s own setup and another setup as itself', () => {
    const item = { id: 'k1', name: 'Kicker' }
    expect(dailyAnswer('Kicker', item, 'Yes', 'No')).toEqual({ choice: 'Yes', picked_setup: 'Kicker' })
    expect(dailyAnswer('Slingshot', item, 'Yes', 'No')).toEqual({ choice: 'Slingshot', picked_setup: 'Slingshot' })
  })
  it('reads an answer: right only when the server agrees on its own setup; the ticker, the last candle\'s date, the XP', () => {
    const item = { id: 'k1', name: 'Kicker', bars: [{ t: '2025-03-03' }, { t: '2025-03-04' }] }
    const ok = { correct: true, reveal: { sym: 'JBI', asof: '2025-03-05', answer: { answer: 'yes' } }, progress: { xp_gained: 10 } }
    expect(readAnswer(item, 'Kicker', ok)).toEqual({ id: 'k1', name: 'Kicker', said: 'Kicker', ok: true, fired: true, ticker: 'JBI', date: '2025-03-04', xp: 10 })
    const miss = { correct: false, reveal: { ticker: ' NVDA ', answer: { answer: 'yes' } }, progress: { xp_gained: 0 } }
    expect(readAnswer(item, 'Gap Support', miss)).toMatchObject({ ok: false, fired: true, said: 'Gap Support', ticker: 'NVDA', xp: 0 })
    // a server that agreed with another name is still not a right answer here (Hard mode's rule)
    expect(readAnswer(item, 'Slingshot', { correct: true, reveal: {} }).ok).toBe(false)
    // no date on the bars: the reveal's asof
    expect(readAnswer({ id: 'x', name: 'Kicker', bars: [] }, 'Kicker', ok).date).toBe('2025-03-05')
    // the key says nothing fired (never in this pool): said so, never dressed up as a setup
    expect(readAnswer(item, 'Kicker', { correct: false, reveal: { answer: { answer: 'no' } } }).fired).toBe(false)
  })
})

describe('the day on the device', () => {
  it('starts empty, adds each chart once, and is done when every chart is answered', () => {
    let rec = emptyRecord('2026-11-09', 3)
    expect(rec).toEqual({ v: 1, day: '2026-11-09', total: 3, charts: [], done: false })
    rec = addRow(rec, row('a', true))
    rec = addRow(rec, row('a', false))            // the same chart again is not a second answer
    expect(rec.charts).toHaveLength(1)
    expect(rec.charts[0].ok).toBe(true)
    rec = addRow(addRow(rec, row('b', false)), row('c', true))
    expect(rec.done).toBe(true)
    expect(addRow(rec, null)).toBe(rec)
    expect(addRow(rec, row('d', true))).toBe(rec)   // a finished day takes no more
    expect(emptyRecord('2026-11-09', 9).total).toBe(3)
  })
  it('merges the device and the screen: the first answer to a chart stands, and a finished day is final', () => {
    const device = addRow(emptyRecord('2026-11-09', 3), row('a', true))          // another tab answered chart a
    const screen = addRow(addRow(emptyRecord('2026-11-09', 3), row('a', false)), row('b', false))
    const m = mergeDay(device, screen)
    expect(m.charts.map((x) => [x.id, x.ok])).toEqual([['a', true], ['b', false]])
    expect(m).toMatchObject({ day: '2026-11-09', total: 3, done: false })
    // the next answer adds to the merged day; an answer to chart a again changes nothing
    expect(addRow(m, row('a', false)).charts).toHaveLength(2)
    expect(addRow(m, row('c', true))).toMatchObject({ done: true })
    // a day finished anywhere is final
    const finished = addRow(addRow(addRow(emptyRecord('2026-11-09', 3), row('a', true)), row('b', true)), row('c', true))
    expect(mergeDay(finished, screen)).toBe(finished)
    expect(mergeDay(screen, finished)).toBe(finished)
    // nothing on the device (or storage refused): the screen's own day; a record of another day is never merged in
    expect(mergeDay(null, screen)).toBe(screen)
    expect(mergeDay(device, null)).toBe(device)
    expect(mergeDay(null, null)).toBe(null)
    expect(mergeDay(addRow(emptyRecord('2026-11-08', 3), row('z', true)), screen).day).toBe('2026-11-08')
    // never more charts than the day holds
    const a = addRow(emptyRecord('2026-11-09', 2), row('x', true))
    const b = addRow(addRow(emptyRecord('2026-11-09', 2), row('z', true)), row('w', true))
    const both = mergeDay(a, { ...b, done: false })
    expect(both.charts.map((x) => x.id)).toEqual(['x', 'z'])
    expect(both.done).toBe(true)
  })
  it('reads back only a record of this day, rows checked, done recounted', () => {
    const saved = JSON.stringify({ v: 1, day: '2026-11-09', total: 3, done: true, charts: [row('a', true), { id: 'b' }, row('a', false), row('c', false)] })
    const r = readSaved(saved, '2026-11-09')
    expect(r.charts.map((x) => [x.id, x.ok])).toEqual([['a', true], ['c', false]])
    expect(r.done).toBe(false)                     // two of three, whatever the stored flag said
    expect(readSaved(saved, '2026-11-10')).toBe(null)
    expect(readSaved('{not json', '2026-11-09')).toBe(null)
    expect(readSaved(null, '2026-11-09')).toBe(null)
    expect(readSaved(JSON.stringify({ day: '2026-11-09', total: 0, charts: [] }), '2026-11-09')).toBe(null)
    const full = readSaved(JSON.stringify({ day: '2026-11-09', total: 2, charts: [row('a', true), row('b', false), row('c', true)] }), '2026-11-09')
    expect(full.charts).toHaveLength(2)
    expect(full.done).toBe(true)
  })
  it('plans a fresh day from the pool, up to three, in order', () => {
    const pool = [{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'c' }, { id: 'd' }]
    expect(planRun(pool, null)).toEqual({ total: 3, todo: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], answered: 0 })
    expect(planRun([{ id: 'a' }, { id: 'b' }], null)).toMatchObject({ total: 2, answered: 0 })     // a thin bank
    expect(planRun([], null)).toEqual({ total: 0, todo: [], answered: 0 })
  })
  it('resumes a day at the next chart, and shrinks only when its remaining charts are no longer drawn', () => {
    const rec = addRow(emptyRecord('2026-11-09', 3), row('a', true))
    expect(planRun([{ id: 'a' }, { id: 'b' }, { id: 'c' }], rec)).toEqual({ total: 3, todo: [{ id: 'b' }, { id: 'c' }], answered: 1 })
    expect(planRun([{ id: 'a' }, { id: 'b' }], rec)).toEqual({ total: 2, todo: [{ id: 'b' }], answered: 1 })
    expect(planRun([{ id: 'a' }], rec)).toEqual({ total: 1, todo: [], answered: 1 })
    expect(withTotal(rec, 1)).toMatchObject({ total: 1, done: true })
    expect(withTotal(rec, 3)).toMatchObject({ total: 3, done: false })
    expect(withTotal(rec, 0)).toMatchObject({ total: 1, done: true })   // never fewer than the charts already answered
  })
  it('clears day results older than the keep window, and nothing else', () => {
    const keys = ['study.daily.2026-11-09', 'study.daily.2026-09-10', 'study.daily.2026-09-09', 'study.daily.2025-01-01', STREAK_KEY, 'study.blitz.best', 'study.daily.junk']
    expect(KEEP_DAYS).toBe(60)
    expect(staleKeys(keys, '2026-11-09')).toEqual(['study.daily.2026-09-09', 'study.daily.2025-01-01'])
    expect(staleKeys(keys, 'bad')).toEqual([])
  })
})

describe('the score and the share line', () => {
  const rows = [row('a', true), row('b', false), row('c', true, { xp: 12 })]
  it('counts the day from its own rows', () => {
    expect(tally(rows)).toEqual({ right: 2, total: 3, xp: 22 })
    expect(tally([])).toEqual({ right: 0, total: 0, xp: 0 })
  })
  it('shares plain characters: the date, the score, a mark per chart in the order played', () => {
    expect(marks(rows, 3)).toBe('X - X')
    expect(shareLine('2026-11-09', rows, 3)).toBe('UCT Daily Chart 2026-11-09: 2/3 X - X')
    expect(shareLine('2026-11-09', [row('a', false), row('b', false), row('c', false)], 3)).toBe('UCT Daily Chart 2026-11-09: 0/3 - - -')
    expect(shareLine('2026-11-09', [row('a', true), row('b', true)], 2)).toBe('UCT Daily Chart 2026-11-09: 2/2 X X')
    // a chart not answered is never a hit
    expect(marks([row('a', true)], 3)).toBe('X - -')
    // plain ASCII: no emoji, no dashes beyond the hyphen-minus
    expect(shareLine('2026-11-09', rows, 3)).toMatch(/^[\x20-\x7E]+$/)
  })
  it("names what fired, the ticker and date, and the miss for the run log", () => {
    expect(whatFired(row('a', true))).toBe('Kicker')
    expect(whatFired({ fired: false, name: 'Kicker' })).toBe('Nothing fired')
    expect(whereText(row('a', true))).toBe('JBI · Mar 4, 2025')
    expect(whereText({ ticker: '', date: '2025-03-04' })).toBe('Mar 4, 2025')
    expect(logRows(rows)).toEqual([
      { name: 'Kicker', ticker: 'JBI · Mar 4, 2025', ok: true, said: null },
      { name: 'Kicker', ticker: 'JBI · Mar 4, 2025', ok: false, said: 'Gap Support' },
      { name: 'Kicker', ticker: 'JBI · Mar 4, 2025', ok: true, said: null },
    ])
  })
  it('says what the copy did', () => {
    expect(copyNote('copied')).toBe('Copied. Paste it anywhere.')
    expect(copyNote('failed')).toMatch(/Select the line above/)
    expect(copyNote('idle')).toMatch(/no tickers/)
  })
})

describe('the streak', () => {
  it('starts at one, adds a day played the day after, starts again after a gap, keeps the best', () => {
    let s = nextStreak(null, '2026-11-07')
    expect(s).toEqual({ last: '2026-11-07', count: 1, best: 1 })
    s = nextStreak(s, '2026-11-08')
    expect(s).toEqual({ last: '2026-11-08', count: 2, best: 2 })
    expect(nextStreak(s, '2026-11-08')).toBe(s)                      // the same day counts once
    s = nextStreak(s, '2026-11-09')
    expect(s).toEqual({ last: '2026-11-09', count: 3, best: 3 })
    s = nextStreak(s, '2026-11-12')
    expect(s).toEqual({ last: '2026-11-12', count: 1, best: 3 })
    expect(nextStreak(s, '2026-11-10')).toBe(s)                      // a clock set back changes nothing
    expect(nextStreak(s, 'bad')).toBe(s)
    // across a month and a year
    expect(nextStreak({ last: '2026-12-31', count: 4, best: 4 }, '2027-01-01')).toEqual({ last: '2027-01-01', count: 5, best: 5 })
  })
  it('shows a streak alive through today and yesterday, and zero after a missed day', () => {
    const s = { last: '2026-11-08', count: 4, best: 6 }
    expect(shownStreak(s, '2026-11-08')).toBe(4)
    expect(shownStreak(s, '2026-11-09')).toBe(4)
    expect(shownStreak(s, '2026-11-10')).toBe(0)
    expect(shownStreak(null, '2026-11-09')).toBe(0)
  })
  it('reads back strictly', () => {
    expect(readStreak(JSON.stringify({ last: '2026-11-08', count: 4, best: 2 }))).toEqual({ last: '2026-11-08', count: 4, best: 4 })
    expect(readStreak('{bad')).toBe(null)
    expect(readStreak(JSON.stringify({ last: 'yesterday', count: 4 }))).toBe(null)
    expect(readStreak(JSON.stringify({ last: '2026-11-08', count: 0 }))).toBe(null)
    expect(readStreak(null)).toBe(null)
  })
  it('says the streak plainly', () => {
    expect(streakText(0)).toBe('No streak yet')
    expect(streakText(1)).toBe('1 day in a row')
    expect(streakText(5)).toBe('5 days in a row')
  })
})

describe('the words', () => {
  it("leads the start screen with the day's game, a resumed day, or the honest empty and failed lines", () => {
    expect(startLead({ total: 3 })).toBe('The same three charts for every member today, tickers hidden. Name the setup that fired on each last candle. One go a day, then share your score.')
    expect(startLead({ total: 1 })).toMatch(/^The same chart for every member today.*on its last candle/)
    expect(startLead({ total: 3, answered: 1, right: 1 })).toBe('You named 1 of 1 so far today. Pick up at chart 2 of 3. The answers you gave stand.')
    // a resumed day whose remaining charts the bank no longer draws: that is the day
    expect(startLead({ total: 2, answered: 2, right: 1 })).toBe('You named 1 of 2 today. That is your day. See your result.')
    expect(startLead({ empty: true })).toBe(EMPTY_LINE)
    expect(EMPTY_LINE).toBe('No questions in this game yet. They arrive as the courses are approved.')
    expect(startLead({ failed: true })).toBe(FAILED_LINE)
  })
  it('counts the three steps for the day: three charts, or what a thin bank deals', () => {
    const three = howSteps(3)
    expect(three.map((x) => x.title)).toEqual(["Today's three charts", 'Name what fired', 'Watch it, then share'])
    expect(three[0].body).toBe('Real charts from the UCT bank, tickers hidden, the same for every member today. The last candle on each is ringed.')
    expect(three[1].body).toBe('One of our setups fired on each last candle. Pick it from four. One try each, scored like every Study answer.')
    expect(howSteps(2)[0].title).toBe("Today's two charts")
    const one = howSteps(1)
    expect(one[0]).toMatchObject({ title: "Today's chart", body: 'A real chart from the UCT bank, ticker hidden, the same for every member today. The last candle is ringed.' })
    expect(one[1].body).toBe('One of our setups fired on that last candle. Pick it from four. One try, scored like every Study answer.')
    expect(one[2].body).toMatch(/^The chart runs on with the trade drawn\./)
    expect(howSteps().map((x) => x.icon)).toEqual(['calendar', 'eye', 'play'])
  })
  it('labels the start button for every state', () => {
    expect(startLabel({ loading: true })).toBe("Loading today's charts")
    expect(startLabel({ failed: true })).toBe('The charts did not load')
    expect(startLabel({ empty: true })).toBe('No charts yet')
    expect(startLabel({ answered: 1 })).toBe('Pick up at chart 2')
    expect(startLabel({ answered: 1, left: 2 })).toBe('Pick up at chart 2')
    expect(startLabel({ answered: 1, left: 0 })).toBe("See today's result")
    expect(startLabel({})).toBe("Play today's charts")
  })
  it('heads the verdict: named, or what it was', () => {
    expect(headline(row('a', true))).toBe('Named it.')
    expect(headline({ ok: false, fired: true, name: 'Oops Reversal' })).toBe('It was an Oops Reversal.')
    expect(headline({ ok: false, fired: true, name: 'Kicker' })).toBe('It was a Kicker.')
    expect(headline({ ok: false, fired: false, name: 'Kicker' })).toBe('Nothing fired here.')
  })
  it("gives the setup's rule in the bank's words: this lesson's, else the setup's definition; UCT, never the firm", () => {
    const lesson = 'Kicker: the day before closes red; then the next day gaps up and closes near its high. Here the stock gapped 2.4% over the red day.'
    expect(ruleLine(lesson)).toBe('The day before closes red; then the next day gaps up and closes near its high.')
    const near = "Kicker: the firm's detector does not fire on the last bar of this chart. the gap was 0.3%."
    expect(ruleLine(near, { name: 'Kicker', text: "the firm's stock is set up; the day before closes red." })).toBe("UCT's stock is set up; the day before closes red.")
    expect(ruleLine('', null)).toBe('')
    // a sentence too long for a screen that cannot scroll shows its first clause, still the bank's words
    const long = 'Launchpad: the base is tight and the averages converge under the price; then it breaks out over the pivot on volume at least half again its fifty day average and closes in the top third of its range.'
    expect(RULE_MAX).toBe(170)
    expect(ruleLine(long)).toBe('The base is tight and the averages converge under the price.')
    // and the label says it is the rule's first step, never the whole rule (the lesson card has every step)
    expect(ruleParts(long)).toEqual({ text: 'The base is tight and the averages converge under the price.', cut: true })
    expect(ruleParts(lesson)).toEqual({ text: 'The day before closes red; then the next day gaps up and closes near its high.', cut: false })
    expect(ruleParts('', null)).toEqual({ text: '', cut: false })
    expect(ruleLabel('Launchpad', true)).toBe('The Launchpad rule, step one:')
    expect(ruleLabel('Kicker')).toBe('The Kicker rule:')
    // a first clause that is itself long is shown whole: the bank's words are never cut mid-sentence
    const one = `Launchpad: ${'the base is tight and the averages converge '.repeat(5).trim()}.`
    expect(ruleLine(one).length).toBeGreaterThan(RULE_MAX)
    expect(ruleLine(one).endsWith('converge.')).toBe(true)
    expect(ruleParts(one).cut).toBe(false)
  })
  it('never writes an em-dash or "the firm" in member copy', () => {
    const copy = [startLead({ total: 3 }), startLead({ total: 3, answered: 2, right: 1 }), startLead({ total: 2, answered: 2, right: 2 }), EMPTY_LINE, FAILED_LINE,
      ANSWER_FAILED, ANSWER_SIGNED_OUT, copyNote('idle'), copyNote('copied'), copyNote('failed'), startLabel({}), startLabel({ answered: 2 }), streakText(3),
      headline({ ok: false, fired: true, name: 'Kicker' }), ...[1, 2, 3].flatMap((n) => howSteps(n).flatMap((x) => [x.title, x.body]))]
    for (const t of copy) { expect(t).not.toMatch(/[—–]/); expect(t).not.toMatch(/\bfirm\b/i) }
  })
})

describe('the replay', () => {
  it("labels the move's best point once it is on the chart: from the plan's entry, or the culmination", () => {
    const plan = { kind: 'plan', long: true, bestSessions: 4, advancePct: 12.34 }
    expect(peakOf(plan, null, 90, 3)).toBe(null)
    expect(peakOf(plan, null, 90, 4)).toEqual({ index: 93, text: '+12.3% from entry in 4 sessions' })
    expect(peakOf({ ...plan, long: false, advancePct: 7.5, bestSessions: 1 }, null, 90, 1)).toEqual({ index: 90, text: 'fell 7.5% from entry in 1 session' })
    expect(peakOf(null, { offset: 2, sessions: 3, pct: 18.04 }, 90, 3)).toEqual({ index: 92, text: '+18.0% in 3 sessions' })
    expect(peakOf(null, { offset: 2, sessions: 3, pct: 18 }, 90, 2)).toBe(null)
    expect(peakOf(null, null, 90, 9)).toBe(null)
  })
  it("runs on to the culmination and past it, stretched to the plan's best bar or its stop", () => {
    expect(runOf(0, { fired: true })).toBe(0)
    expect(runOf(60, { fired: true, culm: { offset: 20 } })).toBe(20 + 1 + RUN_AFTER_PEAK)
    expect(runOf(60, { fired: true, culm: { offset: 0 } })).toBe(RUN_MIN)
    expect(runOf(60, { fired: true, culm: { offset: 0 }, trade: { kind: 'plan', bestSessions: 30 } })).toBe(30 + RUN_AFTER_PEAK)
    expect(runOf(60, { fired: true, culm: { offset: 0 }, trade: { kind: 'plan', bestSessions: null, stoppedSession: 15 } })).toBe(15 + RUN_AFTER_PEAK)
    expect(runOf(20, { fired: true, culm: { offset: 0 }, trade: { kind: 'plan', bestSessions: 30 } })).toBe(20)
    expect(runOf(60, { fired: false })).toBe(RUN_NOTHING)
  })
})
