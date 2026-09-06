import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let noteHookResult
let defsHookResult
const setValueSpy = vi.fn()
const createPropertyDefSpy = vi.fn()

vi.mock('../../hooks/useNoteProperties', () => ({
  default: () => ({ ...noteHookResult, setValue: setValueSpy }),
}))
vi.mock('../../hooks/useJ2PropertyDefs', () => ({
  default: () => defsHookResult,
  createPropertyDef: (...args) => createPropertyDefSpy(...args),
}))

import PropertiesSection from './PropertiesSection'

beforeEach(() => {
  setValueSpy.mockClear()
  createPropertyDefSpy.mockClear()
  noteHookResult = { properties: [], isLoading: false, error: null }
  defsHookResult = { properties: [], isLoading: false, error: null, refresh: vi.fn() }
})

describe('PropertiesSection', () => {
  it('shows a minimal "Add property" link when the note has none', () => {
    render(<PropertiesSection noteId="n1" ticker={null} />)
    expect(screen.getByText('Add property')).toBeInTheDocument()
  })

  it('renders a real property with its current value', () => {
    noteHookResult = {
      properties: [{ defId: 'p1', key: 'k1', name: 'Confidence', type: 'text', options: [], value: 'High', derived: false }],
      isLoading: false, error: null,
    }
    render(<PropertiesSection noteId="n1" ticker={null} />)
    expect(screen.getByText('Confidence')).toBeInTheDocument()
    expect(screen.getByDisplayValue('High')).toBeInTheDocument()
  })

  it('renders a derived property as read-only text, not an input', () => {
    noteHookResult = {
      properties: [{ defId: '__sector__', key: '__sector__', name: 'Sector', type: 'text', options: [], value: 'Technology', derived: true }],
      isLoading: false, error: null,
    }
    render(<PropertiesSection noteId="n1" ticker="NVDA" />)
    expect(screen.getByText('Sector')).toBeInTheDocument()
    expect(screen.getByText('Technology')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('editing a text property value calls setValue on blur', () => {
    noteHookResult = {
      properties: [{ defId: 'p1', key: 'k1', name: 'Confidence', type: 'text', options: [], value: 'High', derived: false }],
      isLoading: false, error: null,
    }
    render(<PropertiesSection noteId="n1" ticker={null} />)
    const input = screen.getByDisplayValue('High')
    fireEvent.change(input, { target: { value: 'Medium' } })
    fireEvent.blur(input)
    expect(setValueSpy).toHaveBeenCalledWith('p1', 'Medium')
  })

  it('a select property renders its options and saves the chosen option id', () => {
    noteHookResult = {
      properties: [{
        defId: 'p1', key: 'k1', name: 'Status', type: 'select',
        options: [{ id: 'opt1', label: 'Active' }, { id: 'opt2', label: 'Closed' }],
        value: 'opt1', derived: false,
      }],
      isLoading: false, error: null,
    }
    render(<PropertiesSection noteId="n1" ticker={null} />)
    const select = screen.getByDisplayValue('Active')
    fireEvent.change(select, { target: { value: 'opt2' } })
    expect(setValueSpy).toHaveBeenCalledWith('p1', 'opt2')
  })

  it('a multi_select property toggles chips', () => {
    noteHookResult = {
      properties: [{
        defId: 'p1', key: 'k1', name: 'Tags', type: 'multi_select',
        options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
        value: ['a'], derived: false,
      }],
      isLoading: false, error: null,
    }
    render(<PropertiesSection noteId="n1" ticker={null} />)
    fireEvent.click(screen.getByText('Beta'))
    expect(setValueSpy).toHaveBeenCalledWith('p1', ['a', 'b'])
  })

  it('clicking "Add property" opens a picker listing existing property defs not yet on this note', () => {
    defsHookResult = {
      properties: [
        { id: 'p1', name: 'Confidence', type: 'text', derived: false },
        { id: '__sector__', name: 'Sector', type: 'text', derived: true },
      ],
      isLoading: false, error: null, refresh: vi.fn(),
    }
    render(<PropertiesSection noteId="n1" ticker={null} />)
    fireEvent.click(screen.getByText('Add property'))
    expect(screen.getByText('Confidence')).toBeInTheDocument()
    expect(screen.queryByText('Sector')).not.toBeInTheDocument()  // derived properties aren't pickable
  })

  it('picking an existing property def sets its default value and closes the picker', () => {
    defsHookResult = {
      properties: [{ id: 'p1', name: 'Confidence', type: 'text', derived: false }],
      isLoading: false, error: null, refresh: vi.fn(),
    }
    render(<PropertiesSection noteId="n1" ticker={null} />)
    fireEvent.click(screen.getByText('Add property'))
    fireEvent.click(screen.getByText('Confidence'))
    expect(setValueSpy).toHaveBeenCalledWith('p1', null)
  })
})
