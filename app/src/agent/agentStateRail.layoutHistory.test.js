// #1248 (layoutHistory.restore): restoring an earlier saved version OVERWRITES the board as it is now — on the state rail it
// is an overwrite licensed ONLY by restore-version words (never a modify / pick verb, never an additive request); it is
// always a card (risk confirm); listing the versions is a query. Evidence: LOCAL (unit) — the rail over synthetic plans.
import { describe, it, expect } from 'vitest'
import { stateEffects, stateRailRefusal } from './stateRail'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'

registerBuiltins()
const planOf = (restore, before = {}) => ({ ok: true, plans: [{ kind: 'layoutHistory', ref: 'boardVersions', before, after: {}, patch: restore ? { restore } : null }] })
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
  it.each(['add a 20 EMA', 'add AAPL to my watchlist', 'also MSFT', 'change my layout', 'apply the Swing layout', 'switch layouts',
    'save my layout', 'do it', 'restore', "don't restore the previous version", 'add a chart, and change the layout'])(
    'nothing else licenses it: "%s"', (w) => {
      expect(stateRailRefusal(planOf(R), { words: w })).toMatch(REFUSED)
    })
})

// ── AUDIT T2 (#1248): a restore that NAMES a layout, and a version BY NUMBER — generated over the board's own names ──
const OPEN = 'Mine'
const SAVED = ['Mine', 'Swing', 'Earnings week', 'UCT Default']
const onBoard = (restore = R) => planOf(restore, { layout: OPEN, layoutNames: SAVED })
const NAMED = ['restore the previous version of my {n} layout', 'roll back the {n} layout to yesterday', 'restore my “{n}” layout to version 4',
  'go back to how the {n} layout was before']
const OFFER = /Version history keeps your whole board, not each saved layout, so “(.+?)” has no versions of its own \(your board has “Mine” open\)\. Say “show my board’s version history”/
describe('a restore that NAMES a layout: only the one this board holds', () => {
  for (const n of SAVED) for (const t of NAMED) {
    const w = t.replace('{n}', n)
    if (n === OPEN) it(`the OPEN layout: "${w}" licenses it`, () => { expect(stateRailRefusal(onBoard(), { words: w })).toBe(null) })
    else it(`another saved layout: "${w}" is refused, honestly, with the board's own history offered`, () => {
      const out = stateRailRefusal(onBoard(), { words: w })
      expect(out).toMatch(/^I didn’t restore anything/)
      expect(out).toMatch(OFFER)
      expect(OFFER.exec(out)[1]).toBe(n)
    })
  }
  it.each(['restore the previous version', 'restore my board to yesterday', 'restore my board layout to the last save', 'restore that one'])(
    'no layout named: unchanged ("%s" licenses it)', (w) => { expect(stateRailRefusal(onBoard(), { words: w })).toBe(null) })
  it('a layout name nobody saved is still another layout: refused with the offer', () => {
    expect(stateRailRefusal(onBoard(), { words: 'restore the previous version of my Momentum layout' })).toMatch(OFFER)
  })
})
describe('a version BY NUMBER: licensed only when it is the version planned (one in this board\'s history)', () => {
  for (const t of ['switch to version {v}', 'go to version {v}', 'go back to version {v}', 'version {v}', 'restore version {v}', 'take me back to version {v}']) {
    it(`"${t.replace('{v}', 4)}" with version 4 planned: licensed`, () => { expect(stateRailRefusal(onBoard(), { words: t.replace('{v}', 4) })).toBe(null) })
    it(`"${t.replace('{v}', 9)}" with version 4 planned (9 is not what the plan restores): refused`, () => { expect(stateRailRefusal(onBoard(), { words: t.replace('{v}', 9) })).toMatch(REFUSED) })
  }
  it.each(['restore', 'switch layouts', 'switch to the Swing layout', 'go to my layouts'])('still refused: "%s"', (w) => {
    expect(stateRailRefusal(onBoard(), { words: w })).toMatch(REFUSED)
  })
})
