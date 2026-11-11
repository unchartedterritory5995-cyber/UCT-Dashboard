import { render, screen, act, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect, vi, beforeEach } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

// ─── B9 (2026-11-07) — right-click inside an indicator pane ─────────────────
//
// StockChart hands its host `paneIndicator` (the pane owner's chip rows, built by
// `chipMenu.paneMenuItems`) on the `onBarContextMenu` payload. ChartWidget leads
// its menu with those rows and keeps the rest of its menu below a rule. The rows
// are the chip's, so pressing one must call the row's own handler, nothing else.
//
// StockChart is stubbed to capture the callback; the payload is the shape
// `StockChart.openMenuAt` sends (pinned there by stockChartWiring's B9 block).

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
        <ChartWidget color="A" opts={{}} />
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}

/** The rows `paneMenuItems` returns for an RS pane, with spies for handlers. */
function rsPane() {
  const h = { settings: vi.fn(), hidden: vi.fn(), alerts: vi.fn(), about: vi.fn(), classic: vi.fn(), phase: vi.fn() }
  return {
    h,
    pane: {
      instanceId: 'inst:rs', defId: 'rsLine', name: 'UCT RS',
      items: [
        { key: 'settings', label: 'UCT RS settings…', icon: 'sliders', onClick: h.settings },
        { key: 'preset', label: 'Preset', icon: 'library', trailing: 'Phase (21 EMA)', submenu: [
          { key: 'preset-classic', presetId: 'classic', label: "Classic (O'Neil)", origin: 'IBD, MarketSurge', checked: false, onClick: h.classic },
          { key: 'preset-phase', presetId: 'phase', label: 'Phase (21 EMA)', origin: '', checked: true, onClick: h.phase },
          { key: 'preset-custom', presetId: null, label: 'Custom', origin: '', checked: false, custom: true },
        ] },
        { key: 'hidden', label: 'Hide', icon: 'eye', onClick: h.hidden },
        { key: 'alerts', label: 'Add alert…', icon: 'bell', onClick: h.alerts },
        { key: 'about', label: 'About UCT Relative Strength', icon: 'info', onClick: h.about },
      ],
    },
  }
}

const open = (extra = {}) => {
  expect(captured.onBarContextMenu, 'ChartWidget handed StockChart no onBarContextMenu').toBeTypeOf('function')
  act(() => {
    captured.onBarContextMenu({
      clientX: 200, clientY: 150, event: null, bar: null, clickPrice: null, currentPrice: 100,
      region: { type: 'indicator', key: 'rsLine', hostKey: 'inst:rs' },
      resetView: () => {}, openSettings: () => {}, clearDrawings: () => {}, hasDrawings: false,
      onWatermark: false, onCandle: false,
      ...extra,
    })
  })
  return document.body.querySelector('[data-guide="chart.contextMenu"]')
}
const ids = (menu) => [...menu.querySelectorAll(':scope > [data-menu-id], :scope > div > [data-menu-id]')]
  .map(b => b.getAttribute('data-menu-id'))

beforeEach(() => { captured.onBarContextMenu = null })

test('an indicator pane leads the menu with its rows, then a rule, then the chart menu', () => {
  render(<Wrap />)
  const { pane } = rsPane()
  const menu = open({ paneIndicator: pane })
  expect(menu, 'no context menu rendered').toBeTruthy()
  const order = ids(menu)
  expect(order.slice(0, 5)).toEqual(['pane-settings', 'pane-preset', 'pane-hidden', 'pane-alerts', 'pane-about'])
  // the existing menu is all still there, below the pane block
  for (const id of ['journal', 'reset', 'settings', 'template', 'add-widget']) expect(order).toContain(id)
  expect(order.indexOf('journal')).toBeGreaterThan(order.indexOf('pane-about'))
  // …separated by a rule
  const about = menu.querySelector('[data-menu-id="pane-about"]')
  expect(about.nextElementSibling.className).toMatch(/menuDivider/)
  expect(menu.querySelector('[data-menu-id="pane-settings"]').textContent).toBe('UCT RS settings…')
  expect(about.textContent).toBe('About UCT Relative Strength')
})

test('each pane row calls its own chip handler and closes the menu', () => {
  for (const key of ['settings', 'hidden', 'alerts', 'about']) {
    const view = render(<Wrap />)
    const { pane, h } = rsPane()
    const menu = open({ paneIndicator: pane })
    fireEvent.click(menu.querySelector(`[data-menu-id="pane-${key}"]`))
    expect(h[key], key).toHaveBeenCalledTimes(1)
    for (const other of ['settings', 'hidden', 'alerts', 'about'].filter(k => k !== key)) {
      expect(h[other], `${key} also fired ${other}`).not.toHaveBeenCalled()
    }
    expect(document.body.querySelector('[data-guide="chart.contextMenu"]'), `${key}: menu stayed open`).toBeNull()
    view.unmount()
  }
})

test('Preset opens a flyout naming the current preset; a preset applies, Custom is a state', () => {
  render(<Wrap />)
  const { pane, h } = rsPane()
  const menu = open({ paneIndicator: pane })
  const row = menu.querySelector('[data-menu-id="pane-preset"]')
  expect(row.querySelector('[data-preset-current]').textContent).toBe('Phase (21 EMA)')
  expect(row.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(row)
  expect(row.getAttribute('aria-expanded')).toBe('true')
  const flyout = row.parentElement.querySelector('[role="menu"]')
  const radios = [...flyout.querySelectorAll('[role="menuitemradio"]')]
  expect(radios.map(r => r.textContent)).toEqual(["Classic (O'Neil)", 'Phase (21 EMA)', 'Custom'])
  expect(radios.map(r => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
  expect(radios[0].getAttribute('title')).toBe('IBD, MarketSurge')
  expect(radios[2].disabled, 'Custom is a state, never a choice').toBe(true)
  fireEvent.click(radios[0])
  expect(h.classic).toHaveBeenCalledTimes(1)
  expect(h.phase).not.toHaveBeenCalled()
  expect(document.body.querySelector('[data-guide="chart.contextMenu"]')).toBeNull()
})

test('the Preset and Chart template flyouts never stand open together', () => {
  render(<Wrap />)
  const menu = open({ paneIndicator: rsPane().pane })
  const preset = menu.querySelector('[data-menu-id="pane-preset"]')
  const tpl = menu.querySelector('[data-menu-id="template"]')
  fireEvent.click(preset)
  fireEvent.click(tpl)
  expect(preset.getAttribute('aria-expanded')).toBe('false')
  expect(tpl.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(preset)
  expect(tpl.getAttribute('aria-expanded')).toBe('false')
})

test('a refused row is shown with its reason and does nothing', () => {
  render(<Wrap />)
  const { pane, h } = rsPane()
  pane.items = pane.items.map(r => (r.key === 'alerts'
    ? { ...r, disabled: 'this chart has no alert form (read-only mount)', onClick: undefined }
    : r))
  const menu = open({ paneIndicator: pane })
  const row = menu.querySelector('[data-menu-id="pane-alerts"]')
  expect(row.disabled).toBe(true)
  expect(row.getAttribute('title')).toBe('Unavailable: this chart has no alert form (read-only mount)')
  fireEvent.click(row)
  expect(h.alerts).not.toHaveBeenCalled()
})

test('no pane rows (price area, read-only, legacy) leaves the menu exactly as before', () => {
  render(<Wrap />)
  const menu = open({ region: { type: 'price' }, paneIndicator: null })
  expect(menu.querySelector('[data-menu-id^="pane-"]')).toBeNull()
  expect(ids(menu)[0]).toBe('journal')
  // an empty row list is treated the same as none
  act(() => { fireEvent.click(document.body.querySelector('[class*="chartCtxBackdrop"]')) })
  const again = open({ paneIndicator: { instanceId: 'x', defId: 'rsi', items: [] } })
  expect(again.querySelector('[data-menu-id^="pane-"]')).toBeNull()
  expect(screen.getByTestId('chart-sym').textContent).toBe('SPY')
})
