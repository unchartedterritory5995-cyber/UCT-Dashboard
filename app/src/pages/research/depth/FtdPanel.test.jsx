// FT-068 — the fails-to-deliver panel, asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DepthTab from './DepthTab'

const pt = (d, q, px) => ({ settle_date: d, quantity: q, price: px, value: Math.round(q * px * 100) / 100 })
const OK = {
  ticker: 'GME', state: 'ok', source: 'SEC fails-to-deliver data',
  basis: 'Each figure is the aggregate fails-to-deliver BALANCE on that settlement date, not the day\'s new fails; balances are never summed across days.',
  window: { from: '2026-08-17', through: '2026-09-15' },
  points: [pt('2026-08-17', 56718, 18.66), pt('2026-09-02', 2570429, 18.81)],
  latest: pt('2026-09-02', 2570429, 18.81), peak: pt('2026-09-02', 2570429, 18.81), days_reported: 2, mismatched_files: [],
}
let body
beforeEach(() => {
  body = OK
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderTab = (flags = { ftd_dataset_enabled: true }) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <DepthTab sym="gme" flags={flags} />
  </SWRConfig>,
)

describe('FtdPanel', () => {
  it('is not rendered when its flag is off', () => {
    renderTab({})
    expect(screen.queryByTestId('ftd-panel')).not.toBeInTheDocument()
  })

  it('states the latest balance, the peak and the window, newest row first', async () => {
    renderTab()
    const s = (await screen.findByTestId('ftd-summary')).textContent
    expect(s).toContain('Latest balance 2,570,429 shares')
    expect(s).toContain('between 2026-08-17 and 2026-09-15')
    expect(screen.getAllByTestId('ftd-row')[0].textContent).toContain('2026-09-02')
    expect(screen.getByTestId('ftd-basis').textContent).toMatch(/never summed/)
  })

  it('nothing ingested and nothing reported read differently', async () => {
    body = { state: 'not_ingested', reason: 'no fails-to-deliver file has been ingested yet', basis: 'b', source: 's' }
    renderTab()
    expect((await screen.findByTestId('ftd-not-ingested')).textContent).toMatch(/ingested yet/)
    cleanup()
    body = { state: 'none_reported', reason: 'no fails reported for GME between 2026-08-17 and 2026-09-15', basis: 'b', source: 's' }
    renderTab()
    expect((await screen.findByTestId('ftd-none')).textContent).toMatch(/^No fails reported/) // a server reason reads as a sentence
  })
})

// 2026-10-07 completeness audit: a failed read is drawn as an error with a working Retry, never as
// an empty or "nothing reported" state.
describe('FtdPanel — a failed read', () => {
  it('a 503 reads as unavailable with Retry, and Retry reads again', async () => {
    const good = body
    let calls = 0
    global.fetch = vi.fn(() => {
      calls += 1
      return calls === 1
        ? Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ detail: 'down' }) })
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(good) })
    })
    renderTab()
    const err = await screen.findByTestId('ftd-unavailable')
    expect(err.textContent).toMatch(/unavailable right now/)
    expect(screen.queryByTestId('ftd-none')).toBeNull()
    expect(screen.queryByTestId('ftd-not-ingested')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findAllByTestId('ftd-summary')).not.toHaveLength(0)
    expect(screen.queryByTestId('ftd-unavailable')).toBeNull()
  })

  it('a none-reported state with no reason still reads as a sentence', async () => {
    body = { state: 'none_reported', basis: 'b', source: 's' }
    renderTab()
    expect((await screen.findByTestId('ftd-none')).textContent).toMatch(/No fails reported for/)
  })
})
