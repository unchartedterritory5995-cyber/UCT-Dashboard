import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test-utils'
import PatternReview from './PatternReview'
import GoldReview from './GoldReview'

// The chart stand-in renders the props the gold mode is responsible for as
// TEXT, so these tests assert what the reviewer would see (framing + how many
// drawings are on the chart), and exposes one control that edits the draft the
// way the real drawing overlay does: by calling onAnnotationsChange.
vi.mock('../../components/StockChart', () => ({
  default: ({ sym, focusDate, focusStartDate, annotations, annotationsEditable, onAnnotationsChange }) => (
    <div data-testid="stock-chart">
      <span>chart:{sym}</span>
      <span>frame:{focusStartDate || '-'}..{focusDate || '-'}</span>
      <span>drawings:{(annotations || []).length}</span>
      <span>{annotationsEditable ? 'editable' : 'read-only'}</span>
      <button onClick={() => onAnnotationsChange?.([...(annotations || []),
        { id: 'new1', type: 'horizontal', points: [{ time: '2025-03-10', price: 42.5 }] }])}>
        stub-add-line
      </button>
    </div>
  ),
}))

const seedA = [
  { id: 's1', type: 'trendline', points: [{ time: '2025-02-03', price: 10 }, { time: '2025-03-28', price: 12 }] },
  { id: 's2', type: 'horizontal', points: [{ time: '2025-03-28', price: 12.4 }] },
]
let ITEMS
let swrError

vi.mock('swr', () => ({
  default: (key) => {
    if (key && key.startsWith('/api/patterns/admin/gold-items')) {
      return { data: swrError ? undefined : { items: ITEMS, total: ITEMS.length }, error: swrError, mutate: vi.fn() }
    }
    if (key && key.includes('/admin/review')) return { data: { verdicts: [] }, mutate: vi.fn() }
    return { data: undefined, mutate: vi.fn() }
  },
}))

beforeEach(() => {
  swrError = undefined
  ITEMS = [
    { item_id: 'gt-0001', batch: 'gtest', ticker: 'AAAA', tf: 'D', label: 'bull_flag',
      asof_date: '2025-04-01', start_date: '2025-01-02', seed_drawings_json: JSON.stringify(seedA), correction: null },
    { item_id: 'gt-0002', batch: 'gtest', ticker: 'BBBB', tf: 'D', label: 'vcp',
      asof_date: '2025-06-02', start_date: '2025-03-03', seed_drawings_json: '[]', correction: null },
    { item_id: 'gt-0003', batch: 'gtest', ticker: 'CCCC', tf: 'D', label: 'flat_base',
      asof_date: '2025-07-01', start_date: null, seed_drawings_json: '[]',
      correction: { verdict: 'not_a_pattern', note: 'no base', drawings_json: null } },
  ]
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }))
})

function lastBody() {
  const call = globalThis.fetch.mock.calls.at(-1)
  return { url: call[0], body: JSON.parse(call[1].body) }
}

describe('Gold set review mode', () => {
  it('is reachable from the Pattern Review page as a mode', () => {
    renderWithProviders(<PatternReview />)
    fireEvent.click(screen.getByRole('tab', { name: 'Gold set' }))
    expect(screen.getByText(/never change the judge's examples/)).toBeInTheDocument()
    expect(screen.getByTestId('gold-progress')).toHaveTextContent('1 of 3 reviewed')
  })

  it('lists items with their status and shows progress', () => {
    renderWithProviders(<GoldReview />)
    expect(screen.getAllByText('AAAA').length).toBeGreaterThan(0)
    expect(screen.getByText('BBBB')).toBeInTheDocument()
    expect(screen.getAllByText('to do')).toHaveLength(2)
    expect(screen.getByText('not a pattern')).toBeInTheDocument()
    expect(screen.getByTestId('gold-progress')).toHaveTextContent('1 of 3 reviewed')
  })

  it('frames the chart at the item date and seeds the editable draft', () => {
    renderWithProviders(<GoldReview />)
    const chart = screen.getByTestId('stock-chart')
    expect(chart).toHaveTextContent('chart:AAAA')
    expect(chart).toHaveTextContent('frame:2025-01-02..2025-04-01')
    expect(chart).toHaveTextContent('drawings:2')
    expect(chart).toHaveTextContent('editable')
    expect(screen.getByText(/Auto-drawn: 2 objects/)).toBeInTheDocument()
  })

  it('"Correct as drawn" saves verdict ok with the seed geometry and moves to the next item', async () => {
    renderWithProviders(<GoldReview />)
    fireEvent.click(screen.getByText('Correct as drawn'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved AAAA: correct as drawn.'))
    const { url, body } = lastBody()
    expect(url).toBe('/api/patterns/admin/gold-items/gt-0001/correction')
    expect(body.verdict).toBe('ok')
    expect(JSON.parse(body.drawings_json)).toEqual(seedA)
    expect(url).not.toContain('exemplar')
    expect(screen.getByTestId('gold-ticker')).toHaveTextContent('BBBB')
    expect(screen.getByTestId('stock-chart')).toHaveTextContent('frame:2025-03-03..2025-06-02')
    expect(screen.getByTestId('gold-progress')).toHaveTextContent('2 of 3 reviewed')
  })

  it('"Save fix" sends the edited drawings and the note', async () => {
    renderWithProviders(<GoldReview />)
    fireEvent.click(screen.getByText('stub-add-line'))
    expect(screen.getByTestId('stock-chart')).toHaveTextContent('drawings:3')
    fireEvent.change(screen.getByLabelText('Gold note'), { target: { value: 'moved the top line' } })
    fireEvent.click(screen.getByText('Save fix'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved AAAA: fixed.'))
    const { body } = lastBody()
    expect(body.verdict).toBe('fixed')
    expect(body.note).toBe('moved the top line')
    expect(JSON.parse(body.drawings_json)).toHaveLength(3)
  })

  it('"Not a pattern" and "Skip" send no drawings', async () => {
    renderWithProviders(<GoldReview />)
    fireEvent.click(screen.getByText('Not a pattern'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved AAAA: not a pattern.'))
    expect(lastBody().body).toMatchObject({ verdict: 'not_a_pattern', drawings_json: null })
    fireEvent.click(screen.getByText('Skip'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved BBBB: skipped.'))
    expect(lastBody().body).toMatchObject({ verdict: 'skip', drawings_json: null })
    expect(screen.getByTestId('gold-progress')).toHaveTextContent('2 of 3 reviewed · 1 skipped')
  })

  it('a failed save says so and stays on the item', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) }))
    renderWithProviders(<GoldReview />)
    fireEvent.click(screen.getByText('Correct as drawn'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Save failed (403). Nothing was recorded.'))
    expect(screen.getByTestId('gold-ticker')).toHaveTextContent('AAAA')
    expect(screen.getByTestId('gold-progress')).toHaveTextContent('1 of 3 reviewed')
  })

  it('next / prev buttons and the ] [ keys move between items', () => {
    renderWithProviders(<GoldReview />)
    fireEvent.click(screen.getByRole('button', { name: 'Next item' }))
    expect(screen.getByTestId('gold-ticker')).toHaveTextContent('BBBB')
    fireEvent.keyDown(window, { key: ']' })
    expect(screen.getByTestId('gold-ticker')).toHaveTextContent('CCCC')
    expect(screen.getByText(/Current verdict: not a pattern/)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '[' })
    expect(screen.getByTestId('gold-ticker')).toHaveTextContent('BBBB')
    fireEvent.click(screen.getByRole('button', { name: 'Previous item' }))
    expect(screen.getByTestId('gold-ticker')).toHaveTextContent('AAAA')
  })

  it('reset restores the auto-drawn seed after an edit', () => {
    renderWithProviders(<GoldReview />)
    fireEvent.click(screen.getByText('stub-add-line'))
    expect(screen.getByTestId('stock-chart')).toHaveTextContent('drawings:3')
    fireEvent.click(screen.getByText('Reset to auto-drawn'))
    expect(screen.getByTestId('stock-chart')).toHaveTextContent('drawings:2')
  })

  it('says so when nothing is loaded, and when loading failed', () => {
    ITEMS = []
    const { unmount } = renderWithProviders(<GoldReview />)
    expect(screen.getByText('No gold-set items loaded yet.')).toBeInTheDocument()
    unmount()
    swrError = new Error('HTTP 403')
    renderWithProviders(<GoldReview />)
    expect(screen.getByText('Could not load the gold set (HTTP 403).')).toBeInTheDocument()
  })
})
