import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { TickerSearchInput } from './ChartExampleKit'

// Seam 14 (Ticker Search Surface Convergence, 2026-09-06): TickerSearchInput
// was rebuilt on the shared useTickerSuggest hook to fix two real, confirmed
// gaps -- zero keyboard navigation and zero stale-response protection --
// found during the dedicated Phase A. This covers the fix directly; the
// external prop contract ({value, onChange, onPick}) is unchanged, so
// ExampleForm's own tests need no update.
//
// Real timers throughout (established this session's convention) -- fake
// timers break Testing Library's own setTimeout-based asyncUtilTimeout.
const DEBOUNCE_WAIT_MS = 220 // useTickerSuggest's debounce is 150ms

function Harness() {
  const [value, setValue] = useState('')
  const onPick = vi.fn()
  return <TickerSearchInput value={value} onChange={setValue} onPick={onPick} />
}

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

describe('TickerSearchInput (ChartExampleKit) -- keyboard navigation (Seam 14 fix)', () => {
  it('ArrowDown/ArrowUp move the highlighted option, and Enter selects it', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'AAPL', name: 'Apple Inc.' }, { ticker: 'APPS', name: 'Digital Turbine' }] }),
    }))
    const onPick = vi.fn()
    render(<ControlledHarness onPick={onPick} />)
    const input = screen.getByPlaceholderText('Ticker')
    fireEvent.change(input, { target: { value: 'APP' } })
    await waitDebounce()
    await screen.findByText('Digital Turbine')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith({ ticker: 'APPS', name: 'Digital Turbine' })
  })

  it('Enter with nothing arrow-navigated does not call onPick -- lets the surrounding form submit as before', async () => {
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
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
  })

  it('Escape closes the dropdown', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'AAPL', name: 'Apple Inc.' }] }),
    }))
    render(<Harness />)
    const input = screen.getByPlaceholderText('Ticker')
    fireEvent.change(input, { target: { value: 'AAPL' } })
    await waitDebounce()
    await screen.findByText('Apple Inc.')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('combobox ARIA attributes reflect open/highlighted state', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'AAPL', name: 'Apple Inc.' }] }),
    }))
    render(<Harness />)
    const input = screen.getByPlaceholderText('Ticker')
    expect(input).toHaveAttribute('role', 'combobox')
    fireEvent.change(input, { target: { value: 'AAPL' } })
    await waitDebounce()
    await screen.findByText('Apple Inc.')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant')
  })
})

describe('TickerSearchInput (ChartExampleKit) -- stale-response protection (Seam 14 fix)', () => {
  it('a stale response never overwrites a newer query\'s results, even when the fetch mock ignores AbortSignal', async () => {
    const resolvers = {}
    global.fetch = vi.fn((url) => {
      const q = new URL(String(url), 'http://x').searchParams.get('q')
      return new Promise((resolve) => { resolvers[q] = resolve })
    })
    render(<Harness />)
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

describe('TickerSearchInput (ChartExampleKit) -- unchanged behavior', () => {
  it('onChange fires with the uppercased value on every keystroke (unchanged contract)', () => {
    render(<Harness />)
    const input = screen.getByPlaceholderText('Ticker')
    fireEvent.change(input, { target: { value: 'nvda' } })
    expect(input).toHaveValue('NVDA')
  })

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
