import { describe, it, expect } from 'vitest'
import {
  streamStatus,
  STREAM_WATCHDOG_MS, STREAM_WATCHDOG_TICK_MS, STREAM_RECONNECT_CAP_MS,
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
