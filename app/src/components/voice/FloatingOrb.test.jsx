import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VoiceProvider } from '../../context/VoiceContext'
import FloatingOrb from './FloatingOrb'

// useOneShot pulls in MediaRecorder which jsdom doesn't have. Mock it cleanly.
vi.mock('../../hooks/useOneShot', () => ({
  default: () => ({ start: vi.fn(), stop: vi.fn() }),
}))

describe('FloatingOrb', () => {
  it('renders a button with mic label when idle', () => {
    render(<VoiceProvider><FloatingOrb /></VoiceProvider>)
    const btn = screen.getByRole('button')
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('aria-label')).toMatch(/ask/i)
  })

  it('mounts the orb component', () => {
    const { container } = render(<VoiceProvider><FloatingOrb /></VoiceProvider>)
    expect(container.querySelector('button')).toBeTruthy()
  })
})
