import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AskInsertPicker from './AskInsertPicker'
import { clearPendingAskInsert, takePendingAskInsert } from '../../lib/askInsert'

const HERE = path.dirname(fileURLToPath(import.meta.url))

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

  it('Escape in the search box closes it', () => {
    const p = setup()
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(p.onCancel).toHaveBeenCalledTimes(1)
    expect(p.onOpenNote).not.toHaveBeenCalled()
  })

  // A live walk found the member had to tap into the search box before
  // typing: the picker opens in place of the Insert button, and nothing moved
  // focus to it.
  it('the search box has focus as soon as the picker opens', () => {
    setup()
    expect(document.activeElement).toBe(input())
  })

  it('while a create is in flight the note rows are disabled, and a click on one does nothing', async () => {
    let settle
    const p = setup({ createNote: vi.fn(() => new Promise((resolve) => { settle = resolve })) })
    fireEvent.change(input(), { target: { value: 'nv' } })
    expect(await screen.findByRole('option', { name: /NVDA thesis/ })).not.toHaveAttribute('aria-disabled')

    fireEvent.click(screen.getByRole('button', { name: 'Create a new note titled "nv"' }))
    await waitFor(() => expect(p.createNote).toHaveBeenCalled())
    const rows = screen.getAllByRole('option')
    expect(rows).toHaveLength(NOTES.length)
    for (const row of rows) expect(row).toHaveAttribute('aria-disabled', 'true')

    // The guard, not the attribute, is what keeps the answer out of a second
    // note: a click on a disabled row neither opens it nor hands it the answer.
    fireEvent.mouseDown(rows[0])
    expect(p.onOpenNote).not.toHaveBeenCalled()
    expect(takePendingAskInsert('n1')).toBeNull()

    await act(async () => { settle({ id: 'new1', title: 'nv' }) })
    expect(p.onOpenNote).toHaveBeenCalledTimes(1)
    expect(p.onOpenNote).toHaveBeenCalledWith({ id: 'new1', title: 'nv' })
  })

  it('the disabled rows are styled as disabled, the same as a disabled button', () => {
    const css = fs.readFileSync(path.join(HERE, 'AskInsertPicker.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = /\.picker \[role='option'\]\[aria-disabled='true'\]\s*\{([^}]*)\}/.exec(css)?.[1] || ''
    expect(rule).toMatch(/opacity:\s*0\.6;/)
    expect(rule).toMatch(/cursor:\s*default;/)
  })

  // The usual host unmounts the picker when a note opens, which used to hide
  // that `busy` was never reset after a SUCCESSFUL create. A host that keeps
  // it mounted must get a live picker back, not a disabled one.
  it('a host that keeps the picker mounted gets it back once the create settles', async () => {
    const p = setup()
    fireEvent.change(input(), { target: { value: 'nv' } })
    await screen.findByRole('option', { name: /NVDA thesis/ })
    const create = () => screen.getByRole('button', { name: 'Create a new note titled "nv"' })

    fireEvent.click(create())
    await waitFor(() => expect(p.onOpenNote).toHaveBeenCalledWith({ id: 'new1', title: 'x' }))
    await waitFor(() => expect(create()).not.toBeDisabled())
    for (const row of screen.getAllByRole('option')) expect(row).not.toHaveAttribute('aria-disabled')

    fireEvent.click(create())
    await waitFor(() => expect(p.createNote).toHaveBeenCalledTimes(2))
  })

  it('a failed create also gives the picker back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = setup({ createNote: vi.fn(async () => { throw new Error('500') }) })
    fireEvent.change(input(), { target: { value: 'nv' } })
    await screen.findByRole('option', { name: /NVDA thesis/ })
    fireEvent.click(screen.getByRole('button', { name: 'Create a new note titled "nv"' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Create a new note titled "nv"' })).not.toBeDisabled()
    for (const row of screen.getAllByRole('option')) expect(row).not.toHaveAttribute('aria-disabled')
    expect(p.onOpenNote).not.toHaveBeenCalled()
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
