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

  it('FREE_PAGES is exactly the measured value (empty since 2026-10-02)', () => {
    // Owner ruling 2026-10-02 (TERM-081 / OI-12), "everything is paywall":
    // the Morning Wire left FREE_PAGES and nothing replaced it. The assertion
    // above is now trivially true BY DESIGN; this pins that it is empty because
    // the ruling emptied it, not because the module stopped exporting an array.
    expect(Array.isArray(FREE_PAGES)).toBe(true)
    expect(FREE_PAGES).toEqual([])
  })
})
