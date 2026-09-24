import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * Wave 6 (lane E) — the note menu's organisation actions, alone. The wired
 * path (NotebookTab hands it to the editor) is NotebookTab.archive.test.jsx.
 * ⛔ Feedback asserted by RENDERED TEXT.
 */
vi.mock('../../lib/offline/useDurableNote', async (importOriginal) => ({
  ...(await importOriginal()),
  recordLandedRevision: vi.fn(async ({ updatedAt }) => updatedAt),
}))

import NoteMenuActions from './NoteMenuActions'
import { recordLandedRevision } from '../../lib/offline/useDurableNote'
import { setCurrentAccountId } from '../../lib/offline/currentAccount'

let calls = []
let answer = null
beforeEach(() => {
  vi.clearAllMocks()
  calls = []
  setCurrentAccountId('acct-A')
  answer = (body, url) => ({
    ok: true, status: 200,
    json: async () => ({ note: url.endsWith('/lock')
      ? { id: 'n1', updatedAt: 'R2', locked: body.locked }
      : { id: 'n1', updatedAt: 'R1', archivedAt: body.archived ? 'T' : null } }),
  })
  global.fetch = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url: String(url), method: init.method, body })
    return answer(body, String(url))
  })
})

describe('Archive in the note menu', () => {
  it('archives a note in the library, says where it went, and lands the revision', async () => {
    const onChanged = vi.fn()
    render(<NoteMenuActions note={{ id: 'n1', archivedAt: null }} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: /^Archive$/ }))
    expect(await screen.findByText('Archived. It is under Archived in the sidebar, still in its folder.')).toBeInTheDocument()
    expect(calls).toEqual([{ url: '/api/j2/notes/n1/archive', method: 'PATCH', body: { archived: true } }])
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1', archivedAt: 'T' }))
    expect(recordLandedRevision).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'n1', updatedAt: 'R1' }))
  })

  it('offers Unarchive for an archived note and brings it back', async () => {
    render(<NoteMenuActions note={{ id: 'n1', archivedAt: '2026-09-24T00:00:00Z' }} />)
    fireEvent.click(screen.getByRole('button', { name: /^Unarchive$/ }))
    expect(await screen.findByText('Unarchived. It is back in its folder.')).toBeInTheDocument()
    expect(calls[0].body).toEqual({ archived: false })
  })

  it('a refused write says nothing changed, in words, and does not report success', async () => {
    answer = () => ({ ok: false, status: 500, json: async () => ({}) })
    const onChanged = vi.fn()
    render(<NoteMenuActions note={{ id: 'n1', archivedAt: '2026-09-24T00:00:00Z' }} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: /^Unarchive$/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't unarchive this note. It is still archived.")
    await waitFor(() => expect(screen.getByRole('button', { name: /^Unarchive$/ })).not.toBeDisabled())
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('renders nothing without a note', () => {
    const { container } = render(<NoteMenuActions note={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('Lock in the note menu (lane D owns the request; this is its menu door)', () => {
  it('locks through PATCH /lock, LANDS the revision the lock moved, and says so', async () => {
    const onChanged = vi.fn()
    render(<NoteMenuActions note={{ id: 'n1', locked: false }} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: /^Lock$/ }))
    expect(await screen.findByText('Locked. Editing is off until you unlock it.')).toBeInTheDocument()
    expect(calls).toEqual([{ url: '/api/j2/notes/n1/lock', method: 'PATCH', body: { locked: true } }])
    // ⛔ The lock ADVANCES the revision; a lock nobody landed is the fork (I1).
    expect(recordLandedRevision).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'n1', updatedAt: 'R2' }))
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ locked: true }))
  })

  it('offers Unlock for a locked note and lands that revision too', async () => {
    render(<NoteMenuActions note={{ id: 'n1', locked: true }} />)
    fireEvent.click(screen.getByRole('button', { name: /^Unlock$/ }))
    expect(await screen.findByText('Unlocked. You can edit this note again.')).toBeInTheDocument()
    expect(calls[0].body).toEqual({ locked: false })
    expect(recordLandedRevision).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: 'R2' }))
  })

  it("only an explicit true is a lock (lane D's noteIsLocked)", () => {
    render(<NoteMenuActions note={{ id: 'n1', locked: 'yes' }} />)
    expect(screen.getByRole('button', { name: /^Lock$/ })).toBeInTheDocument()
  })

  it('a refused lock says so and lands nothing', async () => {
    answer = () => ({ ok: false, status: 404, json: async () => ({}) })
    render(<NoteMenuActions note={{ id: 'n1', locked: false }} />)
    fireEvent.click(screen.getByRole('button', { name: /^Lock$/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't lock this note. Nothing changed.")
    expect(recordLandedRevision).not.toHaveBeenCalled()
  })
})

describe('Save as template in the note menu', () => {
  beforeEach(() => {
    answer = (body, url) => (url.endsWith('/note-templates')
      ? { ok: true, status: 200, json: async () => ({ template: { id: 't9', name: body.name || 'Earnings prep' } }) }
      : { ok: false, status: 500, json: async () => ({}) })
  })

  it('names it (the title by default), asks the SERVER to copy the note, and says where it went', async () => {
    render(<NoteMenuActions note={{ id: 'n1', title: 'Earnings prep' }} />)
    fireEvent.click(screen.getByRole('button', { name: /Save as template/ }))
    const input = screen.getByRole('textbox', { name: 'Template name' })
    expect(input).toHaveValue('Earnings prep')
    fireEvent.change(input, { target: { value: 'Q3 earnings' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByText('Saved “Q3 earnings” as a template. Pick it under Your templates when you make a new note.')).toBeInTheDocument()
    // ⛔ Only the note's id and the name travel: the server reads the body.
    expect(calls).toEqual([{ url: '/api/j2/note-templates', method: 'POST', body: { noteId: 'n1', name: 'Q3 earnings' } }])
    expect(screen.queryByRole('textbox', { name: 'Template name' })).not.toBeInTheDocument()
  })

  it('a refused save says nothing was saved and keeps what the member typed', async () => {
    answer = () => ({ ok: false, status: 400, json: async () => ({ detail: 'nope' }) })
    render(<NoteMenuActions note={{ id: 'n1', title: 'T' }} />)
    fireEvent.click(screen.getByRole('button', { name: /Save as template/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Template name' }), { target: { value: 'Mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save this note as a template. Nothing was saved.")
    expect(screen.getByRole('textbox', { name: 'Template name' })).toHaveValue('Mine')
  })
})
