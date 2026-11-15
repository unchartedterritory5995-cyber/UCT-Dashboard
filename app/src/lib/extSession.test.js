import { describe, expect, it } from 'vitest'
import { extSessionStartSec } from './extSession'

// Same rules as the backend's _ext_session_start (tests/test_live_prices_ext_session_only.py).
// 2026-11-13 is a Friday; November is EST (UTC-5).
const at = (iso) => new Date(iso)
const sec = (iso) => Date.parse(iso) / 1000

describe('extSessionStartSec', () => {
  it('pre-market starts 04:00 ET today', () => {
    expect(extSessionStartSec('pre_market', at('2026-11-12T11:30:00Z'))).toBe(sec('2026-11-12T09:00:00Z'))
  })
  it('after-hours starts 16:00 ET today after the bell', () => {
    expect(extSessionStartSec('post_market', at('2026-11-12T22:05:00Z'))).toBe(sec('2026-11-12T21:00:00Z'))
  })
  it('overnight after-hours belongs to the previous weekday', () => {
    // Fri 02:00 ET → Thu 16:00 ET
    expect(extSessionStartSec('post_market', at('2026-11-13T07:00:00Z'))).toBe(sec('2026-11-12T21:00:00Z'))
  })
  it('over a weekend the after-hours session is Friday’s', () => {
    expect(extSessionStartSec('post_market', at('2026-11-15T17:00:00Z'))).toBe(sec('2026-11-13T21:00:00Z'))
  })
  it('regular session has no extended start', () => {
    expect(extSessionStartSec('regular', at('2026-11-12T16:00:00Z'))).toBeNull()
  })
})
