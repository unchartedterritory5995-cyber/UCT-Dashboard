// app/src/components/chart/engine/__tests__/firstPageOff.rail.test.js
//
// ⛔⛔ (e101, 2026-11-27) THE HOST LANE'S FIRST PAGE IS OFF IN PRODUCTION until it draws only plots whose values are
// PROVED equal to the full history. Measured (`firstPageCensus.measure.test.js`): of 571 plots drawn on a first page,
// 3 were WRONG (support-and-resistance-multi-time-frame, D). The rails that test the page turn it on themselves
// (`setFirstPageEnabled(true)`); a page must never be on by default while this rail stands.
import { describe, it, expect } from 'vitest'
import SRC from '../hostLaneAsync.js?raw'

describe('the first page is off for every member', () => {
  it('the module starts with the first page switched off', () => {
    expect(SRC).toMatch(/^let _firstPageOn = false$/m)
    expect(SRC).not.toMatch(/^let _firstPageOn = true$/m)
  })
})
