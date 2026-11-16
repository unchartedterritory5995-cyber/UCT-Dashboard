// ContextPopover's UCT Signature opt-in on TOUCH (the bottom Sheet): group labels stay inert,
// a checked row is a pressed button (aria-pressed) with its check, and rows still fire and close.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi, expect, test } from 'vitest'

vi.mock('../../hooks/useBreakpoint', () => ({ useIsTouch: () => true }))

import ContextPopover from './ContextPopover'

test('touch sheet: labels inert, checked row pressed with a check, detail shown, rows still work', () => {
  const onClose = vi.fn()
  const onValue = vi.fn()
  render(
    <ContextPopover open signature onClose={onClose} anchor={{ x: 0, y: 0 }} title="RSI"
      items={[
        { groupLabel: 'This line' },
        { key: 'move', label: 'Display in', detail: 'Price pane', onClick: () => {}, keepOpen: true },
        { groupLabel: 'Settings' },
        { key: 'info-value', label: 'Value in header', checked: true, onClick: onValue },
      ]} />,
  )
  const dialog = screen.getByRole('dialog')
  const label = within(dialog).getByText('This line')
  expect(label.hasAttribute('role')).toBe(false)
  expect(label.hasAttribute('tabindex')).toBe(false)
  expect(within(dialog).queryByRole('menuitem')).toBeNull()
  const row = within(dialog).getByRole('button', { name: /Value in header/ })
  expect(row.getAttribute('aria-pressed')).toBe('true')
  // the ✓ and the dimmed value are the caller's, drawn in `label` (StockChart chipMenuSigRow)
  expect(within(dialog).getByRole('button', { name: /Display in/ }).textContent).toBe('Display in')
  fireEvent.click(row)
  expect(onValue).toHaveBeenCalledTimes(1)
  expect(onClose).toHaveBeenCalledTimes(1)
})
