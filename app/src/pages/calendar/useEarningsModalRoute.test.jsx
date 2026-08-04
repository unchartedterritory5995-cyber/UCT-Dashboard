// app/src/pages/calendar/useEarningsModalRoute.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import {
  unstable_HistoryRouter as HistoryRouter, Routes, Route, useLocation,
  UNSAFE_createBrowserHistory as createBrowserHistory,
} from 'react-router-dom'

import useEarningsModalRoute, {
  EARNINGS_PARAM, SECTION_PARAM, isRoutedPath, mergeParams, normalizeSym, resolveFeedEntry,
} from './useEarningsModalRoute'

// ── pure helpers ──────────────────────────────────────────────────────────────

describe('mergeParams', () => {
  it('preserves every untouched key', () => {
    const out = mergeParams(new URLSearchParams('week=2026-08-03&d=2026-08-06'),
                            { [EARNINGS_PARAM]: 'NVDA' })
    expect(out.get('week')).toBe('2026-08-03')
    expect(out.get('d')).toBe('2026-08-06')
    expect(out.get(EARNINGS_PARAM)).toBe('NVDA')
  })

  it('deletes on null and on empty string, and never mutates its input', () => {
    const src = new URLSearchParams('week=w&earnings=NVDA&esection=brief')
    const out = mergeParams(src, { [EARNINGS_PARAM]: null, [SECTION_PARAM]: '' })
    expect(out.has(EARNINGS_PARAM)).toBe(false)
    expect(out.has(SECTION_PARAM)).toBe(false)
    expect(out.get('week')).toBe('w')
    expect(src.get(EARNINGS_PARAM)).toBe('NVDA')   // input untouched
  })
})

describe('normalizeSym', () => {
  it('uppercases and accepts class shares', () => {
    expect(normalizeSym('nvda')).toBe('NVDA')
    expect(normalizeSym(' brk-b ')).toBe('BRK-B')
    expect(normalizeSym('brk.b')).toBe('BRK.B')
  })
  it('rejects junk rather than opening a modal on it', () => {
    expect(normalizeSym('')).toBeNull()
    expect(normalizeSym(null)).toBeNull()
    expect(normalizeSym('1NVDA')).toBeNull()
    expect(normalizeSym('TOOLONGSYM')).toBeNull()
    expect(normalizeSym('<script>')).toBeNull()
  })
})

describe('isRoutedPath', () => {
  it('honours exactly the two calendar surfaces', () => {
    expect(isRoutedPath('/calendar')).toBe(true)
    expect(isRoutedPath('/calendar/')).toBe(true)
    expect(isRoutedPath('/calendar/mystocks')).toBe(true)
    expect(isRoutedPath('/dashboard')).toBe(false)
    expect(isRoutedPath('/research/NVDA')).toBe(false)
  })
})

describe('resolveFeedEntry', () => {
  const days = {
    '2026-08-05': { bmo: [{ sym: 'AAPL' }], amc: [], tbd: [] },
    '2026-08-06': { bmo: [], amc: [{ sym: 'NVDA' }], tbd: [{ sym: 'ZZZ' }] },
  }
  it('finds the entry with its day and session', () => {
    expect(resolveFeedEntry('NVDA', days)).toEqual({ entry: { sym: 'NVDA' }, ds: '2026-08-06', timing: 'amc' })
    expect(resolveFeedEntry('AAPL', days)).toEqual({ entry: { sym: 'AAPL' }, ds: '2026-08-05', timing: 'bmo' })
    expect(resolveFeedEntry('ZZZ', days).timing).toBe('tbd')
  })
  it('returns null for a name outside the loaded week', () => {
    expect(resolveFeedEntry('TSLA', days)).toBeNull()
    expect(resolveFeedEntry('NVDA', null)).toBeNull()
  })
})

// ── the hook ──────────────────────────────────────────────────────────────────

let api = null
function Probe({ enabled = true }) {
  const loc = useLocation()
  api = useEarningsModalRoute({ enabled, pathname: loc.pathname })
  return (
    <div>
      <span data-testid="search">{loc.search}</span>
      <span data-testid="sym">{api.sym ?? ''}</span>
      <span data-testid="section">{api.section ?? ''}</span>
      <span data-testid="routed">{String(api.routed)}</span>
    </div>
  )
}

// Real browser-backed history (exactly what <BrowserRouter> wires up
// internally: createBrowserHistory({ window, v5Compat: true })) instead of
// <MemoryRouter>. MemoryRouter's stack is entirely in-memory and never
// touches window.history, so window.history.back() in the "PUSHES/REPLACES"
// tests below would be a total no-op against it — Back-button semantics are
// a window.history-level contract that only a browser-backed history can
// exhibit. This mirrors production (Calendar.jsx runs under a real router)
// while leaving every assertion in this file unchanged.
const renderAt = (url, props = {}) => {
  window.history.replaceState(null, '', url)
  const history = createBrowserHistory({ window, v5Compat: true })
  return render(
    <HistoryRouter history={history}>
      <Routes>
        <Route path="/calendar" element={<Probe {...props} />} />
        <Route path="/calendar/mystocks" element={<Probe {...props} />} />
        <Route path="/dashboard" element={<Probe {...props} />} />
      </Routes>
    </HistoryRouter>,
  )
}

// jsdom's history.back()/forward()/go() traverse asynchronously (two queued
// macrotasks — see jsdom's SessionHistory#traverseByDelta) before `popstate`
// fires, unlike real browsers where the timing is opaque to test code. A
// single microtask tick isn't enough to observe the reverted state.
const flushHistoryTraversal = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
})

describe('useEarningsModalRoute', () => {
  it('reads ?earnings and &esection on a routed path', () => {
    renderAt('/calendar?week=2026-08-03&earnings=nvda&esection=brief')
    expect(screen.getByTestId('sym').textContent).toBe('NVDA')
    expect(screen.getByTestId('section').textContent).toBe('brief')
    expect(screen.getByTestId('routed').textContent).toBe('true')
  })

  it('ignores the param entirely off the two calendar surfaces', () => {
    renderAt('/dashboard?earnings=NVDA')
    expect(screen.getByTestId('sym').textContent).toBe('')
    expect(screen.getByTestId('routed').textContent).toBe('false')
  })

  it('ignores the param when explicitly disabled', () => {
    renderAt('/calendar?earnings=NVDA', { enabled: false })
    expect(screen.getByTestId('sym').textContent).toBe('')
  })

  it('open() preserves ?week and ?d', () => {
    renderAt('/calendar?week=2026-08-03&d=2026-08-06')
    act(() => api.open('NVDA'))
    const s = new URLSearchParams(screen.getByTestId('search').textContent)
    expect(s.get('week')).toBe('2026-08-03')
    expect(s.get('d')).toBe('2026-08-06')
    expect(s.get(EARNINGS_PARAM)).toBe('NVDA')
  })

  it('open() PUSHES so one Back closes the modal', async () => {
    renderAt('/calendar?week=2026-08-03')
    act(() => api.open('NVDA'))
    expect(screen.getByTestId('sym').textContent).toBe('NVDA')
    act(() => { window.history.back() })
    await flushHistoryTraversal()
    expect(screen.getByTestId('sym').textContent).toBe('')
    expect(new URLSearchParams(screen.getByTestId('search').textContent).get('week'))
      .toBe('2026-08-03')
  })

  it('step() REPLACES so Back still closes in one press after stepping', async () => {
    renderAt('/calendar?week=2026-08-03')
    act(() => api.open('NVDA'))
    act(() => api.step('AMD'))
    act(() => api.step('AVGO'))
    expect(screen.getByTestId('sym').textContent).toBe('AVGO')
    act(() => { window.history.back() })
    await flushHistoryTraversal()
    expect(screen.getByTestId('sym').textContent).toBe('')
  })

  it('setSection() REPLACES and keeps the symbol', async () => {
    renderAt('/calendar')
    act(() => api.open('NVDA'))
    act(() => api.setSection('history'))
    expect(screen.getByTestId('section').textContent).toBe('history')
    act(() => { window.history.back() })
    await flushHistoryTraversal()
    expect(screen.getByTestId('sym').textContent).toBe('')
  })

  it('open() clears a stale section from the previous symbol', () => {
    renderAt('/calendar?earnings=AMD&esection=call')
    act(() => api.open('NVDA'))
    expect(screen.getByTestId('section').textContent).toBe('')
  })

  it('close() on a deep-link entry strips both params without needing history', () => {
    renderAt('/calendar?week=2026-08-03&earnings=NVDA&esection=call')
    act(() => api.close())
    const s = new URLSearchParams(screen.getByTestId('search').textContent)
    expect(s.has(EARNINGS_PARAM)).toBe(false)
    expect(s.has(SECTION_PARAM)).toBe(false)
    expect(s.get('week')).toBe('2026-08-03')
  })

  it('jumpToWeek() REPLACES and preserves the open symbol', () => {
    renderAt('/calendar?earnings=NVDA')
    act(() => api.jumpToWeek('2026-09-07'))
    const s = new URLSearchParams(screen.getByTestId('search').textContent)
    expect(s.get('week')).toBe('2026-09-07')
    expect(s.get(EARNINGS_PARAM)).toBe('NVDA')
  })

  it('never writes an invalid symbol into the URL', () => {
    renderAt('/calendar')
    act(() => api.open('<script>'))
    expect(screen.getByTestId('search').textContent).toBe('')
  })
})
