/**
 * D-03 — THE CHART'S `Alert` BUBBLE LANDS AT THE PRICE THE PAGE CALLS "Last price".
 *
 * ⚰️ WHAT THIS RAIL WAS BUILT AGAINST. `chart.alert` is `kind:'confirm'`, and `buildChartFan`
 * used to let it fall through the default arm with NO `run`. `HubRoot`'s confirm branch performs
 * the write from the sheet's primary button — `onConfirm: () => Promise.resolve(action.run?.(ctx))`
 * (`HubRoot.jsx`) — so the member dragged to Alert, read "Alert on NVDA", pressed Create, and
 * NOTHING was created. `Promise.resolve(undefined)` resolves silently: no throw, no warn, no toast.
 *
 * ⛔⛔ AND THE EXISTING RAIL COULD NOT SEE IT. `runActionsHaveHandlers.test.js` is the rail whose
 * whole job is "a bubble that answers a deliberate gesture with silence" — and it filters
 * `kind === 'run'`. The identical defect wearing `kind:'confirm'` walked straight past it. That is
 * why this file asserts on the OUTCOME (an alert created at a named price, and the sentence the
 * member reads) rather than on the presence of a handler.
 *
 * ⭐ THE ONE-AUTHORITY ASSERTION. "Alert at last price" is only true if the hub's price and the
 * page's own `MobileAlertSheet` price are ONE number. Both are read here from the same mocked
 * `useRealtimePrices`, and the sheet's rendered "Last price" text is compared against the value
 * `createAlert` actually received — so a hub that started sourcing its own price would go red even
 * though every call still happened.
 */
import { describe, it as vitestIt, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ⛔ RAIL (house convention): `vitest -t` is a REGEX and a filter matching nothing exits 0.
let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => {
    executedCount += 1
    return fn(...args)
  })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

// ⛔ EVERY MOCKED RETURN VALUE IS IDENTITY-STABLE, and that is not tidiness. `useHubMode`
// re-registers whenever the config object changes identity, and the config is memoised over the
// callbacks the host hands in — so a mock that returns a fresh function each render drives
// register -> setState -> render -> register forever. This harness produced exactly that (an OOM,
// not a failure) before the wrappers below were hoisted out of the hook bodies.
const { state, stable } = vi.hoisted(() => {
  const state = { prices: {}, createAlert: null, emptyPrices: {} }
  const stable = {
    createAlert: (...a) => state.createAlert(...a),
    deleteAlert: () => {},
    getAlertsForSym: () => [],
    alerts: [],
    isFlagged: () => false,
    toggle: () => {},
    flaggedApi: null,
    alertsApi: null,
  }
  stable.flaggedApi = { isFlagged: stable.isFlagged, toggle: stable.toggle }
  stable.alertsApi = {
    createAlert: stable.createAlert,
    deleteAlert: stable.deleteAlert,
    getAlertsForSym: stable.getAlertsForSym,
    alerts: stable.alerts,
  }
  return { state, stable }
})

// ⚠️ ONE price source for BOTH the hub and the page's own sheet — that shared identity is the
// assertion, not a convenience. `streamable()` passes `[]` for a synthetic `$IDX:` symbol, so a
// hook that ignored its argument would make the synthetic case pass for the wrong reason; this
// mock honours the argument.
vi.mock('../../hooks/useRealtimePrices', () => ({
  default: (syms) => ({
    prices: (Array.isArray(syms) ? syms : []).length ? state.prices : state.emptyPrices,
    status: 'idle',
    isStreaming: false,
  }),
}))
vi.mock('../../hooks/useWatchlistAlerts', () => ({ default: () => stable.alertsApi }))
vi.mock('../../hooks/useFlagged', () => ({ useFlagged: () => stable.flaggedApi }))

import useChartHubSection from './chartSection'
import MobileAlertSheet from '../../pages/charts/mobile/MobileAlertSheet'
import { AuthContext } from '../../context/AuthContext'
import { HubProvider, useHub } from '../HubContext'
import { modesById } from '../registry'
import { _reset as resetCursors } from '../useHubCursor'
import { CHART_MODE_ID } from './chartSection'

const AUTH = { user: { id: 1 }, plan: 'free', isPaid: false, loading: false }

let registered = null
function ConfigProbe() {
  registered = useHub().activeModeConfig
  return null
}

/**
 * The page, reduced to the ONE thing this rail is about: a host that calls `useChartHubSection`
 * with a symbol and renders the `hubMount` it hands back. `MobileChartsApp` does exactly this
 * (`MobileChartsApp.jsx`) — the chart engine below it has no part in an alert, so mounting it
 * would add a hundred mocks and measure nothing more.
 */
const NOOP = () => {}
const NO_CUSTOM_TFS = []
function ChartHost({ symbol }) {
  const { hubMount } = useChartHubSection({
    tf: 'D', symbol, customTfs: NO_CUSTOM_TFS, onTf: NOOP,
  })
  return hubMount
}

/** The action as `HubRoot` would find it. */
const alertAction = () => registered?.fan.find((a) => a.id === 'chart.alert')

/**
 * Firing it the way `HubRoot`'s confirm branch does: the sheet's primary button calls
 * `action.run(ctx)` and nothing else (`HubRoot.jsx`). `navigate` is the one field
 * `validateActionCtx` requires.
 */
const pressCreate = async () => {
  await act(async () => { await Promise.resolve(alertAction().run({ navigate: () => {}, symbol: 'NVDA' })) })
}

const renderPage = (symbol = 'NVDA') => render(
  <AuthContext.Provider value={AUTH}>
    <MemoryRouter initialEntries={['/charts']}>
      <HubProvider>
        <ChartHost symbol={symbol} />
        <ConfigProbe />
      </HubProvider>
    </MemoryRouter>
  </AuthContext.Provider>,
)

const realMatchMedia = window.matchMedia
const realVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
const realCSS = globalThis.CSS
const HUB_VIEWPORT_QUERY = '(max-width: 1023px) and (pointer: coarse)'

beforeEach(() => {
  // The capability + viewport floor `useHubEligible` reads. Without these the section's whole
  // mount (bridge + toast) is null and every case below would fail for an unrelated reason.
  globalThis.CSS = { supports: () => true }
  window.visualViewport = { width: 390, height: 800, addEventListener() {}, removeEventListener() {} }
  window.matchMedia = (q) => ({
    matches: q === HUB_VIEWPORT_QUERY,
    media: q,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })
  resetCursors()
  registered = null
  state.prices = { NVDA: { price: 187.4231 } }
  state.createAlert = vi.fn(() => Promise.resolve({ id: 1 }))
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})
afterEach(() => {
  cleanup()
  if (realVisualViewport) Object.defineProperty(window, 'visualViewport', realVisualViewport)
  else delete window.visualViewport
  window.matchMedia = realMatchMedia
  globalThis.CSS = realCSS
  vi.unstubAllGlobals()
})

// ═══════════════════════════════════════════════════════════════════════════
describe('D-03 — Alert at last price', () => {
  it('the registry declares it and the section ships a body — both halves, separately', () => {
    expect(
      modesById[CHART_MODE_ID].fan.some((a) => a.id === 'chart.alert'),
      'the registry no longer declares chart.alert',
    ).toBe(true)
    renderPage()
    expect(alertAction(), 'the page shipped no chart.alert').toBeTruthy()
    expect(
      typeof alertAction().run,
      'chart.alert reached the member with NO `run`. HubRoot\'s confirm branch calls '
      + '`action.run?.(ctx)` from the sheet\'s primary, so the member presses Create and nothing '
      + 'is created — silently, because Promise.resolve(undefined) resolves.',
    ).toBe('function')
    // Control: it is still a `confirm`, so this rail is measuring the confirm path and not a
    // quietly-rewritten `run` action that `runActionsHaveHandlers.test.js` would already cover.
    expect(alertAction().kind).toBe('confirm')
  })

  it('⛔⛔ creates the alert at the SAME number the page calls "Last price"', async () => {
    renderPage()
    await pressCreate()

    expect(state.createAlert, 'no alert was created').toHaveBeenCalledTimes(1)
    const [sym, price, direction] = state.createAlert.mock.calls[0]
    expect(sym).toBe('NVDA')
    expect(direction).toBe('above')

    // ⭐ THE ONE-AUTHORITY HALF. `MobileAlertSheet` is the page's own alert surface and it labels
    // this number "Last price" (`MobileAlertSheet.jsx`). Rendering it here and reading that text
    // is what turns "createAlert was called" into "the hub and the page agree on the price".
    cleanup()
    render(<MobileAlertSheet open onClose={() => {}} sym="NVDA" />)
    const shown = screen.getByText(/Last price/i).textContent.replace(/[^\d.]/g, '')
    expect(
      price.toFixed(2),
      `the hub created the alert at ${price} while the page's own sheet shows ${shown}. `
      + '"Alert at last price" is only one product if those are one number.',
    ).toBe(shown)
  })

  it('says so in the member\'s own words — the rendered sentence, not the state', async () => {
    renderPage()
    await pressCreate()
    // The repo's standing ruling: user-facing feedback is asserted by rendered DOM text. Two
    // toasts shipped blank in this very hub because the copy was never read back.
    expect(screen.getByRole('status').textContent).toBe('Alert set on NVDA at 187.42')
  })

  it('⛔ with NO live price it creates NOTHING and says which symbol', async () => {
    state.prices = {}
    renderPage()
    await pressCreate()
    expect(
      state.createAlert,
      'an alert was created with no price known — that is an alert at a fabricated level, the '
      + 'exact refusal `alertConfirmPayload` (screenerSection.js) already makes for the Screener.',
    ).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('No live price for NVDA')
  })

  it('⛔ a synthetic $IDX: pseudo-ticker is never subscribed, so it refuses too', async () => {
    state.prices = { '$IDX:ai': { price: 12.5 } }
    renderPage('$IDX:ai')
    await pressCreate()
    expect(state.createAlert).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('No live price for $IDX:ai')
  })
})
