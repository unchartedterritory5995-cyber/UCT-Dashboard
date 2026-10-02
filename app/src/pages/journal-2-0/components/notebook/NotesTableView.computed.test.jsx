/**
 * Wave 11 (lane 11B): formula and rollup columns in the table view —
 * shown, sorted (server side, through the existing sort door), filtered (a
 * small dialog off the header, keyboard-operable), and honest about empties.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NotesTableView from './NotesTableView'
import { ComputedChips } from './ComputedValue'
import NoteCard from './NoteCard'

const defs = [
  { id: 'e1', name: 'Entry', type: 'number', source: 'user_set' },
  { id: 'r1', name: 'R', type: 'formula', source: 'user_set', computed: true, config: { expression: '{@e1}' } },
  { id: 'wr', name: 'Win rate', type: 'rollup', source: 'user_set', computed: true, config: {} },
]
const notes = [
  { id: 'n1', title: 'Plan A', updatedAt: '2026-09-01T00:00:00Z', propertiesJson: {},
    computed: { r1: { value: 2.5, kind: 'formula', name: 'R' }, wr: { value: 66.6667, aggregate: 'win_rate', kind: 'rollup', name: 'Win rate', setSize: 3, usedSize: 3 } } },
  { id: 'n2', title: 'Plan B', updatedAt: '2026-09-02T00:00:00Z', propertiesJson: {},
    computed: { r1: { value: null, reason: 'Division by zero', kind: 'formula', name: 'R' },
      wr: { value: 50, aggregate: 'win_rate', kind: 'rollup', name: 'Win rate', setSize: 1500, usedSize: 1000, capped: true } } },
]

function setup(overrides = {}) {
  const props = {
    notes, propertyDefs: defs, sort: 'updated', onSortChange: vi.fn(), propertySort: null,
    onPropertySortChange: vi.fn(), onQuickFilter: vi.fn(), onOpenNote: vi.fn(),
    propertyFilter: null, onComputedFilter: vi.fn(), ...overrides,
  }
  render(<NotesTableView {...props} />)
  return props
}

describe('computed columns', () => {
  it('a formula/rollup column shows even though no note STORES a value for it', () => {
    setup()
    expect(screen.getByRole('button', { name: /^R/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Win rate/ })).toBeTruthy()
  })

  it('cells show the value; win rate reads as a percent; an empty cell carries its reason as text', () => {
    setup()
    expect(screen.getByText('2.5')).toBeTruthy()
    expect(screen.getByText('66.7%')).toBeTruthy()
    expect(screen.getByText('No value: Division by zero')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('a capped rollup says it covers the first N of M', () => {
    setup()
    const capped = screen.getByText('50%').closest('[title]')
    expect(capped.getAttribute('title')).toBe('Covers the first 1,000 of 1,500')
    expect(within(capped).getByText(/Covers the first 1,000 of 1,500/)).toBeTruthy()
  })

  it('the header sorts through the server sort door, and the active one carries aria-sort', () => {
    const p = setup({ propertySort: { propertyId: 'r1', direction: 'desc' } })
    const th = screen.getByRole('button', { name: /^R/ }).closest('th')
    expect(th.getAttribute('aria-sort')).toBe('descending')
    screen.getByRole('button', { name: /^R/ }).click()
    expect(p.onPropertySortChange).toHaveBeenCalledWith('r1')
  })

  it('KEYBOARD: open the filter, pick "is above", type 1, Enter applies {op:gt, value:1}', async () => {
    const user = userEvent.setup()
    const p = setup()
    const btn = screen.getByRole('button', { name: 'Filter R' })
    btn.focus()
    await user.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: 'Filter R' })
    await new Promise((r) => requestAnimationFrame(r))
    expect(document.activeElement).toBe(within(dialog).getByRole('combobox', { name: 'Show notes where R' }))
    await user.selectOptions(within(dialog).getByRole('combobox'), 'gt')
    await user.type(within(dialog).getByRole('spinbutton', { name: 'Number' }), '1{Enter}')
    expect(p.onComputedFilter).toHaveBeenCalledWith('r1', { op: 'gt', value: 1 })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"is empty" needs no number', async () => {
    const user = userEvent.setup()
    const p = setup()
    await user.click(screen.getByRole('button', { name: 'Filter R' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Show notes where R' }), 'is_empty')
    expect(screen.queryByRole('spinbutton')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(p.onComputedFilter).toHaveBeenCalledWith('r1', { op: 'is_empty' })
  })

  it('a missing number is refused with a sentence, and nothing is applied', async () => {
    const user = userEvent.setup()
    const p = setup()
    await user.click(screen.getByRole('button', { name: 'Filter R' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Type a number to compare with')
    expect(p.onComputedFilter).not.toHaveBeenCalled()
  })

  it('an active filter is named on its button, and Clear removes it', async () => {
    const user = userEvent.setup()
    const p = setup({ propertyFilter: [{ propertyId: 'r1', op: 'gte', value: 2 }] })
    const btn = screen.getByRole('button', { name: 'Filter R: R is at least 2' })
    await user.click(btn)
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(p.onComputedFilter).toHaveBeenCalledWith('r1', null)
  })

  it('KEYBOARD: Escape closes the filter and returns focus to its button', async () => {
    const user = userEvent.setup()
    setup()
    const btn = screen.getByRole('button', { name: 'Filter R' })
    await user.click(btn)
    await new Promise((r) => requestAnimationFrame(r))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await new Promise((r) => requestAnimationFrame(r))
    expect(document.activeElement).toBe(btn)
  })

  it('opening the filter never opens the row under it', async () => {
    const user = userEvent.setup()
    const p = setup()
    await user.click(screen.getByRole('button', { name: 'Filter R' }))
    expect(p.onOpenNote).not.toHaveBeenCalled()
  })

  it('a saved view (no filter door) shows no filter button, only the sort', () => {
    setup({ onComputedFilter: null })
    expect(screen.queryByRole('button', { name: /^Filter/ })).toBeNull()
  })
})

describe('computed values on the other views', () => {
  it('the list card shows each value with its name', () => {
    render(<NoteCard note={notes[0]} onOpen={vi.fn()} />)
    expect(screen.getByText('2.5')).toBeTruthy()
    expect(screen.getByText(/Win rate/)).toBeTruthy()
  })

  it('⛔ flag off: a note with no `computed` key renders no chips at all', () => {
    const { container } = render(<ComputedChips computed={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
