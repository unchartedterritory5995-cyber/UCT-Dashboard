// UCT frame header (look='uct', owner 11-13): a visual restyle only. These pin that it
// keeps EVERY control and behaviour of the classic header — the same buttons with the same
// data-guide anchors (UCT Agent's guide and tests find them by these), the same handlers,
// the same drag handle — and that the classic header is unchanged when look is not set.
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, test, expect } from 'vitest'
import WidgetHeader from './WidgetHeader'
import { paintedSurface } from './uctSurface'

const base = { label: 'Watchlist', color: 'A', icon: 'star' }

test('shows the widget name as its title, with the icon and link badge', () => {
  const { container } = render(<WidgetHeader {...base} look="uct" onColorChange={() => {}} onRemove={() => {}} />)
  expect(container.querySelector('[data-uct-title]')?.textContent).toBe('Watchlist')
  expect(container.querySelector('[data-uct-header]')).toBeInTheDocument()
  expect(container.querySelector('[data-guide="widget.link"]')).toBeInTheDocument()
})

test('keeps every window control, anchor and handler of the classic header', () => {
  const h = { onColorChange: vi.fn(), onRemove: vi.fn(), onPopOut: vi.fn(), onFloat: vi.fn(), onAddTab: vi.fn() }
  const { container } = render(<WidgetHeader {...base} look="uct" {...h} />)
  for (const g of ['widget.link', 'widget.addTab', 'widget.float', 'widget.popOut', 'widget.close', 'widget.headerBar', 'widget.controls']) {
    expect(container.querySelector(`[data-guide="${g}"]`), g).toBeInTheDocument()
  }
  fireEvent.click(screen.getByRole('button', { name: /color group/i }))
  expect(h.onColorChange).toHaveBeenCalledWith('B')
  fireEvent.click(screen.getByRole('button', { name: 'Float widget on top of another' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pop out widget' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close widget' }))
  expect(h.onFloat).toHaveBeenCalledTimes(1)
  expect(h.onPopOut).toHaveBeenCalledTimes(1)
  expect(h.onRemove).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: /add a tab to this widget/i }))
  expect(document.querySelector('[data-wtab-add-menu]')).toBeInTheDocument()
})

test('is the drag handle in grid mode, and hands pointer-down to the float drag when floating', () => {
  const { container, rerender } = render(<WidgetHeader {...base} look="uct" onColorChange={() => {}} onRemove={() => {}} />)
  expect(container.querySelector('.charts-widget-drag-handle')).toBeInTheDocument()
  const onHeaderDragStart = vi.fn()
  rerender(<WidgetHeader {...base} look="uct" floating onDock={() => {}} onHeaderDragStart={onHeaderDragStart} onColorChange={() => {}} onRemove={() => {}} />)
  expect(container.querySelector('.charts-widget-drag-handle')).not.toBeInTheDocument()
  fireEvent.pointerDown(container.querySelector('[data-uct-title]'))
  expect(onHeaderDragStart).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Dock widget into the grid' })).toBeInTheDocument()
})

test('a slot holding several widgets shows its tab strip in place of the title', () => {
  const tabs = [{ id: 'm', isMain: true, type: 'watchlist', label: 'Watchlist' }, { id: 't1', isMain: false, type: 'alerts', label: 'Alerts' }]
  const onSelectTab = vi.fn()
  const { container } = render(<WidgetHeader {...base} look="uct" tabs={tabs} activeIndex={0} onSelectTab={onSelectTab} onColorChange={() => {}} onRemove={() => {}} />)
  expect(container.querySelector('[data-uct-title]')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: /alerts/i }))
  expect(onSelectTab).toHaveBeenCalledWith(1)
})

test('without look, the classic header is unchanged (no title row, glyph controls)', () => {
  const { container } = render(<WidgetHeader {...base} onColorChange={() => {}} onRemove={() => {}} onFloat={() => {}} onPopOut={() => {}} />)
  expect(container.querySelector('[data-uct-header]')).toBeNull()
  expect(screen.getByRole('button', { name: 'Float widget on top of another' }).textContent).toBe('▣')
  expect(screen.getByRole('button', { name: 'Pop out widget' }).textContent).toBe('⧉')
})

test('paintedSurface reads the first opaque background under the body', () => {
  const body = document.createElement('div')
  body.innerHTML = '<div style="background: transparent"><div style="background-color: rgb(14, 15, 13)"><span></span></div></div>'
  document.body.appendChild(body)
  expect(paintedSurface(body)).toBe('rgb(14, 15, 13)')
  const empty = document.createElement('div')
  empty.innerHTML = '<div></div>'
  expect(paintedSurface(empty)).toBeNull()
  body.remove()
})
