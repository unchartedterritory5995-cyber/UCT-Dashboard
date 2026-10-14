import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi, beforeEach, expect, test } from 'vitest'
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
  const pinnedSec = within(dlg).getByRole('region', { name: 'Pinned' })
  expect(within(pinnedSec).getByText('RS rank 90 or higher')).toBeInTheDocument()
  expect(within(pinnedSec).getByText('412')).toBeInTheDocument()
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
  const onSaveChanges = vi.fn()
  render(<ScreenMenu {...props} isEdited onSaveChanges={onSaveChanges} currentName="Semis on watch" currentId={5} />)
  fireEvent.click(screen.getByRole('button', { name: /Semis on watch \(edited\)/ }))
  fireEvent.click(screen.getByRole('button', { name: /Save changes to/ }))
  expect(onSaveChanges).toHaveBeenCalled()
})
test('no Save changes button without a current name', () => {
  render(<ScreenMenu {...props} onSaveChanges={vi.fn()} currentName="" />)
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  expect(screen.queryByRole('button', { name: /Save changes to/ })).toBeNull()
})
test('a pinned id for a deleted screen is skipped, duplicates collapse, trigger omits an unknown count', () => {
  render(<ScreenMenu {...props} count={undefined} pinned={['starter_momentum_leaders', 'starter_momentum_leaders', '999']} />)
  const trigger = screen.getByRole('button', { name: /Leaders/ })
  expect(trigger.getAttribute('aria-label')).not.toMatch(/matches/)
  fireEvent.click(trigger)
  const pinnedSec = screen.getByRole('region', { name: 'Pinned' })
  expect(within(pinnedSec).getAllByRole('button', { name: /^Open / })).toHaveLength(1)
})
test('pin ids are passed as strings', () => {
  render(<ScreenMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Pin Semis on watch' }))
  expect(props.onTogglePin).toHaveBeenCalledWith('5')
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
