// app/src/components/CompanyLogo.test.jsx
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import CompanyLogo from './CompanyLogo'

describe('CompanyLogo', () => {
  afterEach(() => vi.useRealTimers())

  it('renders an img pointing at the logo endpoint', () => {
    render(<CompanyLogo sym="NVDA" />)
    const img = screen.getByAltText('NVDA logo')
    // URL carries a LOGO_ASSET_VERSION cache-bust param (e.g. ?v=2); match robustly.
    expect(img.getAttribute('src')).toMatch(/^\/api\/ticker-logo\/NVDA\?v=\d+/)
  })

  it('ALWAYS shows the monogram as a base — never an empty box', () => {
    render(<CompanyLogo sym="ZZZZ" />)
    // The monogram letter is present immediately, beneath the (not-yet-loaded) image,
    // so a cold/transient/just-deployed logo always shows a clean letter tile.
    expect(screen.getByText('Z')).toBeInTheDocument()
    expect(screen.getByAltText('ZZZZ logo')).toBeInTheDocument()
  })

  it('retries with a cache-busted URL on error — a transient miss never sticks', () => {
    vi.useFakeTimers()
    render(<CompanyLogo sym="ZZZZ" />)
    const img = screen.getByAltText('ZZZZ logo')
    const before = img.getAttribute('src')
    fireEvent.error(img)
    // First backoff elapses → re-render re-fetches with a bumped _r cache-bust.
    act(() => { vi.advanceTimersByTime(1000) })
    const after = screen.getByAltText('ZZZZ logo').getAttribute('src')
    expect(after).not.toBe(before)
    expect(after).toMatch(/_r=1/)
    // The monogram stays visible the whole time (never an empty box).
    expect(screen.getByText('Z')).toBeInTheDocument()
  })

  it('reveals the logo (fades out the monogram) once a REAL image loads', () => {
    render(<CompanyLogo sym="NVDA" />)
    const img = screen.getByAltText('NVDA logo')
    // A real (non-placeholder) logo: naturalWidth > 2.
    Object.defineProperty(img, 'naturalWidth', { value: 256, configurable: true })
    fireEvent.load(img)
    expect(screen.getByText('N')).toHaveStyle({ opacity: '0' })   // monogram hidden
    expect(img).toHaveStyle({ opacity: '1' })                      // logo shown
  })

  it('a cold 1x1 placeholder load does NOT reveal (keeps the monogram, schedules a retry)', () => {
    render(<CompanyLogo sym="ZZZZ" />)
    const img = screen.getByAltText('ZZZZ logo')
    Object.defineProperty(img, 'naturalWidth', { value: 1, configurable: true })
    fireEvent.load(img)
    // Placeholder → monogram stays visible, image stays hidden.
    expect(screen.getByText('Z')).toHaveStyle({ opacity: '1' })
    expect(img).toHaveStyle({ opacity: '0' })
  })
})
