import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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

  it('creating a brand-new property calls the defs hook and reveals it', async () => {
    notePropsResult = { properties: [], isLoading: false, refresh: vi.fn() }
    render(<PropertiesSection noteId="n1" updateNote={updateNoteSpy} />)
    fireEvent.click(screen.getByText('Add property'))
    fireEvent.click(screen.getByText('+ New property…'))
    fireEvent.change(screen.getByPlaceholderText('Property name'), { target: { value: 'Risk Level' } })
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => expect(createDefSpy).toHaveBeenCalledWith('Risk Level', 'text', undefined))
  })
})
