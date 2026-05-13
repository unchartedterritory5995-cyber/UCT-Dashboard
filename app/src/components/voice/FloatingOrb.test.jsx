import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen } from '../../test-utils'
import FloatingOrb from './FloatingOrb'

vi.mock('../../hooks/useRealtimeSession', () => ({
  default: () => ({ connect: vi.fn(), disconnect: vi.fn(), isConnected: false }),
}))

describe('FloatingOrb', () => {
  it('renders the main conversation button with an appropriate aria-label', () => {
    renderWithProviders(<FloatingOrb />)
    // FloatingOrb renders a small menu of secondary buttons (settings cog,
    // close, etc.) alongside the main mic button. Scope to the labelled
    // conversation button to avoid the multi-match error.
    const btn = screen.getByRole('button', { name: /conversation/i })
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('aria-label')).toMatch(/conversation/i)
  })

  it('mounts the orb component', () => {
    const { container } = renderWithProviders(<FloatingOrb />)
    expect(container.querySelector('button')).toBeTruthy()
  })
})
