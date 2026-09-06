import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let defsHookResult
let batchHookResult
vi.mock('../../hooks/useJ2PropertyDefs', () => ({ default: () => defsHookResult }))
vi.mock('../../hooks/useNotePropertiesBatch', () => ({ default: () => batchHookResult }))

import NotesTableView from './NotesTableView'

beforeEach(() => {
  defsHookResult = { properties: [] }
  batchHookResult = { propertiesByNote: {} }
})

describe('NotesTableView', () => {
  it('always renders a Title column', () => {
    render(<NotesTableView notes={[{ id: 'n1', title: 'My Note' }]} view={{ columns: [] }} onOpen={() => {}} />)
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('My Note')).toBeInTheDocument()
  })

  it('renders a column per the view\'s chosen property and its resolved value', () => {
    defsHookResult = { properties: [{ id: 'p1', name: 'Confidence', type: 'text' }] }
    batchHookResult = { propertiesByNote: { n1: [{ defId: 'p1', value: 'High' }] } }
    render(<NotesTableView notes={[{ id: 'n1', title: 'My Note' }]} view={{ columns: ['p1'] }} onOpen={() => {}} />)
    expect(screen.getByText('Confidence')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('resolves a select property value to its current option label, not the raw id', () => {
    defsHookResult = {
      properties: [{ id: 'p1', name: 'Status', type: 'select', options: [{ id: 'opt1', label: 'Active' }] }],
    }
    batchHookResult = { propertiesByNote: { n1: [{ defId: 'p1', value: 'opt1' }] } }
    render(<NotesTableView notes={[{ id: 'n1', title: 'My Note' }]} view={{ columns: ['p1'] }} onOpen={() => {}} />)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText('opt1')).not.toBeInTheDocument()
  })

  it('an unset property cell renders an em-dash placeholder, not blank/undefined text', () => {
    defsHookResult = { properties: [{ id: 'p1', name: 'Confidence', type: 'text' }] }
    render(<NotesTableView notes={[{ id: 'n1', title: 'My Note' }]} view={{ columns: ['p1'] }} onOpen={() => {}} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('clicking a row calls onOpen with that note', () => {
    const onOpen = vi.fn()
    render(<NotesTableView notes={[{ id: 'n1', title: 'My Note' }]} view={{ columns: [] }} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('My Note'))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }))
  })

  it('renders the empty-state text when there are no notes', () => {
    render(<NotesTableView notes={[]} view={{ columns: [] }} onOpen={() => {}} />)
    expect(screen.getByText('No notes match this view yet.')).toBeInTheDocument()
  })
})
