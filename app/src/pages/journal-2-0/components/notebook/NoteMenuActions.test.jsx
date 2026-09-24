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
  answer = (body) => ({ ok: true, status: 200, json: async () => ({ note: { id: 'n1', updatedAt: 'R1', archivedAt: body.archived ? 'T' : null } }) })
  global.fetch = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url: String(url), method: init.method, body })
    return answer(body)
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
