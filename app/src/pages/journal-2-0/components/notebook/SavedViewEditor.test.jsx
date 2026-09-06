import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let defsHookResult
const createSavedViewSpy = vi.fn()
const updateSavedViewSpy = vi.fn()

vi.mock('../../hooks/useJ2PropertyDefs', () => ({ default: () => defsHookResult }))
vi.mock('../../hooks/useJ2SavedViews', () => ({
  createSavedView: (...args) => createSavedViewSpy(...args),
  updateSavedView: (...args) => updateSavedViewSpy(...args),
}))

import SavedViewEditor from './SavedViewEditor'

beforeEach(() => {
  createSavedViewSpy.mockReset()
  updateSavedViewSpy.mockReset()
  createSavedViewSpy.mockImplementation((payload) => Promise.resolve({ id: 'v1', ...payload }))
  updateSavedViewSpy.mockImplementation((id, payload) => Promise.resolve({ id, ...payload }))
  defsHookResult = { properties: [{ id: 'p1', name: 'Confidence', type: 'text', derived: false }] }
})

describe('SavedViewEditor', () => {
  it('requires a name before saving', () => {
    const onSaved = vi.fn()
    render(<SavedViewEditor open onClose={() => {}} existingView={null} onSaved={onSaved} />)
    fireEvent.click(screen.getByText('Save view'))
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required')
    expect(createSavedViewSpy).not.toHaveBeenCalled()
  })

  it('creates a new view with the entered name', async () => {
    const onSaved = vi.fn()
    render(<SavedViewEditor open onClose={() => {}} existingView={null} onSaved={onSaved} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Active Theses'), { target: { value: 'Active Theses' } })
    fireEvent.click(screen.getByText('Save view'))
    await vi.waitFor(() => expect(createSavedViewSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Active Theses', viewType: 'list' }),
    ))
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('editing an existing view calls updateSavedView, not create', async () => {
    render(<SavedViewEditor open onClose={() => {}} existingView={{ id: 'v1', name: 'Old', viewType: 'list', filter: [], columns: [] }} onSaved={() => {}} />)
    fireEvent.click(screen.getByText('Save view'))
    await vi.waitFor(() => expect(updateSavedViewSpy).toHaveBeenCalledWith('v1', expect.objectContaining({ name: 'Old' })))
    expect(createSavedViewSpy).not.toHaveBeenCalled()
  })

  it('adding a filter condition and choosing "Table" layout shows the column picker', () => {
    render(<SavedViewEditor open onClose={() => {}} existingView={null} onSaved={() => {}} />)
    fireEvent.change(screen.getByText('List').closest('select'), { target: { value: 'table' } })
    expect(screen.getByText('Columns')).toBeInTheDocument()
    expect(screen.getByText('Confidence')).toBeInTheDocument()
  })

  it('add condition appends a condition row referencing the first available property', () => {
    render(<SavedViewEditor open onClose={() => {}} existingView={null} onSaved={() => {}} />)
    fireEvent.click(screen.getByText('Add condition'))
    // The condition row's property select should show the only available property.
    const selects = screen.getAllByRole('combobox')
    const propSelect = selects.find((s) => s.value === 'p1')
    expect(propSelect).toBeTruthy()
  })

  it('shows a hint instead of "Add condition" when there are no filterable properties yet', () => {
    defsHookResult = { properties: [] }
    render(<SavedViewEditor open onClose={() => {}} existingView={null} onSaved={() => {}} />)
    expect(screen.queryByText('Add condition')).not.toBeInTheDocument()
    expect(screen.getByText(/Add a property to a note first/)).toBeInTheDocument()
  })
})
