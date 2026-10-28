/* The touch branch of ChartContextMenu (a bottom Sheet) names its menu from the SAME
 * hidden label element the desktop popover uses, and its Sheet dialog carries the same
 * "Chart actions for <SYM>" string (Sheet's own `ariaLabel` door), so phone, tablet and
 * desktop announce one name. */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../hooks/useBreakpoint', async (orig) => ({ ...(await orig()), useIsTouch: () => true }))

import ChartContextMenu from './ChartContextMenu'

const sections = [{ id: 's', items: [{ id: 'a', label: 'Reset view', onSelect: vi.fn() }] }]

describe('ChartContextMenu touch branch: one name', () => {
  it('the Sheet dialog and the menu are both "Chart actions for NVDA"; the menu has no aria-label', () => {
    render(<ChartContextMenu open x={0} y={0} sections={sections} onClose={vi.fn()} ariaLabel="Chart actions for NVDA" />)
    const dialog = screen.getByRole('dialog', { name: 'Chart actions for NVDA' })
    const menu = screen.getByRole('menu', { name: 'Chart actions for NVDA' })
    expect(dialog.contains(menu)).toBe(true)
    expect(menu).not.toHaveAttribute('aria-label')
    const label = document.getElementById(menu.getAttribute('aria-labelledby'))
    expect(label).toHaveClass('sr-only')
    expect(label.textContent).toBe('Chart actions for NVDA')
  })
})
