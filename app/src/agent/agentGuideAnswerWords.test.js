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

// AUDIT #1024 GO item 1: "response" with no "AI" in the request never opens the AI-answer walkthrough; with "AI" it does
describe('"response" without AI stays out of the AI-answer walkthrough (AUDIT #1024)', () => {
  registerBuiltins()
  const aiTargets = (q) => {
    const f = matchFeature(q, null, 'charts')
    return JSON.stringify((f ? guideSteps(f, q).steps : []).map(s => s.target))
  }
  it.each(['show me the response time', 'response from support', 'show me the response from support',
    'show me how to copy the response time', 'how do I save the response from support', 'show me how to copy the response from support'])('"%s" carries no answer and walks nowhere near AI Search', (q) => {
    expect(conceptsOf(q).has('answer')).toBe(false)
    expect(aiTargets(q)).not.toMatch(/aisearch/)
  })
  // positive control: the same word WITH "AI" opens the AI-answer walkthrough (an answer action: copy / save / reopen)
  it.each([
    ['show me how to copy the AI response', 'Copy answer text'],
    ['show me how to save the AI response', 'Save this answer (reopen it later)'],
    ['how do I reopen a saved AI response', 'Saved answers'],
  ])('POSITIVE CONTROL: "%s" carries the answer and walks to AI Search (%s)', (q, control) => {
    expect(conceptsOf(q).has('answer')).toBe(true)
    expect(aiTargets(q)).toMatch(/aisearch/)
    expect(aiTargets(q)).toContain(control)
  })
  // "show me the AI response" with no answer action opens NO walkthrough (on this branch and before it): there is no
  // "where is the answer" walkthrough to open. Not a widening; recorded, not built.
  it.todo('"show me the AI response" (no copy/save/reopen) opens no walkthrough today: no "show the answer" walkthrough exists')
})
