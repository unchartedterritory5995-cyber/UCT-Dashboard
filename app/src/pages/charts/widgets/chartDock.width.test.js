/* The Company Panel's default width must fit its own header chrome.
   Regression: at DEFAULT_RIGHT_W=360 the tab strip (`overflow-x: auto`) did not
   push back when the five labels + the search button overflowed -- it scrolled,
   and the "News" tab slid under the search control, clipped mid-word, in the
   DEFAULT position. Reported from production 8 Sep 2026. */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_RIGHT_W, MIN_RIGHT_W, TABSTRIP_FIT_W, COMPANY_TABS, normalizeDock,
} from './chartDock'

describe('company panel width', () => {
  it('opens wide enough for the whole tab strip', () => {
    expect(DEFAULT_RIGHT_W).toBeGreaterThanOrEqual(TABSTRIP_FIT_W)
  })

  it('still allows a deliberately narrow panel', () => {
    // The feed is designed down to 300px; dragging narrow is a user choice and
    // scrolling tabs is the accepted trade there. Only the DEFAULT must fit.
    expect(MIN_RIGHT_W).toBeLessThan(DEFAULT_RIGHT_W)
  })

  it('keeps News as the last tab the strip has to fit', () => {
    // If a tab is ever appended after News, TABSTRIP_FIT_W is stale.
    expect(COMPANY_TABS.at(-1).key).toBe('news')
    expect(COMPANY_TABS).toHaveLength(5)
  })

  it('migrates the stale 360 default off the clipped width', () => {
    expect(normalizeDock({ rightW: 360 }).rightW).toBe(DEFAULT_RIGHT_W)
  })

  it('does not touch a width the user actually chose', () => {
    expect(normalizeDock({ rightW: 520 }).rightW).toBe(520)
    expect(normalizeDock({ rightW: 300 }).rightW).toBe(300)
  })

  it('falls back to the default when nothing is stored', () => {
    expect(normalizeDock({}).rightW).toBe(DEFAULT_RIGHT_W)
    expect(normalizeDock(null).rightW).toBe(DEFAULT_RIGHT_W)
  })
})
