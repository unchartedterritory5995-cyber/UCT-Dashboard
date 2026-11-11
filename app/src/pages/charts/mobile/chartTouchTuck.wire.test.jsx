/* Decision B3 (2026-11-07) — the phone chart shell's floating buttons.
 *
 *   1. The shell arms the chart-touch tuck on the CHART's own wrapper, and only once
 *      the layout has a chart (widgets hydrate after the first render).
 *   2. Every floating button reads the same root attribute: the voice orb and the
 *      feedback "?" in CSS, the joystick hub through `useHubViewport().touchTucked`.
 *   3. While the hub is on screen the phone chart stops above it, by exactly the
 *      overlap its own declarations produce (the inset rail below derives it).
 *
 * jsdom does no layout, so the readers are asserted on their CSS / source artifacts
 * and the inset on its arithmetic, never on a measured box.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { forwardRef } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import MobileChartsApp from './MobileChartsApp'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../WorkspaceContext'
import { CHART_TOUCH_ATTR, CHART_TOUCH_IDLE_MS } from '../../../hooks/useChartTouchTuck'

vi.mock('../../../components/chart/pane/ChartPane', () => ({
  default: forwardRef(function ChartPaneMock(_props, ref) {
    void ref
    return <div data-testid="chart-pane"><canvas data-testid="chart-canvas" /></div>
  }),
}))
vi.mock('../WidgetHost', () => ({
  default: ({ widget }) => <div data-testid={`widget-body-${widget.type}`}>{widget.type}</div>,
}))
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn(), loading: false }),
}))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useBreadthSymbols', () => ({ default: () => new Map() }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: vi.fn() }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({
  default: () => ({ createAlert: vi.fn(), deleteAlert: vi.fn(), getAlertsForSym: () => [] }),
}))

const HYDRATED = [
  { id: 'w-chart', type: 'chart', color: 'A', opts: { tf: 'D' } },
  { id: 'w-watch', type: 'watchlist', color: 'A', opts: {} },
]
const handlers = () => ({ onRemove: vi.fn(), onColorChange: vi.fn(), onOptsChange: vi.fn(), onAddWidget: vi.fn() })
function renderApp(widgets) {
  const value = { ...WORKSPACE_FALLBACK, groupSyms: { A: 'NVDA', B: null, C: null, D: null }, setGroupSym: vi.fn() }
  const h = handlers()
  const ui = (w) => (
    <WorkspaceContext.Provider value={value}>
      <MobileChartsApp widgets={w} {...h} />
    </WorkspaceContext.Provider>
  )
  const utils = render(ui(widgets))
  return { ...utils, rerenderWith: (w) => utils.rerender(ui(w)) }
}
const tucked = () => document.documentElement.hasAttribute(CHART_TOUCH_ATTR)
const touch = (el, id = 1) => fireEvent.pointerDown(el, { pointerType: 'touch', pointerId: id })
const lift = (id = 1) => fireEvent.pointerUp(window, { pointerType: 'touch', pointerId: id })

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [] }) })))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute(CHART_TOUCH_ATTR)
})

describe('B3 · the shell arms the tuck on the chart', () => {
  test('cold layout: armed once the chart lands; a finger on the chart tucks, the idle brings the buttons back', () => {
    const { rerenderWith } = renderApp([])
    rerenderWith(HYDRATED)
    const canvas = screen.getByTestId('chart-canvas')
    touch(canvas)
    expect(tucked()).toBe(true)
    lift()
    vi.advanceTimersByTime(CHART_TOUCH_IDLE_MS)
    expect(tucked()).toBe(false)
  })

  test('the listener is the chart wrapper, so the toolbar and the symbol strip never tuck anything', () => {
    renderApp(HYDRATED)
    const area = screen.getByTestId('chart-pane').closest('[data-chart-touch-area]')
    expect(area, 'the chart wrapper carries the tuck').not.toBeNull()
    // a press on the shell outside the chart wrapper
    const shell = screen.getByTestId('mobile-charts-app')
    const outside = [...shell.querySelectorAll('*')].find((el) => !area.contains(el) && !el.contains(area))
    expect(outside, 'the shell has chrome outside the chart').toBeTruthy()
    touch(outside)
    expect(tucked()).toBe(false)
  })

  test('the attribute does not outlive the shell', () => {
    const { unmount } = renderApp(HYDRATED)
    touch(screen.getByTestId('chart-canvas'))
    expect(tucked()).toBe(true)
    unmount()
    expect(tucked()).toBe(false)
  })
})

const SRC = (p) => readFileSync(join(process.cwd(), 'src', p), 'utf8').replace(/\r\n/g, '\n')
const css = (p) => SRC(p).replace(/\/\*[\s\S]*?\*\//g, '')

describe('B3 · every floating button reads the one attribute', () => {
  test('the attribute name the CSS readers use IS the hook\'s constant', () => {
    expect(CHART_TOUCH_ATTR).toBe('data-chart-touching')
  })

  test('voice orb: fades and stops taking touches on the chart shell while touched; never mid-call, never mid-drag', () => {
    const s = css('components/voice/FloatingOrb.module.css')
    const sel = `:global(html[data-mobile-chart-shell][${CHART_TOUCH_ATTR}]) .orbCluster:not([data-in-session]):not(.dragging)`
    const at = s.indexOf(sel)
    expect(at, 'the orb rule').toBeGreaterThan(-1)
    expect(s.slice(s.lastIndexOf('@media', at), at)).toMatch(/^@media \(max-width: 1024px\)\s*\{\s*$/)
    const body = /\{([^}]*)\}/.exec(s.slice(at))[1]
    expect(body).toMatch(/opacity:\s*0/)
    expect(body).toMatch(/pointer-events:\s*none/)
  })

  test('feedback "?": slides away like its scroll tuck, but stays while its own menu is open', () => {
    const s = css('components/FeedbackWidget.module.css')
    const sel = `:global(html[data-mobile-chart-shell][${CHART_TOUCH_ATTR}]) .fab:not([aria-expanded='true'])`
    const at = s.indexOf(sel)
    expect(at, 'the feedback rule').toBeGreaterThan(-1)
    const body = /\{([^}]*)\}/.exec(s.slice(at))[1]
    expect(body).toMatch(/opacity:\s*0/)
    expect(body).toMatch(/pointer-events:\s*none/)
    expect(body).toMatch(/transform:\s*translateY\(160%\)/)
    // the button really does announce its menu state through that attribute
    expect(SRC('components/FeedbackWidget.jsx')).toMatch(/aria-expanded=\{Boolean\(mode\)\}/)
  })

  test('joystick hub and its pill: HubShell fades the whole root (pad, knob, chip) from touchTucked, never while the hub is in use', () => {
    const s = SRC('hub/HubRoot.jsx')
    expect(s).toMatch(/hidden: viewportHidden, touchTucked \} = useHubViewport\(\)/)
    expect(s).toMatch(/const touchTuck = touchTucked && !state\.open && !state\.pressing && !state\.dragging/)
    expect(s).toMatch(/opacity: touchTuck \? 0 : 1/)
    expect(s).toMatch(/visibility: touchTuck \? 'hidden' : 'visible'/)
    // the chip is a child of that root, so the fade covers the pill too
    const root = s.indexOf('data-testid="hub-root"')
    const chip = s.indexOf('<HubChip', root)
    const close = s.indexOf('</div>\n  )\n}', root)
    expect(chip).toBeGreaterThan(root)
    expect(chip).toBeLessThan(close)
  })
})

describe('B3 · the phone chart stops above the hub (bottom inset)', () => {
  // ⭐ DERIVED FROM THE HUB'S AND THE TOOLBAR'S OWN DECLARATIONS, never re-typed here,
  // so moving either one without moving the inset fails by name.
  const hub = SRC('hub/HubRoot.jsx')
  const hubBottom = Number(/bottom: 'calc\(env\(safe-area-inset-bottom\) \+ (\d+)px\)'/.exec(hub)[1])
  const hubRoot = hub.slice(hub.indexOf('data-testid="hub-root"'))
  const hubHeight = Number(/height: '(\d+)px'/.exec(hubRoot)[1])
  const shellCss = css('pages/charts/mobile/MobileCharts.module.css')
  const block = (sel) => {
    const m = new RegExp(`(?:^|\\})\\s*${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`, 'm').exec(shellCss)
    expect(m, sel).toBeTruthy()
    return m[1]
  }
  const toolbar = block('.toolbar')
  const btn = block('.tbBtn')
  const pad = /padding:\s*(\d+)px \d+px max\((\d+)px, env\(safe-area-inset-bottom, 0px\)\)/.exec(toolbar)
  const border = Number(/border-top:\s*(\d+)px/.exec(toolbar)[1])
  const tbH = (safe) => border + Number(pad[1]) + 44 /* --tap-min */ + Math.max(Number(pad[2]), safe)
  expect(btn).toMatch(/min-height:\s*var\(--tap-min\)/)

  const at = shellCss.indexOf(':global(html[data-hub-engaged]) .shell:not(.tabletShell) .paneWrap')
  const insetDecl = /padding-bottom:\s*calc\((\d+)px \+ env\(safe-area-inset-bottom, 0px\) - max\((\d+)px, env\(safe-area-inset-bottom, 0px\)\)\)/
    .exec(shellCss.slice(at))
  const inset = (safe) => Number(insetDecl[1]) + safe - Math.max(Number(insetDecl[2]), safe)

  test('scoped to the phone and to a hub that is on screen', () => {
    expect(at).toBeGreaterThan(-1)
    expect(shellCss.slice(shellCss.lastIndexOf('@media', at), at)).toMatch(/^@media \(max-width: 640px\)\s*\{\s*$/)
    // HubRoot is the writer of the attribute the inset keys on
    expect(hub).toMatch(/setAttribute\('data-hub-engaged', ''\)/)
  })

  for (const safe of [0, 5, 21, 34]) {
    test(`clears the hub with 2-8 px to spare at a ${safe} px home-indicator inset`, () => {
      expect(insetDecl, 'the inset declaration').toBeTruthy()
      const overlap = (hubBottom + hubHeight + safe) - tbH(safe)
      expect(overlap, 'the hub reaches into the chart at all').toBeGreaterThan(0)
      expect(inset(safe) - overlap).toBeGreaterThanOrEqual(2)
      expect(inset(safe) - overlap).toBeLessThanOrEqual(8)
    })
  }
})
