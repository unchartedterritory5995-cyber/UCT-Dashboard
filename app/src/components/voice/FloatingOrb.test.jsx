import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, act } from '../../test-utils'
import FloatingOrb from './FloatingOrb'

const { connectSpy } = vi.hoisted(() => ({ connectSpy: vi.fn() }))
vi.mock('../../hooks/useRealtimeSession', () => ({
  default: () => ({ connect: connectSpy, disconnect: vi.fn(), isConnected: false }),
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

describe('FloatingOrb idle edge-tuck', () => {
  const cluster = (container) => container.querySelector('div[class*="orbCluster"]')

  beforeEach(() => {
    vi.useFakeTimers()
    connectSpy.mockClear()
    // The first-run coachmark blocks tucking — mark it seen.
    localStorage.setItem('voice.orb.coachmarkSeen', '1')
    localStorage.removeItem('voice.orb.position')
    localStorage.removeItem('voice.orb.minimized')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('tucks into the edge after the idle delay', () => {
    const { container } = renderWithProviders(<FloatingOrb />)
    expect(cluster(container).className).not.toMatch(/tucked/)
    act(() => { vi.advanceTimersByTime(4100) })
    expect(cluster(container).className).toMatch(/tuckedRight/)
  })

  it('hover untucks and prevents re-tuck until the pointer leaves', () => {
    const { container } = renderWithProviders(<FloatingOrb />)
    act(() => { vi.advanceTimersByTime(4100) })
    expect(cluster(container).className).toMatch(/tucked/)
    fireEvent.pointerEnter(cluster(container))
    expect(cluster(container).className).not.toMatch(/tucked/)
    // Still hovered — the idle timer must not re-arm.
    act(() => { vi.advanceTimersByTime(10000) })
    expect(cluster(container).className).not.toMatch(/tucked/)
    // Leave → re-tucks after the delay.
    fireEvent.pointerLeave(cluster(container))
    act(() => { vi.advanceTimersByTime(4100) })
    expect(cluster(container).className).toMatch(/tucked/)
  })

  it('a tap on the tucked sliver wakes the orb without starting a session; the next tap connects', () => {
    const { container } = renderWithProviders(<FloatingOrb />)
    act(() => { vi.advanceTimersByTime(4100) })
    expect(cluster(container).className).toMatch(/tucked/)
    const orbBtn = screen.getByRole('button', { name: /conversation/i })
    fireEvent.pointerDown(cluster(container))
    fireEvent.click(orbBtn)
    expect(connectSpy).not.toHaveBeenCalled()
    expect(cluster(container).className).not.toMatch(/tucked/)
    fireEvent.click(orbBtn)
    expect(connectSpy).toHaveBeenCalledTimes(1)
  })
})
