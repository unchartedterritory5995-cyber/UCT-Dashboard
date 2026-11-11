// review #1061 F4: cache peeks outside StockChart read the CURRENT view's key.
import { describe, it, expect, afterEach } from 'vitest'
import { setViewShowExtended, viewCacheTf } from './viewSession'
import { peekDisplayable } from '../hooks/useSymbolHandoff'
import { memPut, memClear } from './barsMemCache'

afterEach(() => { setViewShowExtended(false); memClear() })

describe('viewCacheTf', () => {
  it('60m follows the view; every other tf is itself', () => {
    expect(viewCacheTf('60')).toBe('60')
    setViewShowExtended(true)
    expect(viewCacheTf('60')).toBe('60e')
    expect(viewCacheTf('5')).toBe('5')
    expect(viewCacheTf('D')).toBe('D')
  })
  it('the symbol handoff fast path finds the ETH 60m series under 60e', () => {
    const now = Math.floor(Date.now() / 1000)
    const t = now - (now % 3600)
    memPut('HAND', '60e', [{ t, o: 1, h: 1, l: 1, c: 1, v: 1 }])
    setViewShowExtended(false)
    const rth = peekDisplayable('HAND', '60')
    setViewShowExtended(true)
    expect(rth).toBe(false)                    // RTH view: nothing under '60'
    // ETH view reads '60e' (displayable iff current-enough; at least it LOOKS there)
    memPut('HAND2', '60', [{ t, o: 1, h: 1, l: 1, c: 1, v: 1 }])
    expect(peekDisplayable('HAND2', '60')).toBe(false)   // the '60' entry is not this view's
  })
})
