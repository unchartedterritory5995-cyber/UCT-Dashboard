// TECH: setup names come from the pattern engine; the fallback keeps acronyms
// (quality pass 2026-10-05: "Macd Bullish Cross", "Avwap Reclaim" reached members).
import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen } from '../../../test-utils'

vi.mock('../../../components/StockChart', () => ({ default: () => <div data-testid="stock-chart" /> }))
let mockReturn
vi.mock('../hooks/useTechnical', () => ({ default: () => mockReturn }))
import TechnicalTab, { setupLabel } from './TechnicalTab'

describe('setupLabel', () => {
  it('prefers the server name', () => {
    expect(setupLabel('macd_bullish_cross', 'MACD Bullish Crossover')).toBe('MACD Bullish Crossover')
  })
  it.each([
    ['macd_bullish_cross', 'MACD Bullish Cross'],
    ['avwap_reclaim', 'AVWAP Reclaim'],
    ['vsa_no_demand', 'VSA No Demand'],
    ['bull_flag', 'Bull Flag'],
  ])('falls back to %s -> %s', (id, out) => { expect(setupLabel(id)).toBe(out) })

  it('the verdict card renders the engine name', () => {
    mockReturn = { isLoading: false, data: { evaluated: 1, verdicts: [{
      setup: 'macd_bullish_cross', setup_name: 'MACD Bullish Crossover', tf: 'D', asof_date: '2026-10-02',
      confirmed: 1, vision_confidence: 80, rationale: 'r', key_level: 10, checks: [] }] } }
    renderWithProviders(<TechnicalTab sym="AMD" />, { route: '/research/AMD' })
    expect(screen.getAllByTestId('technical-verdict-card')[0].textContent).toMatch(/^MACD Bullish Crossover/)
    expect(document.body.textContent).not.toMatch(/Macd/)
  })

  it('the chosen verdict card is a pressed toggle, so the choice is not colour alone (lane C audit)', async () => {
    const { fireEvent } = await import('@testing-library/react')
    const v = (setup, d) => ({ setup, tf: 'D', asof_date: d, confirmed: 1, key_level: 10, checks: [] })
    mockReturn = { isLoading: false, data: { evaluated: 2, verdicts: [v('bull_flag', '2026-10-02'), v('vcp', '2026-10-01')] } }
    renderWithProviders(<TechnicalTab sym="AMD" />, { route: '/research/AMD' })
    const picks = screen.getAllByTestId('technical-verdict-pick')
    expect(picks.map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
    fireEvent.click(picks[1])
    expect(screen.getAllByTestId('technical-verdict-pick').map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  })

  it('the card is not one giant button: only its title is, named by the setup (wave 3)', () => {
    mockReturn = { isLoading: false, data: { evaluated: 1, verdicts: [{
      setup: 'bull_flag', tf: 'D', asof_date: '2026-10-02', confirmed: 1, rationale: 'Tight flag on volume', key_level: 10,
      checks: [{ criterion: 'Pole over 20%', passed: true }] }] } }
    renderWithProviders(<TechnicalTab sym="AMD" />, { route: '/research/AMD' })
    const card = screen.getAllByTestId('technical-verdict-card')[0]
    expect(card.tagName).not.toBe('BUTTON')
    expect(card.querySelector('button ul, button div')).toBeNull()
    expect(screen.getByRole('button', { name: 'Bull Flag' }).getAttribute('aria-pressed')).toBe('true')
    expect(card.querySelector('ul').textContent).toContain('Pole over 20%')
  })
})
