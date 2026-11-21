// ⭐⭐ ANOTHER SYMBOL'S INTRADAY SUPPLY IS ONE SESSION PARTITION (coordinator ruling 2026-11-21, after the #2134 audit).
//
// `ourSide.js`'s `otherIndex` (the bars another symbol's `request.security` reads, from committed captures, keyed
// `TICKER|tf`) merged every capture of a listing at an intraday timeframe by bar time, whatever its recorded session:
// SPY 60's extended captures (bars on the clock hour, 04:00-20:00) with its regular ones (the 09:30 grid). The
// lower-timeframe supply (`intradayIndex`) already kept them apart; now both use ONE partition helper
// (`sessionPartOf` / `sessionPartPick`): regular when held, else other, the other one named and never merged.
// Measured at e91 (run 44844427930, both lanes): no graded capture read such an intraday supply. This rail keeps the
// index honest for the first one that does. It reads the REAL committed captures, with a control that there is
// something to mix.
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { __otherCaptureIndexForTests } from './ourSide'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const sessions = new Map()
const sessionOf = (f) => {
  if (!sessions.has(f)) sessions.set(f, JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).symbol.session)
  return sessions.get(f)
}

describe("another symbol's intraday supply never merges two sessions", () => {
  let index
  beforeAll(() => { index = __otherCaptureIndexForTests() }, 600000)

  it('control: the committed captures hold SPY 60 in both sessions, so there is something to mix', () => {
    const spy60 = index.get('SPY|60')
    expect(spy60).toBeTruthy()
    const all = new Set([...spy60.files, ...spy60.setAside].map(sessionOf))
    expect(all).toEqual(new Set(['0930-1600', '0400-2000']))
  })

  it("every intraday entry's captures share ONE recorded session; what it set aside holds another", () => {
    const intraday = [...index.entries()].filter(([k]) => /\|[0-9]+$/.test(k))
    expect(intraday.length).toBeGreaterThan(0)
    for (const [key, e] of intraday) {
      const held = new Set(e.files.map(sessionOf))
      expect(held.size, key).toBe(1)
      for (const f of e.setAside) expect(held.has(sessionOf(f)), `${key} ${f}`).toBe(false)
    }
  })

  it('when both are held the REGULAR partition is supplied, as the lower-timeframe supply picks', () => {
    for (const key of ['SPY|60', 'SPY|5', 'SPY|15', 'RDDT|60', 'RDDT|5', 'RDDT|15', 'RDDT|240']) {
      const e = index.get(key)
      expect(e && e.session, key).toBe('regular')
      expect(new Set(e.files.map(sessionOf)), key).toEqual(new Set(['0930-1600']))
      expect(e.setAside.length, key).toBeGreaterThan(0)
      expect(new Set(e.setAside.map(sessionOf)), key).toEqual(new Set(['0400-2000']))
    }
  })

  it('a daily entry is still the union of every capture of the listing (sessions do not split a daily chart)', () => {
    const spyD = index.get('SPY|D')
    expect(spyD && spyD.files.length).toBeGreaterThan(1)
    expect(spyD.setAside).toBeUndefined()
  })
})
