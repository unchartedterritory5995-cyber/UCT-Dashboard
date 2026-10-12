/**
 * Notebook P1 (spec P1.7c): while journal styles are off, Kind of note is not OFFERED through ANY
 * client door -- Add property (PropertiesSection.noteKind.test.jsx), the board's group-by, and the
 * autofill suggestions -- and an existing value is still RENDERED. One predicate, railed per door,
 * switch off and switch on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { latchNotebookFlags, __resetNotebookFlags } from './offline/notebookFlags'
import { JOURNAL_STYLES_FLAG } from './journalStylesFlag'
import { isOfferable } from './kindOfNoteOffer'
import { NOTE_KIND_PROPERTY } from './noteKinds'
import { autofillCandidates } from './propertyAutofill'

vi.mock('./offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn() }))

import NoteBoardView, { groupableDefs } from '../components/notebook/NoteBoardView'
import RollupEditor from '../components/notebook/RollupEditor'

const KIND = {
  id: 'builtin:note_kind', name: 'Kind of note', type: 'select', source: 'user_set',
  options: [{ id: 'trade_plan', label: 'Trade plan', color: 'gray' }],
}
const STATUS = {
  id: 'builtin:thesis_status', name: 'Thesis Status', type: 'select', source: 'user_set',
  options: [{ id: 'active', label: 'Active', color: 'green' }],
}

const switchOn = () => { __resetNotebookFlags(); latchNotebookFlags({ [JOURNAL_STYLES_FLAG]: true }) }

beforeEach(() => { __resetNotebookFlags() })
afterEach(() => { cleanup(); __resetNotebookFlags() })

describe('the one predicate', () => {
  it('names the property it guards', () => {
    expect(NOTE_KIND_PROPERTY).toBe('builtin:note_kind')
  })
  it('refuses Kind of note while dark, accepts it when on, and never touches another property', () => {
    expect(isOfferable(KIND)).toBe(false)
    expect(isOfferable(STATUS)).toBe(true)                    // CONTROL: the filter is specific
    switchOn()
    expect(isOfferable(KIND)).toBe(true)
  })
  it('keeps a property a saved view or the current grouping already names (rendering, not offering)', () => {
    expect(isOfferable(KIND, 'builtin:note_kind')).toBe(true)
    expect(isOfferable(KIND, 'builtin:thesis_status')).toBe(false)
  })
})

describe('board group-by', () => {
  it('does not list Kind of note while dark, and does when on', () => {
    expect(groupableDefs([KIND, STATUS]).map((d) => d.id)).toEqual(['builtin:thesis_status'])
    switchOn()
    expect(groupableDefs([KIND, STATUS]).map((d) => d.id)).toEqual(['builtin:note_kind', 'builtin:thesis_status'])
  })

  const notes = [{ id: 'n1', title: 'A plan', propertiesJson: { 'builtin:note_kind': 'trade_plan' } }]
  const board = (props = {}) => render(
    <NoteBoardView notes={notes} propertyDefs={[KIND, STATUS]} onOpenNote={vi.fn()}
      blockedNoteIds={new Set()} onChanged={vi.fn()} {...props} />,
  )

  it('the rendered Group by picker omits it while dark (and the default grouping is not it)', () => {
    board()
    const picker = screen.getByLabelText('Group by')
    expect(within(picker).queryByText('Kind of note')).toBeNull()
    expect(within(picker).getByText('Thesis Status')).toBeTruthy()   // CONTROL: the picker is populated
  })

  it('a saved view that names it still opens grouped by it, while dark', () => {
    board({ initialGroupById: 'builtin:note_kind' })
    expect(within(screen.getByLabelText('Group by')).getByText('Kind of note')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Trade plan' })).toBeTruthy()
  })

  it('offers it when the switch is on', () => {
    switchOn()
    board()
    expect(within(screen.getByLabelText('Group by')).getByText('Kind of note')).toBeTruthy()
  })
})

describe('autofill suggestions', () => {
  const props = [
    { ...KIND, value: null },
    { ...STATUS, value: null },
  ]
  it('never offers Kind of note while dark, offers it when on', () => {
    expect(autofillCandidates(props).map((p) => p.id)).toEqual(['builtin:thesis_status'])
    switchOn()
    expect(autofillCandidates(props).map((p) => p.id)).toEqual(['builtin:note_kind', 'builtin:thesis_status'])
  })
})

describe('rollup editor ("Of the property")', () => {
  const NUM = { id: 'p:size', name: 'Size', type: 'number', source: 'user_set' }
  const rollup = (cfg = {}) => render(
    <RollupEditor value={{ source: 'links_from_this', aggregate: 'win_rate', ...cfg }} onChange={vi.fn()}
      defs={[KIND, STATUS, NUM]} />,
  )
  const choices = () => [...screen.getByLabelText('Of the property').querySelectorAll('option')].map((o) => o.textContent)

  it('does not list Kind of note while dark; the other selects and numbers are still listed', () => {
    rollup()
    expect(choices()).toContain('Thesis Status')          // CONTROL: win rate lists selects
    expect(choices()).toContain('Size')
    expect(choices()).not.toContain('Kind of note')
  })

  it('lists it when the switch is on', () => {
    switchOn()
    rollup()
    expect(choices()).toContain('Kind of note')
  })

  it('keeps it when the rollup already names it (rendering, not offering), with its win options', () => {
    rollup({ propertyId: 'builtin:note_kind' })
    expect(choices()).toContain('Kind of note')
    expect(within(screen.getByLabelText('Counts as a win')).getByText('Trade plan')).toBeTruthy()
  })
})
