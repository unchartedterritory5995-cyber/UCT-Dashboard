// app/src/pages/dashboard/ZoneDoors.route.test.jsx
//
// ⭐ Reads the hrefs ZoneDoors ITSELF renders and resolves them against the
// real route table (indirectly — the manifest doors.js is the authority
// doors.test.js already checks against App.jsx). The component is the
// authority for what it renders; this test is a reader. See
// app/src/routes/lostDoors.route.test.jsx for why a component test alone
// cannot be the rail for a door.
//
// ⛔ Mocks `useMobileSWR`, NOT `swr`. ZoneDoors polls through the mobile-aware
// wrapper (see the ruling documented in ZoneDoors.jsx) — a bare `useSWR`
// mock would still work mechanically (useMobileSWR calls useSWR internally),
// but it would not be testing what the component actually calls, and it
// would silently stop catching a regression back to a bare `useSWR` call
// (which is exactly the shape `pollingSites.rail.test.js` exists to catch in
// the full suite; this file is a fast, targeted second check on the same
// decision).
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect, vi, beforeEach } from 'vitest'
import ZoneDoors from './ZoneDoors'
import { DOORS } from './doors'

let mockData

vi.mock('../../hooks/useMobileSWR', () => ({
  default: () => ({ data: mockData }),
}))

beforeEach(() => { mockData = undefined })

test('renders one link per door, each pointing at its manifest route', () => {
  mockData = {}
  render(<MemoryRouter><ZoneDoors /></MemoryRouter>)
  const hrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'))
  expect(hrefs.sort()).toEqual(DOORS.map(d => d.to).sort())
})

test('a card carrying a numeric value renders the number on its door', () => {
  const breadthDoor = DOORS.find(d => d.key === 'breadth')
  mockData = { breadth: { label: 'Exposure', value: 87, tone: 'neutral' } }
  render(<MemoryRouter><ZoneDoors /></MemoryRouter>)
  // No whitespace text node sits between the two adjacent <span> siblings, so
  // the accessible name concatenates them with no space — "Breadth87".
  const link = screen.getByRole('link', { name: `${breadthDoor.label}87` })
  expect(link.textContent).toContain('87')
})

// ⭐ Three of the eight cards (desk, journal, community) are PERMANENTLY null
// — the backend cannot put per-user data in a 60s shared-cache endpoint. A
// null-value card is a normal state, not an error, and must render as a
// plain link with no number.
test('a null-value card renders as a plain link with no number', () => {
  const deskDoor = DOORS.find(d => d.key === 'desk')
  mockData = { desk: { label: 'New', value: null, tone: 'neutral' } }
  render(<MemoryRouter><ZoneDoors /></MemoryRouter>)
  const link = screen.getByRole('link', { name: deskDoor.label })
  expect(link.textContent).toBe(deskDoor.label)
})

test('undefined data (still loading, or the fetch failed) renders every door as a plain link, never a crash', () => {
  mockData = undefined
  expect(() => render(<MemoryRouter><ZoneDoors /></MemoryRouter>)).not.toThrow()
  const hrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'))
  expect(hrefs.sort()).toEqual(DOORS.map(d => d.to).sort())
  for (const d of DOORS) {
    expect(screen.getByRole('link', { name: d.label }).textContent).toBe(d.label)
  }
})
