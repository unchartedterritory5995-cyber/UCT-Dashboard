import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AskInsertPicker from './AskInsertPicker'
import { clearPendingAskInsert, takePendingAskInsert } from '../../lib/askInsert'

const NODE = {
  type: 'askInsert', attrs: { insertedAt: '2026-09-22T12:00:00.000Z', scope: 'notebook', question: 'q' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
}
const NOTES = [{ id: 'n1', title: 'NVDA thesis', ticker: 'NVDA' }, { id: 'n2', title: 'AMD notes' }]

beforeEach(() => { clearPendingAskInsert(); sessionStorage.clear() })

function setup(overrides = {}) {
  const props = {
    node: NODE,
    defaultTitle: 'What about margins?',
    onOpenNote: vi.fn(),
    onCancel: vi.fn(),
    search: vi.fn(async () => NOTES),
    createNote: vi.fn(async () => ({ id: 'new1', title: 'x' })),
    ...overrides,
  }
  render(<AskInsertPicker {...props} />)
  return props
}
const input = () => screen.getByRole('textbox', { name: 'Find a note to insert into' })

describe('AskInsertPicker', () => {
  it('picking a note hands the answer to it and opens it', async () => {
    const p = setup()
    fireEvent.change(input(), { target: { value: 'nv' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: /NVDA thesis/ }))
    expect(p.onOpenNote).toHaveBeenCalledWith(NOTES[0])
    expect(takePendingAskInsert('n1')?.node).toEqual(NODE)
  })

  it('Enter picks the highlighted note', async () => {
    const p = setup()
    fireEvent.change(input(), { target: { value: 'nv' } })
    await screen.findByRole('option', { name: /NVDA thesis/ })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(p.onOpenNote).toHaveBeenCalledWith(NOTES[0])
  })

  it('create new uses the typed title and the answer as the body — no hand-off needed', async () => {
    const p = setup()
    fireEvent.change(input(), { target: { value: 'Margins log' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create a new note titled "Margins log"' }))
    await waitFor(() => expect(p.onOpenNote).toHaveBeenCalledWith({ id: 'new1', title: 'x' }))
    expect(p.createNote).toHaveBeenCalledWith({ title: 'Margins log', bodyJson: { type: 'doc', content: [NODE] } })
    expect(takePendingAskInsert('new1')).toBeNull()
  })

  it('with nothing typed, the new note takes the question as its title', async () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Create a new note' }))
    await waitFor(() => expect(p.createNote).toHaveBeenCalled())
    expect(p.createNote.mock.calls[0][0].title).toBe('What about margins?')
  })

  it('a failed create says so in words and keeps the picker', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = setup({ createNote: vi.fn(async () => { throw new Error('500') }) })
    fireEvent.click(screen.getByRole('button', { name: 'Create a new note' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't create the note. Your answer is still here.")
    expect(p.onOpenNote).not.toHaveBeenCalled()
  })

  it('Cancel closes it', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(p.onCancel).toHaveBeenCalled()
  })

  // G-064 final fix wave (M9) — two pickers on one page (a note's Ask and its
  // document sheet's Ask) must not share an id: each label names its OWN input,
  // and each result list has its own id.
  it('two pickers on one page keep their own ids, and each label names its own input', async () => {
    const search = vi.fn(async () => NOTES)
    render(
      <>
        <AskInsertPicker node={NODE} onOpenNote={vi.fn()} onCancel={vi.fn()} search={search} />
        <AskInsertPicker node={NODE} onOpenNote={vi.fn()} onCancel={vi.fn()} search={search} />
      </>,
    )
    const inputs = screen.getAllByRole('textbox', { name: 'Find a note to insert into' })
    expect(inputs).toHaveLength(2)
    expect(inputs[0].id).not.toBe(inputs[1].id)
    for (const el of inputs) fireEvent.change(el, { target: { value: 'nv' } })
    const lists = await screen.findAllByRole('listbox', { name: 'Insert into a note' })
    expect(lists).toHaveLength(2)
    expect(lists[0].id).toBeTruthy()
    expect(lists[0].id).not.toBe(lists[1].id)
  })
})
