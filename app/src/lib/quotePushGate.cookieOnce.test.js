/**
 * THE QUOTE-PUSH COOKIE IS READ ONCE PER PAGE LOAD (section 3.3 change 5, 2026-11-28).
 *
 * `whenQuotePush` runs on every change of a store's ticker set (every symbol switch). With the flag off it read
 * `document.cookie` each time, a synchronous getter that cost 0.5-2.4 ms of the switch's key task in production CPU
 * profiles (local build of master 886bbe212d, mapped to source: get cookie < quotePushFlagOn < whenQuotePush <
 * _pushTickers).
 *   C1 many flag reads, one cookie read (red before the change: one per call)
 *   C2 the cookie still turns the flag on (read at the first ask), and the latch forgets on the test seam
 *   C3 the localStorage key and the kill switch are still read on every call: they act at once
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { quotePushFlagOn, whenQuotePush, __resetQuotePushFlagForTest } from './quotePushGate'

let reads = 0
let jar = ''
beforeEach(() => {
  reads = 0
  jar = ''
  localStorage.clear()
  __resetQuotePushFlagForTest()
  vi.spyOn(Document.prototype, 'cookie', 'get').mockImplementation(() => { reads += 1; return jar })
})
afterEach(() => { vi.restoreAllMocks(); __resetQuotePushFlagForTest() })

describe('the quote-push cookie', () => {
  it('C1 many flag reads (every switch) read the cookie once', () => {
    for (let i = 0; i < 25; i++) { expect(quotePushFlagOn()).toBe(false); whenQuotePush(() => {}) }
    expect(reads).toBe(1)
  })

  it('C2 the cookie turns the flag on; the seam forgets the answer', () => {
    jar = 'a=1; uct_quote_push=1; b=2'
    expect(quotePushFlagOn()).toBe(true)
    expect(quotePushFlagOn()).toBe(true)
    expect(reads).toBe(1)
    jar = ''
    expect(quotePushFlagOn()).toBe(true)      // latched for the page
    __resetQuotePushFlagForTest()
    expect(quotePushFlagOn()).toBe(false)
    expect(reads).toBe(2)
  })

  it('C3 the client key and the kill switch still act at once', () => {
    expect(quotePushFlagOn()).toBe(false)
    localStorage.setItem('uct.quotePush', '1')
    expect(quotePushFlagOn()).toBe(true)
    localStorage.setItem('uct.quotePush.disabled', '1')
    expect(quotePushFlagOn()).toBe(false)
    localStorage.removeItem('uct.quotePush.disabled')
    localStorage.removeItem('uct.quotePush')
    expect(quotePushFlagOn()).toBe(false)
    expect(reads).toBe(1)
  })
})
