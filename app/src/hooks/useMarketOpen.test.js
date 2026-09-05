// app/src/hooks/useMarketOpen.test.js
//
// Pins the upgrade from a naive weekday+fixed-hours guess to S11's real
// NYSE calendar: the returned shape stays locked (existing consumers —
// MarketClock.jsx, ChartMarketClock.jsx, sessionModel.js — never change),
// but a holiday now correctly reports closed even during what used to be
// "regular hours" by the old weekday-only logic.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import useMarketOpen from './useMarketOpen'

afterEach(() => {
  vi.useRealTimers()
})

describe('useMarketOpen', () => {
  it('returns the locked shape: isOpen, isPremarket, isExtended, isHalfDay', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T15:00:00Z')) // regular Thursday, 10am ET
    const { result } = renderHook(() => useMarketOpen())
    expect(result.current).toEqual({
      isOpen: true, isPremarket: false, isExtended: false, isHalfDay: false,
    })
  })

  it('a full NYSE holiday reads closed even at what would be "regular hours" by clock alone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T15:00:00Z')) // Independence Day observed, 10am ET, a weekday
    const { result } = renderHook(() => useMarketOpen())
    expect(result.current.isOpen).toBe(false)
    expect(result.current.isPremarket).toBe(false)
    expect(result.current.isExtended).toBe(false)
  })

  it('an early-close day reports isHalfDay true during the (shortened) regular session', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-27T17:00:00Z')) // day after Thanksgiving, noon ET
    const { result } = renderHook(() => useMarketOpen())
    expect(result.current.isOpen).toBe(true)
    expect(result.current.isHalfDay).toBe(true)
  })
})
