// app/src/components/chart/supportLoop/supportApi.test.js
//
// ⭐ U4 (2026-11-14) — the gap log's refusal CODES: only code-shaped strings leave the page
// (the server then keeps only codes on its closed list). A sentence, an identifier the member
// wrote, a number or an object never reaches the request body.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { refusalCodesOf, logRefusalCodes, logImportGaps, _resetForTests, MAX_REFUSAL_CODES } from './supportApi'

let bodies = []
beforeEach(() => {
  _resetForTests()
  bodies = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => { bodies.push({ url, body: JSON.parse(init.body) }); return { ok: true } }))
})
afterEach(() => vi.unstubAllGlobals())

describe('U4 — refusal codes in the gap log', () => {
  it('keeps only code-shaped strings, deduped and sorted', () => {
    expect(refusalCodesOf([
      'runtime:not-yet-graded', 'pine:builtin', 'pine:builtin',
      'the script reads secretLevel on line 3', 'secretLevel', 'pine: spaced', ':nope', 7, null, { guard: 'pine:x' },
    ])).toEqual(['pine:builtin', 'runtime:not-yet-graded'])
    expect(refusalCodesOf('pine:builtin')).toEqual([])
    // review L1: nothing longer than the server's REFUSAL_CODE_MAX (80) leaves the page
    // (code-shaped either way: a 24-letter namespace and an id under the shape's 64 limit)
    const ns = 'abcdefghijklmnopqrstuvwx'
    const long81 = `${ns}:${'a'.repeat(56)}`
    const ok80 = `${ns}:${'a'.repeat(55)}`
    expect([long81.length, ok80.length]).toEqual([81, 80])
    expect(refusalCodesOf([long81, ok80])).toEqual([ok80])
    expect(refusalCodesOf(Array.from({ length: 50 }, (_, i) => `pine:c${i}`))).toHaveLength(MAX_REFUSAL_CODES)
  })

  it('logRefusalCodes posts the codes only, once per distinct set per page', () => {
    expect(logRefusalCodes(['pine:state', 'a sentence that quotes the script'])).toBe(true)
    expect(logRefusalCodes(['pine:state'])).toBe(false)
    expect(logRefusalCodes(['nothing code-shaped here'])).toBe(false)
    expect(bodies).toHaveLength(1)
    expect(bodies[0].url).toBe('/api/indicator-support/gaps')
    expect(bodies[0].body).toEqual({ dialect: 'pine', gaps: [], unlisted: 0, guards: ['pine:state'] })
  })

  it('an import payload with no guards sends no guards key (A2 unchanged)', () => {
    logImportGaps({ gaps: [{ name: 'ta.sma', kind: 'call-unmapped' }], unlisted: 0 })
    expect(bodies[0].body).toEqual({ dialect: 'pine', gaps: [{ name: 'ta.sma', kind: 'call-unmapped' }], unlisted: 0 })
  })
})
