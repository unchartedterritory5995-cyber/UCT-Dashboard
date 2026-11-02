// The master gate on 2cd4c3839c failed with an unhandled "window is not defined": OpenChart cleared its
// "Opening…" state in a .finally() that ran after the card (and, in CI, the test environment) was gone.
// The state is now cleared only while the button still exists. Behaviour while mounted is unchanged.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import AgentResult from './AgentResult'

const view = { kind: 'text', text: 'Breadth reading', chart: { symbol: 'NASDAQ:A50', label: 'Nasdaq % above 50-day' } }

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Open chart outlives its card', () => {
  it('an open that finishes after the card unmounts AND the window is gone sets no state and raises nothing', async () => {
    let finish
    const onOpen = vi.fn(() => new Promise(r => { finish = r }))
    const { unmount } = render(<AgentResult view={view} onOpenChart={onOpen} />)
    fireEvent.click(screen.getByTestId('agent-open-chart'))
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    unmount()
    const rejected = []
    const onRej = (e) => { rejected.push(String(e && e.message || e)) }
    process.on('unhandledRejection', onRej)
    const win = globalThis.window
    try {
      delete globalThis.window                 // what CI's environment teardown does before the open settles
      finish()
      for (let i = 0; i < 5; i += 1) await new Promise(r => setTimeout(r, 0))
    } finally {
      globalThis.window = win
      process.off('unhandledRejection', onRej)
    }
    expect(rejected).toEqual([])
  })

  it('CONTROL: while mounted, the button shows busy during the open and clears after it', async () => {
    let finish
    const onOpen = vi.fn(() => new Promise(r => { finish = r }))
    render(<AgentResult view={view} onOpenChart={onOpen} />)
    const btn = screen.getByTestId('agent-open-chart')
    fireEvent.click(btn)
    await waitFor(() => expect(btn.getAttribute('aria-busy')).toBe('true'))
    await act(async () => { finish(); await Promise.resolve() })
    await waitFor(() => expect(btn.getAttribute('aria-busy')).toBe(null))
    expect(btn.disabled).toBe(false)
  })
})
