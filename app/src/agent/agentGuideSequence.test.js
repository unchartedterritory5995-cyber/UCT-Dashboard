// ⭐ RAIL: a two-part ask ("X, then Y") is one walkthrough: the first part's steps, then the second's (guide/sequence.js).
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature, matchFeature } from './guide/registry'
import { guideSteps } from './capabilities/guide'
import { stepsFor } from './guide/slots'
import { splitParts, carried, objectOf } from './guide/sequence'

beforeAll(() => { registerBuiltins() })
const fast = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
const walk = (q) => { const g = fast(q); return guideSteps(guideFeature(g.feature), g.detail) }

describe('two-part asks', () => {
  it('splits once, at "then", and keeps a single ask whole', () => {
    expect(splitParts('how do I add an RSI and then change its length')).toEqual(['how do I add an RSI', 'change its length'])
    expect(splitParts('how do I draw a trendline, then lock it')).toEqual(['how do I draw a trendline', 'lock it'])
    expect(splitParts('how do I change the timeframe')).toBeNull()
    expect(splitParts('how do I add it then')).toBeNull()
  })
  it('a part that names nothing takes the first part’s thing', () => {
    expect(objectOf('how do I add an RSI')).toMatch(/RSI/)
    expect(carried('change its length', 'how do I add an RSI')).toMatch(/change its length .*RSI/)
    expect(carried('flag it', 'how do I put NVDA on my watchlist')).toBe('flag it my watchlist')
    expect(carried('lock it', 'how do I draw a trendline')).toBe('lock it the trendline drawing')
  })
  it.each([
    ['how do I add an RSI and then change its length', 'indicators', 'indicatorEdit'],
    ['how do I draw a trendline and then lock it', 'drawing', 'drawingEdit'],
    ['how do I switch this chart to weekly and then add the RSI', 'timeframe', 'indicators'],
  ])('both parts, in order: %s', (q, first, second) => {
    expect(fast(q).feature).toBe(first)
    const { steps, title } = walk(q)
    const cut = steps.findIndex(s => s.part === 2)
    expect(cut).toBeGreaterThan(0)
    // the first part, whole, then the second part, whole
    expect(steps.slice(cut).map(s => s.target)).toEqual(stepsFor(guideFeature(second), carried(splitParts(q)[1], splitParts(q)[0])).map(s => s.target))
    expect(steps.slice(0, cut).some(s => s.endsOnClick)).toBe(false)
    expect(title).toMatch(/, then /)
  })
  it('a second part that reaches no walkthrough leaves the ask read whole, as before', () => {
    const q = 'how do I add an RSI and then go get coffee'
    expect(fast(q)?.feature).toBe(matchFeature(q, null, 'charts')?.id)
    const { steps } = walk(q)
    expect(steps.some(s => s.part === 2)).toBe(false)
  })
})
