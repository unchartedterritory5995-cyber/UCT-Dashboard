import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent } from '../../test-utils'

// Regression for a dead-end CTA: PaywallTeaser is shown ONLY to non-paid
// users (ResearchPage.jsx: `if (!isPaid) return <PaywallTeaser>`), but its
// "Upgrade to unlock" button used to route to /settings?section=billing —
// a page AuthGuard immediately bounces non-paid users away from (back to
// /morning-wire, with the earnings symbol and intent lost). /subscribe is
// the free-accessible equivalent (mirrors the locked NavBar/MoreSheet CTAs).
const navigateSpy = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigateSpy }
})

import PaywallTeaser from './PaywallTeaser'

describe('PaywallTeaser', () => {
  beforeEach(() => {
    navigateSpy.mockClear()
  })

  it('renders the symbol-personalized headline', () => {
    renderWithProviders(<PaywallTeaser sym="NVDA" />)
    expect(screen.getByText(/Unlock NVDA Research/i)).toBeInTheDocument()
  })

  it('routes the Upgrade CTA to the free-accessible /subscribe page, never /settings', () => {
    renderWithProviders(<PaywallTeaser sym="NVDA" />)
    fireEvent.click(screen.getByRole('button', { name: /Upgrade to unlock/i }))
    expect(navigateSpy).toHaveBeenCalledWith('/subscribe')
    expect(navigateSpy).not.toHaveBeenCalledWith(expect.stringContaining('/settings'))
  })
})
