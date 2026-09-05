// app/src/components/provenance/availabilityContract.test.js
import { describe, it, expect } from 'vitest'
import {
  mapAvailability, AVAILABLE, NOT_FOUND, ENTITLEMENT_DENIED, PROVIDER_ERROR, UNKNOWN,
} from './availabilityContract'

describe('a successful ProviderResult maps to AVAILABLE', () => {
  it('a plain, non-degraded result', () => {
    expect(mapAvailability({ value: { c: 230 }, freshness: 'real_time' })).toBe(AVAILABLE)
  })
})

describe('typed D1 error kinds map to the correct, evidenced availability state', () => {
  it('not_found -> NOT_FOUND', () => {
    expect(mapAvailability({ error: true, kind: 'not_found' })).toBe(NOT_FOUND)
  })

  it('auth_error (401 or 403) -> ENTITLEMENT_DENIED regardless of entitlement_denied value', () => {
    expect(mapAvailability({ error: true, kind: 'auth_error', entitlement_denied: true })).toBe(ENTITLEMENT_DENIED)
    expect(mapAvailability({ error: true, kind: 'auth_error', entitlement_denied: false })).toBe(ENTITLEMENT_DENIED)
  })

  it('rate_limited and transient both map to the generic PROVIDER_ERROR bucket', () => {
    expect(mapAvailability({ error: true, kind: 'rate_limited' })).toBe(PROVIDER_ERROR)
    expect(mapAvailability({ error: true, kind: 'transient' })).toBe(PROVIDER_ERROR)
  })

  it('not_configured maps to PROVIDER_ERROR (a UCT-side setup gap, not a vendor data fact)', () => {
    expect(mapAvailability({ error: true, kind: 'not_configured' })).toBe(PROVIDER_ERROR)
  })

  it('unknown (the backend\'s own fallback for an untyped exception) maps to UNKNOWN, not PROVIDER_ERROR, and never throws', () => {
    // Caught by inspecting the real dev UI, not a unit test: a live
    // MASSIVE_API_KEY-unset run reaches this exact kind through
    // provenance_quote.py's generic `except Exception` branch.
    expect(mapAvailability({ error: true, kind: 'unknown' })).toBe(UNKNOWN)
  })
})

describe('degraded (cached-forbidden) results read the SAME as a fresh entitlement denial', () => {
  it('cached_forbidden -> ENTITLEMENT_DENIED, the same state a fresh 403 gets', () => {
    expect(mapAvailability({ value: null, degraded: 'cached_forbidden' })).toBe(ENTITLEMENT_DENIED)
  })

  it('circuit_open -> PROVIDER_ERROR', () => {
    expect(mapAvailability({ value: null, degraded: 'circuit_open' })).toBe(PROVIDER_ERROR)
  })
})

describe('absence of any real signal is UNKNOWN, never guessed as available', () => {
  it('null/undefined input', () => {
    expect(mapAvailability(null)).toBe(UNKNOWN)
    expect(mapAvailability(undefined)).toBe(UNKNOWN)
  })
})

describe('an unrecognized error kind fails loudly, never silently', () => {
  it('throws rather than defaulting', () => {
    expect(() => mapAvailability({ error: true, kind: 'some_new_kind' })).toThrow(/unrecognized error kind/)
  })
})

describe('every state is genuinely distinct', () => {
  it('AVAILABLE/NOT_FOUND/ENTITLEMENT_DENIED/PROVIDER_ERROR/UNKNOWN are five different strings', () => {
    const all = [AVAILABLE, NOT_FOUND, ENTITLEMENT_DENIED, PROVIDER_ERROR, UNKNOWN]
    expect(new Set(all).size).toBe(5)
  })
})
