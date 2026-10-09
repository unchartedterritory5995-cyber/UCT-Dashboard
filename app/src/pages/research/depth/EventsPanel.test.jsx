// FT-064 — the events panel, asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DepthTab from './DepthTab'

const OK = {
  ticker: 'AAPL', state: 'ok', reason: null, offset_unit: 'weekdays (Mon-Fri; exchange holidays are not removed)',
  prints: [{ date: '2026-04-28', label: 'Q2', state: 'reported' }],
  events: [
    { date: '2026-04-24', kind: 'uct_catalyst', title: 'UCT catalyst engine: Earnings', detail: null,
      source: 'UCT catalyst engine (catalysts.db)', print_date: '2026-04-28', print_label: 'Q2', print_state: 'reported', offset: -2, stage: 'T-2' },
    { date: '2026-04-28', kind: 'earnings', title: 'Reported Q2', detail: 'EPS 1.1 vs 1.0 estimate',
      source: 'earnings payload (earnings_intel)', print_date: '2026-04-28', print_label: 'Q2', print_state: 'reported', offset: 0, stage: 'T' },
  ],
  sources: { earnings: { state: 'ok', events: 1 }, uct_catalyst: { state: 'ok', events: 1 }, filing: { state: 'empty', events: 0 }, room_spike: { state: 'error', error: 'OperationalError' } },
}
let body
beforeEach(() => {
  body = OK
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderTab = (flags = { events_timeline_enabled: true }) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <DepthTab sym="aapl" flags={flags} />
  </SWRConfig>,
)

describe('EventsPanel', () => {
  it('is not rendered when its flag is off', () => {
    renderTab({})
    expect(screen.queryByTestId('events-panel')).not.toBeInTheDocument()
  })

  it('stages each event against its print, newest first, and names its source', async () => {
    renderTab()
    const rows = await screen.findAllByTestId('event-row')
    expect(rows[0].textContent).toContain('T Q2')
    expect(rows[1].textContent).toContain('T-2 Q2')
    expect(rows[1].textContent).toContain('UCT catalyst engine')
    // the database file name is internal detail, not member copy (quality pass 2026-10-05)
    expect(rows[1].textContent).not.toContain('catalysts.db')
  })

  it('a source that could not be read is called missing, not absent', async () => {
    renderTab()
    expect((await screen.findByTestId('events-source-errors')).textContent).toContain('Could not read: Room')
  })

  it('prints the offset unit', async () => {
    renderTab()
    expect((await screen.findByTestId('events-unit')).textContent).toMatch(/holidays are not removed/)
    // audit wave 2: the stage notation itself is explained
    expect(screen.getByTestId('events-unit').textContent).toMatch(/T is the report day, T-2 two/)
  })

  it('unstaged events say why', async () => {
    body = { ...OK, state: 'unstaged', reason: 'no reported or scheduled print on file', events: [] , sources: {} }
    renderTab()
    expect((await screen.findByTestId('events-unstaged')).textContent).toMatch(/no reported or scheduled print/)
    expect(screen.getByTestId('events-empty')).toBeInTheDocument()
  })

  // tq-panels: "No events on file" showed while a source was still being read.
  it('a source still being read is named, and the empty line says it is still reading', async () => {
    body = { ...OK, state: 'unstaged', reason: 'earnings history is still being read', events: [],
      sources: { earnings: { state: 'pending' }, uct_catalyst: { state: 'empty', events: 0 } } }
    renderTab()
    expect((await screen.findByTestId('events-empty')).textContent)
      .toBe('No events on file yet: Earnings is still being read.')
    expect(screen.getByTestId('events-pending').textContent)
      .toBe('Still reading: Earnings. Events from that source appear when the read finishes.')
    expect(screen.queryByText('No events on file in the sources read.')).toBeNull()
  })
})

describe('EventsPanel in a terminal panel (wave 3 #3)', () => {
  it('an event kind opens the function holding its detail beside the panel; earnings stays plain', async () => {
    const { PanelListContext } = await import('../../../components/terminal')
    const { default: EventsPanel } = await import('./EventsPanel')
    const api = { open: vi.fn() }
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <PanelListContext.Provider value={api}><EventsPanel sym="aapl" /></PanelListContext.Provider>
      </SWRConfig>,
    )
    const btn = await screen.findByRole('button', { name: 'Open AAPL catalyst history (AAPL CATS)' })
    btn.click()
    expect(api.open).toHaveBeenCalledWith('AAPL CATS')
    expect(screen.queryByRole('button', { name: /AAPL ERN/ })).toBeNull()
  })

  it('CONTROL: outside the terminal the kind is plain text', async () => {
    renderTab()
    await screen.findAllByTestId('event-row')
    expect(screen.queryByRole('button', { name: /AAPL CATS/ })).toBeNull()
  })
})
