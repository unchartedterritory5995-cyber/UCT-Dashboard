import { render, screen, fireEvent } from '@testing-library/react'
import { vi, test, expect, beforeEach } from 'vitest'
vi.mock('../../shell/FilterRail', () => ({ default: p => <div data-testid="rail" data-presentation={p.presentation} /> }))
vi.mock('../../shell/CriteriaBox', () => ({ default: () => <div data-testid="criteria" /> }))
import FiltersDrawer from '../FiltersDrawer'

const meta = { filters: [{ key: 'rs_rank', label: 'RS Rank', type: 'range', presets: [] }] }
const base = { open: true, onClose: vi.fn(), meta, logic: null, onSetFilter: vi.fn(), onClear: vi.fn(), onSetLogic: vi.fn(), count: 214, countLoading: false,
  lists: [{ value: 'wl:7', label: 'Semis' }] }
beforeEach(() => { vi.clearAllMocks() })

test('universe pill reads All stocks with no pool', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  expect(screen.getByRole('button', { name: /Universe: All stocks/ })).toBeInTheDocument()
})
test('active filters are removable pills', () => {
  render(<FiltersDrawer {...base} filters={{ universe: { op: 'eq', value: 'uct', label: 'UCT Universe' }, rs_rank: { op: 'gte', min: 80 } }} />)
  expect(screen.getByRole('button', { name: /Universe: UCT Universe/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Remove RS Rank: ≥ 80' }))
  expect(base.onSetFilter).toHaveBeenCalledWith('rs_rank', null)
})
test('picking a list sets list and clears universe', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  fireEvent.click(screen.getByRole('button', { name: /Universe: All stocks/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Semis' }))
  expect(base.onSetFilter).toHaveBeenCalledWith('universe', null)
  expect(base.onSetFilter).toHaveBeenCalledWith('list', { op: 'in', value: 'wl:7', label: 'Semis' })
})
test('picking UCT sets universe and clears list', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  fireEvent.click(screen.getByRole('button', { name: /Universe: All stocks/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'UCT Universe' }))
  expect(base.onSetFilter).toHaveBeenCalledWith('list', null)
  expect(base.onSetFilter).toHaveBeenCalledWith('universe', { op: 'eq', value: 'uct', label: 'UCT Universe' })
})
test('picking All stocks clears both', () => {
  render(<FiltersDrawer {...base} filters={{ list: { op: 'in', value: 'wl:7', label: 'Semis' } }} />)
  fireEvent.click(screen.getByRole('button', { name: /Universe: Semis/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'All stocks' }))
  expect(base.onSetFilter).toHaveBeenCalledWith('universe', null)
  expect(base.onSetFilter).toHaveBeenCalledWith('list', null)
})
test('custom criteria shows as one pill', () => {
  render(<FiltersDrawer {...base} filters={{}} logic={{ any: [] }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove Custom criteria' }))
  expect(base.onSetLogic).toHaveBeenCalledWith(null)
})
test('rail renders preset buttons', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  expect(screen.getByTestId('rail')).toHaveAttribute('data-presentation', 'buttons')
})
test('footer button shows the count and closes', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Show 214 stocks' }))
  expect(base.onClose).toHaveBeenCalled()
})
test('escape closes; closed renders nothing', () => {
  const { rerender } = render(<FiltersDrawer {...base} filters={{}} />)
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Filters' }), { key: 'Escape' })
  expect(base.onClose).toHaveBeenCalled()
  rerender(<FiltersDrawer {...base} open={false} filters={{}} />)
  expect(screen.queryByRole('dialog')).toBeNull()
})
test('focus moves into the dialog on open and returns to the opener on close', () => {
  const opener = document.createElement('button')
  document.body.appendChild(opener)
  opener.focus()
  const { rerender } = render(<FiltersDrawer {...base} open={false} filters={{}} />)
  rerender(<FiltersDrawer {...base} open filters={{}} />)
  expect(screen.getByRole('dialog', { name: 'Filters' }).contains(document.activeElement)).toBe(true)
  rerender(<FiltersDrawer {...base} open={false} filters={{}} />)
  expect(document.activeElement).toBe(opener)
  opener.remove()
})
test('returnFocusRef wins over the captured element', () => {
  const a = document.createElement('button'), b = document.createElement('button')
  document.body.append(a, b)
  a.focus()
  const ref = { current: b }
  const { rerender } = render(<FiltersDrawer {...base} open={false} filters={{}} returnFocusRef={ref} />)
  rerender(<FiltersDrawer {...base} open filters={{}} returnFocusRef={ref} />)
  rerender(<FiltersDrawer {...base} open={false} filters={{}} returnFocusRef={ref} />)
  expect(document.activeElement).toBe(b)
  a.remove(); b.remove()
})

test('Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  const dlg = screen.getByRole('dialog', { name: 'Filters' })
  const last = screen.getByRole('button', { name: 'Show 214 stocks' })
  last.focus()
  fireEvent.keyDown(last, { key: 'Tab' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close filters' }))
  fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(last)
  expect(dlg.contains(document.activeElement)).toBe(true)
})
test('Escape works with focus on the dialog itself (after a click on plain content)', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  const dlg = screen.getByRole('dialog', { name: 'Filters' })
  expect(dlg).toHaveAttribute('tabindex', '-1')
  dlg.focus()
  fireEvent.keyDown(document.activeElement, { key: 'Escape' })
  expect(base.onClose).toHaveBeenCalled()
})
test('body scroll is locked while open and restored after close', () => {
  document.body.style.overflow = 'scroll'
  const { rerender, unmount } = render(<FiltersDrawer {...base} open={false} filters={{}} />)
  expect(document.body.style.overflow).toBe('scroll')
  rerender(<FiltersDrawer {...base} open filters={{}} />)
  expect(document.body.style.overflow).toBe('hidden')
  rerender(<FiltersDrawer {...base} open={false} filters={{}} />)
  expect(document.body.style.overflow).toBe('scroll')
  rerender(<FiltersDrawer {...base} open filters={{}} />)
  unmount()
  expect(document.body.style.overflow).toBe('scroll')
  document.body.style.overflow = ''
})
test('a new returnFocusRef identity while open does not move focus', () => {
  const { rerender } = render(<FiltersDrawer {...base} open filters={{}} returnFocusRef={{ current: null }} />)
  const btn = screen.getByRole('button', { name: 'Show 214 stocks' })
  btn.focus()
  rerender(<FiltersDrawer {...base} open filters={{}} returnFocusRef={{ current: null }} />)
  expect(document.activeElement).toBe(btn)
})
