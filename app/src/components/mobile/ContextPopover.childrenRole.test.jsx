// @vitest-environment jsdom
//
// The anchored (desktop) branch has two forms. With `items` it is a menu and holds menu
// items. With custom `children` (a form, a note picker) it is NOT a menu: wrapping a
// textarea or a list of plain buttons in `role="menu"` tells a screen reader to expect menu
// items that are not there. That form is a named dialog.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'

vi.mock('../../hooks/useBreakpoint', () => ({ useIsTouch: () => false }))

import ContextPopover from './ContextPopover'

afterEach(cleanup)

describe('ContextPopover: the role follows the content', () => {
  it('custom children are a named dialog, never a menu', async () => {
    render(
      <ContextPopover open onClose={() => {}} anchor={{ x: 10, y: 10 }} title="Send to Notebook">
        <label>Note <textarea /></label>
        <button type="button">Save</button>
      </ContextPopover>,
    )
    const box = await waitFor(() => screen.getByRole('dialog', { name: 'Send to Notebook' }))
    expect(box).toBeTruthy()
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
    expect(document.body.querySelector('[role="menuitem"]')).toBeNull()
  })

  it('custom children with no plain-text title still have a name', async () => {
    render(
      <ContextPopover open onClose={() => {}} anchor={{ x: 10, y: 10 }}>
        <button type="button">Save</button>
      </ContextPopover>,
    )
    const box = await waitFor(() => screen.getByRole('dialog'))
    expect((box.getAttribute('aria-label') || '').length).toBeGreaterThan(0)
  })

  it('CONTROL: an action list is still a menu of menu items', async () => {
    render(
      <ContextPopover open onClose={() => {}} anchor={{ x: 10, y: 10 }} title="AAPL"
        items={[{ label: 'Flag', onClick: () => {} }, { label: 'Remove', onClick: () => {} }]} />,
    )
    const menu = await waitFor(() => screen.getByRole('menu', { name: 'AAPL' }))
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBe(2)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
})
