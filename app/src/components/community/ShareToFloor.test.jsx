// FIX C (8/21 UI stress sweep, zero_a11y_name:_btnCompact_97moi_3): in compact
// mode (used in tight spaces like table rows) this button renders ICON ONLY —
// no visible text span — and previously carried only a `title`, which the
// sweep's a11y check (aria-label OR textContent) never reads. Pins the fix.
import { render, screen } from '@testing-library/react'
import { vi, test, expect } from 'vitest'

vi.mock('swr', () => ({ default: () => ({ data: { chat_enabled: true } }) }))

import ShareToFloor from './ShareToFloor'

const CARD = { kind: 'chart', sym: 'AAPL' }

test('compact + direct mode: the icon-only share button has an accessible name', () => {
  render(<ShareToFloor card={CARD} compact direct />)
  expect(screen.getByRole('button', { name: 'Share to The Floor' })).toBeInTheDocument()
})

test('compact + popover-trigger mode: the icon-only share button has an accessible name', () => {
  render(<ShareToFloor card={CARD} compact />)
  expect(screen.getByRole('button', { name: 'Share to The Floor' })).toBeInTheDocument()
})

test('non-compact mode keeps its visible label text (no aria-label needed)', () => {
  render(<ShareToFloor card={CARD} label="Share to Floor" />)
  const btn = screen.getByRole('button', { name: 'Share to Floor' })
  expect(btn).not.toHaveAttribute('aria-label')
})
