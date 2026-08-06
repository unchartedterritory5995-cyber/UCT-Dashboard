import { renderWithProviders, screen, fireEvent } from '../../test-utils'
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

// T11 review round 1, I5 (Important): the brief's literal
// `section={null} onSectionChange={() => {}}` shipped a modal whose section
// rail renders all four tabs but whose clicks do nothing, forever — dead
// controls, not an inert-but-honest default. CatalystFlow now owns real
// local `section` state (still no route hook — brief's reasoning about the
// two live Dashboard instances is unaffected).
test('the section rail is NOT inert — clicking a tab actually switches sections', () => {
  renderWithProviders(<CatalystFlow data={mockData} />)
  fireEvent.click(screen.getByText('CRH'))

  const setupTab = screen.getByRole('tab', { name: 'Setup' })
  const historyTab = screen.getByRole('tab', { name: 'Earnings History' })
  expect(setupTab.getAttribute('aria-selected')).toBe('true')
  expect(historyTab.getAttribute('aria-selected')).toBe('false')

  fireEvent.click(historyTab)

  expect(historyTab.getAttribute('aria-selected')).toBe('true')
  expect(setupTab.getAttribute('aria-selected')).toBe('false')
})
