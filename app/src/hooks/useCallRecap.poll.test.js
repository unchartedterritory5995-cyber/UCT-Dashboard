import { describe, it, expect } from 'vitest'
import { pollInterval, FAST_POLL_MS, SLOW_POLL_MS } from './useCallRecap'

describe('call-recap polling follows the SERVER’s reason, not the null', () => {
  it('polls fast while the recap is being written', () => {
    // A cold ticker's recap lands ~40s after the first request, so the panel
    // has to re-ask or the first reader stares at an empty box.
    expect(pollInterval({ recap: null, recap_status: 'generating' }))
      .toBe(FAST_POLL_MS)
  })

  it('stops hammering a ticker that will NEVER have a recap', () => {
    // The bug this replaces: the interval keyed on `!recap`, so a name with no
    // transcript was re-fetched twelve times a minute for as long as the tab
    // stayed open — for an answer that cannot change.
    expect(pollInterval({ recap: null, recap_status: 'unavailable' }))
      .toBe(SLOW_POLL_MS)
    expect(pollInterval({ recap: null, recap_status: 'capped' }))
      .toBe(SLOW_POLL_MS)
    expect(pollInterval({ recap: null, recap_status: 'no_recap_for_quarter' }))
      .toBe(SLOW_POLL_MS)
  })

  it('settles to the slow cadence once the recap is in', () => {
    expect(pollInterval({ recap: { headline: 'x' }, recap_status: 'ready' }))
      .toBe(SLOW_POLL_MS)
  })

  it('does not poll fast on a payload that predates the status field', () => {
    expect(pollInterval({ recap: null })).toBe(SLOW_POLL_MS)
    expect(pollInterval(undefined)).toBe(SLOW_POLL_MS)
  })
})
