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
