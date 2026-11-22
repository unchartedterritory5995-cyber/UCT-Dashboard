import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { claimMount, releaseMount, noteScroll, _queueSize, _resetQueue } from './gridMountQueue'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
  _resetQueue()
})
afterEach(() => { vi.useRealTimers() })

const entry = (p, log, name) => ({ priority: () => p, grant: () => log.push(name) })

test('charts are created one at a time, nearest the screen first', () => {
  const log = []
  const far = entry(500, log, 'far')
  const near = entry(10, log, 'near')
  const mid = entry(100, log, 'mid')
  claimMount(far); claimMount(near); claimMount(mid)
  vi.advanceTimersByTime(17)
  expect(log).toEqual(['near'])
  vi.advanceTimersByTime(200)
  expect(log).toEqual(['near', 'mid', 'far'])
  expect(_queueSize()).toBe(0)
})

test('a card that leaves before its turn never builds a chart', () => {
  const log = []
  const a = entry(1, log, 'a')
  const b = entry(2, log, 'b')
  claimMount(a); claimMount(b)
  releaseMount(a)
  vi.advanceTimersByTime(200)
  expect(log).toEqual(['b'])
})

test('mid-scroll, no chart is created; they fill in once the scroll pauses', () => {
  const log = []
  for (let i = 0; i < 5; i++) claimMount(entry(i, log, `c${i}`))
  noteScroll()
  vi.advanceTimersByTime(60)
  noteScroll()   // still scrolling
  vi.advanceTimersByTime(100)
  expect(log).toEqual([])
  vi.advanceTimersByTime(2000)
  expect(log).toEqual(['c0', 'c1', 'c2', 'c3', 'c4'])
})
