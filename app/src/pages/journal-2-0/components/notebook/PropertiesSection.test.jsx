import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let notePropsResult
let defsResult
const updateNoteSpy = vi.fn(() => Promise.resolve({}))
const createDefSpy = vi.fn(() => Promise.resolve({ id: 'new-def', name: 'New Prop', type: 'text' }))

vi.mock('../../hooks/useNoteProperties', () => ({ default: () => notePropsResult }))
vi.mock('../../hooks/useJ2PropertyDefs', () => ({
  default: () => ({ propertyDefs: defsResult, create: createDefSpy }),
}))

import PropertiesSection from './PropertiesSection'

beforeEach(() => {
  updateNoteSpy.mockClear()
  createDefSpy.mockClear()
  notePropsResult = { properties: [], isLoading: false, refresh: vi.fn() }
  defsResult = []
})

describe('PropertiesSection', () => {
  it('renders nothing but a small "Add property" link when nothing is set', () => {
    notePropsResult = {
      properties: [
        { id: 'builtin:ticker', name: 'Ticker', type: 'text', source: 'financial_derived', value: null },
      ],
      isLoading: false, refresh: vi.fn(),
    }
    render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} />)
    expect(screen.getByText('Add property')).toBeTruthy()
    expect(screen.queryByText('Ticker')).toBeNull() // no permanent row for an unset property
  })

  it('renders nothing while loading', () => {
    notePropsResult = { properties: [], isLoading: true, refresh: vi.fn() }
    const { container } = render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a financial-derived property with a value as read-only text', () => {
    notePropsResult = {
      properties: [
        { id: 'builtin:ticker', name: 'Ticker', type: 'text', source: 'financial_derived', value: 'NVDA' },
      ],
      isLoading: false, refresh: vi.fn(),
    }
    render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} />)
    expect(screen.getByText('Ticker')).toBeTruthy()
    expect(screen.getByText('NVDA')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull() // never an editable input
  })

  it('a select property with a value renders a native select the member can change', async () => {
    notePropsResult = {
      properties: [
        {
          id: 'builtin:thesis_status', name: 'Thesis Status', type: 'select', source: 'user_set',
          value: 'active', options: [{ id: 'active', label: 'Active' }, { id: 'closed', label: 'Closed' }],
        },
      ],
      isLoading: false, refresh: vi.fn(),
    }
    render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} />)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'closed' } })
    await waitFor(() => {
      expect(updateNoteSpy).toHaveBeenCalledWith({ properties: { 'builtin:thesis_status': 'closed' } })
    })
  })

  it('a property control is programmatically associated with its label, not just visually adjacent', () => {
    // A screen reader tabbing to the control must announce "Thesis Status" --
    // not an unlabeled combobox -- so the label span and its control share an
    // aria-labelledby link, not just DOM/visual proximity.
    notePropsResult = {
      properties: [
        {
          id: 'builtin:thesis_status', name: 'Thesis Status', type: 'select', source: 'user_set',
          value: 'active', options: [{ id: 'active', label: 'Active' }],
        },
      ],
      isLoading: false, refresh: vi.fn(),
    }
    render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} />)
    expect(screen.getByRole('combobox', { name: 'Thesis Status' })).toBeTruthy()
  })

  it('a text property commits on blur, never on every keystroke', () => {
    notePropsResult = {
      properties: [
        { id: 'p1', name: 'Notes', type: 'text', source: 'user_set', value: '' },
      ],
      isLoading: false, refresh: vi.fn(),
    }
    render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} />)
    const input = screen.getByDisplayValue('')
    fireEvent.change(input, { target: { value: 'h' } })
    fireEvent.change(input, { target: { value: 'hi' } })
    expect(updateNoteSpy).not.toHaveBeenCalled() // still typing
    fireEvent.blur(input)
    expect(updateNoteSpy).toHaveBeenCalledWith({ properties: { p1: 'hi' } })
  })

  it('the picker offers not-yet-shown user_set properties and adding one reveals its row', () => {
    notePropsResult = {
      properties: [
        { id: 'p1', name: 'Confidence', type: 'text', source: 'user_set', value: null },
      ],
      isLoading: false, refresh: vi.fn(),
    }
    render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} />)
    fireEvent.click(screen.getByText('Add property'))
    fireEvent.click(screen.getByText('Confidence'))
    expect(screen.getAllByText('Confidence').length).toBeGreaterThan(0) // now shown as a row
  })

  it('refetches derived properties when the note\'s own ticker changes underneath it', async () => {
    const refresh = vi.fn()
    notePropsResult = {
      properties: [
        { id: 'builtin:ticker', name: 'Ticker', type: 'text', source: 'financial_derived', value: 'NVDA' },
      ],
      isLoading: false, refresh,
    }
    const { rerender } = render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} ticker="NVDA" />)
    expect(refresh).not.toHaveBeenCalled() // no spurious refetch on first mount
    rerender(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} ticker="AMD" />)
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    rerender(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} ticker="AMD" />)
    expect(refresh).toHaveBeenCalledTimes(1) // no re-fire on an unrelated re-render
  })

  it('creating a brand-new property calls the defs hook, refreshes this note\'s own cache, and reveals it', async () => {
    const refresh = vi.fn()
    notePropsResult = { properties: [], isLoading: false, refresh }
    render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} />)
    fireEvent.click(screen.getByText('Add property'))
    fireEvent.click(screen.getByText('+ New property…'))
    fireEvent.change(screen.getByPlaceholderText('Property name'), { target: { value: 'Risk Level' } })
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => expect(createDefSpy).toHaveBeenCalledWith('Risk Level', 'text', undefined))
    // createDef only invalidates the property-defs list, not this note's OWN
    // resolved-properties cache -- without an explicit refresh here the new
    // property was server-created but stayed invisible until a full reload
    // (caught live via browser E2E).
    expect(refresh).toHaveBeenCalled()
  })

  it('creating a select property collects comma-separated option labels so it is usable immediately', async () => {
    notePropsResult = { properties: [], isLoading: false, refresh: vi.fn() }
    render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} />)
    fireEvent.click(screen.getByText('Add property'))
    fireEvent.click(screen.getByText('+ New property…'))
    fireEvent.change(screen.getByPlaceholderText('Property name'), { target: { value: 'Conviction' } })
    fireEvent.change(screen.getByDisplayValue('Text'), { target: { value: 'select' } })
    fireEvent.change(screen.getByPlaceholderText('Options, comma separated (e.g. Low, Medium, High)'), {
      target: { value: 'Low, Medium, High' },
    })
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() =>
      expect(createDefSpy).toHaveBeenCalledWith('Conviction', 'select', [
        { label: 'Low' }, { label: 'Medium' }, { label: 'High' },
      ]),
    )
  })
})

// F4 / A2R-07 (WCAG 2.4.3): lane 10E-2's keyboard walk -- Enter on "Add property" left focus on
// <body>. On a note with nothing set, opening the picker swaps the empty-state button for the
// list layout, and the focused button went with it. Walked with the keyboard.
describe('Add property keeps focus (F4, A2R-07)', () => {
  const STATUS = {
    id: 'builtin:thesis_status', name: 'Thesis Status', type: 'select', source: 'user_set',
    value: null, options: [{ id: 'active', label: 'Active' }, { id: 'closed', label: 'Closed' }],
  }
  beforeEach(() => {
    notePropsResult = { properties: [STATUS], isLoading: false, refresh: vi.fn(() => Promise.resolve({})) }
  })

  it('Enter on the empty-state "Add property" opens the picker with focus on the toggle, which says it is open', async () => {
    const user = userEvent.setup()
    render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} />)
    screen.getByRole('button', { name: 'Add property' }).focus()
    await user.keyboard('{Enter}')
    const toggle = await screen.findByRole('button', { name: 'Add property', expanded: true })
    expect(document.activeElement).toBe(toggle)
    expect(screen.getByRole('button', { name: 'Thesis Status' })).toBeInTheDocument()
  })

  it('picking a property puts focus on its control', async () => {
    const user = userEvent.setup()
    render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} />)
    screen.getByRole('button', { name: 'Add property' }).focus()
    await user.keyboard('{Enter}')
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Thesis Status' }))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Thesis Status' })))
  })

  it('Escape closes the picker and focus goes back to "Add property"', async () => {
    const user = userEvent.setup()
    render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} />)
    screen.getByRole('button', { name: 'Add property' }).focus()
    await user.keyboard('{Enter}')
    await user.tab()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Thesis Status' })).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add property' }))
  })
})

