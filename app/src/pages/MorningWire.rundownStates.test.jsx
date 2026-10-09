// WIRE: a failed rundown read and a not-yet-published wire each say so, instead of a
// 12-line skeleton that never ends (quality pass 2026-10-05).
import { renderWithProviders, screen, cleanup } from '../test-utils'
import { vi, describe, it, expect } from 'vitest'
import { TerminalPanelContext } from '../components/terminal'

let rundownState
vi.mock('swr', () => ({
  default: vi.fn((key) => (key === '/api/rundown' ? { ...rundownState, mutate: vi.fn() } : { data: null })),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))
import MorningWire from './MorningWire'

describe('rundown states', () => {
  it('a failed read says could-not-read with Retry', () => {
    rundownState = { data: undefined, error: Object.assign(new Error('x'), { status: 503 }) }
    renderWithProviders(<MorningWire />)
    expect(screen.getByTestId('rundown-error').textContent).toMatch(/could not be read right now/)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('inside a terminal panel (WIRE) the page title steps aside; outside it is the page heading', () => {
    rundownState = { data: { html: '', date: '' }, error: undefined }
    renderWithProviders(<MorningWire />)
    expect(screen.getByRole('heading', { name: 'Morning Wire' })).toBeInTheDocument()
    cleanup()
    renderWithProviders(
      <TerminalPanelContext.Provider value={{ code: 'WIRE', density: 'comfortable', inset: true }}>
        <MorningWire />
      </TerminalPanelContext.Provider>,
    )
    expect(screen.queryByRole('heading', { name: 'Morning Wire' })).toBeNull()
    expect(screen.getByTestId('rundown-not-out')).toBeInTheDocument()
  })

  it('a wire that is not out yet says when it publishes and that the page re-checks', () => {
    rundownState = { data: { html: '', date: '' }, error: undefined }
    renderWithProviders(<MorningWire />)
    expect(screen.getByTestId('rundown-not-out').textContent).toMatch(/not out yet.*7:35 AM ET.*every five minutes/s)
  })
})
