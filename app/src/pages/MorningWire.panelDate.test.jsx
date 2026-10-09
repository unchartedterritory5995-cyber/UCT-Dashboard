// Wave 2 (audit 2026-10-08): the WIRE panel header carries the wire's OWN date, so a stale wire
// (Monday morning, Friday's wire) does not read as today's.
import { renderWithProviders } from '../test-utils'
import { vi, describe, it, expect } from 'vitest'
import { PanelFreshnessContext } from '../components/terminal'

let rundownState
vi.mock('swr', () => ({
  default: vi.fn((key) => (key === '/api/rundown' ? { ...rundownState, mutate: vi.fn() } : { data: null })),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))
import MorningWire, { wireProvenance, WIRE_SOURCE } from './MorningWire'

describe('WIRE panel date', () => {
  it('reports the wire date to the panel header', () => {
    rundownState = { data: { html: '<p>x</p>', date: '2026-10-02' }, error: undefined }
    const set = vi.fn()
    renderWithProviders(<PanelFreshnessContext.Provider value={set}><MorningWire /></PanelFreshnessContext.Provider>)
    expect(set).toHaveBeenCalledWith({ source: WIRE_SOURCE, age: { dataClass: 'end_of_day', asOfDate: '2026-10-02' } })
  })

  it('a non-ISO date is shown as given; nothing landed or no date reports nothing', () => {
    expect(wireProvenance({ html: '<p/>', date: 'Friday, October 2' }).age.asOfDate).toBe('Friday, October 2')
    expect(wireProvenance({ html: '', date: '2026-10-02' })).toBeNull()
    expect(wireProvenance({ html: '<p/>', date: '' })).toBeNull()
    expect(wireProvenance(undefined)).toBeNull()
  })
})
