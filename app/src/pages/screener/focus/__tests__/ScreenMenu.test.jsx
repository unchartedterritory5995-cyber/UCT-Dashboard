import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi, beforeEach, expect, test } from 'vitest'
const lazy = vi.hoisted(() => ({ counts: { starter_momentum_leaders: 412 } }))
vi.mock('../useLazyCounts', () => ({ default: () => lazy.counts }))
import ScreenMenu from '../ScreenMenu'

const starters = [
  { id: 'starter_momentum_leaders', name: 'Leaders (RS ≥ 90)', spec: { filters: [] }, description: 'RS rank 90 or higher' },
  { id: 'starter_uct_50', name: 'UCT 50', spec: { filters: [] } },
]
const saved = [{ id: 5, name: 'Semis on watch', spec: { filters: [] } }]
const props = { currentName: 'Leaders (RS ≥ 90)', currentId: 'starter_momentum_leaders', count: 412, isEdited: false, starters, saved,
  pinned: ['starter_momentum_leaders'], onTogglePin: vi.fn(), onApply: vi.fn(), onSaveChanges: null, onSaveAsNew: vi.fn(),
  onRename: null, onNewScreen: vi.fn(), myScans: [], onUseScan: vi.fn() }

beforeEach(() => { vi.clearAllMocks(); lazy.counts = { starter_momentum_leaders: 412 } })

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
test('focus leaving the menu and its trigger closes it; a move inside keeps it open', () => {
  render(<><ScreenMenu {...props} /><button type="button">Elsewhere</button></>)
  const trigger = screen.getByRole('button', { name: /Leaders/ })
  const outside = screen.getByRole('button', { name: 'Elsewhere' })
  fireEvent.click(trigger)
  const search = screen.getByRole('searchbox')
  const pin = within(screen.getByRole('dialog', { name: 'Screens' })).getAllByRole('button', { name: /^(Pin|Unpin) / })[0]
  // inside the dialog, and back to the trigger: still open
  fireEvent.focusOut(search, { relatedTarget: pin })
  expect(screen.getByRole('dialog', { name: 'Screens' })).toBeInTheDocument()
  fireEvent.focusOut(pin, { relatedTarget: trigger })
  expect(screen.getByRole('dialog', { name: 'Screens' })).toBeInTheDocument()
  // a window blur (no relatedTarget) is not the member leaving the menu
  fireEvent.focusOut(search, { relatedTarget: null })
  expect(screen.getByRole('dialog', { name: 'Screens' })).toBeInTheDocument()
  // Tab out to the next control on the page: closed, and focus is not pulled back to the trigger
  fireEvent.change(search, { target: { value: 'semis' } })
  outside.focus()
  fireEvent.focusOut(search, { relatedTarget: outside })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(outside).toHaveFocus()
  // the search is cleared with it
  fireEvent.click(trigger)
  expect(screen.getByRole('searchbox')).toHaveValue('')
})

test('a pinned screen is listed once, under Pinned, and not again in its group or My screens', () => {
  render(<ScreenMenu {...props} pinned={['starter_momentum_leaders', '5']} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  const dlg = screen.getByRole('dialog', { name: 'Screens' })
  expect(within(dlg).getAllByRole('button', { name: /^Open Leaders/ })).toHaveLength(1)
  expect(within(dlg).getAllByRole('button', { name: /^Open Semis on watch/ })).toHaveLength(1)
  const pinnedSec = within(dlg).getByRole('region', { name: 'Pinned' })
  expect(within(pinnedSec).getByRole('button', { name: /^Open Leaders/ })).toBeInTheDocument()
  expect(within(pinnedSec).getByRole('button', { name: /^Open Semis on watch/ })).toBeInTheDocument()
  // My screens held only the pinned one, so it has no section of its own now
  expect(within(dlg).queryByRole('region', { name: 'My screens' })).toBeNull()
  // the unpinned starter is still in its group
  expect(within(within(dlg).getByRole('region', { name: 'Momentum leaders' })).getByRole('button', { name: /^Open UCT 50/ })).toBeInTheDocument()
})
test('a screen with 0 matches today is dimmed and says "none today"; an unknown count is never 0', () => {
  lazy.counts = { starter_momentum_leaders: 412, starter_uct_50: 0, 5: null }
  render(<ScreenMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  const empty = screen.getByRole('button', { name: 'Open UCT 50, none today' }).parentElement
  expect(empty).toHaveAttribute('data-empty')
  expect(within(empty).getByText('none today')).toBeInTheDocument()
  // a failed count (null) shows a dash, not "none today"
  const failed = screen.getByRole('button', { name: 'Open Semis on watch' }).parentElement
  expect(failed).not.toHaveAttribute('data-empty')
  expect(within(failed).getByText('—')).toBeInTheDocument()
  // a real count is neither
  const full = screen.getByRole('button', { name: 'Open Leaders (RS ≥ 90)' }).parentElement
  expect(full).not.toHaveAttribute('data-empty')
})
test('the pin control draws the app pin glyph, filled when pinned', () => {
  render(<ScreenMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  const on = screen.getByRole('button', { name: 'Unpin Leaders (RS ≥ 90)' }).querySelector('svg')
  const off = screen.getByRole('button', { name: 'Pin UCT 50' }).querySelector('svg')
  expect(on.getAttribute('fill')).toBe('currentColor')
  expect(off.getAttribute('fill')).toBe('none')
  // UIcon's pin: a head and a needle, never the old one-path glyph
  expect(on.querySelectorAll('path')).toHaveLength(2)
})
test('while landing, the button shows a placeholder, never "Custom screen" or a count', () => {
  const { rerender } = render(<ScreenMenu {...props} currentName={undefined} currentId={undefined} count={412} landing />)
  const btn = screen.getByRole('button', { name: /Change screen/ })
  expect(btn).toHaveTextContent('Loading screen…')
  expect(btn).not.toHaveTextContent('Custom screen')
  expect(screen.getByTestId('screen-count')).toHaveTextContent('')
  rerender(<ScreenMenu {...props} currentName={undefined} currentId={undefined} count={412} landing={false} />)
  expect(screen.getByRole('button', { name: /Change screen/ })).toHaveTextContent('Custom screen')
})
