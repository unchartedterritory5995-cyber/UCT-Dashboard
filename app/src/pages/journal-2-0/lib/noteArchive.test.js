import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave 6 (lane E, item 1) — the archive write, and the bulk sentences/Undo it
 * adds to noteBatch.
 */
vi.mock('./offline/useDurableNote', async (importOriginal) => ({
  ...(await importOriginal()),
  recordLandedRevision: vi.fn(async ({ updatedAt }) => updatedAt),
}))

import { setNoteArchived, noteIsArchived, ARCHIVED_FOLDER } from './noteArchive'
import { describeBatch, undoFor, NOTE_WRITING_OPS, UNSENT_REFUSED_OPS } from './noteBatch'
import { recordLandedRevision } from './offline/useDurableNote'
import { setCurrentAccountId } from './offline/currentAccount'

beforeEach(() => {
  vi.clearAllMocks()
  setCurrentAccountId('acct-A')
})

describe('setNoteArchived', () => {
  it('PATCHes {archived}, lands the revision the server reports, and returns the note', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ note: { id: 'a b', updatedAt: 'R9', archivedAt: 'T' } }) }))
    const note = await setNoteArchived('a b', true, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith('/api/j2/notes/a%20b/archive', expect.objectContaining({
      method: 'PATCH', credentials: 'include', body: JSON.stringify({ archived: true }),
    }))
    expect(note).toEqual({ id: 'a b', updatedAt: 'R9', archivedAt: 'T' })
    expect(recordLandedRevision).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'a b', updatedAt: 'R9' }))
  })

  it('throws with the status on a refusal, and lands nothing', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    await expect(setNoteArchived('n1', false, fetchImpl)).rejects.toMatchObject({ status: 404 })
    expect(recordLandedRevision).not.toHaveBeenCalled()
  })

  it('knows an archived note and the sentinel the sidebar uses', () => {
    expect(noteIsArchived({ archivedAt: 'T' })).toBe(true)
    expect(noteIsArchived({ archivedAt: null })).toBe(false)
    expect(noteIsArchived(null)).toBe(false)
    expect(ARCHIVED_FOLDER).toBe('__archived__')
  })
})

describe('the bulk ops', () => {
  const outcome = (op, ids) => ({
    op, changed: ids.length, unchanged: 0, failed: 0,
    results: ids.map((id) => ({ id, status: 'changed' })),
  })

  it('say what happened, singular and plural', () => {
    expect(describeBatch(outcome('archive', ['a'])).message).toBe('Archived 1 note. It is under Archived, in the sidebar.')
    expect(describeBatch(outcome('archive', ['a', 'b'])).message).toBe('Archived 2 notes. They are under Archived, in the sidebar.')
    expect(describeBatch(outcome('unarchive', ['a'])).message).toBe('Brought 1 note back to its folder.')
    expect(describeBatch(outcome('unarchive', ['a', 'b'])).message).toBe('Brought 2 notes back, each to its own folder.')
  })

  it('an archive is undone by unarchiving exactly the notes it changed, and back', () => {
    const o = { op: 'archive', results: [{ id: 'a', status: 'changed' }, { id: 'b', status: 'unchanged' }] }
    expect(undoFor('archive', o)).toEqual({ op: 'unarchive', ids: ['a'], args: {} })
    expect(undoFor('unarchive', { results: [{ id: 'c', status: 'changed' }] })).toEqual({ op: 'archive', ids: ['c'], args: {} })
    expect(undoFor('archive', { results: [{ id: 'a', status: 'in_trash' }] })).toBeNull()
  })

  it('an archive moves no revision, so a blocked or still-sending note is not refused', () => {
    expect(NOTE_WRITING_OPS.has('archive')).toBe(false)
    expect(NOTE_WRITING_OPS.has('unarchive')).toBe(false)
    expect(UNSENT_REFUSED_OPS.has('archive')).toBe(false)
  })
})
