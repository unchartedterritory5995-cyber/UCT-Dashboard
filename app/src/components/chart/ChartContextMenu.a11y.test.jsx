/* The chart right-click menu, as a keyboard and screen-reader user meets it.
 *
 * Measured live (Playwright WebKit + Chromium + axe, 1200 px, 2026-10-28): the
 * menu was `role="menu"` with NO accessible name, focus stayed on the page behind
 * it when it opened (so arrow keys scrolled the chart and Tab walked the page),
 * Escape closed it but left focus wherever it had been, and page-scope axe
 * reported `region` on every row because the menu renders at the app root,
 * outside every landmark. These rails pin the ARIA menu pattern the fix gives it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'
import isModalOpen from '../../utils/modalOpen'
import axe from 'axe-core'
import ChartContextMenu from './ChartContextMenu'

afterEach(() => cleanup())

function sections() {
  return [
    {
      id: 'region',
      title: 'Price',
      items: [
        { id: 'a', label: 'Reset view', onSelect: vi.fn() },
        { id: 'off', label: 'Unavailable', disabled: true, onSelect: vi.fn() },
        { id: 'b', label: 'Show volume', kind: 'toggle', checked: true, onSelect: vi.fn() },
      ],
    },
    {
      id: 'ticker',
      title: 'NVDA',
      items: [
        { id: 'c', label: 'Flag', kind: 'toggle', checked: false, onSelect: vi.fn() },
        { id: 'd', label: 'Add to Portfolio', onSelect: vi.fn() },
      ],
    },
  ]
}

// The page the menu opens over: a <main> holding ChartPane's named chart region
// (role=region, tabIndex 0) with the chart's own element inside it, and the menu
// rendered at the ROOT beside it, outside <main>, the way GlobalAddPositionProvider
// mounts it.
function renderOverChart(props = {}) {
  const ui = (extra = {}) => (
    <>
      <main>
        <div role="region" aria-label="NVDA daily price chart" tabIndex={0} data-testid="chart-region">
          <div data-testid="chart-el">chart canvas</div>
        </div>
        <input aria-label="elsewhere" />
      </main>
      <ChartContextMenu open x={50} y={50} sections={sections()} onClose={vi.fn()}
        ariaLabel="Chart actions for NVDA" {...props} {...extra} />
    </>
  )
  const view = render(ui())
  // Hand the menu the chart's element, as StockChart's event does (`opener: el`).
  view.rerender(ui({ returnFocusTo: screen.getByTestId('chart-el') }))
  return view
}

const names = () => [...screen.getByRole('menu').querySelectorAll('[role^="menuitem"]')].map((el) => el.textContent.trim())

describe('ChartContextMenu: the ARIA menu pattern (desktop)', () => {
  it('is NAMED for the symbol it acts on', () => {
    renderOverChart()
    expect(screen.getByRole('menu', { name: 'Chart actions for NVDA' })).toBeInTheDocument()
  })

  it('falls back to a generic name when the host passes none', () => {
    render(<ChartContextMenu open x={0} y={0} sections={sections()} onClose={vi.fn()} />)
    expect(screen.getByRole('menu', { name: 'Chart actions' })).toBeInTheDocument()
  })

  it('moves focus to the FIRST enabled item when it opens', () => {
    renderOverChart()
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Reset view' }))
  })

  it('ArrowDown/ArrowUp move between items, skipping the disabled one, and wrap', () => {
    renderOverChart()
    const at = () => document.activeElement.textContent.trim()
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(at()).toBe('Show volume')            // "Unavailable" is skipped
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' })
    expect(at()).toBe('Reset view')
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' })
    expect(at()).toBe('Add to Portfolio')       // wrapped to the last
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(at()).toBe('Reset view')             // and back to the first
  })

  it('Home and End jump to the first and last item', () => {
    renderOverChart()
    fireEvent.keyDown(document.activeElement, { key: 'End' })
    expect(document.activeElement.textContent.trim()).toBe('Add to Portfolio')
    fireEvent.keyDown(document.activeElement, { key: 'Home' })
    expect(document.activeElement.textContent.trim()).toBe('Reset view')
    // Control: every item is a menu item (the walk above is over the real rows).
    expect(names()).toEqual(['Reset view', 'Unavailable', 'Show volume', 'Flag', 'Add to Portfolio'])
  })

  it('Escape closes the menu and gives focus back to the CHART REGION, not <body>', () => {
    const onClose = vi.fn()
    renderOverChart({ onClose })
    expect(screen.getByRole('menu').contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(screen.getByTestId('chart-region'))
  })

  it('picking an item gives focus back to the chart region before the action runs', () => {
    let focusedDuringAction = null
    const secs = sections()
    secs[1].items[1].onSelect = () => { focusedDuringAction = document.activeElement }
    const onClose = vi.fn()
    renderOverChart({ onClose, sections: secs })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Portfolio' }))
    expect(focusedDuringAction).toBe(screen.getByTestId('chart-region'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an Escape pressed in some OTHER field closes the menu without pulling focus to the chart', () => {
    const onClose = vi.fn()
    renderOverChart({ onClose })
    const other = screen.getByLabelText('elsewhere')
    other.focus()
    fireEvent.keyDown(other, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(other)
  })

  it('keeps the menu itself the Escape layer (lib/topLayer.js / TickerPopup rails)', () => {
    renderOverChart()
    expect(screen.getByRole('menu')).toHaveAttribute('data-escape-layer')
  })

  it('page-scope axe: no `region` finding while the menu is open at the root', async () => {
    renderOverChart()
    const res = await axe.run(document, { runOnly: { type: 'rule', values: ['region'] }, resultTypes: ['violations'] })
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
  })

  it('NON-VACUITY · the same axe run DOES report `region` for loose content at the root', async () => {
    renderOverChart()
    const loose = document.createElement('div')
    loose.textContent = 'loose text outside every landmark'
    document.body.appendChild(loose)
    try {
      const res = await axe.run(document, { runOnly: { type: 'rule', values: ['region'] }, resultTypes: ['violations'] })
      expect(res.violations.map((v) => v.id)).toEqual(['region'])
    } finally { loose.remove() }
  })

  it('ONE hidden label element names both the menu and its dialog wrapper; neither has an aria-label', () => {
    renderOverChart()
    const menu = screen.getByRole('menu', { name: 'Chart actions for NVDA' })
    const wrapper = screen.getByRole('dialog', { name: 'Chart actions for NVDA' })
    expect(menu.parentElement).toBe(wrapper)
    expect(menu).not.toHaveAttribute('aria-label')
    expect(wrapper).not.toHaveAttribute('aria-label')
    const id = menu.getAttribute('aria-labelledby')
    expect(id).toBeTruthy()
    expect(wrapper.getAttribute('aria-labelledby')).toBe(id)
    const label = document.getElementById(id)
    expect(label.textContent).toBe('Chart actions for NVDA')     // the single source of the text
    expect(label).toHaveClass('sr-only')
    expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1)
  })
})

// A host that really unmounts the menu on close, the way GlobalAddPositionProvider does.
function Host({ onClosed = () => {} }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <main><div role="region" aria-label="NVDA daily price chart" tabIndex={0}>chart</div>
        <button type="button">after the chart</button></main>
      <ChartContextMenu open={open} x={10} y={10} sections={sections()} ariaLabel="Chart actions for NVDA"
        onClose={() => { setOpen(false); onClosed() }} />
    </>
  )
}

describe('ChartContextMenu: Tab leaves the menu, so the menu goes (APG)', () => {
  it('Tab closes it, without preventDefault, and the chart shortcuts come back (isModalOpen false)', () => {
    const onClosed = vi.fn()
    render(<Host onClosed={onClosed} />)
    expect(isModalOpen()).toBe(true)              // CONTROL: the open menu's dialog wrapper holds them off
    const item = document.activeElement
    expect(screen.getByRole('menu').contains(item)).toBe(true)
    const notPrevented = fireEvent.keyDown(item, { key: 'Tab' })
    expect(notPrevented).toBe(true)               // focus is left to move on naturally
    expect(onClosed).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(isModalOpen()).toBe(false)
  })

  it('Shift+Tab closes it too', () => {
    render(<Host />)
    fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('NON-VACUITY: an arrow key does not close it', () => {
    render(<Host />)
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})
