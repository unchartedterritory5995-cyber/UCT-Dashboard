// P2 Tier 3, Task 9 — the Report page's door reads the server's REAL GET /api/j2/wrapped/years.
//
// Every response is a fixture recorded by tools/notebook_contract_fixtures.py (`wrapped.years*`) and
// held current by tests/test_notebook_contract_fixtures.py. WrappedDoor.test.jsx proves the door is
// placed on the real Report page with a hand-typed list; this file proves it reads what the server
// actually sends, by rendered text. The recorded member has closed trades in 2026, 2025 and 2023;
// the fixture world's today is 2026-10-05 ET, so the clock is pinned there (and to December for the
// current-year door).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

import WrappedDoor from './WrappedDoor'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { contractBody, contractResponse } from '../__fixtures__/contract'

let fixture
let calls
const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T14:30:00Z'))              // the fixture world's frozen now
  latchNotebookFlags({ journal_tier3_enabled: true })
  fixture = 'wrapped.years'
  calls = []
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    calls.push(u)
    if (u === '/api/j2/wrapped/years') return contractResponse(fixture)
    throw new Error(`unexpected request ${u}`)
  })
})
afterEach(() => {
  __resetNotebookFlags()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function renderDoor() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter><WrappedDoor accountId={null} /></MemoryRouter>
    </SWRConfig>,
  )
}

describe('WrappedDoor reads the recorded GET /api/j2/wrapped/years', () => {
  it('in October: no current-year link, and a picker of the earlier recorded years', async () => {
    expect(contractBody('wrapped.years').years).toContain(2026)        // non-vacuity: the current year is sent
    renderDoor()
    const door = await screen.findByRole('navigation', { name: 'Your trading year' })
    expect(calls).toEqual(['/api/j2/wrapped/years'])
    const picker = within(door).getByRole('combobox', { name: 'Earlier years' })
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['2025', '2023'])
    const links = within(door).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['Your 2025 in trading'])
    expect(links[0].getAttribute('href')).toBe('/journal-2-0/wrapped/2025?account_id=_all_')
    expect(door.textContent).not.toContain('Your 2026 in trading')
  })

  it('from December 1: the current year opens beside the earlier years', async () => {
    vi.setSystemTime(new Date('2026-12-15T16:00:00Z'))
    renderDoor()
    const door = await screen.findByRole('navigation', { name: 'Your trading year' })
    const links = within(door).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['Your 2026 in trading', 'Your 2025 in trading'])
    expect(links[0].getAttribute('href')).toBe('/journal-2-0/wrapped/2026?account_id=_all_')
    expect(within(door).getAllByRole('option').map((o) => o.textContent)).toEqual(['2025', '2023'])
  })

  it('a member with no closed trades, in October: no door at all', async () => {
    fixture = 'wrapped.years.empty'
    renderDoor()
    await settle()
    expect(calls).toEqual(['/api/j2/wrapped/years'])                  // it asked, and was told none
    expect(screen.queryByRole('navigation', { name: 'Your trading year' })).not.toBeInTheDocument()
    expect(screen.queryByText(/in trading/)).not.toBeInTheDocument()
  })

  it('a refused member (402), in October: no door, never a picker of nothing', async () => {
    fixture = 'wrapped.years.free-plan'
    renderDoor()
    await settle()
    expect(calls).toEqual(['/api/j2/wrapped/years'])
    expect(screen.queryByRole('navigation', { name: 'Your trading year' })).not.toBeInTheDocument()
  })
})
