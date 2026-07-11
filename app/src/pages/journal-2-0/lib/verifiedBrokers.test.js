import { describe, it, expect } from 'vitest'
import { VERIFIED_BROKERS } from './verifiedBrokers'

describe('VERIFIED_BROKERS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(VERIFIED_BROKERS)).toBe(true)
    expect(VERIFIED_BROKERS.length).toBeGreaterThan(0)
  })

  it('lists Robinhood with an ISO verified date and notes', () => {
    const rh = VERIFIED_BROKERS.find((b) => b.name === 'Robinhood')
    expect(rh).toBeTruthy()
    expect(rh.verifiedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(typeof rh.notes).toBe('string')
    expect(rh.notes.length).toBeGreaterThan(0)
  })

  it('every entry has a name, an ISO verifiedDate, and a notes string', () => {
    for (const b of VERIFIED_BROKERS) {
      expect(typeof b.name).toBe('string')
      expect(b.name.length).toBeGreaterThan(0)
      expect(b.verifiedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(typeof b.notes).toBe('string')
    }
  })
})
