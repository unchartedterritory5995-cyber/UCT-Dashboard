// Chart Comparison Picker Convergence V1 (2026-09-07) -- ComparisonPicker.jsx's
// first-ever direct test coverage. Adds a canonical /api/ticker-search dropdown
// alongside the existing free-text "Add" escape hatch and the existing
// POPULAR_TICKERS quick-pick row, all funneling into the SAME addComparison
// path (per the program's own "no two overlay mechanisms" requirement).
//
// Real timers throughout (established this session's convention) -- fake
// timers break Testing Library's own setTimeout-based asyncUtilTimeout.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import ComparisonPicker from './ComparisonPicker'

const DEBOUNCE_WAIT_MS = 220 // useTickerSuggest's debounce is 150ms

async function waitDebounce(ms = DEBOUNCE_WAIT_MS) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)) })
}

function mockSearch(results) {
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ results }),
  }))
}

afterEach(() => {
  delete global.fetch
})

describe('ComparisonPicker -- quick picks (unchanged)', () => {
  it('clicking a quick pick calls onUpdate with it appended', () => {
    const onUpdate = vi.fn()
    render(<ComparisonPicker comparisons={[]} onUpdate={onUpdate} onClose={() => {}} currentSym="NVDA" />)
    fireEvent.click(screen.getByRole('button', { name: 'QQQ' }))
    expect(onUpdate).toHaveBeenCalledWith([expect.objectContaining({ sym: 'QQQ', enabled: true })])
  })

  it('the current symbol never appears as a quick pick', () => {
    render(<ComparisonPicker comparisons={[]} onUpdate={() => {}} onClose={() => {}} currentSym="QQQ" />)
    expect(screen.queryByRole('button', { name: 'QQQ' })).not.toBeInTheDocument()
  })

  it('an already-added symbol no longer appears as a quick pick', () => {
    render(
      <ComparisonPicker
        comparisons={[{ sym: 'SPY', color: '#fff', enabled: true }]}
        onUpdate={() => {}}
        onClose={() => {}}
        currentSym="NVDA"
      />,
    )
    expect(screen.queryByRole('button', { name: 'SPY' })).not.toBeInTheDocument()
  })

  it('quick picks disappear once MAX_COMPARISONS (5) is reached', () => {
    const five = ['A', 'B', 'C', 'D', 'E'].map(sym => ({ sym, color: '#fff', enabled: true }))
    render(<ComparisonPicker comparisons={five} onUpdate={() => {}} onClose={() => {}} currentSym="NVDA" />)
    expect(screen.queryByRole('button', { name: 'QQQ' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Max reached')).toBeDisabled()
  })
})

describe('ComparisonPicker -- canonical search', () => {
  it('the input is a combobox', () => {
    render(<ComparisonPicker comparisons={[]} onUpdate={() => {}} onClose={() => {}} currentSym="NVDA" />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('typing a query shows canonical search results', async () => {
    mockSearch([{ ticker: 'MSFT', name: 'Microsoft Corp' }])
    render(<ComparisonPicker comparisons={[]} onUpdate={() => {}} onClose={() => {}} currentSym="NVDA" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'msft' } })
    await waitDebounce()
    expect(await screen.findByText('Microsoft Corp')).toBeInTheDocument()
    // the free-text input auto-uppercases, same as before this program
    expect(screen.getByRole('combobox')).toHaveValue('MSFT')
  })

  it('clicking a search result calls onUpdate via the same path as a quick pick', async () => {
    mockSearch([{ ticker: 'MSFT', name: 'Microsoft Corp' }])
    const onUpdate = vi.fn()
    render(<ComparisonPicker comparisons={[]} onUpdate={onUpdate} onClose={() => {}} currentSym="NVDA" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'MSFT' } })
    await waitDebounce()
    fireEvent.click(await screen.findByText('Microsoft Corp'))
    expect(onUpdate).toHaveBeenCalledWith([expect.objectContaining({ sym: 'MSFT', enabled: true })])
  })

  it('the current symbol is excluded from search results even when the backend returns it', async () => {
    mockSearch([{ ticker: 'NVDA', name: 'NVIDIA Corp' }, { ticker: 'NVDL', name: 'NVIDIA 2x' }])
    render(<ComparisonPicker comparisons={[]} onUpdate={() => {}} onClose={() => {}} currentSym="NVDA" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'NV' } })
    await waitDebounce()
    await screen.findByText('NVIDIA 2x')
    expect(screen.queryByText('NVIDIA Corp')).not.toBeInTheDocument()
  })

  it('an already-added symbol is excluded from search results too', async () => {
    mockSearch([{ ticker: 'SPY', name: 'SPDR S&P 500' }, { ticker: 'SPYG', name: 'SPDR Growth' }])
    render(
      <ComparisonPicker
        comparisons={[{ sym: 'SPY', color: '#fff', enabled: true }]}
        onUpdate={() => {}}
        onClose={() => {}}
        currentSym="NVDA"
      />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SP' } })
    await waitDebounce()
    await screen.findByText('SPDR Growth')
    expect(screen.queryByText('SPDR S&P 500')).not.toBeInTheDocument()
  })

  it('no results shows an honest empty state, and the raw-typed "Add" escape hatch still works', async () => {
    mockSearch([])
    const onUpdate = vi.fn()
    render(<ComparisonPicker comparisons={[]} onUpdate={onUpdate} onClose={() => {}} currentSym="NVDA" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ZZZZ' } })
    await waitDebounce()
    // useTickerSuggest always appends a synthetic typed-fallback row when there's
    // no exact match, so "No matches" only shows before that lands -- the escape
    // hatch itself (the visible "Add anyway" row, or the Add button) still works.
    expect(await screen.findByText('Add anyway')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onUpdate).toHaveBeenCalledWith([expect.objectContaining({ sym: 'ZZZZ', enabled: true })])
  })

  it('a request failure degrades honestly -- quick picks remain fully usable', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')))
    const onUpdate = vi.fn()
    render(<ComparisonPicker comparisons={[]} onUpdate={onUpdate} onClose={() => {}} currentSym="NVDA" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'MSFT' } })
    await waitDebounce()
    // Quick picks below are untouched by the failed search request.
    fireEvent.click(screen.getByRole('button', { name: 'QQQ' }))
    expect(onUpdate).toHaveBeenCalledWith([expect.objectContaining({ sym: 'QQQ', enabled: true })])
  })

  it('a stale response never overwrites a newer query\'s results', async () => {
    const resolvers = {}
    global.fetch = vi.fn((url) => {
      const q = new URL(String(url), 'http://x').searchParams.get('q')
      return new Promise((resolve) => { resolvers[q] = resolve })
    })
    render(<ComparisonPicker comparisons={[]} onUpdate={() => {}} onClose={() => {}} currentSym="NVDA" />)
    const input = screen.getByRole('combobox')

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
    expect(await screen.findByText('Apple Inc.')).toBeInTheDocument()
  })
})

describe('ComparisonPicker -- keyboard / accessibility', () => {
  it('ArrowDown/ArrowUp move the highlighted option, and Enter selects it', async () => {
    mockSearch([{ ticker: 'AAPL', name: 'Apple Inc.' }, { ticker: 'AMD', name: 'Advanced Micro Devices' }])
    const onUpdate = vi.fn()
    render(<ComparisonPicker comparisons={[]} onUpdate={onUpdate} onClose={() => {}} currentSym="NVDA" />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'A' } })
    await waitDebounce()
    await screen.findByText('Advanced Micro Devices')

    // useTickerSuggest appends a synthetic typed-fallback row after any
    // non-exact-match server results, so with query "A" the list is
    // [AAPL, AMD, A(typed)] -- one ArrowDown from index 0 lands on AMD.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onUpdate).toHaveBeenCalledWith([expect.objectContaining({ sym: 'AMD', enabled: true })])
  })

  it('Escape clears the search and closes the dropdown', async () => {
    mockSearch([{ ticker: 'AAPL', name: 'Apple Inc.' }])
    render(<ComparisonPicker comparisons={[]} onUpdate={() => {}} onClose={() => {}} currentSym="NVDA" />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'AAPL' } })
    await waitDebounce()
    await screen.findByText('Apple Inc.')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('combobox ARIA attributes reflect open/highlighted state', async () => {
    mockSearch([{ ticker: 'AAPL', name: 'Apple Inc.' }])
    render(<ComparisonPicker comparisons={[]} onUpdate={() => {}} onClose={() => {}} currentSym="NVDA" />)
    const input = screen.getByRole('combobox')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    fireEvent.change(input, { target: { value: 'AAPL' } })
    await waitDebounce()
    await screen.findByText('Apple Inc.')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant')
  })
})

describe('ComparisonPicker -- existing list behavior (unchanged)', () => {
  it('remove/toggle/color still work on already-added comparisons', () => {
    const onUpdate = vi.fn()
    render(
      <ComparisonPicker
        comparisons={[{ sym: 'SPY', color: '#60a5fa', enabled: true }]}
        onUpdate={onUpdate}
        onClose={() => {}}
        currentSym="NVDA"
      />,
    )
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onUpdate).toHaveBeenLastCalledWith([expect.objectContaining({ sym: 'SPY', enabled: false })])

    fireEvent.click(screen.getByRole('button', { name: 'Remove SPY' }))
    expect(onUpdate).toHaveBeenLastCalledWith([])
  })

  it('with zero comparisons, shows the empty-list message', () => {
    render(<ComparisonPicker comparisons={[]} onUpdate={() => {}} onClose={() => {}} currentSym="NVDA" />)
    expect(screen.getByText('No comparisons yet. Add a ticker above.')).toBeInTheDocument()
  })

  it('the close button calls onClose', () => {
    const onClose = vi.fn()
    render(<ComparisonPicker comparisons={[]} onUpdate={() => {}} onClose={onClose} currentSym="NVDA" />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
