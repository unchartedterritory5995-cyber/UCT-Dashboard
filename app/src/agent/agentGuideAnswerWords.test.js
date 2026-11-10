// RAILS: an AI answer named indirectly is still the answer (guide/words.js `answer`): "the response", "what the AI said /
// wrote / told me". A family, not one sentence (HG-03's class); and words that only look alike stay out. LOCAL.
import { describe, it, expect } from 'vitest'
import { conceptsOf } from './guide/words'
import { registerBuiltins } from './builtins'
import { matchFeature } from './guide/registry'
import { guideSteps } from './capabilities/guide'

describe('an answer named indirectly', () => {
  it.each([
    'show me how to copy what the AI search said',
    'how do I copy the AI search response',
    'show me how to save the response I got from AI search',
    'how do I copy what it wrote in AI search',
    'how do I save what the AI told me',
    'how do I copy what AI search came back with',
  ])('"%s" carries the answer', (q) => {
    expect(conceptsOf(q).has('answer')).toBe(true)
  })
  it.each([
    'how do I copy a layout',
    'what did the AI say about NVDA',
    'how do I save my notes',
    'how do I see what the chart said at the close',
    // "response" with no AI beside it (the owner: unrelated phrases never route into a tutorial)
    'how do I check the response time',
    'how do I see the API response',
    'how do I make a responsive layout',
    'the chart isn\'t responding',
    'how do I fix the chart not responding',
  ])('"%s" does not', (q) => {
    expect(conceptsOf(q).has('answer')).toBe(false)
  })
})

// and at the walkthrough: none of the look-alikes is walked to the AI Search widget
describe('look-alikes never reach the AI Search walkthroughs', () => {
  registerBuiltins()
  it.each(['how do I check the response time', 'how do I see the API response', 'how do I make a responsive layout', 'how do I fix the chart not responding'])('"%s"', (q) => {
    const f = matchFeature(q, null, 'charts')
    const steps = f ? guideSteps(f, q).steps : []
    expect(JSON.stringify(steps.map(s => s.target))).not.toMatch(/aisearch/)
  })
  it('and the AI words still do', () => {
    const q = 'how do I copy the AI search response'
    expect(JSON.stringify(guideSteps(matchFeature(q, null, 'charts'), q).steps.map(s => s.target))).toMatch(/aisearch/)
  })
})
