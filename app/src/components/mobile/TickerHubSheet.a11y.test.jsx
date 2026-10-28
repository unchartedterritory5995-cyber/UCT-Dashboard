// The Ticker Hub sheet (what a ticker tap opens at <=1024px) through the screen-reader lens.
// Found by a Playwright WebKit + axe-core walk of the live site:
//   1. axe `aria-dialog-name` (serious): VoiceOver announced only "dialog".
//   2. Flag and Alert carried their state as a CSS class and nothing else.
//   3. Compass: visible "Ask Compass about CLS", accessible name "Talk to Compass about chart
//      of CLS" (WCAG 2.5.3 label in name).
//   4. "+ Compare": accessible name "CLS -- click to search a different ticker" -- the wrong
//      action, and without the visible word.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { expectNoAxeViolations } from '../../pages/journal-2-0/a11y/axeHarness'

const flagState = vi.hoisted(() => ({ flagged: false, alert: false }))
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => vi.fn() }))
vi.mock('../../hooks/useFlagged', () => ({
  useFlagged: () => ({ isFlagged: () => flagState.flagged, toggle: () => { flagState.flagged = !flagState.flagged } }),
}))
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../hooks/useWatchlistAlerts', () => ({
  default: () => ({ createAlert: vi.fn(), hasAlert: () => flagState.alert }),
}))
vi.mock('../../hooks/useTickerTweets', () => ({ default: () => ({ data: [] }) }))
vi.mock('../../hooks/useFilingWatch', () => ({
  default: () => ({ enabled: false, watchState: () => 'NOT_WATCHING', getWatch: () => null, createOrReactivate: vi.fn(), suspend: vi.fn() }),
}))
vi.mock('../StockChart', () => ({ default: () => <div data-testid="stock-chart" /> }))
// Stand-ins that keep the REAL naming contract of each component: the name is the
// `ariaLabel` the sheet passes, else the component's own default. Each component's own
// file rails that it honours the prop (CompassAssistButton.test.jsx, SymbolSearch.ariaLabel.test.jsx).
vi.mock('../voice/CompassAssistButton', () => ({
  default: ({ label, ariaLabel, pageHint }) => (
    <button type="button" aria-label={ariaLabel || `Talk to Compass about ${pageHint}`}>{label}</button>
  ),
}))
vi.mock('../chart/SymbolSearch', () => ({
  default: ({ sym, displayLabel, ariaLabel }) => (
    <button type="button" aria-label={ariaLabel || `${sym} — click to search a different ticker`}>{displayLabel}</button>
  ),
}))

import { TickerHubProvider, useTickerHub } from './TickerHubContext'
import TickerHubSheet from './TickerHubSheet'

function Opener() {
  const { openTicker } = useTickerHub()
  return <button onClick={() => openTicker('CLS')}>open CLS</button>
}

function renderOpen() {
  const out = render(
    <MemoryRouter>
      <TickerHubProvider>
        <Opener />
        <TickerHubSheet />
      </TickerHubProvider>
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByText('open CLS'))
  return out
}

/** Visible words of a control, without the decorative emoji. */
const visibleWords = (el) => el.textContent.replace(/[^\p{L}\p{N}\s+]/gu, '').replace(/\s+/g, ' ').trim()

beforeEach(() => { flagState.flagged = false; flagState.alert = false })

describe('TickerHubSheet -- names and states', () => {
  it('the dialog is named by its ticker heading (axe aria-dialog-name)', () => {
    renderOpen()
    const dialog = screen.getByRole('dialog', { name: 'CLS' })
    // the name is the visible heading, not a restated copy
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy).textContent).toBe('CLS')
  })

  it('Flag says whether the ticker is flagged (aria-pressed), and follows a toggle', () => {
    const { rerender } = renderOpen()
    const flag = screen.getByRole('button', { name: 'Flag' })
    expect(flag).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(flag)
    rerender(
      <MemoryRouter>
        <TickerHubProvider>
          <Opener />
          <TickerHubSheet />
        </TickerHubProvider>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('open CLS'))
    expect(screen.getByRole('button', { name: 'Flag' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('Alert says the form is open (aria-expanded) and, when one exists, that an alert is set', () => {
    flagState.alert = true
    renderOpen()
    const alert = screen.getByRole('button', { name: /^Alert/ })
    expect(alert).toHaveAccessibleName('Alert, alert set')
    expect(alert).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(alert)
    expect(alert).toHaveAttribute('aria-expanded', 'true')
  })

  it('Alert with no alert set is just "Alert" -- the state is spoken only when it is true', () => {
    renderOpen()
    expect(screen.getByRole('button', { name: /^Alert/ })).toHaveAccessibleName('Alert')
  })

  it('Compass: the accessible name contains the visible words (WCAG 2.5.3)', () => {
    renderOpen()
    const btn = screen.getByRole('button', { name: /Compass/ })
    expect(visibleWords(btn)).toBe('Ask Compass about CLS')
    expect(btn.getAttribute('aria-label')).toContain(visibleWords(btn))
  })

  it('+ Compare names the COMPARE action and contains its visible word', () => {
    renderOpen()
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
    const btn = screen.getByText('+ Compare').closest('button')
    expect(btn).toHaveAccessibleName('Compare CLS with another ticker')
    expect(btn.getAttribute('aria-label')).not.toMatch(/search a different ticker/)
  })

  it('the chart wrapper is a named region (symbol + timeframe) that keeps its tab stop (type-to-search, Shift+F)', async () => {
    renderOpen()
    // ChartPane is a lazy chunk; cold, under a loaded box, it measured 10-13s here.
    await screen.findByTestId('stock-chart', {}, { timeout: 25000 })
    const region = screen.getByRole('region', { name: 'CLS daily price chart' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(within(region).getByTestId('stock-chart')).toBeInTheDocument()
  }, 60000)

  it('axe finds 0 violations in the open sheet (chart pane mounted)', async () => {
    renderOpen()
    const dialog = screen.getByRole('dialog', { name: 'CLS' })
    // ChartPane is a lazy chunk; cold, under a loaded box, it measured 10-13s here.
    await within(dialog).findByTestId('stock-chart', {}, { timeout: 25000 })
    await expectNoAxeViolations(dialog)
  }, 60000)
})
