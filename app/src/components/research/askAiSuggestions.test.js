import { describe, it, expect } from 'vitest'
import { suggestionsFor } from './askAiSuggestions'
import { SECTIONS } from './railSections'

describe('suggestionsFor', () => {
  it('names the symbol in every starter, whatever the lifecycle', () => {
    // Derived, never retyped: a hardcoded list here would keep passing against a
    // template that had lost its interpolation and now reads "'s print".
    for (const lc of ['PRE', 'IMMINENT', 'PRINTED', 'POST', 'CALL_LIVE']) {
      const out = suggestionsFor({ sym: 'NVDA', lifecycle: lc })
      expect(out.length).toBeGreaterThan(0)
      for (const q of out) expect(q).toContain('NVDA')
    }
  })

  it('asks about the SETUP before the print and the RESULT after it', () => {
    const pre = suggestionsFor({ sym: 'NVDA', lifecycle: 'PRE' })
    const post = suggestionsFor({ sym: 'NVDA', lifecycle: 'PRINTED' })

    // The whole point of keying off lifecycle: "how did the print go" is noise on
    // a company that reports tonight, and vice versa.
    expect(pre).not.toEqual(post)
    expect(pre.join(' ')).toMatch(/into NVDA's print/)
    expect(post.join(' ')).toMatch(/How did NVDA's print go/)
    expect(pre.join(' ')).not.toMatch(/How did NVDA's print go/)
  })

  it('treats every actuals-present lifecycle as reported', () => {
    // POST, CALL_LIVE and PRINTED all mean the number is out (computeLifecycle's
    // strict precedence order). CALL_LIVE reading as PRE would offer "what does
    // the options market expect" while the call is underway.
    const printed = suggestionsFor({ sym: 'NVDA', lifecycle: 'PRINTED' })
    expect(suggestionsFor({ sym: 'NVDA', lifecycle: 'POST' })).toEqual(printed)
    expect(suggestionsFor({ sym: 'NVDA', lifecycle: 'CALL_LIVE' })).toEqual(printed)
  })

  it('falls back to the pre-print set on an unknown or missing lifecycle', () => {
    const pre = suggestionsFor({ sym: 'NVDA', lifecycle: 'PRE' })
    expect(suggestionsFor({ sym: 'NVDA' })).toEqual(pre)
    expect(suggestionsFor({ sym: 'NVDA', lifecycle: 'WAT' })).toEqual(pre)
  })

  it('returns nothing rather than a question with a hole in it', () => {
    // The panel mounts against the SETTLED symbol, which is empty for one
    // debounce tick while a reader arrow-steps. "What's the setup into 's
    // print?" must never reach the screen.
    for (const bad of [undefined, null, '', '   ']) {
      expect(suggestionsFor({ sym: bad, lifecycle: 'PRE' })).toEqual([])
    }
    expect(suggestionsFor()).toEqual([])
  })

  it('the rail carries an Ask AI section for these to belong to', () => {
    // This module is only reachable through that section; if the rail entry were
    // dropped, every test above would still pass against dead code.
    expect(SECTIONS.map((s) => s.id)).toContain('ai')
  })
})
