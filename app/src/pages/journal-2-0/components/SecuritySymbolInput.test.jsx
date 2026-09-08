import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import SecuritySymbolInput from './SecuritySymbolInput'

// Seam 17 remainder (Journal Symbol Input Assist V1, 2026-09-06): this file
// tests ONLY SecuritySymbolInput's own form-input behavior (search/debounce/
// keyboard nav/selection/disclosure states) -- never AddPositionModal/
// AddTradeModal's save/validation logic (covered in their own test files,
// which mock this component entirely for that reason).
//
// This is ASSISTIVE identity UX, not hard validation: free-form entry is
// always allowed, no search state ever blocks the input, and the component
// applies NO frontend dot/hyphen canonicalization of its own -- whatever the
// backend search contract returns (or doesn't) is exactly what's shown/used.
//
// Real timers throughout (mirrors CommandPalette.test.jsx), NOT vi.useFakeTimers()
// -- Testing Library's own asyncUtilTimeout ceiling (test-setup.js) is itself
// setTimeout-based, so faking timers here makes every findBy/waitFor hang
// until vitest's outer testTimeout instead of resolving normally.
const DEBOUNCE_WAIT_MS = 260 // component debounce is 200ms

function Harness({ initial = '' } = {}) {
  const [value, setValue] = useState(initial)
  return <SecuritySymbolInput value={value} onChange={setValue} />
}

async function waitDebounce(ms = DEBOUNCE_WAIT_MS) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)) })
}

afterEach(() => {
  delete global.fetch
})

describe('SecuritySymbolInput -- debounce + request shape', () => {
  it('issues a single debounced request for the final value after rapid typing', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'NVDA', name: 'NVIDIA Corp' }] }),
    }))
    render(<Harness />)
    const input = screen.getByPlaceholderText('e.g. NVDA')

    fireEvent.change(input, { target: { value: 'N' } })
    fireEvent.change(input, { target: { value: 'NV' } })
    fireEvent.change(input, { target: { value: 'NVDA' } })

    await waitDebounce()
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    expect(global.fetch.mock.calls[0][0]).toContain('q=NVDA')
  })

  it('never fetches for an empty/whitespace-only value', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }))
    render(<Harness />)
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: '   ' } })
    await waitDebounce()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('SecuritySymbolInput -- stale-response protection', () => {
  // Mirrors CommandPalette.test.jsx's own "a stale response never overwrites
  // a newer query's results" pattern: a hand-rolled fetch mock that does NOT
  // honor AbortSignal, so correctness here can only come from the reqIdRef
  // sequence guard, not from AbortController being respected.
  it('a stale response never overwrites a newer query\'s results, even when the fetch mock ignores AbortSignal', async () => {
    const resolvers = {}
    global.fetch = vi.fn((url) => {
      const q = new URL(String(url), 'http://x').searchParams.get('q')
      return new Promise((resolve) => { resolvers[q] = resolve })
    })
    render(<Harness />)
    const input = screen.getByPlaceholderText('e.g. NVDA')

    fireEvent.change(input, { target: { value: 'AA' } })
    await waitDebounce()
    fireEvent.change(input, { target: { value: 'AAPL' } })
    await waitDebounce()

    // The stale 'AA' request resolves AFTER 'AAPL' is already in flight.
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

describe('SecuritySymbolInput -- search states (found / no match / failed)', () => {
  it('shows suggestions when the search finds matches', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'NVDA', name: 'NVIDIA Corp' }] }),
    }))
    render(<Harness />)
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'NVDA' } })
    await waitDebounce()
    await screen.findByText('NVIDIA Corp')
    expect(screen.getByRole('option', { name: /NVDA/ })).toBeInTheDocument()
  })

  it('shows a light, non-blocking disclosure -- never a blocking error -- when nothing matches', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }))
    render(<Harness />)
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'ZZZZDELISTED' } })
    await waitDebounce()
    await screen.findByText('Not found in current search — you can still use this symbol.')
    expect(screen.queryByText(/invalid/i)).not.toBeInTheDocument()
    expect(input).not.toBeDisabled()
  })

  it('degrades silently to bare-input capability on a failed search -- no dropdown, no error text, input stays fully usable', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }))
    render(<Harness />)
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'NVDA' } })
    await waitDebounce()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument()
    expect(input).not.toBeDisabled()
    expect(input).toHaveValue('NVDA')
  })

  it('a network-level rejection (not just a non-ok response) also degrades silently', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')))
    render(<Harness />)
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'NVDA' } })
    await waitDebounce()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).not.toBeDisabled()
  })
})

describe('SecuritySymbolInput -- keyboard navigation', () => {
  function setup(results) {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results }) }))
    return render(<Harness />)
  }

  it('ArrowDown/ArrowUp move the highlighted option', async () => {
    setup([{ ticker: 'AAPL', name: 'Apple Inc.' }, { ticker: 'APPS', name: 'Digital Turbine' }])
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'APP' } })
    await waitDebounce()
    await screen.findByText('Digital Turbine')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /AAPL/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /APPS/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getByRole('option', { name: /AAPL/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('Enter selects the highlighted suggestion and writes the canonical symbol', async () => {
    setup([{ ticker: 'AAPL', name: 'Apple Inc.' }])
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'aap' } })
    await waitDebounce()
    await screen.findByText('Apple Inc.')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('AAPL')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('Enter with nothing arrow-navigated leaves the typed free-form text untouched (no forced selection)', async () => {
    setup([{ ticker: 'AAPL', name: 'Apple Inc.' }])
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'AAPLX' } })
    await waitDebounce()
    await screen.findByText('Apple Inc.')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('AAPLX')
  })

  it('Escape closes the dropdown without altering the typed value', async () => {
    setup([{ ticker: 'AAPL', name: 'Apple Inc.' }])
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'AAPL' } })
    await waitDebounce()
    await screen.findByText('Apple Inc.')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveValue('AAPL')
  })
})

describe('SecuritySymbolInput -- click/touch selection', () => {
  it('clicking a suggestion selects it and writes the canonical symbol', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'MSFT', name: 'Microsoft Corp' }] }),
    }))
    render(<Harness />)
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'msft' } })
    await waitDebounce()
    const row = await screen.findByText('Microsoft Corp')
    fireEvent.mouseDown(row)
    expect(input).toHaveValue('MSFT')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('SecuritySymbolInput -- free-form + identity safety', () => {
  it('always allows free-form entry -- typing is never restricted by search state', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }))
    render(<Harness />)
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'MYOLDDELISTEDTICKER' } })
    await waitDebounce()
    await screen.findByText(/not found in current search/i)
    expect(input).not.toBeDisabled()
    expect(input).toHaveValue('MYOLDDELISTEDTICKER')
  })

  it('an ordinary ticker match selects its canonical (uppercase) form', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'NVDA', name: 'NVIDIA Corp' }] }),
    }))
    render(<Harness />)
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'nvda' } })
    await waitDebounce()
    const row = await screen.findByText('NVIDIA Corp')
    fireEvent.mouseDown(row)
    expect(input).toHaveValue('NVDA')
  })

  it('a class-share result (BRK.B) selects verbatim -- the component performs no dot/hyphen rewriting of its own', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'BRK.B', name: 'Berkshire Hathaway Inc. Class B' }] }),
    }))
    render(<Harness />)
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'brk.b' } })
    await waitDebounce()
    const row = await screen.findByText('Berkshire Hathaway Inc. Class B')
    fireEvent.mouseDown(row)
    // Selection writes exactly what the search contract returned (upper-cased
    // for consistent display only) -- BRK.B in, BRK.B out. No BRK-B rewrite.
    expect(input).toHaveValue('BRK.B')
  })

  it('typing the hyphen form (BRK-B) free-form is never rewritten to a dot, and stays allowed with no match', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }))
    render(<Harness />)
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'BRK-B' } })
    await waitDebounce()
    await screen.findByText(/not found in current search/i)
    expect(input).toHaveValue('BRK-B')
  })

  it('a lowercase query still reaches the search contract unchanged (no case-folding before the request)', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }))
    render(<Harness />)
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'brk.b' } })
    await waitDebounce()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(global.fetch.mock.calls[0][0]).toContain('q=brk.b')
  })

  it('an unknown/delisted-like ticker with no search match still flows through as free-form text, unblocked', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }))
    render(<Harness />)
    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'XYZQDEAD' } })
    await waitDebounce()
    await screen.findByText(/not found in current search/i)
    expect(input).toHaveValue('XYZQDEAD')
    expect(input).not.toHaveAttribute('aria-invalid')
  })
})
