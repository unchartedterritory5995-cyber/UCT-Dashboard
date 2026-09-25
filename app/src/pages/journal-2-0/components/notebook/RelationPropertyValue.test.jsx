import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

/**
 * Wave 6 (lane E, item 5) — a relation's value: chips that open the notes it
 * links, a picker over the quick switcher's search, and ⛔ a deleted or trashed
 * target rendered as "missing note", never as a crash. Also: the wired path
 * through the note's Properties section, and "Related from" on the target.
 */
const navSpy = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navSpy,
}))
let notePropsResult
vi.mock('../../hooks/useNoteProperties', () => ({ default: () => notePropsResult }))
vi.mock('../../hooks/useJ2PropertyDefs', () => ({ default: () => ({ propertyDefs: [], create: vi.fn() }) }))
let relatedResult
vi.mock('../../hooks/useNoteRelatedFrom', () => ({ default: () => relatedResult }))
vi.mock('../../hooks/useNoteBacklinksList', () => ({
  default: () => ({ count: 0, notes: [], isLoading: false, error: null }),
}))

import RelationPropertyValue from './RelationPropertyValue'
import PropertiesSection from './PropertiesSection'
import NoteBacklinksSection from './NoteBacklinksSection'
import { _resetNoteLinkTargetsBatchForTests } from '../../lib/noteLinkTargetsBatch'
import { NotePaneContext, SplitViewContext } from '../../lib/splitView'

let switcherCalls
beforeEach(() => {
  navSpy.mockClear()
  _resetNoteLinkTargetsBatchForTests()
  switcherCalls = []
  relatedResult = { count: 0, notes: [], isLoading: false, error: null }
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.startsWith('/api/j2/notes/link-targets')) {
      return { ok: true, json: async () => ({ targets: {
        live: { title: 'NVDA thesis', status: 'active' },
        binned: { title: 'Old idea', status: 'trashed' },
        // `gone` is absent: deleted, purged, or never the member's
      } }) }
    }
    if (u.startsWith('/api/j2/notes/switcher')) {
      switcherCalls.push(u)
      return { ok: true, json: async () => ({ notes: [
        { id: 'self', title: 'This note' }, { id: 'live', title: 'NVDA thesis' }, { id: 'amd', title: 'AMD thesis' },
      ] }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
})

describe('the chips', () => {
  it('open the linked note; a trashed or deleted target reads "missing note" and does not crash', async () => {
    const onChange = vi.fn()
    render(<RelationPropertyValue value={['live', 'binned', 'gone']} onChange={onChange} labelId="l" />)
    const open = await screen.findByRole('button', { name: 'NVDA thesis' })
    expect(screen.getAllByRole('button', { name: 'missing note' })).toHaveLength(2)
    screen.getAllByRole('button', { name: 'missing note' }).forEach((b) => expect(b).toBeDisabled())
    fireEvent.click(open)
    expect(navSpy).toHaveBeenCalledWith('/journal/notebook?note=live')
  })

  it('a missing note can still be unlinked, and unlinking the last clears the property', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<RelationPropertyValue value={['live', 'gone']} onChange={onChange} labelId="l" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink missing note' }))
    expect(onChange).toHaveBeenLastCalledWith(['live'])
    rerender(<RelationPropertyValue value={['live']} onChange={onChange} labelId="l" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink NVDA thesis' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})

describe('the picker', () => {
  it('searches with the quick switcher, leaves out this note and ones already linked, and links the pick', async () => {
    const onChange = vi.fn()
    render(<RelationPropertyValue value={['live']} onChange={onChange} labelId="l" currentNoteId="self" />)
    fireEvent.click(screen.getByRole('button', { name: /Link a note/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a note to link' }), { target: { value: 'thesis' } })
    const list = await screen.findByRole('listbox', { name: 'Notes to link' })
    expect(switcherCalls[0]).toContain('/api/j2/notes/switcher?q=thesis')
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['AMD thesis'])
    fireEvent.click(within(list).getByRole('button', { name: 'AMD thesis' }))
    expect(onChange).toHaveBeenCalledWith(['live', 'amd'])
  })
})

describe('wired', () => {
  it('the note’s Properties section offers Relation, and renders a relation as its chips', async () => {
    notePropsResult = {
      properties: [{ id: 'p1', name: 'Peers', type: 'relation', source: 'user_set', value: ['live'] }],
      isLoading: false, refresh: vi.fn(),
    }
    render(<PropertiesSection noteId="self" updateNote={vi.fn(() => Promise.resolve({}))} />)
    expect(await screen.findByRole('button', { name: 'NVDA thesis' })).toBeInTheDocument()
    expect(screen.queryByText('live')).not.toBeInTheDocument()
  })

  it('the target note lists what is Related from it, with the relation’s name, and opens it', () => {
    relatedResult = {
      count: 2, isLoading: false, error: null,
      notes: [
        { id: 'a', title: 'A thesis', properties: ['Peers'] },
        { id: 'b', title: 'B thesis', properties: ['Peers', 'Supply chain'] },
      ],
    }
    render(<NoteBacklinksSection noteId="t" />)
    fireEvent.click(screen.getByText('Related from (2)'))
    expect(screen.getByText('Peers · Supply chain')).toBeInTheDocument()
    fireEvent.click(screen.getByText('B thesis'))
    expect(navSpy).toHaveBeenCalledWith('/journal/notebook?note=b')
  })

  it('shows no Related from at zero', () => {
    const { container } = render(<NoteBacklinksSection noteId="t" />)
    expect(container).toBeEmptyDOMElement()
  })
})

// Wave 6 (lane E, item 7): a chip and a "Related from" row open their note the
// Notebook's one way — beside on Ctrl/Cmd+click, in their own pane when split.
describe('split view', () => {
  const inPane = (ui, split, pane) => (
    <SplitViewContext.Provider value={split}>
      <NotePaneContext.Provider value={pane}>{ui}</NotePaneContext.Provider>
    </SplitViewContext.Provider>
  )

  it('a chip opens beside on Ctrl+click, and in its own pane on a plain click', async () => {
    const openToSide = vi.fn()
    const open = vi.fn()
    render(inPane(<RelationPropertyValue value={['live']} onChange={vi.fn()} labelId="l" />,
      { canSplit: true, openToSide }, { pane: 'side', open }))
    const chip = await screen.findByRole('button', { name: 'NVDA thesis' })
    fireEvent.click(chip, { ctrlKey: true })
    expect(openToSide).toHaveBeenCalledWith('live')
    fireEvent.click(chip)
    expect(open).toHaveBeenCalledWith('live')
    expect(navSpy).not.toHaveBeenCalled()
  })

  it('a Related from row opens in its own pane', () => {
    // CollapsibleSection remembers open/closed in localStorage by id, and the
    // wired test above opened this one.
    window.localStorage.clear()
    relatedResult = { count: 1, isLoading: false, error: null, notes: [{ id: 'b', title: 'B thesis', properties: ['Peers'] }] }
    const open = vi.fn()
    render(inPane(<NoteBacklinksSection noteId="t" />, { canSplit: true, openToSide: vi.fn() }, { pane: 'main', open }))
    fireEvent.click(screen.getByText('Related from (1)'))
    fireEvent.click(screen.getByText('B thesis'))
    expect(open).toHaveBeenCalledWith('b')
    expect(navSpy).not.toHaveBeenCalled()
  })
})
