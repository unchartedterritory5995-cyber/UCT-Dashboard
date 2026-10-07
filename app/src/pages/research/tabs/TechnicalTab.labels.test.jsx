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
})
