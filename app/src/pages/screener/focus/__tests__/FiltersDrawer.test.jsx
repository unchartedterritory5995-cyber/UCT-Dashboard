import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, test, expect, beforeEach } from 'vitest'
vi.mock('../../shell/FilterRail', () => ({ default: p => <div data-testid="rail" data-presentation={p.presentation} /> }))
vi.mock('../../shell/CriteriaBox', () => ({ default: () => <div data-testid="criteria" /> }))
const describeState = { available: false, busy: false, error: null, run: vi.fn() }
vi.mock('../useDescribe', () => ({ default: () => describeState }))
import FiltersDrawer from '../FiltersDrawer'

const meta = { filters: [{ key: 'rs_rank', label: 'RS Rank', type: 'range', presets: [] }] }
const base = { open: true, onClose: vi.fn(), meta, logic: null, onSetFilter: vi.fn(), onClear: vi.fn(), onSetLogic: vi.fn(), count: 214, countLoading: false,
  lists: [{ value: 'wl:7', label: 'Semis' }] }
beforeEach(() => { vi.clearAllMocks(); Object.assign(describeState, { available: false, busy: false, error: null }) })

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
test('large numbers in pill text read compactly', () => {
  const m = { filters: [{ key: 'dollar_volume_30d', label: 'Dollar Volume (30d)', type: 'range', unit: '$', presets: [] }] }
  render(<FiltersDrawer {...base} meta={m} filters={{ dollar_volume_30d: { op: 'gte', min: 20000000 } }} />)
  const pill = screen.getByRole('button', { name: /^Remove Dollar Volume/ })
  expect(pill.getAttribute('aria-label')).toMatch(/20M/)
  expect(pill.getAttribute('aria-label')).not.toMatch(/20000000/)
})

const typeAndSubmit = words => {
  fireEvent.change(screen.getByLabelText('Describe a setup'), { target: { value: words } })
  fireEvent.submit(screen.getByLabelText('Describe a setup').closest('form'))
}
test('no Describe input when the compile door is closed', () => {
  render(<FiltersDrawer {...base} filters={{}} />)
  expect(screen.queryByLabelText('Describe a setup')).toBeNull()
})
test('a plain AND becomes pills and clears the old logic tree', async () => {
  describeState.available = true
  describeState.run.mockResolvedValue({ filters: [{ key: 'rs_rank', op: 'gte', min: 80 }], logic: { all: [] }, explanation: [{ depth: 0, text: 'All of the following:' }, { depth: 1, text: 'RS Rank is at least 80' }] })
  render(<FiltersDrawer {...base} filters={{}} />)
  typeAndSubmit('liquid leaders')
  expect(await screen.findByText('RS Rank is at least 80')).toBeInTheDocument()
  expect(base.onClear).toHaveBeenCalled()
  expect(base.onSetFilter).toHaveBeenCalledWith('rs_rank', { op: 'gte', min: 80 })
  expect(base.onSetLogic).toHaveBeenCalledWith(null)
})
test('a described setup keeps the member universe', async () => {
  describeState.available = true
  describeState.run.mockResolvedValue({ filters: [{ key: 'rs_rank', op: 'gte', min: 80 }], explanation: [] })
  const uni = { op: 'eq', value: 'uct', label: 'UCT Universe' }
  const lst = { op: 'in', value: 'wl:7', label: 'Semis' }
  render(<FiltersDrawer {...base} filters={{ universe: uni, list: lst }} />)
  typeAndSubmit('leaders')
  await waitFor(() => expect(base.onSetFilter).toHaveBeenCalledWith('universe', uni))
  expect(base.onSetFilter).toHaveBeenCalledWith('list', lst)
  expect(base.onSetFilter).toHaveBeenCalledWith('rs_rank', { op: 'gte', min: 80 })
})
test('a complex result is applied as a logic tree', async () => {
  describeState.available = true
  const tree = { any: [{ key: 'price', op: 'gt', min: 5 }] }
  describeState.run.mockResolvedValue({ filters: null, logic: tree, explanation: [] })
  render(<FiltersDrawer {...base} filters={{}} />)
  typeAndSubmit('either or')
  await waitFor(() => expect(base.onSetLogic).toHaveBeenCalledWith(tree))
  expect(base.onClear).not.toHaveBeenCalled()
})
test('an empty compile says so instead of doing nothing', async () => {
  describeState.available = true
  describeState.run.mockResolvedValue({ filters: null, logic: null, explanation: [] })
  render(<FiltersDrawer {...base} filters={{}} />)
  typeAndSubmit('gibberish')
  expect(await screen.findByText("Couldn't turn that into filters. Try different words.")).toBeInTheDocument()
  expect(base.onSetFilter).not.toHaveBeenCalled()
})
test('the Describe input sits inside the focus trap', () => {
  describeState.available = true
  render(<FiltersDrawer {...base} filters={{}} />)
  const input = screen.getByLabelText('Describe a setup')
  const close = screen.getByRole('button', { name: 'Close filters' })
  close.focus()
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show 214 stocks' }))
  expect(input.closest('[role="dialog"]')).not.toBeNull()
})

test('an any-of explanation keeps its wording so it never reads as an AND', async () => {
  describeState.available = true
  describeState.run.mockResolvedValue({ filters: null, logic: { any: [] }, explanation: [{ depth: 0, text: 'Any of the following:' }, { depth: 1, text: 'RS Rank is at least 80' }, { depth: 1, text: 'Price is above 10' }] })
  render(<FiltersDrawer {...base} filters={{}} />)
  typeAndSubmit('either')
  expect(await screen.findByText('Any of the following: RS Rank is at least 80; Price is above 10')).toBeInTheDocument()
})
test('a universe changed during the compile is not overwritten', async () => {
  describeState.available = true
  let release
  describeState.run.mockImplementation(() => new Promise(r => { release = () => r({ filters: [{ key: 'rs_rank', op: 'gte', min: 80 }], explanation: [] }) }))
  const old = { op: 'eq', value: 'uct', label: 'UCT Universe' }
  const fresh = { op: 'in', value: 'wl:7', label: 'Semis' }
  const { rerender } = render(<FiltersDrawer {...base} filters={{ universe: old }} />)
  typeAndSubmit('leaders')
  rerender(<FiltersDrawer {...base} filters={{ list: fresh }} />)
  release()
  await waitFor(() => expect(base.onSetFilter).toHaveBeenCalledWith('list', fresh))
  expect(base.onSetFilter).not.toHaveBeenCalledWith('universe', old)
})

// -- Task 3 (S4) --
test('S4: a failed count never reads as a number: "Show stocks" and "Count unavailable"', () => {
  render(<FiltersDrawer {...base} filters={{}} count={214} countError={new Error('count 500')} />)
  expect(screen.getByRole('button', { name: 'Show stocks' })).toBeInTheDocument()
  expect(screen.getByTestId('drawer-count-note')).toHaveTextContent('Count unavailable')
  expect(screen.getByText('Count unavailable', { selector: '[role="status"]' })).toBeInTheDocument()
  expect(screen.queryByText(/214|Show 0/)).toBeNull()
})
test('S4: an unknown count is "Show stocks" with no note', () => {
  render(<FiltersDrawer {...base} filters={{}} count={null} />)
  expect(screen.getByRole('button', { name: 'Show stocks' })).toBeInTheDocument()
  expect(screen.queryByTestId('drawer-count-note')).toBeNull()
})

test('7: pills use the plain column name and a lowercase operator word', () => {
  const m = { filters: [{ key: 'adr_pct', label: 'ADR %', type: 'range', presets: [{ label: 'Over 4%', op: 'gte', min: 4 }] }] }
  render(<FiltersDrawer {...base} meta={m} filters={{ adr_pct: { op: 'gte', min: 4 } }} />)
  expect(screen.getByText('Avg daily range: over 4%')).toBeInTheDocument()
  expect(screen.queryByText(/ADR %/)).toBeNull()
})
test('4: after Clear all, focus stays inside the drawer and Escape still closes it', () => {
  const onClose = vi.fn()
  render(<FiltersDrawer {...base} onClose={onClose} filters={{ rs_rank: { op: 'gte', min: 80 } }} />)
  const clear = screen.getByRole('button', { name: 'Clear all' })
  clear.focus()
  fireEvent.click(clear)
  expect(base.onClear).toHaveBeenCalled()
  const dialog = screen.getByRole('dialog', { name: 'Filters' })
  expect(dialog.contains(document.activeElement)).toBe(true)
  fireEvent.keyDown(document.activeElement, { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
})
