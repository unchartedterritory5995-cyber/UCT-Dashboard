import { renderWithProviders, screen } from '../test-utils'
import { vi } from 'vitest'

// The page IS the scanner now — ScannerShell is the whole body. Stub it so this
// stays a test of the page SHELL (heading, container, embedded mode).
vi.mock('./screener/shell/ScannerShell', () => ({ default: () => <div>scanner shell</div> }))

import Screener from './Screener'

test('renders the Screener heading, matching the nav label', () => {
  // ⛔ NOT "Scanner Hub". The hub had three doors; Candidate Board and Live Scan
  // retired 2026-08-29 and one surface is not a hub. `NavBar.jsx` and
  // `MoreSheet.jsx` both label this route "Screener" — a third name for one
  // page is how a member stops believing the nav.
  renderWithProviders(<Screener />)
  expect(screen.getByRole('heading', { name: /^screener$/i })).toBeInTheDocument()
})

test('there is no tab strip — nothing to switch between', () => {
  // The removal's own rail. A tab strip reappearing here means a second surface
  // was added to a page whose whole point is that it has one.
  renderWithProviders(<Screener />)
  expect(screen.queryByRole('button', { name: /candidate board/i })).toBeNull()
  expect(screen.queryByRole('button', { name: /live scan/i })).toBeNull()
})

test('embedded mode drops the heading — the widget shell supplies its own', () => {
  renderWithProviders(<Screener embedded />)
  expect(screen.queryByRole('heading', { name: /screener/i })).toBeNull()
  expect(screen.getByText('scanner shell')).toBeInTheDocument()
})
