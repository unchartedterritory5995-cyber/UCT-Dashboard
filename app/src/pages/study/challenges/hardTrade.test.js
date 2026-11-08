import { describe, expect, it } from 'vitest'
import { KICKER_MAX_STOP, kickerTrade, tradeOf } from './hardMode'

// Round 22: the Kicker trade on the owner's own rules (entry over the kicker's high on day 2; stop under the kicker's low
// or 3.5% under the entry, whichever is closer), and the measured move for every other setup.
const K = { o: 10, h: 11, l: 9.8, c: 10.9 }

describe('the Kicker trade', () => {
  it('enters over the kicker high on day 2 and keeps the stop within 3.5%', () => {
    const t = kickerTrade(K, [{ o: 11, h: 11.5, l: 10.9, c: 11.4 }, { o: 11.4, h: 12.4, l: 11.2, c: 12.2 }, { o: 12.2, h: 12.1, l: 10.5, c: 10.7 }])
    expect(t.triggered).toBe(true)
    expect(t.entry).toBe(11)
    expect(t.stop).toBeCloseTo(11 * (1 - KICKER_MAX_STOP), 6)   // the kicker's low (9.8) is further than 3.5%
    expect(t.best).toBe(12.4)
    expect(t.bestSessions).toBe(2)
    expect(t.stoppedSession).toBe(3)
    expect(t.advancePct).toBeCloseTo((12.4 / 11 - 1) * 100, 6)
  })
  it('uses the kicker low when it is the closer stop', () => {
    const t = kickerTrade({ o: 10, h: 11, l: 10.8, c: 10.95 }, [{ o: 11, h: 11.3, l: 10.9, c: 11.2 }])
    expect(t.stop).toBe(10.8)
  })
  it('has no entry when day 2 never clears the kicker high', () => {
    expect(kickerTrade(K, [{ o: 10.7, h: 10.95, l: 10.4, c: 10.6 }])).toEqual({ kind: 'kicker', triggered: false, entry: 11 })
  })
  it('a bar that reaches the stop ends the trade before its high counts', () => {
    const t = kickerTrade(K, [{ o: 11, h: 11.2, l: 10.9, c: 11.1 }, { o: 11.1, h: 13, l: 10.5, c: 12.9 }])
    expect(t.best).toBe(11.2)
    expect(t.stoppedSession).toBe(2)
  })
})

describe('the trade the lesson reviews', () => {
  it('is the Kicker trade for a Kicker, the measured move for anything else, nothing when nothing fired', () => {
    expect(tradeOf('Kicker', K, [{ o: 11, h: 11.5, l: 10.9, c: 11.4 }], null, true).kind).toBe('kicker')
    const t = tradeOf('Slingshot', K, [], { pct: 12.5, sessions: 9, broke: null }, true)
    expect(t).toMatchObject({ kind: 'signal', close: 10.9, line: 9.8, advancePct: 12.5, sessions: 9, broke: null })
    expect(tradeOf('Bear gap', K, [], { pct: -8, sessions: 4, broke: 6 }, true)).toMatchObject({ short: true, line: 11, broke: 7 })
    expect(tradeOf('Kicker', K, [], null, false)).toBeNull()
  })
})
