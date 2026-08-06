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

  it('RETRIES on image error before falling back — a transient miss never sticks', () => {
    vi.useFakeTimers()
    render(<CompanyLogo sym="ZZZZ" />)
    const img = screen.getByAltText('ZZZZ logo')
    // First error → NOT the monogram yet; it schedules a cache-busted retry.
    fireEvent.error(img)
    expect(screen.queryByText('Z')).toBeNull()
    // Drive the retries (MAX_RETRY = 3, 1800ms each): each re-render re-fetches with a
    // bumped _r cache-bust; keep erroring until the retry budget is spent.
    for (let i = 0; i < 4; i++) {
      act(() => { vi.advanceTimersByTime(1800) })
      const cur = screen.queryByAltText('ZZZZ logo')
      if (cur) fireEvent.error(cur)
    }
    // Budget exhausted → monogram.
    expect(screen.getByText('Z')).toBeInTheDocument()
  })
})
