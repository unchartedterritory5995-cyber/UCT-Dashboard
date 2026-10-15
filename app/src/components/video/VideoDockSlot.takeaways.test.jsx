// Key takeaways open collapsed to four bullets with a "Show all" toggle, and a
// new video starts collapsed again. Fetch-stub idiom from
// VideoDockSlot.returns.test.jsx.
import { fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderWithProviders, screen } from '../../test-utils'
import VideoDockSlot from './VideoDockSlot'
import * as store from './videoStore'

vi.mock('../../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(),
  prefetchBars: vi.fn(),
  prefetchBar: vi.fn(),
  default: vi.fn(),
}))
vi.mock('../chart/pane/ChartPane', () => ({ default: () => <div /> }))

const LIST = [
  { id: 701, youtube_id: 'sess0000701', title: 'Session A' },
  { id: 702, youtube_id: 'sess0000702', title: 'Session B' },
]
const insightsFor = (n) => ({
  chapters: [], ticker_moments: [], has_transcript: false, headline: '',
  summary: Array.from({ length: n }, (_, i) => `Takeaway number ${i + 1}`),
  setups: [], has_poster: false, poster_url: null,
})

function stubFetch(n) {
  vi.stubGlobal('fetch', vi.fn((url) =>
    String(url).includes('/insights')
      ? Promise.resolve({ ok: true, json: async () => insightsFor(n) })
      : Promise.resolve({ ok: false }),
  ))
}

beforeEach(() => { window.localStorage.clear(); store.__reset() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('VideoDockSlot key takeaways', () => {
  it('shows four, expands to all, and collapses back', async () => {
    stubFetch(6)
    act(() => store.play(LIST, 0))
    renderWithProviders(<VideoDockSlot />)
    expect(await screen.findByText('Takeaway number 4')).toBeInTheDocument()
    expect(screen.queryByText('Takeaway number 5')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 6 takeaways' }))
    expect(screen.getByText('Takeaway number 6')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.queryByText('Takeaway number 6')).not.toBeInTheDocument()
  })

  it('offers no toggle when there are four or fewer', async () => {
    stubFetch(4)
    act(() => store.play(LIST, 0))
    renderWithProviders(<VideoDockSlot />)
    expect(await screen.findByText('Takeaway number 4')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument()
  })

  it('a different video starts collapsed again', async () => {
    stubFetch(6)
    act(() => store.play(LIST, 0))
    renderWithProviders(<VideoDockSlot />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show all 6 takeaways' }))
    expect(screen.getByText('Takeaway number 6')).toBeInTheDocument()
    act(() => store.next())
    expect(await screen.findByRole('button', { name: 'Show all 6 takeaways' })).toBeInTheDocument()
    expect(screen.queryByText('Takeaway number 6')).not.toBeInTheDocument()
  })
})
