// RAILS: an AI answer named indirectly is still the answer (guide/words.js `answer`): "the response", "what the AI said /
// wrote / told me". A family, not one sentence (HG-03's class); and words that only look alike stay out. LOCAL.
import { describe, it, expect } from 'vitest'
import { conceptsOf } from './guide/words'

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
  ])('"%s" does not', (q) => {
    expect(conceptsOf(q).has('answer')).toBe(false)
  })
})
