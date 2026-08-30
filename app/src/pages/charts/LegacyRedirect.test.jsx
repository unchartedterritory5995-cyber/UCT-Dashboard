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
        <Route path="/theme-tracker" element={<LegacyRedirect />} />
        <Route path="/watchlists" element={<LegacyRedirect />} />
        <Route path="/multi-chart" element={<LegacyRedirect />} />
        <Route path="/charts" element={<CurrentUrl />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('/theme-tracker redirects to /charts asking for the themes widget', () => {
  // Theme Tracker is reachable ONLY as the `themes` widget inside /charts —
  // a bare redirect could land on a saved workspace missing it entirely.
  renderAt('/theme-tracker')
  expect(screen.getByTestId('url').textContent).toBe('/charts?ensure=themes')
})

test('preserves non-tab query params from the legacy URL and adds the ensure intent', () => {
  renderAt('/watchlists?id=42&filter=tech')
  expect(screen.getByTestId('url').textContent).toBe('/charts?id=42&filter=tech&ensure=watchlist')
})

test('strips legacy ?tab= param entirely', () => {
  // /multi-chart has no widget-ensure counterpart — only tab= is stripped.
  renderAt('/multi-chart?tab=multichart&keep=me')
  expect(screen.getByTestId('url').textContent).toBe('/charts?keep=me')
})

test('/theme-tracker?tab= drops the legacy tab param but still carries ensure=themes', () => {
  renderAt('/theme-tracker?tab=themes')
  expect(screen.getByTestId('url').textContent).toBe('/charts?ensure=themes')
})
