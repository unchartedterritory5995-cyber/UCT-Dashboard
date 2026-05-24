import { render, screen, act } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

// Mock the 4 sub-tab components — we only care about which one is visible.
vi.mock('./ChartTab', () => ({ default: () => <div data-testid="tab-chart">CHART</div> }))
vi.mock('../Watchlists', () => ({ default: () => <div data-testid="tab-watchlist">WATCHLIST</div> }))
vi.mock('../ThemeTrackerPage', () => ({ default: () => <div data-testid="tab-themes">THEMES</div> }))
vi.mock('../MultiChart', () => ({ default: () => <div data-testid="tab-multichart">MULTICHART</div> }))

// Mock usePreferences — we control returned prefs and capture setPref calls.
const setPref = vi.fn()
let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, loading: false }),
}))

import ChartsHub from './ChartsHub'

function UrlProbe() {
  const loc = useLocation()
  return <div data-testid="url">{loc.pathname + loc.search}</div>
}

function renderHub(initial = '/charts') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/charts" element={<><ChartsHub /><UrlProbe /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setPref.mockReset()
  mockPrefs = {}
})

test('first visit with no preference lands on Chart sub-tab', async () => {
  renderHub('/charts')
  expect(await screen.findByTestId('tab-chart')).toBeVisible()
})

test('?tab=watchlist activates Watchlist sub-tab', async () => {
  renderHub('/charts?tab=watchlist')
  expect(await screen.findByTestId('tab-watchlist')).toBeVisible()
})

test('returning user with saved preference restores last-visited sub-tab', async () => {
  mockPrefs = { charts_last_tab: 'themes' }
  renderHub('/charts')
  expect(await screen.findByTestId('tab-themes')).toBeVisible()
})

test('?tab= URL param wins over saved preference', async () => {
  mockPrefs = { charts_last_tab: 'themes' }
  renderHub('/charts?tab=multichart')
  expect(await screen.findByTestId('tab-multichart')).toBeVisible()
})

test('clicking a sub-tab updates URL and saves preference', async () => {
  renderHub('/charts')
  await screen.findByTestId('tab-chart')
  act(() => {
    screen.getByRole('tab', { name: /themes/i }).click()
  })
  expect(await screen.findByTestId('tab-themes')).toBeVisible()
  expect(screen.getByTestId('url').textContent).toBe('/charts?tab=themes')
  expect(setPref).toHaveBeenCalledWith('charts_last_tab', 'themes')
})

test('lazy-mount: unvisited sub-tabs are not in the DOM', async () => {
  renderHub('/charts?tab=chart')
  await screen.findByTestId('tab-chart')
  expect(screen.queryByTestId('tab-watchlist')).not.toBeInTheDocument()
  expect(screen.queryByTestId('tab-themes')).not.toBeInTheDocument()
  expect(screen.queryByTestId('tab-multichart')).not.toBeInTheDocument()
})

test('visited sub-tabs stay mounted (display:none) after switching', async () => {
  renderHub('/charts?tab=chart')
  await screen.findByTestId('tab-chart')
  act(() => {
    screen.getByRole('tab', { name: /watchlist/i }).click()
  })
  await screen.findByTestId('tab-watchlist')
  // Previously-visited Chart still in DOM
  expect(screen.getByTestId('tab-chart')).toBeInTheDocument()
})

test('seeds context from ?sym= and exposes it to active sub-tab', async () => {
  // ChartTab mock doesn't read context; we just verify the URL is honored
  // and the active tab renders. Full context wiring covered in Task 3.
  renderHub('/charts?tab=chart&sym=NVDA')
  expect(await screen.findByTestId('tab-chart')).toBeVisible()
  // URL preserved
  expect(screen.getByTestId('url').textContent).toContain('sym=NVDA')
})
