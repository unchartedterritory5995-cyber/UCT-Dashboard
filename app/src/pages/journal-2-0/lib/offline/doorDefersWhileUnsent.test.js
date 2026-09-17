/**
 * ⛔⛔ THE DOOR GUARD'S RAIL. MITIGATION, NOT ROOT CAUSE.
 *
 * `sendCaptureToJournal` is the single chokepoint every capture door funnels
 * through — thirteen call sites — and while a note has unsent work it must DEFER
 * rather than post an embed onto a route that loses the member's offline words
 * (Q1/Q2, `docs/notebook/q1-red-cells-investigation.md`; the defect is unnamed and
 * neither fix 4 nor fix 5 closed it).
 *
 * ⭐ EVERY CASE DRIVES THE REAL ID-RESOLUTION PATH. `freshLastNote()` reads
 * `localStorage['uct.jw.lastNote']`, so these seed that key rather than mocking an
 * id. A rail that hands the guard a clean string cannot catch the defect this file
 * exists for — the guard's FIRST version passed `{id, ts}` where a string was due,
 * every lookup missed, and it would have passed SILENTLY on every door.
 *
 * ⛔ ONE PREDICATE. The cases and the control both go through
 * `noteHasUnsentWork`; none of them re-implements it. A control that restates the
 * predicate agrees with itself and says nothing about the product (R-05).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installKeyRange } from './__fixtures__/fakeIndexedDb'
import { noteHasUnsentWork, STILL_SYNCING_MESSAGE } from './noteHasUnsentWork'

const LAST_NOTE_KEY = 'uct.jw.lastNote'
const NOTE = 'note-1'
const ACCT = 'acct-1'

/** A store stub with exactly the two reads the predicate performs. ⛔ It is a
 *  STORE stub, not a predicate stub — the logic under test still runs. */
function fakeDb({ record = null, queued = false, throwOn = null } = {}) {
  return {
    transaction(name) {
      if (throwOn === name) throw new Error('store unavailable')
      return {
        objectStore() {
          return {
            get() {
              const req = {}
              setTimeout(() => { req.result = record; req.onsuccess?.() }, 0)
              return req
            },
            index() {
              return {
                getKey() {
                  const req = {}
                  setTimeout(() => { req.result = queued ? 'mut-1' : undefined; req.onsuccess?.() }, 0)
                  return req
                },
              }
            },
          }
        },
      }
    },
  }
}

const connectOk = (opts) => async () => fakeDb(opts)
const connectThrows = () => async () => { throw new Error('cannot open') }

/** The guard's own decision, driven through the REAL id path. */
async function doorVerdict({ lastNote, account = ACCT, connect }) {
  if (lastNote === undefined) localStorage.removeItem(LAST_NOTE_KEY)
  else localStorage.setItem(LAST_NOTE_KEY, JSON.stringify(lastNote))
  const { freshLastNote } = await import('../captureTargets')
  const last = freshLastNote()
  return noteHasUnsentWork(last?.id || null, { accountId: account, connect })
}

beforeEach(() => {
  installKeyRange()
  localStorage.clear()
  localStorage.setItem('uct.notebook.offline', '1')
  vi.stubGlobal('indexedDB', { open: () => ({}) })
})
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

describe('the capture door defers while a note has unsent work', () => {
  it('⛔ a QUEUED entry with a CLEAN record DEFERS — the five-cell shape', async () => {
    // ⭐ This is the case `dirty` alone would miss. Production shows the record
    // reconciled clean while an entry is still queued:
    //   store trail: [(1, True, …, True), (0, False, 'None', False)] · queued 1 entry(s)
    const v = await doorVerdict({
      lastNote: { id: NOTE, ts: Date.now() },
      connect: connectOk({ record: { noteId: NOTE, dirty: 0 }, queued: true }),
    })
    expect(v.unsent, 'a queued entry must defer even when the record reads clean').toBe(true)
    expect(v.why).toBe('queued')
  })

  it('⛔ a DIRTY record with nothing queued DEFERS', async () => {
    const v = await doorVerdict({
      lastNote: { id: NOTE, ts: Date.now() },
      connect: connectOk({ record: { noteId: NOTE, dirty: 1 }, queued: false }),
    })
    expect(v.unsent).toBe(true)
    expect(v.why).toBe('dirty')
  })

  it('⛔ a store that cannot be OPENED defers — UNKNOWN is not safe', async () => {
    const v = await doorVerdict({ lastNote: { id: NOTE, ts: Date.now() }, connect: connectThrows() })
    expect(v.unsent, 'an unreadable store must defer, never pass').toBe(true)
    expect(v.why).toBe('unreadable')
  })

  it('⛔ a store that cannot be READ defers too', async () => {
    const v = await doorVerdict({
      lastNote: { id: NOTE, ts: Date.now() },
      connect: connectOk({ throwOn: 'notes' }),
    })
    expect(v.unsent).toBe(true)
    expect(v.why).toBe('unreadable')
  })

  it('⛔⛔ AN ID-SHAPED BUG DEFERS, NEVER PASSES', async () => {
    // ⚰️ The guard's first version passed freshLastNote()'s WHOLE OBJECT where a
    // string id was due. Every lookup missed, so it would have passed silently on
    // every door — the failure direction that costs the member's words. Here the
    // object is handed in deliberately: the guard must not treat a miss as clean.
    const bogus = { id: NOTE, ts: Date.now() }
    const v = await noteHasUnsentWork(bogus, {
      accountId: ACCT,
      // the store holds a queued entry for the REAL id; an object key finds nothing
      connect: connectOk({ record: null, queued: false }),
    })
    expect(typeof bogus, 'the fixture must actually be an object, or this proves nothing')
      .toBe('object')
    expect(v.unsent, 'an id that is not a string must defer, not pass').toBe(true)
  })

  it('⭐ CONTROL — a clean note with nothing queued PASSES', async () => {
    // ⛔ Without this the guard could be "always defer", which would break every
    // capture door in the app and read as safety.
    const v = await doorVerdict({
      lastNote: { id: NOTE, ts: Date.now() },
      connect: connectOk({ record: { noteId: NOTE, dirty: 0 }, queued: false }),
    })
    expect(v.unsent, 'a clean, drained note must not be deferred').toBe(false)
    expect(v.why).toBe(null)
  })

  it('⭐ CONTROL — ABSENT passes: no current note, and no account', async () => {
    // ⛔ ABSENT IS NOT UNKNOWN. The store is named per account and keyed per note,
    // so with neither there is no store and no entry CAN exist. Deferring here
    // would block doors that were never at risk — it deferred five legitimate door
    // tests before this distinction was drawn.
    const noNote = await doorVerdict({
      lastNote: undefined,
      connect: connectOk({ record: { noteId: NOTE, dirty: 1 }, queued: true }),
    })
    expect(noNote.unsent).toBe(false)
    expect(noNote.why).toBe('no-store')

    const noAcct = await doorVerdict({
      lastNote: { id: NOTE, ts: Date.now() },
      account: null,
      connect: connectOk({ record: { noteId: NOTE, dirty: 1 }, queued: true }),
    })
    expect(noAcct.unsent).toBe(false)
    expect(noAcct.why).toBe('no-store')
  })
})

describe('⛔⛔ THE GUARD ITSELF — sendCaptureToJournal, not just the predicate', () => {
  // ⚰️ WHY THIS BLOCK EXISTS. Every case above drives `noteHasUnsentWork`
  // directly. The mutation proof then removed the GUARD from
  // sendCaptureToJournal entirely — and all eight stayed GREEN. A rail that
  // tests the predicate while the guard is deleted proves the predicate and
  // nothing else; it is R-05 one level out, and the mutation proof is the only
  // reason it was caught before shipping.
  //
  // ⛔ So these drive the real exported door and assert on what it DOES: the
  // embed is not posted, and the member gets the sentence back.

  it('⛔ with unsent work the door DEFERS: no embed posted, sentence returned', async () => {
    vi.resetModules()
    localStorage.setItem(LAST_NOTE_KEY, JSON.stringify({ id: NOTE, ts: Date.now() }))
    const ran = vi.fn(async () => 'SHOULD NOT REACH THE SERVER')
    vi.doMock('../captureTargets', async (orig) => ({
      ...(await orig()),
      CAPTURE_TARGETS: { note: { run: ran } },
      freshLastNote: () => ({ id: NOTE, ts: Date.now() }),
    }))
    vi.doMock('./notebookDb', async (orig) => ({
      ...(await orig()),
      offlineStorageAvailable: () => true,
      openNotebookDb: async () => fakeDb({ record: { noteId: NOTE, dirty: 1 }, queued: true }),
    }))
    vi.doMock('./currentAccount', () => ({ getCurrentAccountId: () => ACCT }))
    const { sendCaptureToJournal } = await import('../sendToJournal')
    const msg = await sendCaptureToJournal('chart', { any: 'capture' }, { label: 'x' })
    expect(ran, 'the embed must NOT be posted while work is unsent').not.toHaveBeenCalled()
    expect(msg).toBe(STILL_SYNCING_MESSAGE)
  })

  it('⭐ CONTROL — with nothing unsent the door PROCEEDS and posts', async () => {
    // ⛔ Without this the guard could be "always defer", which would break every
    // capture door in the app and read as safety.
    vi.resetModules()
    localStorage.setItem(LAST_NOTE_KEY, JSON.stringify({ id: NOTE, ts: Date.now() }))
    const ran = vi.fn(async () => 'Saved to your note')
    vi.doMock('../captureTargets', async (orig) => ({
      ...(await orig()),
      CAPTURE_TARGETS: { note: { run: ran } },
      freshLastNote: () => ({ id: NOTE, ts: Date.now() }),
    }))
    vi.doMock('./notebookDb', async (orig) => ({
      ...(await orig()),
      offlineStorageAvailable: () => true,
      openNotebookDb: async () => fakeDb({ record: { noteId: NOTE, dirty: 0 }, queued: false }),
    }))
    vi.doMock('./currentAccount', () => ({ getCurrentAccountId: () => ACCT }))
    const { sendCaptureToJournal } = await import('../sendToJournal')
    const msg = await sendCaptureToJournal('chart', { any: 'capture' }, { label: 'x' })
    expect(ran, 'a clean note must still be able to capture').toHaveBeenCalled()
    expect(msg).toBe('Saved to your note')
  })
})

describe('copy contract — the member must SEE the sentence', () => {
  it('⛔ the deferral message is real rendered text, not a state flag', () => {
    // ⚰️ Two toasts have shipped invisible in this repo: one passed `message`
    // where the component reads `msg`, one was owned by the branch its own action
    // unmounts. Both left every structural assertion green. So the sentence itself
    // is pinned, and `sendCaptureToJournal` returns it as the toast line every
    // caller already renders.
    expect(STILL_SYNCING_MESSAGE).toBe('This note is still syncing — try again in a moment.')
    expect(STILL_SYNCING_MESSAGE).toMatch(/still syncing/i)
    expect(STILL_SYNCING_MESSAGE.trim().length, 'an empty toast is an invisible toast')
      .toBeGreaterThan(10)
  })
})
