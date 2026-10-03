import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { vi } from 'vitest'
import { renderWithProviders, screen, fireEvent } from '../test-utils'
import NavBar, { NAV_ITEMS } from './NavBar'

test('no free tier: every nav entry, the Morning Wire included, is locked to upgrade', () => {
  // Owner ruling 2026-10-02 (TERM-081 / OI-12), "everything is paywall". Until
  // then the Wire was the one free page and linked to itself here. Paid tools
  // are still not hidden from a non-paid member — they render dimmed + locked
  // and route to /subscribe so the member can see what Pro unlocks.
  renderWithProviders(<NavBar />)
  expect(screen.getByTestId('nav-sidebar')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /morning wire — unlock with pro/i })).toHaveAttribute('href', '/subscribe')
  // DERIVED, not a hand-picked sample: every declared item that renders.
  // (/community is dark-launched and renders nothing until enabled.)
  const rendered = NAV_ITEMS.filter((i) => i.to !== '/community')
  expect(rendered.length).toBeGreaterThan(5)
  for (const item of rendered) {
    const link = screen.getByRole('link', { name: `${item.label} — unlock with Pro` })
    expect(link, `${item.to} is reachable without a paid plan`).toHaveAttribute('href', '/subscribe')
  }
  expect(screen.queryByRole('link', { name: /^morning wire$/i })).toBeNull()
  // Settings is paid-only too (2026-07-19) — locked to upgrade for free users
  expect(screen.getByRole('link', { name: /settings — unlock with pro/i })).toHaveAttribute('href', '/subscribe')
})

test('active link has active class (paid member)', async () => {
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(String(url).startsWith('/api/auth/me')
      ? { user: { id: 1, email: 'p@local', role: 'admin', email_verified: true }, plan: 'lifetime' }
      : {}),
  })))
  try {
    renderWithProviders(<NavBar />, { route: '/morning-wire' })
    const wireLink = await screen.findByRole('link', { name: /^morning wire$/i })
    expect(wireLink).toHaveAttribute('href', '/morning-wire')
    expect(wireLink.className).toMatch(/active/)
  } finally {
    vi.unstubAllGlobals()
  }
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

test('a visible Search trigger (2026-09-03 discoverability slice) calls onOpenPalette on click', () => {
  const onOpenPalette = vi.fn()
  renderWithProviders(<NavBar onOpenPalette={onOpenPalette} />)
  const trigger = screen.getByLabelText('Search — Ctrl+K')
  expect(trigger).toBeInTheDocument()
  fireEvent.click(trigger)
  expect(onOpenPalette).toHaveBeenCalledTimes(1)
})

test('the Search trigger is a plain button, not a nav route — it never navigates', () => {
  // Regression guard: this must stay a button that opens the SAME global
  // palette, never grow its own href/route (that would be a second surface).
  renderWithProviders(<NavBar onOpenPalette={() => {}} />)
  const trigger = screen.getByLabelText('Search — Ctrl+K')
  expect(trigger.tagName).toBe('BUTTON')
  expect(trigger).not.toHaveAttribute('href')
})
