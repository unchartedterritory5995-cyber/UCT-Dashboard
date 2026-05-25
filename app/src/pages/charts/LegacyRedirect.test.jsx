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

test('/theme-tracker redirects to /charts', () => {
  renderAt('/theme-tracker')
  expect(screen.getByTestId('url').textContent).toBe('/charts')
})

test('preserves non-tab query params from the legacy URL', () => {
  renderAt('/watchlists?id=42&filter=tech')
  expect(screen.getByTestId('url').textContent).toBe('/charts?id=42&filter=tech')
})

test('strips legacy ?tab= param entirely', () => {
  renderAt('/multi-chart?tab=multichart&keep=me')
  expect(screen.getByTestId('url').textContent).toBe('/charts?keep=me')
})

test('redirects with empty query when only ?tab= was present', () => {
  renderAt('/theme-tracker?tab=themes')
  expect(screen.getByTestId('url').textContent).toBe('/charts')
})
