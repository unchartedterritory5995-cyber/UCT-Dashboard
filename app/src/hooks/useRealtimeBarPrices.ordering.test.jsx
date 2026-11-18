import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const subs = []
vi.mock('../lib/barsStreamManager', () => ({
  subscribe: (sym, tf, cbs) => { subs.push({ sym, tf, ...cbs }); return () => {} },
}))
const { default: useRealtimeBarPrices } = await import('./useRealtimeBarPrices')

beforeEach(() => { subs.length = 0 })

describe('useRealtimeBarPrices — older-t frames never roll the price back', () => {
  it('ignores a frame whose t is older than the last one seen for that symbol', async () => {
    const { result } = renderHook(() => useRealtimeBarPrices(['SYN']))
    const s = subs.find(x => x.sym === 'SYN')
    await act(async () => {
      s.onBar({ sym: 'SYN', tf: '1', bar: { t: 120000, c: 20.5 } })
      await new Promise(r => requestAnimationFrame(r))
    })
    expect(result.current.SYN.price).toBe(20.5)
    await act(async () => {
      s.onBar({ sym: 'SYN', tf: '1', bar: { t: 60000, c: 19.9, final: true } })   // late correction of the prior minute
      await new Promise(r => requestAnimationFrame(r))
    })
    expect(result.current.SYN.price).toBe(20.5)
  })
})
