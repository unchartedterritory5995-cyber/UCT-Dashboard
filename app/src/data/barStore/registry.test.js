import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRegistry } from './registry'
import { deriveStatus, isLegalTransition, TRANSITIONS } from './status'
import { STATUS, keyOf } from './types'
import { initialState } from './reducer'
import { etUnix } from './__fixtures__/seededSeries'

const NOW = etUnix('2026-11-10', 612) * 1000
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

const rows = (n, from = etUnix('2026-11-10', 560)) =>
  Array.from({ length: n }, (_, i) => ({ t: from + 300 * i, o: 10, h: 11, l: 9, c: 10, v: 1 }))
const full = (n) => ({ type: 'rest-full', payload: { bars: rows(n) } })

describe('BarStore registry', () => {
  it('notifies only the subscribers of the changed key, only on a new snapshot', () => {
    const reg = createRegistry({ ctx: () => ({ nowMs: NOW }) })
    const a = keyOf({ sym: 'AAA', tf: '5' }), b = keyOf({ sym: 'BBB', tf: '5' })
    const ca = vi.fn(), cb = vi.fn()
    reg.subscribe(a, ca); reg.subscribe(b, cb)
    const s1 = reg.dispatch(a, full(5))
    expect(ca).toHaveBeenCalledTimes(1)
    expect(ca).toHaveBeenLastCalledWith(s1)
    expect(cb).not.toHaveBeenCalled()
    reg.dispatch(a, full(5))                 // identical answer → same snapshot, no notify
    expect(ca).toHaveBeenCalledTimes(1)
    expect(reg.getSnapshot(a)).toBe(s1)
  })

  it('LRU-evicts idle entries past maxKeys; pinned / subscribed entries survive', () => {
    const reg = createRegistry({ maxKeys: 3, ctx: () => ({ nowMs: NOW }) })
    const k = (s) => keyOf({ sym: s, tf: '5' })
    reg.acquire(k('PIN'))
    const unsub = reg.subscribe(k('SUB'), () => {})
    for (const s of ['A1', 'A2', 'A3', 'A4']) reg.dispatch(k(s), full(2))
    expect(reg.has(k('PIN'))).toBe(true)
    expect(reg.has(k('SUB'))).toBe(true)
    expect(reg.stats().keys).toBeLessThanOrEqual(3)
    expect(reg.has(k('A4'))).toBe(true)      // most recent idle kept
    unsub(); reg.release(k('PIN'))
    reg.dispatch(k('A5'), full(2))
    expect(reg.stats().keys).toBeLessThanOrEqual(3)
  })

  it('evicts by bar budget and applies per-tf depth caps', () => {
    const reg = createRegistry({ barBudget: 25, depthCaps: { '5': 10 }, ctx: () => ({ nowMs: NOW }) })
    const k = (s) => keyOf({ sym: s, tf: '5' })
    for (const s of ['A', 'B', 'C']) reg.dispatch(k(s), full(30))
    expect(reg.peek(k('C')).depth).toBeLessThanOrEqual(10)
    expect(reg.stats().bars).toBeLessThanOrEqual(25)
    expect(reg.has(k('A'))).toBe(false)
  })

  it('invalidate(pred) resets matching entries and notifies; peek never creates', () => {
    const reg = createRegistry({ ctx: () => ({ nowMs: NOW }) })
    const a = keyOf({ sym: 'AAA', tf: '5' }), b = keyOf({ sym: 'AAA', tf: '15' })
    reg.dispatch(a, full(4)); reg.dispatch(b, { type: 'rest-full', payload: { bars: rows(2).map((r, i) => ({ ...r, t: r.t + 600 * i })) } })
    const cb = vi.fn(); reg.subscribe(a, cb)
    expect(reg.invalidate((key) => key.startsWith('AAA_'), 'split')).toBe(2)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(reg.peek(a).status).toBe(STATUS.EMPTY)
    expect(reg.peek(a).invalidatedFor).toBe('split')
    expect(reg.peek('ZZZ_5')).toBeNull()
    expect(reg.has('ZZZ_5')).toBe(false)
  })
})

describe('BarStore status', () => {
  it('the transition table: never back to local-only once a server answer is held', () => {
    for (const from of ['current', 'updating', 'unavailable']) expect(isLegalTransition(from, 'provisional')).toBe(false)
    for (const s of Object.keys(TRANSITIONS)) {
      expect(isLegalTransition(s, s)).toBe(true)
      if (s !== 'empty') expect(isLegalTransition(s, 'empty')).toBe(true)
    }
    expect(isLegalTransition('empty', 'current')).toBe(true)
  })

  it('derives from the one freshness function (intradayBarCurrentness)', () => {
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const base = initialState(key, { nowMs: NOW })
    expect(deriveStatus(base, { nowMs: NOW })).toBe('empty')
    const fresh = rows(11)    // 09:20 … 10:10 → within one bucket of the 10:05 frontier
    const stale = rows(3)     // stops 09:30
    const mk = (bars, extra) => ({ ...base, bars, ...extra })
    expect(deriveStatus(mk(fresh, { restSeen: false }), { nowMs: NOW })).toBe('context')
    expect(deriveStatus(mk(stale, { restSeen: false }), { nowMs: NOW })).toBe('provisional')
    expect(deriveStatus(mk(fresh, { restSeen: true, verifiedThrough: NOW / 1000 - 60 }), { nowMs: NOW })).toBe('current')
    expect(deriveStatus(mk(fresh, { restSeen: true }), { nowMs: NOW })).toBe('context')
    expect(deriveStatus(mk(stale, { restSeen: true }), { nowMs: NOW })).toBe('updating')
    expect(deriveStatus(mk([], { restSeen: true, error: 'no_data' }), { nowMs: NOW })).toBe('unavailable')
  })
})
