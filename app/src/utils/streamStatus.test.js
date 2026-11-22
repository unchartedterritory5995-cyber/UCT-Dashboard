import { describe, it, expect } from 'vitest'
import {
  streamStatus,
  STREAM_WATCHDOG_MS, STREAM_WATCHDOG_TICK_MS, STREAM_RECONNECT_CAP_MS,
  liveCandleCadenceMs, LIVE_CADENCE_KEY,
} from './streamStatus'

describe('streamStatus', () => {
  it('live when streaming and not stale', () => {
    expect(streamStatus({ isStreaming: true, isStale: false }))
      .toEqual({ state: 'live', label: 'LIVE', tone: 'live' })
  })

  it('stale when streaming but server reports the symbol paused', () => {
    expect(streamStatus({ isStreaming: true, isStale: true }).state).toBe('stale')
  })

  it('reconnecting when not streaming', () => {
    expect(streamStatus({ isStreaming: false, isStale: false }).state).toBe('reconnecting')
  })

  it('reconnecting outranks stale (dead connection wins)', () => {
    expect(streamStatus({ isStreaming: false, isStale: true }).state).toBe('reconnecting')
  })

  it('exposes tuning constants', () => {
    expect(STREAM_WATCHDOG_MS).toBe(30000)
    expect(STREAM_WATCHDOG_TICK_MS).toBe(10000)
    expect(STREAM_RECONNECT_CAP_MS).toBe(20000)
  })
})

describe('liveCandleCadenceMs: a per-browser override, the default otherwise', () => {
  const set = (v) => { if (v === null) localStorage.removeItem(LIVE_CADENCE_KEY); else localStorage.setItem(LIVE_CADENCE_KEY, v) }
  it('returns the caller default when nothing (or nothing usable) is stored', () => {
    for (const v of [null, '', 'fast', 'NaN', 'Infinity']) {
      set(v)
      expect(liveCandleCadenceMs(500)).toBe(500)
      expect(liveCandleCadenceMs(1000)).toBe(1000)
    }
    set(null)
  })
  it('uses a stored number, kept between 16 and 1000 ms', () => {
    set('50'); expect(liveCandleCadenceMs(500)).toBe(50)
    set('49.6'); expect(liveCandleCadenceMs(500)).toBe(50)
    set('0'); expect(liveCandleCadenceMs(500)).toBe(16)
    set('-5'); expect(liveCandleCadenceMs(500)).toBe(16)
    set('60000'); expect(liveCandleCadenceMs(500)).toBe(1000)
    set(null)
  })
  it('falls back to the default when storage throws', () => {
    const real = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new Error('blocked') }
    try { expect(liveCandleCadenceMs(500)).toBe(500) } finally { Storage.prototype.getItem = real }
  })
  it('names the key the proof tool sets', () => { expect(LIVE_CADENCE_KEY).toBe('uct.liveCadenceMs') })
})
