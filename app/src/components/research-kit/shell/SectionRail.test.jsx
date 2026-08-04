import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SectionRail, { nextIndex } from './SectionRail'

const SECTIONS = [
  { id: 'setup', label: 'Setup' },
  { id: 'history', label: 'Earnings History' },
  { id: 'brief', label: 'Brief' },
  { id: 'call', label: 'Call' },
]
const LINKS = [
  { id: 'analyst', label: 'Analyst & Ownership', href: '/research/NVDA?section=ownership' },
  { id: 'filings', label: 'Filings', href: '/research/NVDA?section=filings' },
]

describe('nextIndex — one handler for both axes', () => {
  it('moves forward on Down AND Right, wrapping', () => {
    expect(nextIndex(0, 'ArrowDown', 4)).toBe(1)
    expect(nextIndex(0, 'ArrowRight', 4)).toBe(1)
    expect(nextIndex(3, 'ArrowDown', 4)).toBe(0)
  })

  it('moves backward on Up AND Left, wrapping', () => {
    expect(nextIndex(1, 'ArrowUp', 4)).toBe(0)
    expect(nextIndex(0, 'ArrowLeft', 4)).toBe(3)
  })

  it('jumps to the ends on Home/End', () => {
    expect(nextIndex(2, 'Home', 4)).toBe(0)
    expect(nextIndex(2, 'End', 4)).toBe(3)
  })

  it('returns -1 for a key it does not own', () => {
    expect(nextIndex(0, 'a', 4)).toBe(-1)
    expect(nextIndex(0, 'Enter', 4)).toBe(-1)
  })

  it('never returns an index into an empty list', () => {
    expect(nextIndex(0, 'ArrowDown', 0)).toBe(-1)
  })
})

describe('SectionRail', () => {
  const setup = (over = {}) => {
    const onSelect = vi.fn()
    const utils = render(
      <SectionRail sections={SECTIONS} links={LINKS} active="setup" onSelect={onSelect} {...over} />,
    )
    return { onSelect, ...utils }
  }

  it('is a tablist of the sections only', () => {
    setup()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(SECTIONS.length)
  })

  it('marks the active tab and gives it the only reachable tabindex (roving)', () => {
    setup()
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
  })

  it('points each tab at its panel', () => {
    setup({ idPrefix: 'modal' })
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-controls', 'modal-panel-setup')
  })

  it('selects on click', async () => {
    const { onSelect } = setup()
    await userEvent.click(screen.getByRole('tab', { name: 'Brief' }))
    expect(onSelect).toHaveBeenCalledWith('brief')
  })

  it('selects on arrow keys, wrapping, and moves focus with the selection', async () => {
    const { onSelect } = setup({ active: 'call' })
    screen.getByRole('tab', { name: 'Call' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(onSelect).toHaveBeenCalledWith('setup')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Setup' }))
  })

  it('honours Home and End', async () => {
    const { onSelect } = setup({ active: 'brief' })
    screen.getByRole('tab', { name: 'Brief' }).focus()
    await userEvent.keyboard('{End}')
    expect(onSelect).toHaveBeenCalledWith('call')
    await userEvent.keyboard('{Home}')
    expect(onSelect).toHaveBeenCalledWith('setup')
  })

  it('ignores keys it does not own', async () => {
    const { onSelect } = setup()
    screen.getByRole('tab', { name: 'Setup' }).focus()
    await userEvent.keyboard('x')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('renders link items as links, NOT as tabs (§4.3)', () => {
    setup()
    const link = screen.getByRole('link', { name: /Analyst & Ownership/ })
    expect(link).toHaveAttribute('href', '/research/NVDA?section=ownership')
    expect(screen.queryByRole('tab', { name: /Analyst & Ownership/ })).toBeNull()
  })

  it('renders no link group when there are no links', () => {
    setup({ links: [] })
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('is a labelled navigation region', () => {
    setup({ ariaLabel: 'Modal sections' })
    expect(screen.getByRole('tablist', { name: 'Modal sections' })).toBeInTheDocument()
  })

  it('labels the wrapping nav landmark too, not just the tablist', () => {
    setup({ ariaLabel: 'Modal sections' })
    expect(screen.getByRole('navigation', { name: 'Modal sections' })).toBeInTheDocument()
  })

  // I1 — an `active` id that matches nothing must not strand the whole
  // tablist at tabIndex=-1 (keyboard-unreachable).
  it('falls back to the first tab when active matches nothing in the list', () => {
    setup({ active: 'nonexistent' })
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('falls back to the first tab when active is null', () => {
    setup({ active: null })
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })
})
