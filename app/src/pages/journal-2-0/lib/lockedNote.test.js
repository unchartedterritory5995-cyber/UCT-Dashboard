// Wave 6 item 8 — the lock's two pure pieces (lib/lockedNote.js). The editor
// half is railed through the real page in NoteEditorPage.wave6.test.jsx and
// NoteEditorPage.unlock.test.jsx (I1: the unlock's revision, end to end).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { noteIsLocked, setNoteLock } from './lockedNote'
import { setCurrentAccountId } from './offline/currentAccount'
import { recordLandedRevision } from './offline/useDurableNote'

// ⭐ The stub is at the bottom of the stack (the doorFamilies.settle idiom):
// `settleNoteWrite` — the account gate, the baseline authority, the response
// read — runs for real; only the ring write is observed.
vi.mock('./offline/useDurableNote', () => ({
  recordLandedRevision: vi.fn(async ({ updatedAt }) => updatedAt),
}))

const T2 = '2026-09-24T14:05:00.000000+00:00'
const landed = () => recordLandedRevision.mock.calls.map(([a]) => [a.noteId, a.updatedAt])
const answering = (res) => { const f = vi.fn().mockResolvedValue(res); vi.stubGlobal('fetch', f); return f }

beforeEach(() => { vi.clearAllMocks(); setCurrentAccountId('acct-A') })
afterEach(() => { vi.unstubAllGlobals(); setCurrentAccountId(null) })

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
    const f = answering({ ok: true, status: 200, json: async () => ({}) })
    await setNoteLock('a/b', false)
    expect(f).toHaveBeenCalledWith('/api/j2/notes/a%2Fb/lock', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ locked: false }),
    }))
  })

  it('throws on a refusal and on no answer, so the caller never believes a lock it did not get', async () => {
    answering({ ok: false, status: 404 })
    await expect(setNoteLock('n1', false)).rejects.toThrow('404')
    answering(undefined)
    await expect(setNoteLock('n1', false)).rejects.toThrow('network')
  })
})

// ⛔⛔ I1 (wave 6 fix round 1): the lock endpoint advances `updatedAt`, so this is
// a DOOR and it lands the revision it created — through `settleNoteWrite`.
describe('setNoteLock — a door that lands its revision', () => {
  it('lands the revision the server returned, and hands back the note ({note} envelope)', async () => {
    answering({ ok: true, status: 200, json: async () => ({ note: { id: 'n1', locked: false, updatedAt: T2 } }) })
    const note = await setNoteLock('n1', false)
    expect(landed()).toEqual([['n1', T2]])
    expect(note).toEqual({ id: 'n1', locked: false, updatedAt: T2 })
  })

  it('a bare note body lands the same way', async () => {
    answering({ ok: true, status: 200, json: async () => ({ id: 'n1', locked: true, updatedAt: T2 }) })
    expect((await setNoteLock('n1', true)).updatedAt).toBe(T2)
    expect(landed()).toEqual([['n1', T2]])
  })

  it('⛔ CONTROL — a refused lock lands nothing (a write that did not happen has no revision)', async () => {
    answering({ ok: false, status: 409, json: async () => ({ note: { updatedAt: T2 } }) })
    await expect(setNoteLock('n1', false)).rejects.toThrow('409')
    expect(landed()).toEqual([])
  })

  it('⛔ CONTROL — an answer with no note (`{ok:true}`, or no JSON at all) lands nothing rather than a guess', async () => {
    answering({ ok: true, status: 200, json: async () => ({ ok: true }) })
    expect(await setNoteLock('n1', false)).toEqual({ ok: true })
    answering({ ok: true, status: 200, json: async () => { throw new SyntaxError('not json') } })
    expect(await setNoteLock('n1', false)).toBeNull()
    expect(landed(), 'a browser cannot record a revision it was never told').toEqual([])
  })
})
