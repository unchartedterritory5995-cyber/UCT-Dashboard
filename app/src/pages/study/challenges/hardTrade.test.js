import { describe, expect, it } from 'vitest'
import { TRIM_R, reviewTrade, timesWord, tradeOf, trimLabels, trimR } from './hardMode'

// Round 23: the trade plan comes from the server with the reveal (api/services/study_trade.py: the setup's own entry and
// stop, the house trims t1 and t2, 3R and 5R since the account rulebook); the client plays it against the bars after the
// signal. The review reads the plan's ORIGINAL stop; the breakeven stop is Trade Story's (games/tradeStory.js). This
// fixture keeps its old levels (t1 at 2R, t2 at 3R): reviewTrade reads whatever prices the plan carries.
const K = { o: 10.2, h: 11.2, l: 10.5, c: 11.1 }
const KICK = { skill: 'setup.family3.kicker', direction: 'bullish', entry: 10.71, stop: 10.5, t1: 11.13, t2: 11.34, enters_intraday: true }

describe('the house trims on a plan', () => {
  it('reads trim_r from the plan, and 3R and 5R when an older plan has none', () => {
    expect(TRIM_R).toEqual([3, 5])
    expect(trimR({ trim_r: [3, 5] })).toEqual([3, 5])
    expect(trimR({ trim_r: [2, 4] })).toEqual([2, 4])
    expect(trimR({})).toEqual([3, 5])
    expect(trimR(null)).toEqual([3, 5])
    expect(trimR({ trim_r: [3] })).toEqual([3, 5])
    expect(trimR({ trim_r: ['3', '5'] })).toEqual([3, 5])
    expect(trimLabels({ trim_r: [3, 5] })).toEqual(['3R', '5R'])
    expect(trimLabels({ trim_r: [2.5, 4] })).toEqual(['2.5R', '4R'])
    expect(trimLabels(undefined)).toEqual(['3R', '5R'])
    expect([timesWord(2), timesWord(3), timesWord(5), timesWord(7)]).toEqual(['twice', 'three times', 'five times', '7 times'])
  })
})

describe('reviewTrade', () => {
  it('counts the Kicker day once it has entered, marks each trim and the stop', () => {
    const t = reviewTrade(KICK, K, [{ o: 11.1, h: 11.5, l: 10.9, c: 11.4 }, { o: 11.4, h: 11.3, l: 10.4, c: 10.5 }])
    expect(t.best).toBe(11.5)
    expect(t.bestSessions).toBe(1)
    expect(t.t1At).toBe(0)                 // t1 (11.13) was already reached on the Kicker day (high 11.20)
    expect(t.t2At).toBe(1)                 // t2 (11.34) the next session
    expect(t.stoppedSession).toBe(2)
    expect(t.advancePct).toBeCloseTo((11.5 / 10.71 - 1) * 100, 6)
    expect(t.r).toBeCloseTo((11.5 - 10.71) / 0.21, 6)
  })
  it('a close entry starts the next session, and a bar that reaches the stop ends the trade before its high counts', () => {
    const plan = { direction: 'bullish', entry: 11.1, stop: 10.5, t1: 12.3, t2: 12.9, enters_intraday: false }
    const t = reviewTrade(plan, K, [{ o: 11.1, h: 11.6, l: 10.9, c: 11.5 }, { o: 11.5, h: 13.5, l: 10.4, c: 13.4 }])
    expect(t.best).toBe(11.6)
    expect(t.t1At).toBeNull()
    expect(t.stoppedSession).toBe(2)
  })
  it('a short mirrors it', () => {
    const plan = { direction: 'bearish', entry: 8.8, stop: 9.4, t1: 7.6, t2: 7.0, enters_intraday: false }
    const t = reviewTrade(plan, { o: 9, h: 9.4, l: 8.6, c: 8.8 }, [{ o: 8.7, h: 8.9, l: 7.5, c: 7.6 }, { o: 7.6, h: 9.5, l: 7.4, c: 9.3 }])
    expect(t.long).toBe(false)
    expect(t.best).toBe(7.5)
    expect(t.t1At).toBe(1)
    expect(t.stoppedSession).toBe(2)
    expect(t.advancePct).toBeCloseTo((1 - 7.5 / 8.8) * 100, 6)
  })
})

describe('the trade the lesson reviews', () => {
  it('is the plan when the reveal carries one, the measured move otherwise, nothing when nothing fired', () => {
    expect(tradeOf('Kicker', K, [], null, true, KICK).kind).toBe('plan')
    const t = tradeOf('Slingshot', K, [], { pct: 12.5, sessions: 9, broke: null }, true)
    expect(t).toMatchObject({ kind: 'signal', close: 11.1, line: 10.5, advancePct: 12.5, sessions: 9, broke: null })
    expect(tradeOf('Bear gap', K, [], { pct: -8, sessions: 4, broke: 6 }, true)).toMatchObject({ short: true, line: 11.2, broke: 7 })
    expect(tradeOf('Kicker', K, [], null, false, KICK)).toBeNull()
  })
})
