import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import ContextPopover from './ContextPopover'

// Desktop (matchMedia matches:false) → anchored menu path.

test('renders items and title (desktop anchored menu)', () => {
  render(
    <ContextPopover open onClose={() => {}} anchor={{ x: 10, y: 10 }} title="AAPL"
      items={[{ label: 'Flag' }, { label: 'Remove', danger: true }]} />,
  )
  expect(screen.getByText('AAPL')).toBeInTheDocument()
  expect(screen.getByText('Flag')).toBeInTheDocument()
  expect(screen.getByText('Remove')).toBeInTheDocument()
})

test('clicking an item fires its onClick and then onClose', () => {
  const onClose = vi.fn()
  const onClick = vi.fn()
  render(
    <ContextPopover open onClose={onClose} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Flag', onClick }]} />,
  )
  fireEvent.click(screen.getByText('Flag'))
  expect(onClick).toHaveBeenCalledTimes(1)
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('keepOpen item does not auto-close', () => {
  const onClose = vi.fn()
  render(
    <ContextPopover open onClose={onClose} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Tag', onClick: () => {}, keepOpen: true }]} />,
  )
  fireEvent.click(screen.getByText('Tag'))
  expect(onClose).not.toHaveBeenCalled()
})

test('renders nothing when closed', () => {
  render(<ContextPopover open={false} onClose={() => {}} items={[{ label: 'Flag' }]} />)
  expect(screen.queryByText('Flag')).toBeNull()
})


// ─── keyboard containment on the DESKTOP anchored menu ──────────────────────
//
// The touch branch is a `Sheet`, which traps, focuses and restores. This is the
// other branch: a `role="menu"` portalled to <body> that had NO focus
// management, so focus stayed on the trigger, Tab walked the page behind an
// open menu, and a screen-reader user was never taken to the menu at all.

test('opening moves focus INTO the menu', () => {
  render(
    <ContextPopover open onClose={() => {}} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Flag' }, { label: 'Remove' }]} />,
  )
  expect(document.activeElement).toBe(screen.getByText('Flag').closest('button'))
})

test('Tab from the last item wraps to the first, and Shift+Tab back', () => {
  render(
    <ContextPopover open onClose={() => {}} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Flag' }, { label: 'Remove' }]} />,
  )
  const first = screen.getByText('Flag').closest('button')
  const last = screen.getByText('Remove').closest('button')

  last.focus()
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(document.activeElement).toBe(first)

  first.focus()
  fireEvent.keyDown(document, { key: 'Shift+Tab', shiftKey: true })
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(last)
})

test('closing restores focus to whatever had it before', () => {
  const trigger = document.createElement('button')
  trigger.textContent = 'open me'
  document.body.appendChild(trigger)
  trigger.focus()
  expect(document.activeElement).toBe(trigger)

  const { rerender } = render(
    <ContextPopover open onClose={() => {}} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Flag' }]} />,
  )
  expect(document.activeElement).not.toBe(trigger)

  rerender(
    <ContextPopover open={false} onClose={() => {}} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Flag' }]} />,
  )
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})

