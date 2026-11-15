// #1248 (layoutHistory.restore): restoring an earlier saved version OVERWRITES the board as it is now — on the state rail it
// is an overwrite licensed ONLY by restore-version words (never a modify / pick verb, never an additive request); it is
// always a card (risk confirm); listing the versions is a query. Evidence: LOCAL (unit) — the rail over synthetic plans.
import { describe, it, expect } from 'vitest'
import { stateEffects, stateRailRefusal } from './stateRail'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'

registerBuiltins()
const planOf = (restore) => ({ ok: true, plans: [{ kind: 'layoutHistory', ref: 'boardVersions', before: {}, after: {}, patch: restore ? { restore } : null }] })
const R = { version: 4, sha: 'h4', base: 5, baseSha: 'h5' }
const REFUSED = /^I didn’t change anything/

describe('layoutHistory on the state rail', () => {
  it('a restore is a layout overwrite naming the board as it is now; no patch, no effect', () => {
    const eff = stateEffects(planOf(R))
    expect(eff.map(e => `${e.state}:${e.type}`)).toEqual(['layout:overwrite'])
    expect(eff[0].name).toBe('your board as it is now (version 5), replaced by version 4')
    expect(stateEffects(planOf(null))).toEqual([])
  })
  it('is always a card, and listing is a query', () => {
    expect(getCapability('layoutHistory.restore').risk).toBe('confirm')
    expect(getCapability('layoutHistory.list').query).toBe(true)
  })
  it.each(['restore the previous version', 'restore version 4', 'go back to how it was yesterday', 'roll back my board to the last save',
    'revert to the earlier version', 'restore that one', 'add AAPL, and restore the previous version'])('its own words license it: "%s"', (w) => {
    expect(stateRailRefusal(planOf(R), { words: w })).toBe(null)
  })
  it.each(['add a 20 EMA', 'add AAPL to my watchlist', 'also MSFT', 'change my layout', 'apply the Swing layout', 'switch to version 4',
    'save my layout', 'do it', 'restore', "don't restore the previous version", 'add a chart, and change the layout'])(
    'nothing else licenses it: "%s"', (w) => {
      expect(stateRailRefusal(planOf(R), { words: w })).toMatch(REFUSED)
    })
})
