import { describe, it, expect } from 'vitest'
import {
  buildResearchReturnParam,
  withResearchReturnParam,
  parseResearchReturnParam,
  researchReturnTarget,
  researchReturnLabel,
} from './researchReturnContext.js'

describe('researchReturnContext', () => {
  it('builds a trade marker', () => {
    expect(buildResearchReturnParam('trade', 42)).toBe('trade:42')
  })

  it('builds a position marker', () => {
    expect(buildResearchReturnParam('position', 'AAPL')).toBe('position:AAPL')
  })

  it('returns null for a missing ref', () => {
    expect(buildResearchReturnParam('trade', null)).toBeNull()
    expect(buildResearchReturnParam('trade', '')).toBeNull()
  })

  it('appends the param with ? when the path has no query string yet', () => {
    expect(withResearchReturnParam('/research/AAPL', 'trade', 42)).toBe('/research/AAPL?from=trade%3A42')
  })

  it('appends the param with & when the path already has a query string', () => {
    expect(withResearchReturnParam('/research/AAPL?section=ai', 'trade', 42))
      .toBe('/research/AAPL?section=ai&from=trade%3A42')
  })

  it('leaves the path unchanged when there is no ref to attach', () => {
    expect(withResearchReturnParam('/research/AAPL?section=ai', 'trade', null)).toBe('/research/AAPL?section=ai')
  })

  it('round-trips a trade marker through parse + target + label', () => {
    const parsed = parseResearchReturnParam('trade:42')
    expect(parsed).toEqual({ kind: 'trade', ref: '42' })
    expect(researchReturnTarget(parsed)).toBe('/journal-2-0/trade/42')
    expect(researchReturnLabel(parsed)).toBe('Back to Trade')
  })

  it('round-trips a position marker, uppercasing the symbol', () => {
    const parsed = parseResearchReturnParam('position:aapl')
    expect(parsed).toEqual({ kind: 'position', ref: 'AAPL' })
    expect(researchReturnTarget(parsed)).toBe('/journal-2-0/position/AAPL')
    expect(researchReturnLabel(parsed)).toBe('Back to AAPL Position')
  })

  it('rejects malformed or unknown markers rather than guessing', () => {
    expect(parseResearchReturnParam('')).toBeNull()
    expect(parseResearchReturnParam(null)).toBeNull()
    expect(parseResearchReturnParam('nocolon')).toBeNull()
    expect(parseResearchReturnParam('trade:')).toBeNull()
    expect(parseResearchReturnParam(':42')).toBeNull()
    expect(parseResearchReturnParam('watchlist:42')).toBeNull()
  })
})
