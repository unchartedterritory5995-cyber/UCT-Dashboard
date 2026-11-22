// ⭐ (2026-11-21) The facade's two cold-switch doors: deviceWarm (the key press starts the device read on the key
// the chart reads: persist.refreshDevice) and watch (a waiter woken by the entry's own changes, the registry's
// subscription: no life cycle, no request).
import { describe, it, expect, vi } from 'vitest'
import { createPrefetch } from './prefetch'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

function setup({ registry = undefined } = {}) {
  const refreshDevice = vi.fn(() => Promise.resolve(true))
  const subs = []
  const reg = registry === null ? undefined : { subscribe: vi.fn((key, cb, o) => { const s = { key, cb, o, off: false }; subs.push(s); return () => { s.off = true } }) }
  const store = { persist: { refreshDevice }, registry: reg, peek: () => null }
  return { pf: createPrefetch({ store, tickerMeta: () => {} }), refreshDevice, reg, subs }
}

describe('deviceWarm: the device read leaves in the key press', () => {
  it('asks the persistence layer for the device copy of the key the chart reads', async () => {
    const { pf, refreshDevice } = setup()
    expect(await pf.deviceWarm('AAA', 'D')).toBe(true)
    expect(refreshDevice).toHaveBeenCalledWith(pf.keyFor('AAA', 'D'))
    await pf.deviceWarm('AAA', '30', { showExtended: true })
    expect(refreshDevice).toHaveBeenLastCalledWith(pf.keyFor('AAA', '30', { showExtended: true }))
  })
  it('no key, or a failing read: false, never a throw', async () => {
    const { pf, refreshDevice } = setup()
    expect(await pf.deviceWarm('', 'D')).toBe(false)
    refreshDevice.mockImplementation(() => { throw new Error('gone') })
    expect(await pf.deviceWarm('AAA', 'D')).toBe(false)
  })
})

describe('watch: woken by the entry, not a poll', () => {
  it('subscribes to the key in the registry and calls back on each change; the off detaches', () => {
    const { pf, reg, subs } = setup()
    const cb = vi.fn()
    const off = pf.watch('AAA', 'D', {}, cb)
    expect(reg.subscribe).toHaveBeenCalledWith(pf.keyFor('AAA', 'D'), expect.any(Function), { wake: 'all' })
    subs[0].cb(); subs[0].cb()
    expect(cb).toHaveBeenCalledTimes(2)
    off()
    expect(subs[0].off).toBe(true)
  })
  it('a store with no registry: null (the caller polls)', () => {
    const { pf } = setup({ registry: null })
    expect(pf.watch('AAA', 'D', {}, () => {})).toBe(null)
  })
})
