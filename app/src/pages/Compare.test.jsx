import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import Compare from './Compare'

function renderCompare() {
  return render(
    <MemoryRouter>
      <Compare />
    </MemoryRouter>,
  )
}

test('renders the hero headline', () => {
  renderCompare()
  expect(
    screen.getByRole('heading', { name: /The journal that coaches before the trade\./i }),
  ).toBeInTheDocument()
})

test('renders the comparison table with all four columns', () => {
  renderCompare()
  const table = screen.getByRole('table')
  expect(table).toBeInTheDocument()
  for (const col of ['UCT Intelligence', 'TradeZella', 'TraderSync', 'Tradervue']) {
    expect(screen.getByRole('columnheader', { name: col })).toBeInTheDocument()
  }
  // The feature rows exist.
  expect(screen.getByRole('rowheader', { name: 'AI coaching' })).toBeInTheDocument()
  expect(screen.getByRole('rowheader', { name: 'Broker data' })).toBeInTheDocument()
})

test('states the "no credits, ever" differentiator and the counter-position copy', () => {
  renderCompare()
  expect(screen.getByText(/Unlimited — no credits, ever/)).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { name: /Coaching before the trade beats replaying after it\./i }),
  ).toBeInTheDocument()
})

test('CTAs point at /signup and the switch line is present', () => {
  renderCompare()
  const signupLinks = screen.getAllByRole('link', { name: /Start free/i })
  expect(signupLinks.length).toBeGreaterThan(0)
  signupLinks.forEach((l) => expect(l).toHaveAttribute('href', '/signup'))
  const switchLink = screen.getByRole('link', {
    name: /Switch in 30 minutes — import your TradeZella history/i,
  })
  expect(switchLink).toHaveAttribute('href', '/signup')
})

test('contains NO emoji and no literal check/cross glyphs', () => {
  const { container } = renderCompare()
  const text = container.textContent || ''
  // Emoji planes + Misc-Symbols/Dingbats block (includes ✓ U+2713, ✗ U+2717).
  const emojiRe = /[\u{1F000}-\u{1FAFF}☀-➿]/u
  expect(emojiRe.test(text)).toBe(false)
  // Belt-and-suspenders: no literal check / cross characters anywhere.
  expect(text.includes('✓')).toBe(false) // ✓
  expect(text.includes('✗')).toBe(false) // ✗
  expect(text.includes('✔')).toBe(false) // ✔
  expect(text.includes('✖')).toBe(false) // ✖
})

test('fires a compare_view analytics event on mount', () => {
  // landingTrack.track posts via sendBeacon/fetch; assert it is invoked once.
  const beacon = vi.fn(() => true)
  vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon })
  renderCompare()
  expect(beacon).toHaveBeenCalled()
  vi.unstubAllGlobals()
})
