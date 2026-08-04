import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import IdentityBanner, { LIFECYCLE_STATES, normalizeLifecycle, timingVariant } from './IdentityBanner'

const base = {
  sym: 'NVDA',
  company: 'NVIDIA Corporation',
  sector: 'Technology',
  timingText: 'Reports tonight AMC · confirmed · call 5:00 PM ET',
  resultText: 'Beat $0.98 vs $0.94 · +4.2% AH',
  countdown: <span data-testid="countdown">4h 12m</span>,
  price: <span data-testid="price">$182.40</span>,
  grade: <span data-testid="grade">B+</span>,
  guidance: <span data-testid="guidance">RAISED · from the call recap</span>,
}

describe('lifecycle helpers (§4.5)', () => {
  it('publishes the five states', () => {
    expect(LIFECYCLE_STATES).toEqual(['PRE', 'IMMINENT', 'PRINTED', 'CALL_LIVE', 'POST'])
  })

  it('normalises case and falls back to PRE on anything unknown', () => {
    expect(normalizeLifecycle('post')).toBe('POST')
    expect(normalizeLifecycle('nonsense')).toBe('PRE')
    expect(normalizeLifecycle(null)).toBe('PRE')
  })

  it('maps each state to its line variant', () => {
    expect(timingVariant('PRE')).toBe('countdown')
    expect(timingVariant('IMMINENT')).toBe('awaiting')
    expect(timingVariant('PRINTED')).toBe('result')
    expect(timingVariant('CALL_LIVE')).toBe('result')
    expect(timingVariant('POST')).toBe('result')
  })
})

describe('IdentityBanner', () => {
  beforeEach(() => { global.fetch = vi.fn() })

  it('renders the identity block', () => {
    render(<IdentityBanner {...base} />)
    expect(screen.getByText('NVDA')).toBeInTheDocument()
    expect(screen.getByText('NVIDIA Corporation')).toBeInTheDocument()
    expect(screen.getByText('Technology')).toBeInTheDocument()
  })

  it('PRE: timing line plus the countdown slot', () => {
    render(<IdentityBanner {...base} lifecycle="PRE" />)
    expect(screen.getByTestId('rk-banner-line')).toHaveTextContent('Reports tonight AMC')
    expect(screen.getByTestId('countdown')).toBeInTheDocument()
  })

  it('IMMINENT: no stale "Reports tonight" copy and no countdown survive past T0 (§4.5.2)', () => {
    render(<IdentityBanner {...base} lifecycle="IMMINENT" />)
    expect(screen.getByTestId('rk-banner-line')).toHaveTextContent('Awaiting numbers…')
    expect(screen.queryByText(/Reports tonight/)).toBeNull()
    expect(screen.queryByTestId('countdown')).toBeNull()
  })

  it('PRINTED: the line flips to the result — pure data (§4.2)', () => {
    render(<IdentityBanner {...base} lifecycle="PRINTED" />)
    expect(screen.getByTestId('rk-banner-line')).toHaveTextContent('Beat $0.98 vs $0.94 · +4.2% AH')
    expect(screen.queryByTestId('countdown')).toBeNull()
  })

  it('PRINTED with no result yet says "Reported", never an empty line', () => {
    render(<IdentityBanner {...base} lifecycle="PRINTED" resultText={null} />)
    expect(screen.getByTestId('rk-banner-line')).toHaveTextContent('Reported')
  })

  it('renders the guidance chip ONLY in POST (it is never inferred, §4.2)', () => {
    const { rerender } = render(<IdentityBanner {...base} lifecycle="PRINTED" />)
    expect(screen.queryByTestId('guidance')).toBeNull()
    rerender(<IdentityBanner {...base} lifecycle="POST" />)
    expect(screen.getByTestId('guidance')).toBeInTheDocument()
  })

  it('renders the price and grade slots in every state', () => {
    for (const state of LIFECYCLE_STATES) {
      const { unmount } = render(<IdentityBanner {...base} lifecycle={state} />)
      expect(screen.getByTestId('price')).toBeInTheDocument()
      expect(screen.getByTestId('grade')).toBeInTheDocument()
      unmount()
    }
  })

  it('has exactly ONE ticking element across the whole state machine (§3.1)', () => {
    const ticking = LIFECYCLE_STATES.filter((state) => {
      const { container, unmount } = render(<IdentityBanner {...base} lifecycle={state} />)
      const has = !!container.querySelector('[data-testid="countdown"]')
      unmount()
      return has
    })
    expect(ticking).toEqual(['PRE'])
  })

  it('fetches nothing — it is a display component (§4.5)', () => {
    render(<IdentityBanner {...base} lifecycle="POST" />)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('is a banner landmark on near-opaque chrome', () => {
    const { container } = render(<IdentityBanner {...base} />)
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(container.firstChild.tagName).toBe('HEADER')
  })
})
