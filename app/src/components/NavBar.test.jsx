import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { renderWithProviders, screen } from '../test-utils'
import NavBar from './NavBar'

test('free tier: Morning Wire links to its page, everything else is locked to upgrade', () => {
  // Free tier (default, no paid plan). Morning Wire is the ONLY free page
  // (owner decision 2026-07-19). Paid tools are not hidden — they render
  // dimmed + locked and route to /subscribe so a free user can see what
  // Pro unlocks.
  renderWithProviders(<NavBar />)
  expect(screen.getByTestId('nav-sidebar')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /morning wire/i })).toHaveAttribute('href', '/morning-wire')
  // Everything else is VISIBLE but routed to the upgrade page
  expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('href', '/subscribe')
  expect(screen.getByRole('link', { name: /breadth/i })).toHaveAttribute('href', '/subscribe')
  expect(screen.getByRole('link', { name: /^charts — unlock with pro$/i })).toHaveAttribute('href', '/subscribe')
  expect(screen.getByRole('link', { name: /model book/i })).toHaveAttribute('href', '/subscribe')
  expect(screen.getByRole('link', { name: /calendar/i })).toHaveAttribute('href', '/subscribe')
  // Settings is paid-only too (2026-07-19) — locked to upgrade for free users
  expect(screen.getByRole('link', { name: /settings — unlock with pro/i })).toHaveAttribute('href', '/subscribe')
})

test('active link has active class', () => {
  renderWithProviders(<NavBar />, { route: '/morning-wire' })
  const wireLink = screen.getByRole('link', { name: /morning wire/i })
  expect(wireLink.className).toMatch(/active/)
})

test('Flow Scoreboard is reachable from the nav, not only from a dashboard tile', () => {
  // /flow-scoreboard has been a live, working route (restored 2026-08-09,
  // railed by lostDoors.route.test.jsx) with no nav entry — the dashboard
  // tile was its only discoverable path. readFileSync(new URL(...)) throws
  // on this Windows/vitest setup, so use the established fileURLToPath +
  // dirname/join pattern (see AlertBell.delivery.test.jsx).
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, 'NavBar.jsx'), 'utf8')
  expect(src).toContain("to: '/flow-scoreboard'")
})
