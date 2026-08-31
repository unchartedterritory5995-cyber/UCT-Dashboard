/**
 * The router plumbing — the part `breadthUrlState.test.js` cannot see.
 *
 * Two claims are measured here rather than argued: writes REPLACE (they never
 * grow the history stack), and they MERGE (a param this tab does not own
 * survives). Both are observed at the platform API — `window.history` — which
 * is what React Router actually calls, so the test cannot pass by mocking the
 * thing under test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, screen, act } from '@testing-library/react'
import { BrowserRouter, useLocation } from 'react-router-dom'

import useBreadthUrlState from './useBreadthUrlState'

const DAY_CHOICES = [90, 180, 365]

// The router's own view of the query, rendered beside the hook under test.
function LocationProbe() {
  return <div data-testid="search">{useLocation().search}</div>
}

const search = () => screen.getByTestId('search').textContent
// Set by `mountAt` (outside any component, so nothing is written during render).
let hookResult = null
const api = () => hookResult.current
// BrowserRouter stamps its own index with `replaceState(state, '')` on mount —
// no URL argument. Only a call that carries a URL is a navigation.
const urlWrites = (spy) => spy.mock.calls.filter(c => c[2] != null)
const mountAt = (query, props = {}) => {
  window.history.replaceState({}, '', `/breadth${query}`)
  const spies = {
    push: vi.spyOn(window.history, 'pushState'),
    replace: vi.spyOn(window.history, 'replaceState'),
  }
  const wrapper = ({ children }) => (
    <BrowserRouter>{children}<LocationProbe /></BrowserRouter>
  )
  const view = renderHook(
    () => useBreadthUrlState({ dayChoices: DAY_CHOICES, debounceMs: 100, ...props }),
    { wrapper })
  hookResult = view.result
  return { ...view, spies }
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); hookResult = null })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('reading the link', () => {
  it('parses the query it was mounted on', () => {
    mountAt('?view=clock&date=2026-08-14&days=180&compare=clock,events')
    expect(api().initial).toMatchObject({ view: 'clock', date: '2026-08-14', days: 180 })
    expect(api().initial.compare.slice(0, 2)).toEqual(['clock', 'events'])
  })

  it('reads ONCE — a later write does not become new input', () => {
    // The asymmetry is deliberate: a live read would turn every settled write
    // into a state change and the scrubber would fight its own URL.
    mountAt('?view=clock')
    const before = api().initial
    act(() => { api().write({ view: 'radar', layout: 'single' }); vi.advanceTimersByTime(200) })
    expect(search()).toContain('view=radar')
    expect(api().initial).toBe(before)
    expect(api().initial.view).toBe('clock')
  })

  it('gives four nulls for a bare URL', () => {
    mountAt('')
    expect(api().initial).toEqual({ view: null, date: null, days: null, compare: null })
  })
})

/**
 * ⛔ THE LINK IS AN ENTRY CONDITION — Back does not re-apply it, deliberately.
 *
 * This rail exists so the non-behaviour is a DECISION with a name rather than
 * an omission nobody wrote down. The reasoning is in the header of
 * `useBreadthUrlState.js`: every write REPLACES (there are no intra-page
 * entries to go back to), and a live read of the query beside a debounced
 * writer turns each settled write into new input — the cursor would fight its
 * own URL 300ms after every step of playback.
 *
 * If a future change makes history navigation re-apply the link, THIS goes red,
 * and whoever makes it has to state the trade rather than discover it later as
 * a scrubber that jumps.
 */
describe('the link is an ENTRY condition, not a live input', () => {
  it('does not re-read the query when the URL changes underneath it', () => {
    const { spies } = mountAt('?view=clock&days=90')
    expect(api().initial).toMatchObject({ view: 'clock', days: 90 })

    // A history navigation, exactly as Back performs one.
    act(() => {
      window.history.replaceState({}, '', '/breadth?view=radar&days=365')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(api().initial,
      'the hook started tracking the query — read the Back decision in its header')
      .toMatchObject({ view: 'clock', days: 90 })
    // ⛔ CONTROL: the probe can see a URL change at all, so the assertion above
    // is not passing because nothing happened.
    expect(search()).toContain('view=radar')
    expect(urlWrites(spies.push), 'a write pushed an entry Back could land on').toHaveLength(0)
  })
})

describe('writing the link', () => {
  it('REPLACES — one history entry, however many times state moves', () => {
    const { spies } = mountAt('?view=clock')
    act(() => {
      for (const v of ['radar', 'ribbon', 'clock', 'events']) api().write({ view: v, layout: 'single' })
      vi.advanceTimersByTime(200)
    })
    expect(urlWrites(spies.push)).toHaveLength(0)
    // Debounced: four moves, one write.
    expect(urlWrites(spies.replace)).toHaveLength(1)
    expect(search()).toContain('view=events')
  })

  it('MERGES — a param this tab does not own survives the write', () => {
    mountAt('?tab=monitor&view=clock')
    act(() => { api().write({ view: 'radar', days: 365, layout: 'single' }); vi.advanceTimersByTime(200) })
    expect(search()).toContain('tab=monitor')
    expect(search()).toContain('view=radar')
    expect(search()).toContain('days=365')
  })

  it('DELETES a param the state no longer has', () => {
    mountAt('?view=clock&date=2026-08-14&compare=clock,events')
    act(() => { api().write({ view: 'clock', date: null, layout: 'single' }); vi.advanceTimersByTime(200) })
    expect(search()).not.toContain('date=')
    expect(search()).not.toContain('compare=')
    expect(search()).toContain('view=clock')
  })

  it('writes the quad only in compare layout', () => {
    mountAt('')
    act(() => {
      api().write({ view: 'clock', layout: 'compare', compare: ['clock', 'divergence', 'events', 'analogues'] })
      vi.advanceTimersByTime(200)
    })
    expect(decodeURIComponent(search())).toContain('compare=clock,divergence,events,analogues')
  })

  it('writes nothing at all when disabled', () => {
    const { spies } = mountAt('?view=clock', { enabled: false })
    act(() => { api().write({ view: 'radar', layout: 'single' }); vi.advanceTimersByTime(500) })
    expect(urlWrites(spies.replace)).toHaveLength(0)
    expect(search()).toContain('view=clock')
  })

  it('drops a pending write when the page unmounts', () => {
    const { spies, unmount } = mountAt('?view=clock')
    act(() => { api().write({ view: 'radar', layout: 'single' }) })
    unmount()
    act(() => { vi.advanceTimersByTime(500) })
    expect(urlWrites(spies.replace)).toHaveLength(0)
  })
})
