import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent } from '../../test-utils'
import StudyGallery from './StudyGallery'

// A gallery card must not say "No stored bars" when the bars read FAILED.
// Only the route's own 404 means the item has no chart; a 429 or a 5xx says
// nothing about the data, and an owner grading off a false "no bars" can
// reject a good item. Asserted by rendered text.

vi.mock('../../components/StockChart', () => ({
  default: ({ sym }) => <div data-testid="stock-chart">chart:{sym}</div>,
}))

const ITEM = {
  id: 'si_a', sym: 'NVDA', asof: '2025-06-02', review_status: 'draft',
  prompt_json: { subject: 'Doji', chart: { tf: 'D' } }, reveal_json: {},
}

let BARS_RESULT
const RETRY = vi.fn()

vi.mock('swr', () => ({
  default: (key) => {
    if (key && key.startsWith('/api/study/admin/review')) {
      return { data: { drafts: [ITEM] }, error: undefined, mutate: vi.fn() }
    }
    if (key && /^\/api\/study\/admin\/items\/[^/]+\/bars$/.test(key)) {
      return { ...BARS_RESULT, mutate: RETRY }
    }
    return { data: undefined, error: undefined, mutate: vi.fn() }
  },
}))

function httpError(status) {
  const e = new Error(`HTTP ${status}`)
  e.status = status
  return e
}

describe('StudyGallery card: a failed bars read is not "no stored bars"', () => {
  beforeEach(() => { RETRY.mockClear() })

  it('a 429 says the bars could not be loaded and offers Retry', () => {
    BARS_RESULT = { data: undefined, error: httpError(429) }
    renderWithProviders(<StudyGallery skill="candle.doji" />)
    expect(screen.getByText(/Could not load the bars \(HTTP 429\)\./)).toBeInTheDocument()
    expect(screen.queryByText('No stored bars')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(RETRY).toHaveBeenCalledTimes(1)
  })

  it('a 500 is a failed load too', () => {
    BARS_RESULT = { data: undefined, error: httpError(500) }
    renderWithProviders(<StudyGallery skill="candle.doji" />)
    expect(screen.getByText(/Could not load the bars \(HTTP 500\)\./)).toBeInTheDocument()
    expect(screen.queryByText('No stored bars')).not.toBeInTheDocument()
  })

  it('THE CONTROL: the route\'s 404 still reads "No stored bars"', () => {
    BARS_RESULT = { data: undefined, error: httpError(404) }
    renderWithProviders(<StudyGallery skill="candle.doji" />)
    expect(screen.getByText('No stored bars')).toBeInTheDocument()
    expect(screen.queryByText(/Could not load the bars/)).not.toBeInTheDocument()
  })
})
