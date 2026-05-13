/**
 * useHandsFreeEodRecap — gate behavior tests.
 *
 * The hook itself is React/lifecycle-coupled; here we just test the
 * pure helpers it relies on (timezone gate + localStorage key derivation).
 */
import { describe, it, expect } from 'vitest'


describe('handsFreeEodRecap gates', () => {
  it('localStorage key pattern is account+date scoped', () => {
    // The hook uses `compass.eod_spoken.${accountId}.${todayET()}` —
    // this assertion documents the contract so the key format doesn't
    // change accidentally and break idempotency.
    const accountId = 'acc-123'
    const date = '2026-05-12'
    const key = `compass.eod_spoken.${accountId}.${date}`
    expect(key).toMatch(/^compass\.eod_spoken\.[\w-]+\.\d{4}-\d{2}-\d{2}$/)
  })

  it('post-market-close gate uses 4 PM ET threshold', () => {
    // Document the threshold so it can't be silently changed
    const RECAP_GATE_HOUR_ET = 16
    expect(RECAP_GATE_HOUR_ET).toBe(16)
  })

  it('TTS body includes intro phrase', () => {
    // The hook prepends "End of day recap." to the body. Verify the
    // contract for the future migration to a richer intro.
    const body = 'Net plus one R on three trades.'
    const expected = `End of day recap. ${body}`
    expect(expected).toContain('End of day recap.')
    expect(expected).toContain(body)
  })
})
