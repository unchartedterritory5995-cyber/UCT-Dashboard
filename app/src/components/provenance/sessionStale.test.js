// app/src/components/provenance/sessionStale.test.js
//
// Pins: source-stale vs session-stale independence (this module never reads
// a FreshnessClass), boundary-crossing semantics, and honest defaults for
// missing/invalid input.

import { describe, it, expect } from 'vitest'
import { computeSessionStale } from './sessionStale'

const REGULAR_DAY = '2026-01-15' // regular Thursday trading day, EST

describe('computeSessionStale', () => {
  it('true when asOf is from before the most recent session boundary', () => {
    const asOf = new Date(`${REGULAR_DAY}T14:00:00Z`) // 9:00am ET, pre-market
    const now = new Date(`${REGULAR_DAY}T15:00:00Z`) // 10:00am ET, regular (open boundary crossed)
    expect(computeSessionStale(asOf, now)).toBe(true)
  })

  it('false when asOf is from within the current session, no boundary crossed', () => {
    const asOf = new Date(`${REGULAR_DAY}T15:00:00Z`) // 10:00am ET, regular
    const now = new Date(`${REGULAR_DAY}T15:40:00Z`) // 10:40am ET, still regular
    expect(computeSessionStale(asOf, now)).toBe(false)
  })

  it('accepts an ISO string', () => {
    expect(computeSessionStale(`${REGULAR_DAY}T14:00:00Z`, new Date(`${REGULAR_DAY}T15:00:00Z`))).toBe(true)
  })

  it('accepts epoch seconds (D1 source_observed_at convention)', () => {
    const asOfSeconds = new Date(`${REGULAR_DAY}T14:00:00Z`).getTime() / 1000
    expect(computeSessionStale(asOfSeconds, new Date(`${REGULAR_DAY}T15:00:00Z`))).toBe(true)
  })

  it('accepts epoch milliseconds', () => {
    const asOfMs = new Date(`${REGULAR_DAY}T14:00:00Z`).getTime()
    expect(computeSessionStale(asOfMs, new Date(`${REGULAR_DAY}T15:00:00Z`))).toBe(true)
  })

  it('missing asOf never fabricates a stale claim', () => {
    expect(computeSessionStale(null)).toBe(false)
    expect(computeSessionStale(undefined)).toBe(false)
  })

  it('unparseable asOf never fabricates a stale claim', () => {
    expect(computeSessionStale('not a date')).toBe(false)
  })

  it('never throws on a FreshnessClass-shaped input by accident (proves the two axes cannot collide)', () => {
    // A caller confusing D1's freshnessClass string ("stale") for an asOf
    // timestamp gets an honest false, not a crash and not a fabricated true.
    expect(computeSessionStale('stale')).toBe(false)
  })
})
