import { describe, expect, it } from 'vitest'
import { __makeRenderTokenOk, renderTokenOk } from './renderToken'

describe('renderTokenOk — the one render-token gate', () => {
  it('accepts the current token and refuses anything else', () => {
    const ok = __makeRenderTokenOk('new-token', '')
    expect(ok('new-token')).toBe(true)
    expect(ok('old-token')).toBe(false)
    expect(ok('')).toBe(false)
    expect(ok(null)).toBe(false)
    expect(ok(undefined)).toBe(false)
  })

  it('accepts the previous token DURING a rotation, and only then', () => {
    const during = __makeRenderTokenOk('new-token', 'old-token')
    expect(during('new-token')).toBe(true)
    expect(during('old-token')).toBe(true)
    expect(during('other')).toBe(false)

    // ⛔ The point of the rotation: once PREVIOUS is cleared the old token STOPS working.
    const after = __makeRenderTokenOk('new-token', '')
    expect(after('old-token')).toBe(false)
  })

  it('is off when no token is configured — a dev build must still open the page', () => {
    const off = __makeRenderTokenOk('', '')
    expect(off('anything')).toBe(true)
    expect(off('')).toBe(true)
  })

  it('never lets a blank previous value authorise a blank token', () => {
    // A string-equality check written as `given === PREVIOUS` with both '' would admit every
    // caller that sends ?token= with nothing after it.
    const ok = __makeRenderTokenOk('new-token', '')
    expect(ok('')).toBe(false)
  })

  it('does not match on a prefix or a substring', () => {
    const ok = __makeRenderTokenOk('new-token', 'old-token')
    expect(ok('new-token-extra')).toBe(false)
    expect(ok('new')).toBe(false)
    expect(ok('OLD-TOKEN')).toBe(false)
  })

  it('exports a live checker bound to this build (no token configured in test env)', () => {
    // The real export reads import.meta.env at module load; under vitest nothing is set, so the
    // gate is off. Asserting it is callable and total keeps the export itself railed.
    expect(typeof renderTokenOk).toBe('function')
    expect(renderTokenOk('whatever')).toBe(true)
  })
})
