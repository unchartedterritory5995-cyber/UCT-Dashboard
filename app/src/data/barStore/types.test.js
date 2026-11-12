import { describe, it, expect } from 'vitest'
import {
  keyOf, parseKey, expectedServerCacheKey, normTf, bucketGridOf, dateLabelToUnix, unixToDateLabel, TFS,
} from './types'

describe('barStore key identity', () => {
  it('matches the existing cache identity (seriesCacheTf): only 60m eth differs by session', () => {
    expect(keyOf({ sym: 'aapl', tf: '5' })).toBe('AAPL_5')
    expect(keyOf({ sym: 'AAPL', tf: 5, session: 'eth' })).toBe('AAPL_5')
    expect(keyOf({ sym: 'AAPL', tf: '60', session: 'rth' })).toBe('AAPL_60')
    expect(keyOf({ sym: 'AAPL', tf: '60', session: 'eth' })).toBe('AAPL_60e')
    expect(keyOf({ sym: 'AAPL', tf: 'd' })).toBe('AAPL_D')
    expect(keyOf({ sym: 'AAPL', tf: '1', window: { to: 1762871522.7 } })).toBe('AAPL_1@to=1762871522')
  })

  it('round-trips every tf x session x window', () => {
    for (const tf of TFS) {
      for (const session of ['rth', 'eth']) {
        for (const window of [null, { to: 1700000000 }]) {
          const key = keyOf({ sym: 'BRK.B', tf, session, window })
          const p = parseKey(key)
          expect(p.key).toBe(key)
          expect(p.sym).toBe('BRK.B')
          expect(p.tf).toBe(tf)
          expect(keyOf({ sym: p.sym, tf: p.tf, session: p.session ?? session, window: p.window })).toBe(key)
        }
      }
    }
  })

  it('parseKey rejects what keyOf cannot produce', () => {
    for (const bad of ['', 'AAPL', '_5', 'aapl_5', 'AAPL_7', 'AAPL_5@to=x', 'AAPL_60x', 5, null]) {
      expect(parseKey(bad)).toBeNull()
    }
    expect(() => keyOf({ sym: '', tf: '5' })).toThrow()
    expect(() => keyOf({ sym: 'A', tf: '7' })).toThrow()
  })

  it('names the server cache_key / grid of the P1 contract', () => {
    expect(expectedServerCacheKey('AAPL_5')).toBe('b1:AAPL:5:eth-clock')
    expect(expectedServerCacheKey('AAPL_60')).toBe('b1:AAPL:60:rth-tv')
    expect(expectedServerCacheKey('AAPL_60e')).toBe('b1:AAPL:60:eth-clock')
    expect(expectedServerCacheKey('AAPL_D')).toBe('b1:AAPL:D:plain')
    expect(bucketGridOf('rth-tv')).toBe('session')
    expect(bucketGridOf('eth-clock')).toBe('clock')
    expect(bucketGridOf('plain')).toBeNull()
    expect(normTf('60e')).toBe('60')
  })

  it('D/W/M t is 00:00 UTC of the label date', () => {
    const t = dateLabelToUnix('2026-11-10')
    expect(t % 86400).toBe(0)
    expect(unixToDateLabel(t)).toBe('2026-11-10')
    expect(Number.isNaN(dateLabelToUnix('2026-1-1'))).toBe(true)
  })
})
