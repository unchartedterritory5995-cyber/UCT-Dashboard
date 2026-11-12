// CAPABILITY REGRESSION · "duplicate" / "copy" SPLIT BY ITS NOUN (#1076, drawing.duplicate). A drawing copy is named by
// drawing words (trendline, drawing, shape…); an indicator or definition copy keeps routing to indicators / definitions.
// drawing.duplicate's summary says "duplicate drawing", never a bare "copy": in routing v2's BM25 index a generic "copy"
// in the drawings document lowered that word's weight for definitions, and "create a custom copy of the rsi indicator"
// lost definitions (definition.duplicate unreachable under v2). Both routers, the real routed request (testing/route.js).
import { describe, it, expect } from 'vitest'
import { registerCatalog } from './testing/registry'
import { routedNames } from './testing/route'
import { groupOfAction } from '../../routing'
import { pinClock } from './testing/clock'

pinClock()
await registerCatalog()

const groupsOf = (text, v2) => new Set(routedNames(text, { v2 }).names.map(groupOfAction))

describe('duplicate / copy: the noun picks the group', () => {
  for (const v2 of [true, false]) {
    const r = v2 ? 'v2' : 'v1'
    for (const text of ['duplicate my RSI', 'copy that indicator']) {
      it(`${r}: "${text}" → indicators / definitions, never drawings`, () => {
        const g = groupsOf(text, v2)
        expect(g.has('indicators') || g.has('definitions'), `${r} "${text}": ${[...g]}`).toBe(true)
        expect(g.has('drawings'), `${r} "${text}": ${[...g]}`).toBe(false)
      })
    }
    for (const text of ['duplicate this trendline', 'duplicate the drawing', 'copy this trendline']) {
      it(`${r}: "${text}" → drawing.duplicate`, () => {
        expect(routedNames(text, { v2 }).names).toContain('drawing.duplicate')
      })
    }
  }
  it('v2: "create a custom copy of the rsi indicator" carries definition.duplicate (and not drawing.duplicate)', () => {
    const n = routedNames('create a custom copy of the rsi indicator', { v2: true }).names
    expect(n).toContain('definition.duplicate')
    expect(n).not.toContain('drawing.duplicate')
  })
})
