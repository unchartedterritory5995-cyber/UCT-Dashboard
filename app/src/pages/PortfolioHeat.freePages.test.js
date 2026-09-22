// A14 CP1 (GATE-A14-PORTFOLIO-HEAT-CP1, signed 2026-09-21, fingerprint
// 417b6b853) — §5: `test_page_is_not_in_free_pages`.
//
// A structural, falsifiable assertion against `freePages.js` itself, not a
// restated claim: G1 (owner, 2026-09-20, "we no longer have a free and paid
// tier, only paid") means /portfolio-heat is gated the ordinary way — by
// simply never being added here — same as every other paid page.
import { describe, it, expect } from 'vitest'
import { FREE_PAGES } from '../constants/freePages'

describe('portfolio heat is paid-gated the normal way', () => {
  it('is NOT in FREE_PAGES', () => {
    expect(FREE_PAGES).not.toContain('/portfolio-heat')
  })

  it('FREE_PAGES is still exactly the one page it was before this checkpoint', () => {
    // Non-vacuity: proves the assertion above isn't trivially true because
    // FREE_PAGES is empty or unreadable.
    expect(FREE_PAGES).toEqual(['/morning-wire'])
  })
})
