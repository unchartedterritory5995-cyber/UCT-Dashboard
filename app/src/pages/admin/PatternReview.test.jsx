import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent } from '../../test-utils'
import PatternReview from './PatternReview'

vi.mock('../../components/StockChart', () => ({
  default: ({ sym }) => <div data-testid="stock-chart">chart:{sym}</div>,
}))
vi.mock('../../utils/chartCapture', () => ({
  captureChartPng: () => 'data:image/png;base64,QQ==',
}))

const VERDICTS = [
  { ticker: 'NVDA', tf: 'D', setup: 'vcp', asof_date: '2026-06-19', confirmed: 1,
    vision_confidence: 82, rationale: 'tight coil',
    checks: [{ criterion: 'tightening', passed: true }], feedback: null },
  { ticker: 'TSLA', tf: 'D', setup: 'bull_flag', asof_date: '2026-06-19', confirmed: 0,
    vision_confidence: 30, rationale: 'no pole', checks: [], feedback: { rating: 'down', note: 'meh' } },
]

vi.mock('swr', () => ({
  default: (key) => {
    if (!key) return { data: undefined, mutate: vi.fn() }
    if (key.includes('/admin/review')) return { data: { verdicts: VERDICTS }, mutate: vi.fn() }
    if (key.includes('/admin/exemplars')) return { data: { exemplars: [] }, mutate: vi.fn() }
    return { data: undefined, mutate: vi.fn() }
  },
}))

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }))
})

describe('PatternReview', () => {
  it('lists confirmed and rejected verdicts', () => {
    renderWithProviders(<PatternReview />)
    expect(screen.getAllByText('NVDA').length).toBeGreaterThan(0)  // list + detail head
    expect(screen.getAllByText('TSLA').length).toBeGreaterThan(0)
    expect(screen.getAllByText('confirmed').length).toBeGreaterThan(0)
    expect(screen.getAllByText('rejected').length).toBeGreaterThan(0)
  })

  it('shows detail (chart + rationale) for the selected verdict', () => {
    renderWithProviders(<PatternReview />)
    expect(screen.getByTestId('stock-chart')).toHaveTextContent('chart:NVDA')
    expect(screen.getByText('“tight coil”')).toBeInTheDocument()
  })

  it('posts feedback when clicking 👍 Agree', async () => {
    renderWithProviders(<PatternReview />)
    fireEvent.click(screen.getByText('👍 Agree'))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/patterns/feedback',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('enters draw mode and offers Save as ideal example', () => {
    renderWithProviders(<PatternReview />)
    fireEvent.click(screen.getByText('✏️ Draw the ideal'))
    expect(screen.getByText('💾 Save as ideal example')).toBeInTheDocument()
  })
})
