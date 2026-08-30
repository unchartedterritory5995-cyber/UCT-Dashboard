// app/src/pages/charts/LegacyRedirect.themes.test.jsx
//
// /theme-tracker used to land on bare /charts. If the member's saved
// workspace had no themes widget, the door opened onto a room that did not
// contain the thing they asked for. This rail asserts the redirect carries
// an intent the workspace can honour.
//
// These are behavioral (URL-based) assertions rather than a source-string
// match: `params.set('ensure', 'themes')` never puts the literal substring
// "ensure=themes" in LegacyRedirect.jsx's source, so a text-search test
// would fail against correct code. Reading the resulting URL through
// react-router's own `useLocation()` (the same technique the sibling
// LegacyRedirect.test.jsx already uses) verifies the real behavior instead.
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { test, expect } from 'vitest'
import LegacyRedirect from './LegacyRedirect'

function CurrentUrl() {
  const loc = useLocation()
  return <div data-testid="dest">{loc.pathname + loc.search}</div>
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
  renderAt('/theme-tracker')
  expect(screen.getByTestId('dest').textContent).toBe('/charts?ensure=themes')
})

test('/watchlists redirects to /charts asking for the watchlist widget', () => {
  renderAt('/watchlists')
  expect(screen.getByTestId('dest').textContent).toBe('/charts?ensure=watchlist')
})

test('/multi-chart carries no ensure intent — it has no single widget counterpart', () => {
  // The control: a legacy door that was NOT given an ensure mapping must not
  // pick one up by accident.
  renderAt('/multi-chart')
  expect(screen.getByTestId('dest').textContent).toBe('/charts')
})
