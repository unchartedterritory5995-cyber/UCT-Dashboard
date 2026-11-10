import { render, act, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect, vi, beforeEach } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

// ─── C1-123 (owner-approved 2026-11-10): "Add indicator…" on the desktop /charts menu ─
//
// StockChart already builds the row (`ind-add`: openIndicatorLibrary, falling back to
// the settings surface, present only when `showDrawingTools`) and hands it to its host
// in `sections` on the `onBarContextMenu` payload. ChartWidget draws its own menu and
// never read `sections`, so on desktop /charts the row was unreachable.
//
// ⛔ THE ROW IS THE SOURCE ITEM, NOT A COPY OF IT. These rails pin that:
//   • it exists exactly when the source item is in `sections` (the same gate: no
//     drawing tools, or a region whose section has no add row → no row here);
//   • pressing it calls the source item's OWN onSelect (a spy here), once, and closes;
//   • every other row is unchanged with or without it.
// StockChart is stubbed to capture the callback; the payload is the shape
// `StockChart.openMenuAt` sends (its `ind-add` item is railed by stockChartWiring).

const captured = { onBarContextMenu: null }
vi.mock('../../../components/StockChart', () => ({
  default: (props) => {
    captured.onBarContextMenu = props.onBarContextMenu
    return <span data-testid="chart-sym">{props.sym}</span>
  },
}))
vi.mock('../../../components/chart/SymbolSearch', () => ({ default: () => <span>search</span> }))
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <span>share</span> }))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({ default: () => null }))
vi.mock('./ChartMarketClock', () => ({ default: () => <span>clock</span> }))
vi.mock('./ChartDayGain', () => ({ default: () => <span>gain</span> }))
vi.mock('./AiSearchWidget', () => ({ default: () => null }))
vi.mock('./TimeframeMenu', () => ({ default: () => null }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, loading: false }),
  parsePref: (_raw, fallback) => fallback,
}))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))

import ChartWidget from './ChartWidget'

function Wrap() {
  const [groupSyms, setGroupSyms] = useState({ A: 'SPY', B: null, C: null, D: null })
  const value = {
    groupSyms,
    setGroupSym: (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s })),
    chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
  }
  return (
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <ChartWidget color="A" opts={{}} />
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}

/** The open-price-area `region` section as StockChart builds it, with the source row's onSelect a spy. */
const regionSection = (withAdd) => {
  const onSelect = vi.fn()
  const items = [
    { id: 'pr-log', label: 'Logarithmic scale', kind: 'toggle', checked: false, onSelect: vi.fn() },
    { id: 'indicators', label: 'Indicators', submenu: [] },
    withAdd ? { id: 'ind-add', label: <>Add indicator…</>, onSelect } : null,
  ]
  return { onSelect, sections: [{ id: 'region', title: 'Chart', items }, { id: 'view', items: [{ id: 'reset', label: 'Reset view', onSelect: vi.fn() }] }] }
}

const open = (extra = {}) => {
  expect(captured.onBarContextMenu, 'ChartWidget handed StockChart no onBarContextMenu').toBeTypeOf('function')
  act(() => {
    captured.onBarContextMenu({
      clientX: 200, clientY: 150, event: null, bar: null, clickPrice: null, currentPrice: 100,
      region: { type: 'price' },
      resetView: () => {}, openSettings: () => {}, clearDrawings: () => {}, hasDrawings: false,
      onWatermark: false, onCandle: false, paneIndicator: null,
      ...extra,
    })
  })
  return document.body.querySelector('[data-guide="chart.contextMenu"]')
}
const ids = (menu) => [...menu.querySelectorAll('[data-menu-id]')].map(b => b.getAttribute('data-menu-id'))
const close = () => act(() => { fireEvent.click(document.body.querySelector('[class*="chartCtxBackdrop"]')) })

beforeEach(() => { captured.onBarContextMenu = null })

test('the source item in sections → an "Add indicator…" row on the menu', () => {
  render(<Wrap />)
  const menu = open({ sections: regionSection(true).sections })
  const row = menu.querySelector('[data-menu-id="ind-add"]')
  expect(row, 'the desktop /charts menu does not offer Add indicator').toBeTruthy()
  expect(row.textContent).toBe('Add indicator…')
  expect(row.tagName).toBe('BUTTON')
  expect(row.disabled).toBe(false)
})

test('pressing it calls the SOURCE item’s own onSelect once and closes the menu', () => {
  render(<Wrap />)
  const { onSelect, sections } = regionSection(true)
  const menu = open({ sections })
  fireEvent.click(menu.querySelector('[data-menu-id="ind-add"]'))
  expect(onSelect, 'the row called something other than the source item').toHaveBeenCalledTimes(1)
  expect(document.body.querySelector('[data-guide="chart.contextMenu"]'), 'menu stayed open').toBeNull()
})

test('gated exactly like the source: no source item → no row (no drawing tools, another region, no sections)', () => {
  render(<Wrap />)
  // showDrawingTools false: StockChart omits the item (addIndicatorItem null)
  expect(open({ sections: regionSection(false).sections }).querySelector('[data-menu-id="ind-add"]')).toBeNull()
  close()
  // a region whose section has no add row (price axis, MA line, volume…)
  expect(open({ region: { type: 'priceAxis' }, sections: [{ id: 'axis', items: [{ id: 'ax-log', label: 'Log', onSelect: vi.fn() }] }] })
    .querySelector('[data-menu-id="ind-add"]')).toBeNull()
  close()
  // an older payload with no sections at all
  expect(open({}).querySelector('[data-menu-id="ind-add"]')).toBeNull()
  close()
  // a malformed item (no handler) is never drawn as a dead row
  expect(open({ sections: [{ id: 'region', items: [{ id: 'ind-add', label: 'Add indicator…' }] }] })
    .querySelector('[data-menu-id="ind-add"]')).toBeNull()
})

test('every other row is unchanged with or without it', () => {
  render(<Wrap />)
  const without = ids(open({ sections: regionSection(false).sections }))
  close()
  const withIt = ids(open({ sections: regionSection(true).sections }))
  expect(withIt.filter(id => id !== 'ind-add')).toEqual(without)
  expect(withIt.filter(id => id === 'ind-add')).toHaveLength(1)
  // it sits with the chart configuration rows, just above Chart settings
  expect(withIt.indexOf('ind-add')).toBe(withIt.indexOf('settings') - 1)
})

test('the add-widget picker does not carry the row', () => {
  render(<Wrap />)
  const menu = open({ sections: regionSection(true).sections })
  fireEvent.click(menu.querySelector('[data-menu-id="add-widget"]'))
  expect(document.body.querySelector('[data-guide="chart.contextMenu"] [data-menu-id="ind-add"]')).toBeNull()
})
