/**
 * The Breadth Monitor's universe switcher, on the page: the dropdown before Columns (the
 * chart's Signature menu, gold ✓ on the chosen one), `?universe=` in the URL, the grid asked
 * for the chosen universe, Health on its own bands and the Phase 3 columns "n/a" off UCT, no drill off
 * UCT, and the header menus' universe notes. Same shell-mocking pattern as monitorGridError.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))
vi.mock('../CotData', () => ({ default: () => <div /> }))
vi.mock('../BreadthCharts', () => ({ default: () => <div /> }))
vi.mock('../../components/tiles/MarketBreadth', () => ({ default: () => <div /> }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'user' } }) }))
vi.mock('../../hooks/useFlagged', () => ({
  useFlagged: () => ({ flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
                       isShared: false, toggleShare: () => {}, flaggedName: 'Flagged',
                       renameFlagged: () => {} }),
}))
vi.mock('../../hooks/useLiveBreadth', () => ({
  useLiveBreadth: () => ({ row: null, stamp: null, superseded: true }),
  formatLiveClock: () => 'now',
}))
vi.mock('swr', () => ({
  default: () => ({ data: { rows: [], days: 90 }, isLoading: false, error: null, mutate: () => {} }),
  useSWRConfig: () => ({ mutate: () => {} }),
}))
// Every column visible, so Health and the "n/a" columns are on the sheet.
vi.mock('./useBreadthCustomize', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({
    activePreset: 'Mine', activeLabel: 'Mine', hidden: new Set(), presetNames: ['Mine'], presets: {},
    isDefaultActive: false, isEdited: false, differsFromDefault: true,
    toggleHidden: () => {}, setHiddenSet: () => {}, order: null, setOrder: () => {}, revertDraft: () => {},
    savePreset: () => {}, renamePreset: () => {}, duplicatePreset: () => {}, deletePreset: () => {},
    switchPreset: () => {}, resetActive: () => {},
  }),
}))
// The virtualizer draws every row in jsdom (no layout).
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, i) => ({ index: i, start: i * 32, end: (i + 1) * 32 })),
    getTotalSize: () => count * 32, scrollToIndex: () => {}, measure: () => {}, scrollOffset: 0,
  }),
}))
const seen = vi.hoisted(() => ({ universes: [] }))
vi.mock('./useMonitorGrid', () => ({
  default: ({ universe }) => {
    seen.universes.push(universe)
    const row = { date: '2026-11-17', breadth_score: universe === 'uct' ? 61 : 57, up_vol_ratio: 1.4,
                  hvc_52w: 3, atr_ext_7: 2, new_ath: 5, pct_above_50sma: 44, up_4pct_today: 120,
                  universe_count: universe === 'uct' ? 3700 : 2900, vix: 18 }
    return {
      allDates: ['2026-11-17'], getRow: () => row, trail: () => [], ensureRange: () => {}, refresh: () => {},
      indexOfDate: () => 0, indexOfYearStart: () => 0, min: universe === 'nyse' ? '2009-06-11' : '2008-01-02',
      max: '2026-11-17', ready: true, count: 1, datesFailed: false, blocksFailed: 0, retry: () => {}, universe,
    }
  },
}))

import Breadth from '../Breadth'

let loc = null
function LocationProbe() { loc = useLocation(); return null }
const mount = (q = '') => render(
  <MemoryRouter initialEntries={[`/breadth?tab=breadth${q}`]}><Breadth /><LocationProbe /></MemoryRouter>,
)
const cellOf = (key) => document.querySelector(`[data-universe-na="${key}"]`)

beforeEach(() => { seen.universes = []; loc = null })

describe('the universe switcher', () => {
  it('sits before Columns, defaults to UCT, and asks the grid for UCT', () => {
    mount()
    const btn = screen.getByTestId('breadth-universe')
    expect(btn).toHaveTextContent('UCT')
    const columns = screen.getByRole('button', { name: /Columns/ })
    expect(btn.compareDocumentPosition(columns) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(seen.universes.at(-1)).toBe('uct')
    // UCT: Health shows its number and nothing reads n/a
    expect(cellOf('breadth_score')).toBeNull()
    expect(document.querySelector('[data-universe-na]')).toBeNull()
  })

  it('the menu lists the four universes with the gold ✓ on the chosen one; picking one switches and writes ?universe=', () => {
    mount()
    fireEvent.click(screen.getByTestId('breadth-universe'))
    const menu = screen.getByRole('menu')
    const items = within(menu).getAllByRole('menuitemcheckbox')
    expect(items.map(i => i.textContent.trim())).toEqual(['UCTtradable stocks', 'U.S. stocksall listed', 'Nasdaqall listed', 'NYSEall listed'])
    expect(items.map(i => i.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false'])
    fireEvent.click(items[2])
    expect(seen.universes.at(-1)).toBe('nasdaq')
    expect(screen.getByTestId('breadth-universe')).toHaveTextContent('Nasdaq')
    expect(new URLSearchParams(loc.search).get('universe')).toBe('nasdaq')
    expect(new URLSearchParams(loc.search).get('tab')).toBe('breadth')     // other params kept
    fireEvent.click(screen.getByTestId('breadth-universe'))
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemcheckbox')[0])
    expect(seen.universes.at(-1)).toBe('uct')
    expect(new URLSearchParams(loc.search).has('universe')).toBe(false)     // UCT = no param
  })

  it('a link (or a reload) with ?universe= opens on that universe', () => {
    mount('&universe=nyse')
    expect(seen.universes[0]).toBe('nyse')
    expect(screen.getByTestId('breadth-universe')).toHaveTextContent('NYSE')
  })

  it('an unknown ?universe= opens on UCT', () => {
    mount('&universe=nasdac')
    expect(seen.universes.every(u => u === 'uct')).toBe(true)
  })

  it('off UCT: Health and the rebuilt Up Vol / HVC / >7×ATR show values, ATH reads n/a, and no cell opens a list', () => {
    mount('&universe=us')
    expect(cellOf('breadth_score')).toBeNull()                    // a real cell, not an override
    expect(document.querySelector('[data-universe-na="breadth_score"]')).toBeNull()
    for (const k of ['up_vol_ratio', 'hvc_52w', 'atr_ext_7']) expect(cellOf(k)).toBeNull()
    expect(cellOf('new_ath')).toHaveTextContent('n/a')
    expect(cellOf('new_ath')).toHaveAttribute('title', 'Not available for this universe yet.')
    // No lists off UCT yet: no cell opens one. Every value cell still opens its reading.
    expect(document.querySelector('td[data-drill-list]')).toBeNull()
  })

  it('UCT cells drill as before', () => {
    mount()
    expect(document.querySelector('td[data-drill]')).not.toBeNull()
  })

  it('header menus say market-wide / ratio-adjusted / not available off UCT, and nothing extra on UCT', () => {
    mount('&universe=nasdaq')
    fireEvent.click(screen.getByTestId('col-menu-vix'))
    expect(screen.getByTestId('col-universe-note')).toHaveTextContent('Market-wide')
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('col-menu-mcclellan_osc'))
    expect(screen.getByTestId('col-universe-note')).toHaveTextContent('Ratio-adjusted on Nasdaq')
    fireEvent.click(screen.getByTestId('col-menu-breadth_score'))
    expect(screen.getByTestId('col-universe-note')).toHaveTextContent('Nasdaq’s own bands')
  })

  it('on UCT a header menu carries no universe note', () => {
    mount()
    fireEvent.click(screen.getByTestId('col-menu-vix'))
    expect(screen.queryByTestId('col-universe-note')).toBeNull()
  })
})
