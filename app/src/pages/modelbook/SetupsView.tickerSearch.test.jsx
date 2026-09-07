import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { TickerSearchInput } from './SetupsView'

// Seam 14 (Ticker Search Surface Convergence, 2026-09-06): mirrors
// shared/ChartExampleKit.tickerSearch.test.jsx -- SetupsView.jsx's own
// TickerSearchInput (previously a byte-identical copy-paste of ChartExampleKit's)
// was independently rebuilt on the shared useTickerSuggest hook, fixing the
// same two real gaps (zero keyboard nav, zero stale-response protection) while
// keeping its own CSS module (per this file's own header comment: the LOGIC
// converges, the two pages keep their own lightweight visual wrapper).
const DEBOUNCE_WAIT_MS = 220

function ControlledHarness({ onPick }) {
  const [value, setValue] = useState('')
  return <TickerSearchInput value={value} onChange={setValue} onPick={onPick} />
}

async function waitDebounce(ms = DEBOUNCE_WAIT_MS) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)) })
}

afterEach(() => {
  delete global.fetch
})

describe('TickerSearchInput (SetupsView) -- keyboard navigation (Seam 14 fix)', () => {
  it('ArrowDown + Enter selects the highlighted suggestion', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'AAPL', name: 'Apple Inc.' }] }),
    }))
    const onPick = vi.fn()
    render(<ControlledHarness onPick={onPick} />)
    const input = screen.getByPlaceholderText('Ticker')
    fireEvent.change(input, { target: { value: 'AAPL' } })
    await waitDebounce()
    await screen.findByText('Apple Inc.')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith({ ticker: 'AAPL', name: 'Apple Inc.' })
  })

  it('Escape closes the dropdown without calling onPick', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'AAPL', name: 'Apple Inc.' }] }),
    }))
    const onPick = vi.fn()
    render(<ControlledHarness onPick={onPick} />)
    const input = screen.getByPlaceholderText('Ticker')
    fireEvent.change(input, { target: { value: 'AAPL' } })
    await waitDebounce()
    await screen.findByText('Apple Inc.')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onPick).not.toHaveBeenCalled()
  })
})

describe('TickerSearchInput (SetupsView) -- stale-response protection (Seam 14 fix)', () => {
  it('a stale response never overwrites a newer query\'s results', async () => {
    const resolvers = {}
    global.fetch = vi.fn((url) => {
      const q = new URL(String(url), 'http://x').searchParams.get('q')
      return new Promise((resolve) => { resolvers[q] = resolve })
    })
    render(<ControlledHarness onPick={vi.fn()} />)
    const input = screen.getByPlaceholderText('Ticker')

    fireEvent.change(input, { target: { value: 'AA' } })
    await waitDebounce()
    fireEvent.change(input, { target: { value: 'AAPL' } })
    await waitDebounce()

    await act(async () => {
      resolvers['AA']?.({ ok: true, json: () => Promise.resolve({ results: [{ ticker: 'AAA', name: 'Stale Corp' }] }) })
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(screen.queryByText('Stale Corp')).toBeNull()

    await act(async () => {
      resolvers['AAPL']?.({ ok: true, json: () => Promise.resolve({ results: [{ ticker: 'AAPL', name: 'Apple Inc.' }] }) })
    })
    await screen.findByText('Apple Inc.')
  })
})

describe('TickerSearchInput (SetupsView) -- unchanged behavior', () => {
  it('clicking a suggestion still calls onPick with the full result object', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'MSFT', name: 'Microsoft Corp' }] }),
    }))
    const onPick = vi.fn()
    render(<ControlledHarness onPick={onPick} />)
    const input = screen.getByPlaceholderText('Ticker')
    fireEvent.change(input, { target: { value: 'msft' } })
    await waitDebounce()
    const row = await screen.findByText('Microsoft Corp')
    fireEvent.click(row)
    expect(onPick).toHaveBeenCalledWith({ ticker: 'MSFT', name: 'Microsoft Corp' })
  })
})
