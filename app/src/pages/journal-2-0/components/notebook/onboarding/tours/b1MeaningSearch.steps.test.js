// W14-Q2: in a real browser the meaning-search tour's count step never showed (it exists only
// while a search has results, and a tour opened from Help starts with an empty box). Step 1
// now asks the member to type, and waits for the count.
import { describe, it, expect } from 'vitest'
import { STEPS, COPY } from './b1MeaningSearch.steps'

describe('meaning-search asks for the search that makes its count appear', () => {
  it('step 1 waits for the count, which is step 2', () => {
    expect(STEPS[0].waitFor).toBe('search-count')
    expect(STEPS[1].anchor).toBe('search-count')
  })

  it('step 1 tells the member what to do (the engine adds "Do this to continue")', () => {
    expect(COPY[STEPS[0].id].body).toMatch(/Type a word/)
  })
})
