import { describe, it, expect } from 'vitest'
import { QUOTES, quoteOfTheDay } from './quotes'

describe('quoteOfTheDay', () => {
  it('has the full library', () => {
    expect(QUOTES.length).toBeGreaterThan(300)
    expect(QUOTES[0]).toHaveProperty('t')
    expect(QUOTES[0]).toHaveProperty('a')
  })

  it('is deterministic per calendar date and matches the legacy seed math', () => {
    const d = new Date(2026, 6, 2)   // 2026-07-02
    const seed = 2026 * 10000 + 7 * 100 + 2
    expect(quoteOfTheDay(d)).toBe(QUOTES[(seed * 97) % QUOTES.length])
    expect(quoteOfTheDay(d)).toBe(quoteOfTheDay(new Date(2026, 6, 2, 15, 30)))
  })

  it('changes across days', () => {
    expect(quoteOfTheDay(new Date(2026, 6, 2))).not.toBe(quoteOfTheDay(new Date(2026, 6, 3)))
  })
})
