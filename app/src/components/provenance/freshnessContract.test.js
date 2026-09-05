// app/src/components/provenance/freshnessContract.test.js
//
// The D1 -> S8 boundary is the single most material finding of the S8
// readiness review (PRD-S8 §7.2a / SPEC-S8 §5.2a): D1's FreshnessClass has 5
// real values, not the 4 this program's architecture docs assumed, and one
// of them ("stale") shares a name with a DIFFERENT S8-side concept. These
// tests pin: every value D1 actually emits is exhaustively handled, an
// unrecognized value fails loudly rather than silently, and the two "stale"
// concepts never collapse into one.

import { describe, it, expect } from 'vitest'
import {
  mapD1Freshness, KNOWN_D1_FRESHNESS_VALUES, SOURCE_STALE, SESSION_STALE,
} from './freshnessContract'

// ⛔ MIRRORED FROM api/services/provider_errors.py::FreshnessClass, read
// directly 2026-09-02 -- not derivable from JS at test time (no cross-
// language import exists), so this list is a deliberate, documented manual
// mirror, not a second authority invented by accident. If the Python Literal
// changes, this list and KNOWN_D1_FRESHNESS_VALUES must change together.
const PYTHON_FRESHNESS_CLASS = ['real_time', 'delayed_15', 'end_of_day', 'historical', 'stale']

describe('mapD1Freshness is exhaustive over D1s real, live enum', () => {
  it('handles every value the Python FreshnessClass Literal actually declares', () => {
    for (const v of PYTHON_FRESHNESS_CLASS) {
      expect(() => mapD1Freshness(v), `mapD1Freshness threw on a real D1 value: ${v}`).not.toThrow()
    }
  })

  it('the exported known-values list matches the mirrored Python enum exactly', () => {
    expect([...KNOWN_D1_FRESHNESS_VALUES].sort()).toEqual([...PYTHON_FRESHNESS_CLASS].sort())
  })

  it('each of the 5 values maps to a distinct, correctly-shaped presentation', () => {
    const seen = new Set()
    for (const v of PYTHON_FRESHNESS_CLASS) {
      const p = mapD1Freshness(v)
      expect(p).toHaveProperty('tier')
      expect(p).toHaveProperty('isSourceStale')
      expect(p).toHaveProperty('label')
      expect(p).toHaveProperty('disclosureRequired')
      seen.add(JSON.stringify(p))
    }
    expect(seen.size, 'two different D1 freshness values produced the same presentation')
      .toBe(PYTHON_FRESHNESS_CLASS.length)
  })
})

describe('an unrecognized value fails LOUDLY, never silently', () => {
  it('throws on a value D1 has never emitted', () => {
    expect(() => mapD1Freshness('quantum_flux')).toThrow(/unrecognized D1 freshness value/)
  })

  it('throws on a value that LOOKS plausible but is not in the real enum (case/spelling)', () => {
    // Guards against exactly the casing-boundary mismatch the S8 review
    // flagged (kebab-case in the spec's own prop sketch vs D1's snake_case).
    expect(() => mapD1Freshness('real-time')).toThrow()
    expect(() => mapD1Freshness('REAL_TIME')).toThrow()
    expect(() => mapD1Freshness('Stale')).toThrow()
  })

  it('never returns a default/fallback presentation for an unknown value', () => {
    let threw = false
    try { mapD1Freshness('not_a_real_tier') } catch { threw = true }
    expect(threw, 'an unknown value must throw, not silently resolve to some tier').toBe(true)
  })
})

describe('D1s freshness=None (not established) is a distinct, honest state', () => {
  it('null resolves to the unknown tier, never a guessed default', () => {
    const p = mapD1Freshness(null)
    expect(p.tier).toBe('unknown')
    expect(p.isSourceStale).toBe(false)
  })

  it('undefined resolves the same way as null', () => {
    expect(mapD1Freshness(undefined)).toEqual(mapD1Freshness(null))
  })

  it('unknown is never equal to any real tier presentation', () => {
    const unknown = mapD1Freshness(null)
    for (const v of PYTHON_FRESHNESS_CLASS) {
      expect(mapD1Freshness(v)).not.toEqual(unknown)
    }
  })
})

describe('source staleness (D1) and session staleness (S8) are structurally distinct', () => {
  it('only "stale" is flagged isSourceStale -- no other tier is', () => {
    for (const v of PYTHON_FRESHNESS_CLASS) {
      const expected = v === 'stale'
      expect(mapD1Freshness(v).isSourceStale, `${v} isSourceStale mismatch`).toBe(expected)
    }
  })

  it('SOURCE_STALE and SESSION_STALE are two different, non-empty strings', () => {
    expect(typeof SOURCE_STALE).toBe('string')
    expect(typeof SESSION_STALE).toBe('string')
    expect(SOURCE_STALE).not.toBe(SESSION_STALE)
    expect(SOURCE_STALE.length).toBeGreaterThan(0)
    expect(SESSION_STALE.length).toBeGreaterThan(0)
  })

  it('neither constant is the bare word "stale"', () => {
    // The exact collision this module exists to prevent, asserted directly.
    expect(SOURCE_STALE).not.toBe('stale')
    expect(SESSION_STALE).not.toBe('stale')
  })
})

describe('delayed_15 is the one tier that requires the UTP/CTA disclosure', () => {
  it('delayed_15 sets disclosureRequired', () => {
    expect(mapD1Freshness('delayed_15').disclosureRequired).toBe(true)
  })

  it('no other real tier requires it', () => {
    for (const v of PYTHON_FRESHNESS_CLASS.filter((x) => x !== 'delayed_15')) {
      expect(mapD1Freshness(v).disclosureRequired, `${v} should not require disclosure`).toBe(false)
    }
  })

  it('the unknown state does not require it either', () => {
    expect(mapD1Freshness(null).disclosureRequired).toBe(false)
  })
})

describe('confirm the three named surface-level checks the owner asked for', () => {
  // These three mirror the "BEFORE FRESHNESSBADGE LIVE WIRING" checklist
  // items 5-7 at the contract-mapping level; FreshnessBadge.test.jsx repeats
  // them at the render level.
  it('delayed_15 never maps to the real_time tier', () => {
    expect(mapD1Freshness('delayed_15').tier).not.toBe('real_time')
  })

  it('end_of_day never maps to the real_time tier', () => {
    expect(mapD1Freshness('end_of_day').tier).not.toBe('real_time')
  })

  it('historical does not map to a source-stale/error state', () => {
    const p = mapD1Freshness('historical')
    expect(p.isSourceStale).toBe(false)
    expect(p.tier).toBe('historical')
  })
})
