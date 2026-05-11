import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VoiceProvider } from '../../context/VoiceContext'
import FloatingOrb from './FloatingOrb'

vi.mock('../../hooks/useRealtimeSession', () => ({
  default: () => ({ connect: vi.fn(), disconnect: vi.fn(), isConnected: false }),
}))

describe('FloatingOrb', () => {
  it('renders a button with mic label when idle', () => {
    render(<VoiceProvider><FloatingOrb /></VoiceProvider>)
    const btn = screen.getByRole('button')
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('aria-label')).toMatch(/conversation/i)
  })

  it('mounts the orb component', () => {
    const { container } = render(<VoiceProvider><FloatingOrb /></VoiceProvider>)
    expect(container.querySelector('button')).toBeTruthy()
  })
})
