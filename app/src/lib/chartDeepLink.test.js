// The "open on charts" link contract — ONE spelling, both ends.
//
// The rail that matters: the builder and the reader are inverses. A
// hand-typed `?sym=` on the link side and a hand-typed `p.get('symbol')` on
// the workspace side agree the day they're written and silently stop later —
// the second-authority defect this repo pays for most often.
import { describe, it, expect } from 'vitest'
import {
  chartsLinkPath, chartsLinkUrl, readChartsLink, stripChartsLink, CHARTS_PATH,
} from './chartDeepLink'

describe('chart deep link', () => {
  it('builder and reader are inverses', () => {
    for (const args of [
      { symbol: 'AMD', tf: '15' },
      { symbol: 'brk.b', tf: 'D' },
      { symbol: 'NVDA' },
    ]) {
      const path = chartsLinkPath(args)
      const search = path.slice(path.indexOf('?'))
      expect(readChartsLink(search)).toEqual({
        symbol: args.symbol.toUpperCase(),
        tf: args.tf ?? null,
      })
    }
  })

  it('nothing to apply → null, so the workspace can skip the whole path', () => {
    expect(readChartsLink('')).toBeNull()
    expect(readChartsLink('?foo=1')).toBeNull()
    expect(chartsLinkPath({})).toBe(CHARTS_PATH)
    expect(chartsLinkPath()).toBe(CHARTS_PATH)
  })

  it('stripping removes ONLY the instruction, preserving other params', () => {
    expect(stripChartsLink('?sym=AMD&tf=15')).toBe('')
    expect(stripChartsLink('?gridspike=4&sym=AMD')).toBe('?gridspike=4')
    // Idempotent: applying an already-stripped search is a no-op.
    expect(stripChartsLink(stripChartsLink('?sym=AMD&tf=15'))).toBe('')
  })

  it('the absolute URL is the path on this origin', () => {
    expect(chartsLinkUrl({ symbol: 'AMD', tf: '15' }))
      .toBe(`${window.location.origin}/charts?sym=AMD&tf=15`)
  })
})
