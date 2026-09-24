// Wave 6 item 8 — the lock's two pure pieces (lib/lockedNote.js). The editor
// half is railed through the real page in NoteEditorPage.wave6.test.jsx.
import { describe, it, expect, vi } from 'vitest'
import { noteIsLocked, setNoteLock } from './lockedNote'

describe('noteIsLocked', () => {
  it('only an explicit true locks (an old payload without the field is unlocked)', () => {
    expect(noteIsLocked({ locked: true })).toBe(true)
    for (const n of [{ locked: false }, {}, { locked: 'true' }, { locked: 1 }, null, undefined]) {
      expect(noteIsLocked(n), JSON.stringify(n)).toBe(false)
    }
  })
})

describe('setNoteLock', () => {
  it('PATCHes /api/j2/notes/{id}/lock with {locked}', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    await setNoteLock('a/b', false, f)
    expect(f).toHaveBeenCalledWith('/api/j2/notes/a%2Fb/lock', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ locked: false }),
    }))
  })

  it('throws on a refusal and on no answer, so the caller never believes a lock it did not get', async () => {
    await expect(setNoteLock('n1', false, vi.fn().mockResolvedValue({ ok: false, status: 404 }))).rejects.toThrow('404')
    await expect(setNoteLock('n1', false, vi.fn().mockResolvedValue(undefined))).rejects.toThrow('network')
  })
})
