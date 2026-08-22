// app/src/components/StalledLoadFallback.test.jsx
//
// The route-level Suspense fallback's stall recovery (2026-08-22 stress
// repro). A lazy chunk that never settles used to strand "Loading page"
// forever; after 20s of continuous mounting the splash must swap to a
// recovery panel whose Reload button does a real document reload — the only
// thing that can retry a hung React.lazy import (its promise is cached, so a
// remount/key-bump cannot).
//
// Location mocking: no prior location-mock idiom exists in this repo's tests
// (grep 2026-08-22; StockChart.jsx ~L12437 documents that raw jsdom makes
// Location unforgeable, which is why its marker click uses window.open).
// Under vitest's jsdom environment, however, `window.location` IS a
// configurable property of the populated global (probe-verified), so the
// standard Object.defineProperty swap works and is used here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import StalledLoadFallback, { STALL_MS } from './StalledLoadFallback'

const realLocation = window.location

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, reload: vi.fn(), href: String(realLocation.href) },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
  })
  vi.useRealTimers()
})

describe('StalledLoadFallback', () => {
  it('renders BrandSplash initially — exactly what the plain fallback showed', () => {
    render(<StalledLoadFallback />)
    // BrandSplash renders role="status" with the wordmark; no recovery panel.
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('UCT INTELLIGENCE')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reload/i })).not.toBeInTheDocument()
  })

  it('is still the splash just under the threshold — no premature panel', () => {
    render(<StalledLoadFallback />)
    act(() => { vi.advanceTimersByTime(STALL_MS - 1) })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reload/i })).not.toBeInTheDocument()
  })

  it('after 20s of continuous mounting, swaps to the recovery panel', () => {
    render(<StalledLoadFallback />)
    act(() => { vi.advanceTimersByTime(STALL_MS) })
    expect(screen.getByText('This page is taking too long to load.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back to dashboard/i })).toBeInTheDocument()
    // The splash is gone — the panel replaces it, not overlays it.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('Reload triggers a real document reload — the only recovery for a hung lazy import', () => {
    render(<StalledLoadFallback />)
    act(() => { vi.advanceTimersByTime(STALL_MS) })
    fireEvent.click(screen.getByRole('button', { name: /^reload$/i }))
    expect(window.location.reload).toHaveBeenCalledTimes(1)
  })

  it('Back to dashboard is a FULL navigation (window.location.href), not client-side routing', () => {
    render(<StalledLoadFallback />)
    act(() => { vi.advanceTimersByTime(STALL_MS) })
    fireEvent.click(screen.getByRole('button', { name: /back to dashboard/i }))
    expect(window.location.href).toBe('/dashboard')
  })

  it('unmount (route resolved) cancels the timer — a fast route never trips the panel later', () => {
    const { unmount } = render(<StalledLoadFallback />)
    act(() => { vi.advanceTimersByTime(STALL_MS / 2) })
    unmount()
    // If the timeout were not cleared, this would setState on an unmounted
    // component (React warns → surfaces in strict CI). Advancing past the
    // threshold after unmount must be a no-op.
    act(() => { vi.advanceTimersByTime(STALL_MS * 2) })
    expect(vi.getTimerCount()).toBe(0)
  })
})
