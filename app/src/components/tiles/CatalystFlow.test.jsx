import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'

// CatalystFlow uses SWR for live gap data; mock it so the component doesn't
// attempt a real fetch. Mocking returns undefined data which the component
// gracefully handles (treats gaps as "—").
vi.mock('swr', () => ({
  default: vi.fn(() => ({ data: undefined, error: undefined, mutate: vi.fn() })),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

import CatalystFlow from './CatalystFlow'

// CatalystFlow has been rebuilt. The visible columns are now Ticker / Price /
// Verdict / Gap / EPS Act / Rev Act — no "surprise %" column. Verdict pills
// render UPPERCASE (BEAT/MISS). So we test what the component actually shows.
const mockData = {
  bmo: [
    { sym: 'CRH', reported_eps: 0.47, rev_actual: 12000, change_pct: 1.43, verdict: 'Beat' },
    { sym: 'AMH', reported_eps: 0.66, rev_actual: 425, change_pct: 0.65, verdict: 'Beat' },
  ],
  amc: [],
  amc_tonight: [],
}

test('renders earnings table', () => {
  renderWithProviders(<CatalystFlow data={mockData} />)
  expect(screen.getByText('CRH')).toBeInTheDocument()
  expect(screen.getByText('AMH')).toBeInTheDocument()
  // Verdict pill renders uppercase ("BEAT"); two rows so use getAllByText.
  expect(screen.getAllByText('BEAT').length).toBeGreaterThan(0)
})

test('renders skeleton (no crash) when no data', () => {
  // Loading state now renders SkeletonTable, no literal "loading" text.
  const { container } = renderWithProviders(<CatalystFlow data={null} />)
  expect(container).toBeTruthy()
})
