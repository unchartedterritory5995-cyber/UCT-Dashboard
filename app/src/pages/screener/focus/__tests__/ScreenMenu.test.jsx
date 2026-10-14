import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi } from 'vitest'
vi.mock('../useLazyCounts', () => ({ default: () => ({ starter_momentum_leaders: 412 }) }))
import ScreenMenu from '../ScreenMenu'

const starters = [
  { id: 'starter_momentum_leaders', name: 'Leaders (RS ≥ 90)', spec: { filters: [] }, description: 'RS rank 90 or higher' },
  { id: 'starter_uct_50', name: 'UCT 50', spec: { filters: [] } },
]
const saved = [{ id: 5, name: 'Semis on watch', spec: { filters: [] } }]
const props = { currentName: 'Leaders (RS ≥ 90)', currentId: 'starter_momentum_leaders', count: 412, isEdited: false, starters, saved,
  pinned: ['starter_momentum_leaders'], onTogglePin: vi.fn(), onApply: vi.fn(), onSaveChanges: null, onSaveAsNew: vi.fn(),
  onRename: null, onNewScreen: vi.fn(), myScans: [], onUseScan: vi.fn() }

beforeEach(() => { vi.clearAllMocks() })

test('trigger names the screen and its count', () => {
  render(<ScreenMenu {...props} />)
  expect(screen.getByRole('button', { name: /Leaders \(RS ≥ 90\).*412/ })).toBeInTheDocument()
})
test('opens with pinned first, then groups and my screens', () => {
  render(<ScreenMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  const dlg = screen.getByRole('dialog', { name: 'Screens' })
  const heads = within(dlg).getAllByRole('heading').map(h => h.textContent)
  expect(heads[0]).toBe('Pinned')
  expect(heads).toContain('My screens')
  expect(within(dlg).getByText('RS rank 90 or higher')).toBeInTheDocument()
})
test('search filters items', () => {
  render(<ScreenMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search screens' }), { target: { value: 'semis' } })
  expect(screen.getByText('Semis on watch')).toBeInTheDocument()
  expect(screen.queryByText('UCT 50')).toBeNull()
})
test('picking applies and closes', () => {
  render(<ScreenMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  fireEvent.click(screen.getByRole('button', { name: /Open UCT 50/ }))
  expect(props.onApply).toHaveBeenCalledWith(starters[1].spec, expect.objectContaining({ id: 'starter_uct_50' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})
test('pin toggles without applying', () => {
  render(<ScreenMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Pin UCT 50' }))
  expect(props.onTogglePin).toHaveBeenCalledWith('starter_uct_50')
  expect(props.onApply).not.toHaveBeenCalled()
})
test('edited screen offers save changes', () => {
  render(<ScreenMenu {...props} isEdited onSaveChanges={vi.fn()} currentName="Semis on watch" currentId={5} />)
  expect(screen.getByRole('button', { name: /Semis on watch \(edited\)/ })).toBeInTheDocument()
})
test('Escape closes and returns focus to the trigger; outside pointerdown closes', () => {
  render(<ScreenMenu {...props} />)
  const trigger = screen.getByRole('button', { name: /Leaders/ })
  fireEvent.click(trigger)
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(trigger).toHaveFocus()
  fireEvent.click(trigger)
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
})
