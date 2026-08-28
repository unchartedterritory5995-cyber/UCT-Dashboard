import { describe, it, expect } from 'vitest'

import { parseFormula, TICKER_SHAPE } from './parse.js'

/**
 * What a `sym` node's ticker may look like — ONE authority, four doors.
 *
 * ⚰️⚰️ IT LIVED IN THREE PLACES AND WAS MISSING FROM A FOURTH. `pine.js`,
 * `thinkscript.js` and `sentence.js` each carried their own copy of the pattern
 * — and one had already drifted in SPELLING (`[A-Z0-9.\-]` against the others'
 * `[A-Z0-9.-]`) — while `canonicalise`, the door a member types a formula into,
 * checked NOTHING.
 *
 * ⚠️ I TYPED THE THIRD COPY MYSELF one commit earlier, mirroring `pine.js` while
 * adding the thinkScript symbol fold. That is how a pattern reaches three owners:
 * each addition is locally reasonable.
 *
 * ⭐ SHAPE IS NOT THE ROSTER. `closedTable.json::_benchmarks` blesses that
 * asymmetry — the scan gate refuses an undeclared ticker while `interpret`
 * accepts it, "and that is NOT the two-authorities defect". This answers only
 * "could that string be a ticker at all".
 */
describe('a sym node names something that could be a ticker', () => {
  it('⛔⛔ the formula box no longer saves a symbol that is not one', () => {
    // Before: `sym('!!bad!!', close)` PARSED AND SAVED, then charted as all-NaN
    // and refused at the scan gate — a definition a member built, kept, and could
    // never use.
    const out = parseFormula("sym('!!bad!!', close)")
    expect(out.ok).toBe(false)
    expect(out.guard).toBe('canonicalise:symbol')
  })

  it('⛔ …and neither does a venue-prefixed one, YET', () => {
    // ⚠️ `NASDAQ:AAPL` is a real instrument we hold, and a member may reasonably
    // type it. Accepting it means resolving the prefix and checking coverage —
    // a design with its own open questions. Until then a refusal AT THE DOOR
    // beats a definition that saves and answers nothing. This case is the one to
    // change when that lands.
    expect(parseFormula("sym('NASDAQ:AAPL', close)").guard).toBe('canonicalise:symbol')
  })

  it('⭐ a real ticker still parses — this is a shape check, not a wall', () => {
    const out = parseFormula("sym('SPY', close)")
    expect(out.ok).toBe(true)
    expect(out.ast).toEqual({
      type: 'sym', value: 'SPY', args: [{ type: 'series', name: 'close' }],
    })
  })

  it('⭐ and so do the awkward real ones — dots and hyphens are in tickers', () => {
    // ⛔ THE CONTROL AGAINST OVER-TIGHTENING. `BRK.B` and `BRK-B` are the same
    // company under two conventions this codebase already juggles at the Massive
    // boundary; a pattern that refused them would be a wall, not a guard.
    for (const t of ['BRK.B', 'BRK-B', 'QQQ', 'X']) {
      expect(parseFormula(`sym('${t}', close)`).ok, t).toBe(true)
    }
  })

  it('⛔ the pattern is EXPORTED and every door reads it — not re-typed', () => {
    // The rail on the authority itself. If a door reintroduces its own copy this
    // stays green, so the file above says so in prose — but at minimum the
    // constant must exist and be the thing `canonicalise` actually applies.
    expect(TICKER_SHAPE).toBeInstanceOf(RegExp)
    expect(TICKER_SHAPE.test('SPY')).toBe(true)
    expect(TICKER_SHAPE.test('!!bad!!')).toBe(false)
    expect(TICKER_SHAPE.test('NASDAQ:AAPL')).toBe(false)
  })
})
