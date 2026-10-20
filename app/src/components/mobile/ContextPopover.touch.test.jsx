// The touch branch of ContextPopover: a bottom Sheet (a dialog) whose rows are plain buttons.
//
// Every other ContextPopover suite pins `useIsTouch` to false, so this branch had no test at
// all. It is the one a phone member actually gets: the chart embed's More menu, the touch
// tier's Block actions button, the drawing and chart region menus.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi, expect, test } from 'vitest'

vi.mock('../../hooks/useBreakpoint', () => ({ useIsTouch: () => true }))

import ContextPopover from './ContextPopover'

const renderMenu = (props = {}) => {
  const onClose = vi.fn()
  const onFlag = vi.fn()
  render(
    <ContextPopover
      open onClose={onClose} anchor={{ x: 0, y: 0 }} title="NVDA"
      items={[
        { label: 'Flag', onClick: onFlag },
        { label: 'Open in Charts', href: '/charts?sym=NVDA' },
        { separator: true },
        { label: 'Remove', danger: true },
      ]}
      {...props}
    />,
  )
  return { onClose, onFlag }
}

test('the rows render as plain buttons inside a Sheet, not as a menu', () => {
  renderMenu()
  const sheet = screen.getByRole('dialog')
  expect(within(sheet).getByText('NVDA')).toBeTruthy()
  expect(within(sheet).getByRole('button', { name: 'Flag' })).toBeTruthy()
  expect(within(sheet).getByRole('button', { name: 'Remove' })).toBeTruthy()
  // the desktop branch's roles do not leak into the sheet
  expect(screen.queryByRole('menu')).toBeNull()
  expect(screen.queryByRole('menuitem')).toBeNull()
})

test('a separator renders between the rows (without the menu role)', () => {
  renderMenu()
  const sheet = screen.getByRole('dialog')
  const remove = within(sheet).getByRole('button', { name: 'Remove' })
  const sep = remove.previousElementSibling
  expect(sep).toBeTruthy()
  expect(sep.tagName).toBe('DIV')
  expect(sep.textContent).toBe('')
  expect(sep.getAttribute('role')).toBeNull()
})

test('picking an item runs it and closes the sheet', () => {
  const { onClose, onFlag } = renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Flag' }))
  expect(onFlag).toHaveBeenCalledTimes(1)
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('an href item is a real link, and picking it closes the sheet too', () => {
  const { onClose } = renderMenu()
  const link = within(screen.getByRole('dialog')).getByRole('link', { name: 'Open in Charts' })
  expect(link.getAttribute('href')).toBe('/charts?sym=NVDA')
  fireEvent.click(link)
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('a hint reaches the touch rows as well (title + aria-description)', () => {
  renderMenu({ items: [{ label: 'Sync', hint: 'Pull your current settings' }, { label: 'Freeze' }] })
  const sync = screen.getByRole('button', { name: 'Sync' })
  expect(sync.getAttribute('title')).toBe('Pull your current settings')
  expect(sync.getAttribute('aria-description')).toBe('Pull your current settings')
  expect(screen.getByRole('button', { name: 'Freeze' }).hasAttribute('title')).toBe(false)
})
