// Audit wave 2 (lane A, CATH P2 #6/#13/#20/#8): the terminal skeleton while loading in a panel,
// no "0 rows" while loading or on error, plain-English copy, a styled Retry.
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { TerminalPanelContext } from '../components/terminal'

vi.mock('../components/TickerPopup', () => ({ default: ({ sym }) => <span>{sym}</span> }))
import CatalystsHistory from './CatalystsHistory'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const wrap = (inPanel = false) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <MemoryRouter>
      {inPanel
        ? <TerminalPanelContext.Provider value={{ code: 'CATH', density: 'comfortable', inset: true }}><CatalystsHistory /></TerminalPanelContext.Provider>
        : <CatalystsHistory />}
    </MemoryRouter>
  </SWRConfig>,
)

describe('CATH wave 2', () => {
  it('loading in a panel is the terminal skeleton, with no "0 rows"', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    wrap(true)
    expect(screen.getByTestId('cath-loading').getAttribute('role')).toBe('status')
    expect(screen.queryByText(/0 rows/)).toBeNull()
  })

  it('an error shows no row count and a styled Retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    wrap()
    const err = await screen.findByTestId('cath-error')
    expect(screen.queryByText(/0 rows/)).toBeNull()
    expect(err.querySelector('button').className).not.toBe('')
  })

  it('plain English: no "persisting", "src" or "Vol×"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [{ ticker: 'XP', rank: 1, tag: 'Catalyst', thesis_text: 'Beat.', thesis_status: 'ok', gap_pct: 3, price: 28, thesis_sources: JSON.stringify(['a', 'b']) }] }) })
    wrap()
    await screen.findByText('1 row')
    expect(document.body.textContent).not.toMatch(/persisting|\bsrc\b|Vol×/)
    expect(document.body.textContent).toMatch(/2 sources/)
  })
})
