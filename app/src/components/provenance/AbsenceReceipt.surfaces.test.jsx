// app/src/components/provenance/AbsenceReceipt.surfaces.test.jsx
//
// TERM-057 / FB-A8-03 "known it worked": the same question asked on two curated
// surfaces returns the same receipt from one component. This mounts the REAL
// Catalyst tile (Dashboard + Morning Wire) and the REAL research-page Catalysts
// tab, asks each why the same ticker is absent, and compares the rendered text.
//
// Nothing on the path under test is mocked: the tile's own hooks run against a
// stubbed network, so cutting the mount in either file goes red here even if
// AbsenceReceipt's own tests stay green.

import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, afterEach } from 'vitest'

import { AuthContext } from '../../context/AuthContext'
import { HubProvider } from '../../hub/HubContext'
import { _reset as resetCursors } from '../../hub/useHubCursor'

vi.mock('../voice/ReadAloudButton', () => ({ default: () => null }))
vi.mock('../../pages/research/hooks/useCatalystHistory', () => ({
  default: () => ({ data: { ticker: 'GXX', entries: [] }, isLoading: false }),
}))

const json = (body, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(body) })

const QUOTA_BODY = {
  ticker: 'GXX', found: true, verdict: 'quota_full', tag: 'Gapper',
  quota: { tag: 'Gapper', slots: 3, rank_in_tag: 5, in_tag: 6 },
  rank_among_scored: 22, total_scored: 30, score: 9.5, market_date: '2026-09-29',
  signal_summary: { gap_pct: 6.1 },
}

let explainCalls = []

function stubNetwork() {
  explainCalls = []
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (u.startsWith('/api/catalysts/explain/')) { explainCalls.push(u); return json(QUOTA_BODY) }
    if (u.startsWith('/api/catalysts/today')) {
      return json({ rows: [{ ticker: 'NVDA', tag: 'Earnings', grade: 'A', price: 120, gap_pct: 3, vol_x: 2, thesis_text: 't' }], market_date: '2026-09-29', refreshed_at: Math.floor(Date.now() / 1000) })
    }
    if (u.startsWith('/api/catalysts/my-feedback')) return json({ items: {} })
    if (u.startsWith('/api/watchlists')) return json([])
    return json({})
  }))
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetCursors() })

async function receiptFromTile() {
  stubNetwork()
  const { default: CatalystTable } = await import('../tiles/CatalystTable')
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthContext.Provider value={{ user: null, plan: null }}>
        <HubProvider>
          <CatalystTable />
        </HubProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
  fireEvent.click(screen.getByRole('button', { name: /Why isn't X on the list\?/ }))
  fireEvent.change(screen.getByLabelText('Ticker to check'), { target: { value: 'GXX' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check' })) })
  const r = screen.getByTestId('absence-receipt')
  const out = { kind: r.getAttribute('data-kind'), text: r.textContent }
  cleanup()
  return out
}

async function receiptFromResearchTab() {
  stubNetwork()
  const { default: CatalystsTab } = await import('../../pages/research/tabs/CatalystsTab')
  render(<CatalystsTab sym="GXX" />)
  const section = screen.getByTestId('catalyst-absence')
  expect(section).toHaveTextContent("Today's catalyst list")
  await act(async () => {
    fireEvent.click(within(section).getByRole('button', { name: "Why isn't GXX on today's catalyst list?" }))
  })
  const r = screen.getByTestId('absence-receipt')
  const out = { kind: r.getAttribute('data-kind'), text: r.textContent }
  cleanup()
  return out
}

describe('one receipt, two curated surfaces', () => {
  it('the Catalyst tile and the research Catalysts tab render the SAME receipt for the same question', async () => {
    const tile = await receiptFromTile()
    const tab = await receiptFromResearchTab()
    expect(explainCalls).toEqual(['/api/catalysts/explain/GXX'])   // the tab's own call (reset per surface)
    expect(tile.kind).toBe('quota_full')
    expect(tab).toEqual(tile)
    expect(tile.text).toContain("GXX missed today's catalyst list because the Gapper bucket was full.")
    expect(tile.text).toContain('The list takes 3 Gapper names. GXX ranked 5 of 6 Gapper names by score.')
  })

  it('the tile no longer carries its own widget: no raw JSON, no tile-local lookup copy', async () => {
    const tile = await receiptFromTile()
    expect(tile.text).not.toMatch(/[{}]/)
    expect(tile.text).not.toMatch(/not in candidate pool/)
  })
})
