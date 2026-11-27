// app/src/components/chart/engine/__tests__/firstPageExact.rail.test.js
//
// ⛔⛔ (e101, 2026-11-27) THE HOST LANE'S FIRST PAGE IS ON ONLY WITH THE REACH RULE. It was switched off (#2885) when the
// census found 3 of 571 page plots WRONG against the full history (support-and-resistance-multi-time-frame, D); it is on
// again because every plot drawn on a page must pass `pageReachProvable` beside the two-start agreement (census: 496
// plots drawn, 0 wrong, SPY 1D and SPY 60). A page switched on without the rule is the defect this rail stands against.
import { describe, it, expect } from 'vitest'
import ASYNC_SRC from '../hostLaneAsync.js?raw'
import PAGE_SRC from '../firstPage.js?raw'

describe('the first page is on only with the reach rule', () => {
  it('on by default, and every page plot is drawn only when its reach is proved', () => {
    expect(ASYNC_SRC).toMatch(/^let _firstPageOn = true$/m)
    expect(PAGE_SRC).toMatch(/const same = sameTail\(col, probe\[key\], FIRST_PAGE_ROWS\) && pageReachProvable\(def, key\)/)
  })
})
