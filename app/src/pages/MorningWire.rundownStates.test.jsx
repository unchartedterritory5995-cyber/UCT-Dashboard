// WIRE: a failed rundown read and a not-yet-published wire each say so, instead of a
// 12-line skeleton that never ends (quality pass 2026-10-05).
import { renderWithProviders, screen } from '../test-utils'
import { vi, describe, it, expect } from 'vitest'

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

  it('a wire that is not out yet says when it publishes and that the page re-checks', () => {
    rundownState = { data: { html: '', date: '' }, error: undefined }
    renderWithProviders(<MorningWire />)
    expect(screen.getByTestId('rundown-not-out').textContent).toMatch(/not out yet.*7:35 AM ET.*every five minutes/s)
  })
})
