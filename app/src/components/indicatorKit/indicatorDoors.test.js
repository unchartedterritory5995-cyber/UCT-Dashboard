// app/src/components/indicatorKit/indicatorDoors.test.js
//
// The door request is parked, taken once, and dropped when stale. Engine-free.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  INDICATOR_DOORS, PENDING_KEY, PENDING_TTL_MS, clearPendingIndicatorDoor, onIndicatorDoor,
  peekPendingIndicatorDoor, pickChartApi, requestIndicatorDoor, runIndicatorDoor,
} from './indicatorDoors'
import useIndicatorDoors, { RETRY_MS } from './useIndicatorDoors'

const chart = (over = {}) => ({
  agent: {
    openCreateIndicator: vi.fn(() => ({ ok: true })),
    openIndicatorDoor: vi.fn(() => true),
    ...over,
  },
})

beforeEach(() => { sessionStorage.clear() })
afterEach(() => { sessionStorage.clear(); vi.useRealTimers() })

describe('requestIndicatorDoor / peekPendingIndicatorDoor', () => {
  it('parks a known door and announces it', () => {
    const heard = vi.fn()
    const off = onIndicatorDoor(heard)
    expect(requestIndicatorDoor(INDICATOR_DOORS.PASTE, { now: 1000 })).toBe(true)
    expect(heard).toHaveBeenCalledWith('pine')
    expect(peekPendingIndicatorDoor({ now: 1500 })).toBe('pine')
    off()
  })

  it('refuses a door it does not know, and parks nothing', () => {
    expect(requestIndicatorDoor('delete-everything')).toBe(false)
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull()
  })

  it('a stale request is dropped, never returned', () => {
    requestIndicatorDoor(INDICATOR_DOORS.LIBRARY, { now: 1000 })
    expect(peekPendingIndicatorDoor({ now: 1000 + PENDING_TTL_MS + 1 })).toBeNull()
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull()
  })

  it('control: the same request one millisecond inside its time is still returned', () => {
    requestIndicatorDoor(INDICATOR_DOORS.LIBRARY, { now: 1000 })
    expect(peekPendingIndicatorDoor({ now: 1000 + PENDING_TTL_MS })).toBe('library')
  })

  it('a value somebody else wrote under the key is dropped: not JSON, an unknown door, a future time', () => {
    for (const raw of ['not json', JSON.stringify({ door: 'rm', at: 1000 }), JSON.stringify({ door: 'pine', at: 9e15 }),
      JSON.stringify({ door: 'pine' })]) {
      sessionStorage.setItem(PENDING_KEY, raw)
      expect(peekPendingIndicatorDoor({ now: 2000 })).toBeNull()
      expect(sessionStorage.getItem(PENDING_KEY)).toBeNull()
    }
  })
})

describe('pickChartApi', () => {
  it('prefers the chart the member is on, else the first that can answer', () => {
    const a = chart(); const b = chart()
    const map = new Map([['a', a], ['b', b]])
    expect(pickChartApi(map, 'b')).toBe(b)
    expect(pickChartApi(map, null)).toBe(a)
    expect(pickChartApi(map, 'gone')).toBe(a)
  })

  it('skips an entry with no agent door, and answers null when none has one', () => {
    const b = chart()
    expect(pickChartApi(new Map([['a', { getRect: () => null }], ['b', b]]), 'a')).toBe(b)
    expect(pickChartApi(new Map([['a', {}]]), 'a')).toBeNull()
    expect(pickChartApi(null, 'a')).toBeNull()
  })
})

describe('runIndicatorDoor', () => {
  it('describe opens Create Indicator; the others open the named builder door', () => {
    const c = chart()
    expect(runIndicatorDoor(INDICATOR_DOORS.DESCRIBE, c)).toBe('opened')
    expect(c.agent.openCreateIndicator).toHaveBeenCalledTimes(1)
    expect(runIndicatorDoor(INDICATOR_DOORS.PASTE, c)).toBe('opened')
    expect(c.agent.openIndicatorDoor).toHaveBeenCalledWith('pine')
  })

  it('a chart that says no for good is refused, so nobody keeps asking', () => {
    for (const reason of ['access', 'readonly']) {
      const c = chart({ openCreateIndicator: () => ({ ok: false, reason }) })
      expect(runIndicatorDoor(INDICATOR_DOORS.DESCRIBE, c)).toBe('refused')
    }
  })

  it('a chart that is not ready, is missing, or throws is asked again later', () => {
    expect(runIndicatorDoor(INDICATOR_DOORS.DESCRIBE, chart({ openCreateIndicator: () => ({ ok: false, reason: 'unavailable' }) }))).toBe('later')
    expect(runIndicatorDoor(INDICATOR_DOORS.PASTE, chart({ openIndicatorDoor: () => false }))).toBe('later')
    expect(runIndicatorDoor(INDICATOR_DOORS.PASTE, null)).toBe('later')
    expect(runIndicatorDoor(INDICATOR_DOORS.PASTE, chart({ openIndicatorDoor: () => { throw new Error('x') } }))).toBe('later')
    expect(runIndicatorDoor('nope', chart())).toBe('later')
  })
})

describe('useIndicatorDoors', () => {
  it('a request parked BEFORE the charts page mounts opens once a chart registers', () => {
    vi.useFakeTimers()
    requestIndicatorDoor(INDICATOR_DOORS.FORMULA)
    const apis = { current: new Map() }
    const active = { current: null }
    renderHook(() => useIndicatorDoors(apis, active))
    const c = chart()
    vi.advanceTimersByTime(RETRY_MS * 2)
    expect(c.agent.openIndicatorDoor).not.toHaveBeenCalled()
    apis.current.set('w1', c)
    vi.advanceTimersByTime(RETRY_MS)
    expect(c.agent.openIndicatorDoor).toHaveBeenCalledTimes(1)
    expect(c.agent.openIndicatorDoor).toHaveBeenCalledWith('formula')
    expect(peekPendingIndicatorDoor()).toBeNull()
    vi.advanceTimersByTime(RETRY_MS * 10)
    expect(c.agent.openIndicatorDoor).toHaveBeenCalledTimes(1)      // opened once, never again
  })

  it('a request made while the page is open is answered at once, on the active chart', () => {
    const a = chart(); const b = chart()
    const apis = { current: new Map([['a', a], ['b', b]]) }
    renderHook(() => useIndicatorDoors(apis, { current: 'b' }))
    requestIndicatorDoor(INDICATOR_DOORS.DESCRIBE)
    expect(b.agent.openCreateIndicator).toHaveBeenCalledTimes(1)
    expect(a.agent.openCreateIndicator).not.toHaveBeenCalled()
  })

  it('gives up when no chart ever answers, and leaves no timer running', () => {
    vi.useFakeTimers()
    requestIndicatorDoor(INDICATOR_DOORS.LIBRARY)
    renderHook(() => useIndicatorDoors({ current: new Map() }, { current: null }))
    vi.advanceTimersByTime(PENDING_TTL_MS + RETRY_MS * 4)
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('with nothing parked it starts no timer at all', () => {
    vi.useFakeTimers()
    renderHook(() => useIndicatorDoors({ current: new Map() }, { current: null }))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('unmounting stops the asking', () => {
    vi.useFakeTimers()
    requestIndicatorDoor(INDICATOR_DOORS.LIBRARY)
    const apis = { current: new Map() }
    const { unmount } = renderHook(() => useIndicatorDoors(apis, { current: null }))
    unmount()
    const c = chart()
    apis.current.set('w1', c)
    vi.advanceTimersByTime(RETRY_MS * 4)
    expect(c.agent.openIndicatorDoor).not.toHaveBeenCalled()
    clearPendingIndicatorDoor()
  })
})
