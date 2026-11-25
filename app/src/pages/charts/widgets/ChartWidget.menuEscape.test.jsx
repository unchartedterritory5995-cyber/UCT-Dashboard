import { render, act, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

// ─── The desktop /charts right-click menu closes on Escape (2026-11-10) ──────────────────────────────────────────────
//
// The menu closed only on a click or right-click of its backdrop: Escape did nothing (pl-teach candle-diag 4c2a87e3d5).
// Through the key registry (`charts.ctxMenuClose`, the census ratchet forbids a raw listener): bound only while the menu
// is open; a modal layer above the page owns the press; otherwise the menu closes, claims the press (stops it) and hands
// focus back to the chart, as Reset view does. Nothing else about the menu moves.

const captured = { onBarContextMenu: null }
vi.mock('../../../components/StockChart', () => ({
  default: (props) => {
    captured.onBarContextMenu = props.onBarContextMenu
    return <span data-testid='chart-sym'>{props.sym}</span>
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

// Imported AFTER the mocks are registered.
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
        <ChartWidget color='A' opts={{}} />
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}


const MENU = '[data-guide="chart.contextMenu"]'
const open = (extra = {}) => {
  act(() => {
    captured.onBarContextMenu({
      clientX: 200, clientY: 150, event: null, bar: null, clickPrice: null, currentPrice: 100,
      region: { type: 'price' },
      resetView: () => {}, openSettings: () => {}, clearDrawings: () => {}, hasDrawings: false,
      onWatermark: false, onCandle: false, paneIndicator: null,
      ...extra,
    })
  })
  return document.body.querySelector(MENU)
}
const esc = (init = {}) => act(() => { fireEvent.keyDown(window, { key: 'Escape', code: 'Escape', ...init }) })
const flush = () => act(() => new Promise(r => requestAnimationFrame(() => r())))
let heard
const listen = (e) => { if (e.key === 'Escape') heard.push(e) }
beforeEach(() => { captured.onBarContextMenu = null; heard = []; window.addEventListener('keydown', listen) })
afterEach(() => { window.removeEventListener('keydown', listen); document.querySelectorAll('[data-escape-layer]').forEach(n => n.remove()) })

test('Escape closes the open menu and hands focus back to the chart', async () => {
  render(<Wrap />)
  expect(open(), 'no menu').toBeTruthy()
  esc()
  expect(document.body.querySelector(MENU), 'the menu stayed open on Escape').toBeNull()
  await flush()
  const a = document.activeElement
  expect(a && a !== document.body, 'focus went nowhere').toBe(true)
  expect(a.getAttribute('role')).toBe('region')
  expect(a.tabIndex).toBe(0)
})

test('the press is the menu’s: a later listener never hears it; with no menu open it does', () => {
  render(<Wrap />)
  open()
  esc()
  expect(heard, 'Escape reached the page after closing the menu').toHaveLength(0)
  esc()
  expect(heard, 'with the menu closed Escape is the page’s again').toHaveLength(1)
})

test('a modal layer above the page owns Escape: the menu stays, the press goes on', () => {
  render(<Wrap />)
  open()
  const layer = document.createElement('div'); layer.setAttribute('data-escape-layer', ''); document.body.appendChild(layer)
  esc()
  expect(document.body.querySelector(MENU), 'the menu closed under a modal layer').toBeTruthy()
  expect(heard).toHaveLength(1)
})

test('from the add-widget picker too, and other keys do nothing', () => {
  render(<Wrap />)
  const menu = open()
  fireEvent.click(menu.querySelector('[data-menu-id="add-widget"]'))
  act(() => { fireEvent.keyDown(window, { key: 'Enter' }); fireEvent.keyDown(window, { key: 'a' }) })
  expect(document.body.querySelector(MENU), 'another key closed it').toBeTruthy()
  esc()
  expect(document.body.querySelector(MENU)).toBeNull()
})

test('the backdrop still closes it, and Escape after that is not the menu’s', () => {
  render(<Wrap />)
  open()
  act(() => { fireEvent.click(document.body.querySelector('[class*="chartCtxBackdrop"]')) })
  expect(document.body.querySelector(MENU)).toBeNull()
  esc()
  expect(heard).toHaveLength(1)
})
