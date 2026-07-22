// app/src/pages/charts/widgets/LeverageInverseControl.test.jsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import LeverageInverseControl from './LeverageInverseControl'

const FAMILY = {
  underlying: 'NBIS',
  long: [
    { ticker: 'NBIL', name: 'GraniteShares 2x Long NBIS Daily ETF', factor: 2, avg_dollar_vol: 4.82e7 },
    { ticker: 'NEBX', name: 'Tradr 2X Long NBIS Daily ETF', factor: 2, avg_dollar_vol: 1.2e7 },
  ],
  short: [{ ticker: 'NBIZ', name: 'Tradr 2X Short NBIS Daily ETF', factor: 2, avg_dollar_vol: 9.3e6 }],
  best_long: 'NBIL', best_short: 'NBIZ',
}
const EMPTY = { underlying: null, long: [], short: [], best_long: null, best_short: null }

beforeEach(() => { global.fetch = vi.fn(async () => ({ ok: true, json: async () => FAMILY })) })

describe('LeverageInverseControl', () => {
  it('renders nothing when the symbol has no family', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => EMPTY }))
    const { container } = render(<LeverageInverseControl sym="KO" onSelect={() => {}} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('one click swaps to the most-liquid long / short / stock', async () => {
    const onSelect = vi.fn()
    render(<LeverageInverseControl sym="NBIS" onSelect={onSelect} />)
    await screen.findByRole('button', { name: /2X ↑/i })
    fireEvent.click(screen.getByRole('button', { name: /2X ↑/i }))
    expect(onSelect).toHaveBeenCalledWith('NBIL')          // best_long, not first-listed
    fireEvent.click(screen.getByRole('button', { name: /2X ↓/i }))
    expect(onSelect).toHaveBeenCalledWith('NBIZ')
  })

  it('reverse seat: charting NBIL lights LONG, STOCK returns underlying', async () => {
    const onSelect = vi.fn()
    render(<LeverageInverseControl sym="NBIL" onSelect={onSelect} />)
    const stock = await screen.findByRole('button', { name: /stock/i })
    fireEvent.click(stock)
    expect(onSelect).toHaveBeenCalledWith('NBIS')
  })

  it('panel lists every fund liquidity-desc with the ★ on best per side', async () => {
    render(<LeverageInverseControl sym="NBIS" onSelect={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /more single-stock etfs/i }))
    const rows = screen.getAllByRole('menuitem')
    expect(rows.map(r => r.textContent.slice(0, 4))).toEqual(['NBIL', 'NEBX', 'NBIZ'])
    expect(rows[0].textContent).toMatch(/most liquid/i)
    expect(rows[1].textContent).not.toMatch(/most liquid/i)
  })

  it('panel row click selects that specific fund (manual override)', async () => {
    const onSelect = vi.fn()
    render(<LeverageInverseControl sym="NBIS" onSelect={onSelect} />)
    fireEvent.click(await screen.findByRole('button', { name: /more single-stock etfs/i }))
    fireEvent.click(screen.getAllByRole('menuitem')[1])
    expect(onSelect).toHaveBeenCalledWith('NEBX')
  })

  it('side with no funds renders a disabled segment', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () =>
      ({ ...FAMILY, short: [], best_short: null }) }))
    render(<LeverageInverseControl sym="NBIS" onSelect={() => {}} />)
    const shortBtn = await screen.findByRole('button', { name: /↓/ })
    expect(shortBtn).toBeDisabled()
  })
})
