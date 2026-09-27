/**
 * `search_used` (wave 10, lane 10D, R-16, task T4) — one reading per search, timed from
 * the debounced ask to the first settled page. Driven with a fake clock through the real
 * hook; the rendered door is railed in FolderSidebar.test.jsx.
 */
import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSearchUsedTelemetry } from './searchTelemetry'

let fetchFn
let t
const clock = () => t
beforeEach(() => {
  t = 1000
  fetchFn = vi.fn(() => Promise.resolve({ ok: true }))
  vi.stubGlobal('fetch', fetchFn)
})
afterEach(() => vi.unstubAllGlobals())

const sent = () => fetchFn.mock.calls
  .filter(([u]) => u === '/api/j2/telemetry')
  .map(([, init]) => JSON.parse(init.body))

const props = (over) => ({
  enabled: true, searchKey: '["nvda thesis","","","",""]', settled: false,
  results: 7, filters: 1, textQuery: true, now: clock, ...over,
})

describe('useSearchUsedTelemetry', () => {
  it('fires ONCE when the search settles, with the time since it was asked — never the query', () => {
    const { rerender } = renderHook((p) => useSearchUsedTelemetry(p), { initialProps: props() })
    expect(sent()).toEqual([])
    t = 1180.4
    rerender(props({ settled: true }))
    expect(sent()).toEqual([
      { event: 'search_used', props: { results: 7, filters: 1, mode: 'text', ms: 180 } },
    ])
    rerender(props({ settled: false }))
    rerender(props({ settled: true }))
    expect(sent()).toHaveLength(1)   // a revalidation of the same search is not a second search
    expect(JSON.stringify(sent())).not.toMatch(/nvda|thesis/)
  })

  it('a NEW search is a new reading; one answered from cache reads 0 ms; filters-only reads "filter"', () => {
    const { rerender } = renderHook((p) => useSearchUsedTelemetry(p), { initialProps: props({ settled: true }) })
    rerender(props({ searchKey: '["","2026-09-01","","",""]', textQuery: false, settled: true }))
    expect(sent().map((b) => [b.props.mode, b.props.ms])).toEqual([['text', 0], ['filter', 0]])
  })

  it('a disabled search (the panel closed, nothing asked) sends nothing', () => {
    const { rerender } = renderHook((p) => useSearchUsedTelemetry(p),
      { initialProps: props({ enabled: false, settled: true }) })
    rerender(props({ enabled: false, searchKey: '', settled: true }))
    expect(sent()).toEqual([])
  })
})
