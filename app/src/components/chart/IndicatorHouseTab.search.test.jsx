// ─── ⭐ A SEARCH ACROSS EVERY LIST REACHES THE UCT SET (2026-11-18) ───────────────────────────────
//
// Owner, after #1759 shipped Fred RS: "i still dont see fred's RS indicator as an option". The UCT set is its own
// file, loaded by the UCT tab only, so a search across every tab (the desktop window with no tab pinned, the
// sheet's "All indicators") never reached it: typing "Fred" said "Nothing matches". Both windows now mount the
// UCT tab in `searchOnly` mode under their search: the matching entries lead, under a "UCT" heading, and the
// "Nothing matches" line is never said over a match. These rails use the REAL windows and the REAL house files.
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import IndicatorHouseTab from './IndicatorHouseTab'
import { AuthContext } from '../../context/AuthContext'
import { mergeChartSettings } from './chartDefaults'
import * as engineRegistry from './engine/nativeRegistry'
import PINE from './house/housePineIndicators.json'
import HOUSE from './house/houseIndicators.json'

const FRED = PINE.indicators.find((i) => i.slug === 'fred-rs')
const ALL = [...PINE.indicators, ...HOUSE.indicators]
const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [], definitions: [] }) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete globalThis.fetch })

describe('the UCT tab in searchOnly mode', () => {
  it('shows only the matches, under a "UCT" heading, without the tab\'s lede, and reports how many', async () => {
    const onMatches = vi.fn()
    render(<IndicatorHouseTab load={async () => ALL} query="fred" searchOnly onMatches={onMatches} />)
    await settle()
    expect(screen.getByTestId('house-search')).toBeTruthy()
    expect(screen.getByText('UCT')).toBeTruthy()
    expect(screen.getAllByTestId('house-entry').map((e) => e.getAttribute('data-slug'))).toEqual(['fred-rs'])
    expect(screen.queryByText(/Chosen by UCT/)).toBeNull()
    expect(onMatches).toHaveBeenLastCalledWith(1)
  })

  it('renders NOTHING while loading, on a failed load, or with no match, and reports 0', async () => {
    const onMatches = vi.fn()
    const { container, rerender } = render(<IndicatorHouseTab load={() => new Promise(() => {})} query="fred" searchOnly onMatches={onMatches} />)
    expect(container.innerHTML).toBe('')
    rerender(<IndicatorHouseTab load={async () => ALL} query="zzzz-nothing" searchOnly onMatches={onMatches} />)
    await settle()
    expect(screen.queryByTestId('house-search')).toBeNull()
    expect(screen.queryByTestId('house-no-match')).toBeNull()
    expect(onMatches).toHaveBeenLastCalledWith(0)
  })
})

function Host() {
  const [cs, setCs] = useState(() => mergeChartSettings({}))
  return (
    <AuthContext.Provider value={{ user: { id: 1, role: 'user' }, isPaid: true, loading: false }}>
      <ChartSettingsModal open settings={cs} onChange={setCs} onClose={() => {}} />
    </AuthContext.Provider>
  )
}

describe('the desktop Indicators window', () => {
  it('typing "Fred" with no tab chosen shows Fred RS under UCT, and never says "Nothing matches"', async () => {
    render(<Host />)
    fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
    fireEvent.click(screen.getByTestId('add-enter'))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search indicators' }), { target: { value: 'Fred' } })
    await settle()
    const section = screen.getByTestId('house-search')
    expect(section.querySelector('[data-slug="fred-rs"]')).toBeTruthy()
    expect(section.textContent).toContain(FRED.name)
    expect(screen.queryByText(/Nothing matches/)).toBeNull()
  })

  it('⛔ CONTROL: a query matching nothing anywhere still says "Nothing matches"', async () => {
    render(<Host />)
    fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
    fireEvent.click(screen.getByTestId('add-enter'))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search indicators' }), { target: { value: 'zzqqzzqq' } })
    await settle()
    expect(screen.queryByTestId('house-search')).toBeNull()
    expect(screen.getByText(/Nothing matches/)).toBeTruthy()
  })
})

describe('the phone / toolbar Indicators sheet', () => {
  it('"All indicators" + "Fred" shows Fred RS under UCT, and never says "Nothing matches"', async () => {
    render(<IndicatorLibraryDialog open onClose={() => {}} settings={mergeChartSettings(null)} onChange={vi.fn()} registry={engineRegistry} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Fred' } })
    await settle()
    const section = screen.getByTestId('library-house-search')
    expect(section.querySelector('[data-slug="fred-rs"]')).toBeTruthy()
    expect(screen.queryByText(/Nothing matches/)).toBeNull()
  })

  it('⛔ CONTROL: a query matching nothing anywhere still says "Nothing matches"', async () => {
    render(<IndicatorLibraryDialog open onClose={() => {}} settings={mergeChartSettings(null)} onChange={vi.fn()} registry={engineRegistry} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzqqzzqq' } })
    await settle()
    expect(screen.queryByTestId('house-entry')).toBeNull()
    expect(screen.getByText(/Nothing matches/)).toBeTruthy()
  })
})
