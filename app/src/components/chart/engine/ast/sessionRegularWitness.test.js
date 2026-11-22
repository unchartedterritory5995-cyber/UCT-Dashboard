// ─── THE WITNESS: PINE'S OWN FORMULATION EQUALS THE NATIVE READERS ───────────
//
// `sessionHigh()`, `sessionLow()`, `sessionOpen()`, `openingRangeHigh(n)` are this engine's own
// names. What makes them trustworthy is that the SAME quantity, written the way a TradingView
// author writes it (a `var` reset on `session.isfirstbar_regular`, stepped while
// `session.ismarket`), run through the script lane, is the same number on every bar.
//
// The Pine formulation is fixed here, verbatim, because it is also what gets captured on
// TradingView for the reference grade (`WITNESS_SOURCE`): change one and the other is stale.
//
// ⚠️ WHAT THIS CAN AND CANNOT SEE. Both sides read `regularfirst` / `regularhours` from the one
// clock, so this proves the READERS (start, step, carry, freeze) against an independent
// implementation of the same rules in another lane. It cannot see a wrong CLOCK: that is
// `sessionRegular.test.js`'s independent Intl calendar, and the TradingView capture.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translatePine, BUILTIN_SESSION_ALIAS } from './pine.js'
import { TABLE } from './parse.js'
import { computeSessionRegular } from '../../indicators.js'
import { computeHeadless } from '../headlessCompute.js'
import { memberPaneDefinition, MEMBER_PANE_DEF_PREFIX } from '../../builder/memberPane/memberPaneDefinition'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..', '..', '..', '..', '..')
const replay = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'alerts', 'replay_bars.json'), 'utf8'))
const NVDA = replay.fixtures.nvda_5m_extended.bars
const HALF = replay.fixtures.halfday_30m.bars

/** The formulation captured on TradingView for the reference grade. Verbatim. */
export const WITNESS_SOURCE = `//@version=6
indicator("Regular session witness", overlay=true)
var float hi = na
var float lo = na
var float op = na
var float orHi = na
var int openTime = na
if session.isfirstbar_regular
    hi := high
    lo := low
    op := open
    orHi := high
    openTime := time
else if session.ismarket
    hi := math.max(hi, high)
    lo := math.min(lo, low)
    if time < openTime + 30 * 60 * 1000
        orHi := math.max(orHi, high)
plot(hi, "Session high")
plot(lo, "Session low")
plot(op, "Session open")
plot(orHi, "Opening range high 30")
`

const clean = (col) => Array.from(col, (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : null))

describe('the Pine door reads the two regular-session names', () => {
  it('maps them onto declared clock leaves, and nothing else under session.', () => {
    expect(BUILTIN_SESSION_ALIAS).toEqual({ 'session.isfirstbar_regular': 'regularfirst', 'session.ismarket': 'regularhours' })
    for (const leaf of Object.values(BUILTIN_SESSION_ALIAS)) expect(TABLE.clock).toHaveProperty(leaf)
  })

  it('a plain condition on each translates to that leaf', () => {
    for (const [name, leaf] of Object.entries(BUILTIN_SESSION_ALIAS)) {
      const out = translatePine(`//@version=6\nindicator("x")\nplot(${name} ? 1 : 0)\n`)
      expect(JSON.stringify(out), name).toContain(`"name":"${leaf}"`)
    }
  })

  it('⛔ the session names that need the chart\'s own session setting stay refused by name', () => {
    for (const name of ['session.isfirstbar', 'session.ispremarket', 'session.ispostmarket']) {
      const out = translatePine(`//@version=6\nindicator("x")\nplot(${name} ? 1 : 0)\n`)
      expect(out.ok, name).toBe(false)
      expect(out.outputs[0].refusal, name).toMatchObject({ guard: 'pine:builtin', token: name })
    }
  })
})

describe('the witness: the Pine formulation through the script lane equals the native readers', () => {
  const built = memberPaneDefinition({ source: WITNESS_SOURCE, id: MEMBER_PANE_DEF_PREFIX })

  it('the script is admitted and draws four plots', () => {
    expect(built.ok, built.reason).toBe(true)
  })

  it.each([['5-minute, extended hours, a cut first session', NVDA, '5'], ['30-minute, the half-day', HALF, '30']])(
    '%s', (_what, bars, tf) => {
      // ⚠️ `historyFromListing: true` IS THE WITNESS'S PREMISE, NOT A CLAIM ABOUT THE FIXTURE. A `var`
      // is carried from the first bar of history, so on bars cut out of a longer history the script
      // lane withholds what a `var` held before them (`var-origin:bars`), correctly. The question
      // here is the one TradingView answers with its whole history: GIVEN these bars as the history,
      // is the Pine formulation the native readers' number on every bar?
      const out = computeHeadless(built.definition, bars, { tf, historyFromListing: true })
      expect(out.refusal, JSON.stringify(out.refusal)).toBeUndefined()
      const byTitle = Object.fromEntries(out.outputs.map((o) => [o.title, clean(o.values)]))
      const native = {
        'Session high': clean(computeSessionRegular(bars, tf, 'high')),
        'Session low': clean(computeSessionRegular(bars, tf, 'low')),
        'Session open': clean(computeSessionRegular(bars, tf, 'open')),
        'Opening range high 30': clean(computeSessionRegular(bars, tf, 'high', 30)),
      }
      for (const [title, want] of Object.entries(native)) {
        expect(byTitle[title], title).toBeDefined()
        expect(want.some((v) => v !== null), `${title}: the native reader answers something`).toBe(true)
        expect(byTitle[title], title).toEqual(want)
      }
    })
})
