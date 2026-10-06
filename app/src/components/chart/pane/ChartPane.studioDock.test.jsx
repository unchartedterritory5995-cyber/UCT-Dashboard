// ⭐ P2 Track B — Create Indicator as a RIGHT WORKSPACE DOCK (owner review 2026-10-06).
// The REAL ChartPane and the REAL CreateIndicatorPanel; StockChart is stood in by
// a component that mounts the panel exactly as the primary toolbar does (the
// pane's `studioDockHost` + `onStudioDockChange`). ASKED / CLAIMED / DID per case.
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const H = vi.hoisted(() => ({ open: null, Panel: null, deps: null }))
// ⚠️ The stand-in reads the panel from H (assigned below, after the imports): a
// factory that imported it would recurse — the panel's graph reaches StockChart.
vi.mock('../../StockChart', async () => {
  const { useState: useS } = await import('react')
  return {
    default: function StockChartStandIn(props) {
      const [open, setOpen] = useS(false)
      H.open = setOpen
      const { Panel, deps } = H
      return (
        <div data-testid="chart-canvas">
          {open && (
            <Panel
              settings={deps.settings} onChange={() => {}} sym={props.sym} tf="D"
              onPreview={() => {}} onClose={() => setOpen(false)} converse={deps.converse}
              dockHost={props.studioDockHost} onDocked={props.onStudioDockChange}
            />
          )}
        </div>
      )
    },
  }
})
vi.mock('../SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef(({ displayLabel }, ref) => {
      useImperativeHandle(ref, () => ({ openWith: () => {} }))
      return <span data-testid="sym-label">{displayLabel}</span>
    }),
  }
})
vi.mock('../ChartSettingsModal', () => ({
  default: ({ open }) => (open ? <div data-testid="settings-modal" /> : null),
}))
vi.mock('../../../pages/charts/widgets/ChartMarketClock', () => ({
  default: () => <span data-testid="market-clock">clock</span>,
}))
vi.mock('../../../pages/charts/widgets/ChartDayGain', () => ({
  default: ({ sym }) => <span data-testid="day-gain">{sym}</span>,
}))
vi.mock('../../../pages/charts/widgets/TimeframeMenu', () => ({
  default: () => <div data-testid="tf-menu" />,
}))
vi.mock('../../../hooks/useFlagged', () => ({
  useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }),
}))
// Real-shaped fundamentals so the meta row renders VALUES, not em-dashes.
// Wrapped in vi.fn() (not just a plain factory) so Task-1's new tests can
// assert on the call arguments (the enabled/disabled flag) without changing
// what it returns for the three pre-existing tests below.
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({
  default: vi.fn(() => ({
    data: { metrics: { market_cap: '$1.2T' }, next_earnings: '2026-08-28', composite: 61 },
    isLoading: false,
  })),
}))
// Mutable so individual tests can shape `prefs` (in particular
// `charts_workspace_layout`) without re-mocking the module — mirrors the
// pattern in useChartSurfaceSettings.test.js. Reset to `{}` in beforeEach so
// pre-existing tests (which never touch this) see the same empty prefs as
// before.
let mockPrefs = {}
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref: () => {}, loading: false }),
}))
vi.mock('../../../hooks/useThemeIndexBars', () => ({
  default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }),
}))
// null meta => the header label falls back to the raw ticker, so the identity
// label is assertable as "NVDA" in either the search or the static branch.
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({
  default: () => ({ isOpen: false, isPremarket: false, isExtended: false }),
}))
vi.mock('../../../utils/extSession', () => ({ getExtSessionCached: () => ({ session: 'post' }) }))


import ChartPane from './ChartPane'
import { studioDockWidth } from './studioDock'
import paneStyles from '../../../pages/charts/ChartsWorkspace.module.css'
import * as registry from '../engine/nativeRegistry'
import CreateIndicatorPanel from '../builder/studio/CreateIndicatorPanel'
import { mergeChartSettings } from '../chartDefaults'
import { scriptedConverse } from '../../../testing/createIndicator/scriptedConverse'

H.Panel = CreateIndicatorPanel
H.deps = { settings: mergeChartSettings({}), converse: scriptedConverse }

let paneW = 1400
beforeEach(() => {
  mockPrefs = {}
  paneW = 1400
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: paneW, height: 700, top: 0, left: 0, right: paneW, bottom: 700, x: 0, y: 0, toJSON() {} }))
})
afterEach(() => { cleanup(); registry.clearUserDefinitions(); vi.restoreAllMocks() })

const host = () => document.querySelector('[data-studio-dock]')
const pane = () => host().parentElement
const openStudio = () => act(() => { H.open(true) })
const closeStudio = () => act(() => { H.open(false) })

describe('Create Indicator docks on the RIGHT of the whole chart section', () => {
  it('CLOSED: the pane is exactly as before — no room taken, empty host, no inline var', () => {
    render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} />)
    expect(host().dataset.studioDock).toBe('closed')
    expect(host().childElementCount).toBe(0)
    expect(pane().className).toBe(paneStyles.chartWidget)
    expect(pane().getAttribute('style')).toBeNull()
  })

  it('OPEN (wide): the panel lives IN the dock host, the pane reflows, the composer has focus', () => {
    render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} />)
    openStudio()
    const panel = screen.getByTestId('create-indicator')
    expect(host().contains(panel)).toBe(true)                       // not a body overlay
    expect(panel.parentElement).not.toBe(document.body)
    expect(host().dataset.studioDock).toBe('dock')
    expect(pane().className).toContain(paneStyles.studioDocked)     // padding-right = dock width
    expect(pane().style.getPropertyValue('--studio-dock-w')).toBe('360px')
    expect(panel.getAttribute('style')).toBeNull()                  // no floating geometry
    // the chart and its chrome stay siblings of the host, inside the reflowed pane
    expect(pane().contains(screen.getByTestId('chart-canvas'))).toBe(true)
    expect(host().contains(screen.getByTestId('chart-canvas'))).toBe(false)
    expect(document.activeElement).toBe(screen.getByTestId('create-indicator-input'))
  })

  it('CLOSE: the room is handed back exactly — class, var and host content all gone', () => {
    render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} />)
    openStudio()
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }))
    expect(screen.queryByTestId('create-indicator')).toBeNull()
    expect(host().dataset.studioDock).toBe('closed')
    expect(pane().className).toBe(paneStyles.chartWidget)
    expect(pane().getAttribute('style') || '').toBe('')            // React leaves style="" — no declarations
    openStudio()                                                     // reopen works
    expect(host().dataset.studioDock).toBe('dock')
    closeStudio()
    expect(pane().className).toBe(paneStyles.chartWidget)
  })

  it('MID (a ~750px drill-board chart): docked at the 300px clamp, the chart keeps the rest', () => {
    paneW = 750
    render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} />)
    openStudio()
    expect(host().dataset.studioDock).toBe('dock')
    expect(pane().style.getPropertyValue('--studio-dock-w')).toBe('300px')
    expect(studioDockWidth(750)).toBe(300)
    expect(studioDockWidth(860)).toBe(344)
    expect(studioDockWidth(1400)).toBe(360)
  })

  it('NARROW (pane < 300 + 340): the dock overlays the right edge instead of crushing the chart', () => {
    paneW = 600
    render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} />)
    openStudio()
    expect(host().dataset.studioDock).toBe('overlay')
    expect(pane().className).not.toContain(paneStyles.studioDocked)
    expect(host().contains(screen.getByTestId('create-indicator'))).toBe(true)
  })

  it('keys typed in the docked composer reach neither the chart fill nor document handlers', () => {
    const seen = []
    const onDoc = (e) => seen.push(e.key)
    document.addEventListener('keydown', onDoc)
    try {
      render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} />)
      openStudio()
      for (const key of ['ArrowDown', 'ArrowUp', 'Escape', 'a', 'Enter']) {
        fireEvent.keyDown(screen.getByTestId('create-indicator-input'), { key, shiftKey: key === 'Enter' })
      }
      expect(seen).toEqual([])
      expect(screen.getByTestId('create-indicator')).toBeTruthy()   // Escape did not close anything
    } finally { document.removeEventListener('keydown', onDoc) }
  })
})
