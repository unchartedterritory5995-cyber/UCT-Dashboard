// Every chart's timeframe per colour group (2026-11-19): a list linked to a daily AND an hourly chart
// warms both (production: the unwarmed one waited 501 ms at every flip).
import { describe, it, expect, vi } from 'vitest'
import { createGroupTfRegistry } from './groupTfRegistry'

describe('createGroupTfRegistry', () => {
  it('holds every chart\'s timeframe per colour, sorted and unique', () => {
    const seen = []
    const r = createGroupTfRegistry((s) => seen.push(s))
    r.register('A', 'c1', 'D')
    r.register('A', 'c2', '60')
    r.register('A', 'c3', '60')
    r.register('B', 'c4', '5')
    expect(r.sets()).toEqual({ A: ['60', 'D'], B: ['5'] })
    expect(seen.length).toBe(3)                                   // the duplicate 60 changed nothing
  })

  it('an unregistered chart (unmount, colour or timeframe change) leaves the set', () => {
    const r = createGroupTfRegistry(() => {})
    const offD = r.register('A', 'c1', 'D')
    r.register('A', 'c2', '60')
    offD()
    expect(r.sets()).toEqual({ A: ['60'] })
    offD()                                                        // twice is harmless
    expect(r.sets()).toEqual({ A: ['60'] })
  })

  it('a stale unregister never removes the timeframe the same chart registered after it', () => {
    const r = createGroupTfRegistry(() => {})
    const off1 = r.register('A', 'c1', 'D')
    r.register('A', 'c1', '15')                                   // the chart switched to 15m first
    off1()                                                        // ...then its old effect cleaned up
    expect(r.sets()).toEqual({ A: ['15'] })
  })

  it('tells only on a change', () => {
    const onChange = vi.fn()
    const r = createGroupTfRegistry(onChange)
    const off = r.register('A', 'c1', 'D')
    r.register('A', 'c2', 'D')
    off()
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
