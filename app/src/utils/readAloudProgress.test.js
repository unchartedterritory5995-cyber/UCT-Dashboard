import { describe, it, expect } from 'vitest'
import { setProgress, getProgress, subscribeProgress } from './readAloudProgress'

describe('readAloudProgress', () => {
  it('publishes updates to subscribers and exposes current state', () => {
    const seen = []
    const unsub = subscribeProgress((s) => seen.push(s))
    // subscribe fires immediately with current state
    expect(seen.length).toBe(1)

    setProgress({ trackId: 'morning-wire-2026-06-01', currentTime: 12, duration: 480, playing: true })
    const cur = getProgress()
    expect(cur.trackId).toBe('morning-wire-2026-06-01')
    expect(cur.currentTime).toBe(12)
    expect(cur.duration).toBe(480)
    expect(cur.playing).toBe(true)
    expect(seen[seen.length - 1]).toEqual(cur)

    unsub()
    setProgress({ currentTime: 99 })
    // no longer notified after unsubscribe
    expect(seen[seen.length - 1].currentTime).toBe(12)
    // but global state still updates
    expect(getProgress().currentTime).toBe(99)
  })
})
