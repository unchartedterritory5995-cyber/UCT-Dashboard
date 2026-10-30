import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import WidgetHeader from './WidgetHeader'

test('renders the label', () => {
  render(<WidgetHeader label="My Widget" color="A" onColorChange={() => {}} onRemove={() => {}} />)
  expect(screen.getByText('My Widget')).toBeInTheDocument()
})

test('renders the drag handle with the react-grid-layout className', () => {
  const { container } = render(<WidgetHeader label="W" color="A" onColorChange={() => {}} onRemove={() => {}} />)
  expect(container.querySelector('.charts-widget-drag-handle')).toBeInTheDocument()
})

test('color dot click cycles A → B → C → D → A', () => {
  const onColorChange = vi.fn()
  const { rerender } = render(<WidgetHeader label="W" color="A" onColorChange={onColorChange} onRemove={() => {}} />)

  screen.getByRole('button', { name: /color group/i }).click()
  expect(onColorChange).toHaveBeenLastCalledWith('B')

  rerender(<WidgetHeader label="W" color="B" onColorChange={onColorChange} onRemove={() => {}} />)
  screen.getByRole('button', { name: /color group/i }).click()
  expect(onColorChange).toHaveBeenLastCalledWith('C')

  rerender(<WidgetHeader label="W" color="C" onColorChange={onColorChange} onRemove={() => {}} />)
  screen.getByRole('button', { name: /color group/i }).click()
  expect(onColorChange).toHaveBeenLastCalledWith('D')

  rerender(<WidgetHeader label="W" color="D" onColorChange={onColorChange} onRemove={() => {}} />)
  screen.getByRole('button', { name: /color group/i }).click()
  expect(onColorChange).toHaveBeenLastCalledWith('N')   // D → N (grey "not linked")

  rerender(<WidgetHeader label="W" color="N" onColorChange={onColorChange} onRemove={() => {}} />)
  screen.getByRole('button', { name: /not linked/i }).click()
  expect(onColorChange).toHaveBeenLastCalledWith('A')   // N → A (back to the start)
})

test('close button calls onRemove', () => {
  const onRemove = vi.fn()
  render(<WidgetHeader label="W" color="A" onColorChange={() => {}} onRemove={onRemove} />)
  screen.getByRole('button', { name: /close/i }).click()
  expect(onRemove).toHaveBeenCalledTimes(1)
})

test('pop-out button calls onPopOut', () => {
  const onPopOut = vi.fn()
  render(<WidgetHeader label="W" color="A" onColorChange={() => {}} onRemove={() => {}} onPopOut={onPopOut} />)
  screen.getByRole('button', { name: /pop out/i }).click()
  expect(onPopOut).toHaveBeenCalledTimes(1)
})

test('no pop-out button when the surface does not support it', () => {
  // Widgets already inside a popped-out board don't offer it — the window is
  // itself the "move this to another monitor" unit.
  render(<WidgetHeader label="W" color="A" onColorChange={() => {}} onRemove={() => {}} />)
  expect(screen.queryByRole('button', { name: /pop out/i })).toBeNull()
})

// ⛔ REGRESSION (2026-10-30): UCT News is released to every member, so the add-tab menu
// offers it -- from the MEMBER list (WIDGET_TAB_PICKER_TYPES), never UCT Agent's
// widget.addTab list, which stays without it. News & Catalysts is still offered too.
test('the add-tab menu offers UCT News and News & Catalysts, and adds UCT News as a tab', () => {
  localStorage.removeItem('uct.nb.capture.enabled')
  const onAddTab = vi.fn()
  render(<WidgetHeader label="W" color="A" onColorChange={() => {}} onRemove={() => {}} onAddTab={onAddTab} />)
  fireEvent.click(screen.getByRole('button', { name: /add a tab to this widget/i }))
  const menu = document.querySelector('[data-wtab-add-menu]')
  const items = [...menu.querySelectorAll('button')].map(b => b.textContent)
  expect(items).toContain('News & Catalysts')
  expect(items).toContain('News')
  fireEvent.click([...menu.querySelectorAll('button')].find(b => b.textContent === 'News'))
  expect(onAddTab).toHaveBeenCalledWith('tradeExchangeNews')
})
