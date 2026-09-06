import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  requestNoteLinkTarget, subscribeNoteLinkTargets, _resetNoteLinkTargetsBatchForTests,
} from './noteLinkTargetsBatch'

beforeEach(() => {
  _resetNoteLinkTargetsBatchForTests()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  delete global.fetch
})

function jsonResponse(body) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
}

describe('noteLinkTargetsBatch', () => {
  it('returns undefined (loading) on first request for an id', () => {
    global.fetch = vi.fn(() => jsonResponse({ targets: {} }))
    expect(requestNoteLinkTarget('n1')).toBeUndefined()
  })

  it('batches multiple ids requested within the window into ONE fetch call', async () => {
    global.fetch = vi.fn(() => jsonResponse({ targets: {
      n1: { title: 'One', status: 'active' },
      n2: { title: 'Two', status: 'active' },
    } }))
    requestNoteLinkTarget('n1')
    requestNoteLinkTarget('n2')
    requestNoteLinkTarget('n1') // duplicate -- still one entry in the batch

    await vi.runAllTimersAsync()

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const url = global.fetch.mock.calls[0][0]
    expect(url).toContain('n1')
    expect(url).toContain('n2')
  })

  it('resolves to the fetched title/status after the batch completes', async () => {
    global.fetch = vi.fn(() => jsonResponse({ targets: { n1: { title: 'Thesis', status: 'active' } } }))
    const listener = vi.fn()
    subscribeNoteLinkTargets(listener)
    requestNoteLinkTarget('n1')

    await vi.runAllTimersAsync()

    expect(listener).toHaveBeenCalled()
    expect(requestNoteLinkTarget('n1')).toEqual({ title: 'Thesis', status: 'active' })
  })

  it('resolves to null (unavailable) for an id the server omits from targets', async () => {
    global.fetch = vi.fn(() => jsonResponse({ targets: {} }))
    requestNoteLinkTarget('ghost')
    await vi.runAllTimersAsync()
    expect(requestNoteLinkTarget('ghost')).toBeNull()
  })

  it('resolves to null for every pending id on a network failure', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')))
    requestNoteLinkTarget('n1')
    await vi.runAllTimersAsync()
    expect(requestNoteLinkTarget('n1')).toBeNull()
  })

  it('a cached result never re-fetches', async () => {
    global.fetch = vi.fn(() => jsonResponse({ targets: { n1: { title: 'One', status: 'active' } } }))
    requestNoteLinkTarget('n1')
    await vi.runAllTimersAsync()
    expect(global.fetch).toHaveBeenCalledTimes(1)

    requestNoteLinkTarget('n1')
    await vi.runAllTimersAsync()
    expect(global.fetch).toHaveBeenCalledTimes(1) // still one -- served from cache
  })

  it('a second, later batch (new ids after the first flushed) fires a second fetch', async () => {
    global.fetch = vi.fn(() => jsonResponse({ targets: { n1: { title: 'One', status: 'active' } } }))
    requestNoteLinkTarget('n1')
    await vi.runAllTimersAsync()

    requestNoteLinkTarget('n2')
    await vi.runAllTimersAsync()

    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('ignores a falsy id without queuing anything', () => {
    global.fetch = vi.fn()
    expect(requestNoteLinkTarget(null)).toBeNull()
    expect(requestNoteLinkTarget('')).toBeNull()
  })
})
