import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import LegacyRedirect from './LegacyRedirect'

function CurrentUrl() {
  const loc = useLocation()
  return <div data-testid="url">{loc.pathname + loc.search}</div>
}

function renderAt(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/theme-tracker" element={<LegacyRedirect tab="themes" />} />
        <Route path="/watchlists" element={<LegacyRedirect tab="watchlist" />} />
        <Route path="/multi-chart" element={<LegacyRedirect tab="multichart" />} />
        <Route path="/charts" element={<CurrentUrl />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('/theme-tracker redirects to /charts?tab=themes', () => {
  renderAt('/theme-tracker')
  expect(screen.getByTestId('url').textContent).toBe('/charts?tab=themes')
})

test('preserves extra query params from the legacy URL', () => {
  renderAt('/watchlists?id=42&filter=tech')
  // Order of params in URLSearchParams output is insertion order
  expect(screen.getByTestId('url').textContent).toBe('/charts?tab=watchlist&id=42&filter=tech')
})

test('legacy ?tab= param is dropped (we set our own)', () => {
  renderAt('/multi-chart?tab=ignored&keep=me')
  expect(screen.getByTestId('url').textContent).toBe('/charts?tab=multichart&keep=me')
})
