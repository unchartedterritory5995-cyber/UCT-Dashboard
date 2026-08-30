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

  it('drops aria-controls from non-active tabs (their panel is unmounted — GATE c)', () => {
    // Review round 1, item 6: a consumer that unmounts inactive panels (P2's
    // EarningsResearchModal) has no element at `{idPrefix}-panel-{id}` for a
    // non-active tab — that aria-controls would dangle, pointing at nothing.
    setup({ idPrefix: 'modal' })
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-controls', 'modal-panel-setup')
    for (const tab of tabs.slice(1)) {
      expect(tab).not.toHaveAttribute('aria-controls')
    }
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

  // ── density is OPT-IN ──────────────────────────────────────────────────────
  //
  // The row-tightening exists for EarningsResearchModal's 12-section rail. This
  // module is shared with ResearchPage and CatalystFlow, so the DEFAULT is the
  // thing worth pinning: an unscoped rule here re-spaces two pages nobody
  // looked at. `data-rk-dense` is the attribute the CSS selects on, so asserting
  // it is asserting the real switch, not a proxy for it.
  it('is NOT dense by default — the other rail consumers keep their geometry', () => {
    const { container } = render(
      <SectionRail sections={SECTIONS} active="a" onSelect={() => {}} />,
    )
    const nav = container.querySelector('nav')
    expect(nav).toBeTruthy()
    expect(nav.hasAttribute('data-rk-dense')).toBe(false)
  })

  it('reports density only when the caller asks for it', () => {
    const { container } = render(
      <SectionRail sections={SECTIONS} active="a" onSelect={() => {}} dense />,
    )
    expect(container.querySelector('nav').hasAttribute('data-rk-dense')).toBe(true)
  })

  it('dense={false} is the same as omitting it (no empty attribute)', () => {
    // `data-rk-dense={false}` would render as the string "false", which IS
    // present to an attribute selector — the density would be permanently on.
    const { container } = render(
      <SectionRail sections={SECTIONS} active="a" onSelect={() => {}} dense={false} />,
    )
    expect(container.querySelector('nav').hasAttribute('data-rk-dense')).toBe(false)
  })
})
