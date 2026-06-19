import { render, screen, fireEvent } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

// Stub the responsive Sheet so the profile/edit modals render plainly in jsdom.
vi.mock('../../components/mobile/Sheet', () => ({
  default: ({ children, title, open }) =>
    open ? <div data-testid="sheet">{title}{children}</div> : null,
}))

let mockRole = 'pro-user'
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockRole } }),
}))

let mockData = null
vi.mock('swr', () => ({
  default: () => ({ data: mockData, isLoading: false, mutate: vi.fn() }),
}))

import TeamSection from './TeamSection'

const BRACCO = {
  id: 1, name: 'Bracco', role: 'Co-Founder', enabled: 1,
  years_trading: '6 Years', bio: 'Co-runs Uncharted Territory.',
  trading_style: 'Hunts for fat pitches\nSizes up aggressively when conditions align',
  teaching_focus: 'Pattern recognition\nWhen to size up',
  twitter_url: 'https://x.com/Braczyy',
}

beforeEach(() => {
  mockRole = 'pro-user'
  mockData = { team: [BRACCO] }
})

test('card shows name, role, years, and a one-line style tagline', () => {
  render(<TeamSection />)
  expect(screen.getByText('Bracco')).toBeTruthy()
  expect(screen.getByText('Co-Founder')).toBeTruthy()
  expect(screen.getByText('6 Years trading')).toBeTruthy()
  // Tagline = first line of trading style, not the full bio/style block.
  expect(screen.getByText(/Hunts for fat pitches/)).toBeTruthy()
  // Profile sheet is not open until the card is clicked.
  expect(screen.queryByTestId('sheet')).toBeNull()
})

test('clicking a card opens the profile with bio + style + focus bullets', () => {
  render(<TeamSection />)
  fireEvent.click(screen.getByText('Bracco'))
  expect(screen.getByTestId('sheet')).toBeTruthy()
  expect(screen.getByText('Trading Style')).toBeTruthy()
  expect(screen.getByText('Teaching Focus')).toBeTruthy()
  expect(screen.getByText('Co-runs Uncharted Territory.')).toBeTruthy()
  // Both style bullets are rendered as list items.
  expect(screen.getByText('Sizes up aggressively when conditions align')).toBeTruthy()
  expect(screen.getByText('Pattern recognition')).toBeTruthy()
})

test('non-admin sees no edit/delete controls', () => {
  render(<TeamSection />)
  expect(screen.queryByText('Edit')).toBeNull()
  expect(screen.queryByText('Add member')).toBeNull()
})

test('admin sees edit controls and the add form has the strategy fields', () => {
  mockRole = 'admin'
  render(<TeamSection />)
  expect(screen.getByText('Add member')).toBeTruthy()
  fireEvent.click(screen.getByText('Edit'))
  const sheet = screen.getByTestId('sheet')
  expect(sheet.textContent).toContain('Trading style')
  expect(sheet.textContent).toContain('Teaching focus')
  expect(sheet.textContent).toContain('Time trading')
})
