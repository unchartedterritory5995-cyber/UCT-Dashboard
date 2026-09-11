/**
 * ⛔⛔ THE DOORS, DRIVEN THROUGH THE EDITOR'S REAL SAVE PATH.
 *
 * ⛔⛔⛔ STATUS, 2026-09-11: **THIS RAIL DOES NOT YET REPRODUCE THE ROUND-3
 * FAILURE, AND IT IS NOT A GATE.** It is green on current code AND green with a
 * KNOWN defect reintroduced (see §MUTATION below). By Wave Q1 §A's own rule —
 * "if the rail cannot go red on the current code, it is not modelling the
 * failure, and no fix is attempted" — no product fix has been made against it.
 *
 * ⛔ DO NOT READ ITS GREEN AS EVIDENCE OF ANYTHING. It is committed because the
 * harness is real and reusable and the negative result is worth keeping, not
 * because it certifies the save path.
 *
 * §MUTATION — the proof that it cannot yet distinguish. Reintroducing round 2's
 * defect (`const current = captureLocalState() || saved` in
 * `settleMetadataRevision`) — the exact line that provably lost a member's
 * words in production — leaves all 17 cases GREEN. The mutation is INERT here
 * because `captureLocalState()` never returns null in this harness: the door's
 * handler closes over the `noteId` of the render that created it, and
 * `editorRef.current` survives. Making that fallback live is the next move.
 *
 * ⚰️ WHY THIS FILE EXISTS. The self-fork has now escaped three deploys. Each
 * fix was correct about the mechanism it named and each shipped with green
 * rails, because every existing rail models a door by CALLING THE HELPER THE
 * DOOR CALLS. A rail shaped like the implementation cannot fail on the
 * implementation being wired wrong, or on an ordering the EDITOR creates.
 * (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`.)
 *
 * ⭐ MEASURED, 2026-09-11, before this file was written:
 *
 *     rail                                    mounts the editor?
 *     offlineWordsSurvive.property.test.jsx   no — calls settleLandedSave directly
 *     selfForkDoors.test.jsx                  no — THE DOOR RAIL
 *     slowPutOrdering.test.jsx                no
 *     selfFork.test.jsx                       no — reads the SOURCE as text
 *     inFlightGuards.test.jsx                 no — reads the SOURCE as text
 *
 * The last two hold a source pin (`§THE WIRE`), which can catch a call that is
 * missing and cannot catch a call wired to the wrong thing at the wrong moment.
 *
 * ⛔⛔ AND THE SEAM NOBODY HAD BOTH SIDES OF. The three metadata doors live in
 * `NoteEditorPage`. The drain lives in `NotebookTab`, mounted as
 * `useOutboxDrain({ excludeNoteId: noteId })` — so the OPEN note is excluded
 * from draining. `NotebookTab.test.jsx` mocks out `NoteEditorPage`;
 * every `NoteEditorPage.*.test.jsx` mocks out the tab. **No test in this repo
 * has ever had both real at once.** The defect lives exactly there.
 *
 * ⛔ THE ONE THING THIS FILE ASSERTS, for every ordering:
 *      the server BODY CONTAINS THE OFFLINE SENTENCE, and the note count is
 *      unchanged.
 * Not "a settle ran". Not "the entry was superseded". The member's words, on
 * the server, and no fork. `lesson_rail_the_sentence_not_just_the_guard`.
 */
import React from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeIndexedDbFactory, settleIdb } from '../../lib/offline/__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from '../../lib/offline/useDurableNote'
import { OFFLINE_FLAG_KEY } from '../../lib/offline/offlineFlag'
import { dbNameFor } from '../../lib/offline/notebookDb'
import { useOutboxDrain } from '../../lib/offline/useOutboxDrain'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const OFFLINE_SENTENCE = 'WINDOW-CHECK-SENTINEL typed offline @ 2026-09-11T00:00:56Z'
const ACCOUNT = 'u42'
const ACCOUNT_DB = dbNameFor(ACCOUNT)

const docOf = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const plainOf = (doc) => JSON.stringify(doc ?? {})

/**
 * ⭐ ONE server, two transports — because that is the product's real shape.
 * The editor's doors and `commitSave` reach it through `useJ2Note().update`;
 * the drain reaches the SAME state through `global.fetch` (`sendNoteUpdate`,
 * `serverCopyIsOursDefault`, `forkConflictedCopy` all fetch). A rail with two
 * different servers could never see a door invalidate a queued entry.
 */
function createCasServer() {
  const srv = {
    note: {
      id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null, ticker: null,
      tags: [], heroImageUrl: null, isFavorite: false,
      bodyJson: docOf('Original body'), updatedAt: 'T1',
    },
    revisions: [],
    online: true,
    puts: [],            // every PUT, in order, with what it carried
    created: [],         // every note CREATED — a fork shows up here
    gate: null,          // when set, PUTs park here until released
    rev: 1,
  }

  srv.applyPut = (patch, via) => {
    // ⛔ CAS only when a baseline is supplied. The three metadata doors send
    // NONE — that is the product's real behaviour and the whole reason the
    // `folder` door can move the revision out from under a queued entry.
    if (patch.baseUpdatedAt && patch.baseUpdatedAt !== srv.note.updatedAt) {
      const err = new Error('conflict')
      err.status = 409
      throw err
    }
    srv.rev += 1
    const next = { ...srv.note }
    if (patch.title !== undefined) next.title = patch.title
    if (patch.subtitle !== undefined) next.subtitle = patch.subtitle
    if (patch.bodyJson !== undefined) next.bodyJson = patch.bodyJson
    if (patch.folderId !== undefined) next.folderId = patch.folderId
    if (patch.ticker !== undefined) next.ticker = patch.ticker
    if (patch.tags !== undefined) next.tags = patch.tags
    next.updatedAt = `T${srv.rev}`
    srv.revisions.push({ ...next })
    srv.note = next
    srv.puts.push({ via, patch, resultingUpdatedAt: next.updatedAt, carriedBody: patch.bodyJson !== undefined })
    return { ...next }
  }

  srv.offlineError = () => {
    // What the real code actually sees from a dead network.
    const e = new TypeError('Failed to fetch')
    return e
  }

  return srv
}

let server
let factory

// The doors + commitSave reach the server through this.
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({
    note: server.note, isLoading: false, error: null,
    update: updateMock, refresh: vi.fn(),
  }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: ACCOUNT, role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [{ id: 'f1', name: 'Ideas' }] }) }))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')   // the layer is dark in prod; certification opts in
  server = createCasServer()
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory

  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => {
    if (!server.online) throw server.offlineError()
    if (server.gate) await server.gate.promise
    return server.applyPut(patch, 'editor')
  })

  global.fetch = vi.fn(async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase()
    if (!server.online) throw server.offlineError()
    if (String(url).includes('/api/j2/notes') && method === 'PUT') {
      if (server.gate) await server.gate.promise
      try {
        const note = server.applyPut(JSON.parse(opts.body || '{}'), 'drain')
        return { ok: true, status: 200, json: async () => ({ note }) }
      } catch (e) {
        return { ok: false, status: e.status || 500, json: async () => ({ detail: 'conflict' }) }
      }
    }
    if (String(url).includes('/api/j2/notes') && method === 'POST') {
      const body = JSON.parse(opts.body || '{}')
      server.created.push(body)                     // ⛔ this is a FORK
      return { ok: true, status: 200, json: async () => ({ note: { ...body, id: `fork${server.created.length}` } }) }
    }
    // GET the note — the drain's `serverCopyIsOurs` and the fork's read
    return { ok: true, status: 200, json: async () => ({ note: { ...server.note } }) }
  })

  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
})

/**
 * ⭐ THE REAL TOPOLOGY, NOT A CONVENIENT ONE. This mounts what `NotebookTab`
 * mounts: the real editor AND the real drain, with the open note excluded from
 * draining. The source pin below proves this harness still matches the product;
 * without it this file would be free to drift into the same fiction the Phase 3
 * arity defect shipped — a contract and its test agreeing with each other and
 * neither agreeing with the product.
 */
function RealSavePath({ noteId }) {
  useOutboxDrain({ accountId: ACCOUNT, excludeNoteId: noteId })
  const [Editor, setEditor] = React.useState(null)
  React.useEffect(() => {
    let live = true
    import('./NoteEditorPage').then((m) => { if (live) setEditor(() => m.default) })
    return () => { live = false }
  }, [])
  // ⛔ CONDITIONAL, exactly as NotebookTab does it: `{noteId ? <NoteEditorPage
  // .../> : ...}`. Rendering the editor unconditionally with a null noteId
  // keeps it MOUNTED and its refs alive, so `captureLocalState()` can still
  // answer — and the whole navigate-away ordering quietly stops existing.
  if (!Editor || !noteId) return null
  return <Editor noteId={noteId} onBack={() => {}} showBack={false} />
}

async function mountRealSavePath() {
  render(<MemoryRouter><RealSavePath noteId="n1" /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  await act(async () => { await settleIdb(6) })
}

const typeTitle = (v) => fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: v } })

/**
 * ⭐ THE MEMBER TYPES INTO THE BODY. `EditorContent` hangs the live TipTap
 * instance on its own `.ProseMirror` node, so the rail reaches the REAL editor
 * the page is using — no product test seam, no second editor, no mock.
 * `setContent` emits the update, which is what drives the real autosave.
 */
function typeBody(text) {
  const dom = document.querySelector('.ProseMirror')
  if (!dom || !dom.editor) throw new Error('the editor is not mounted — the rail cannot type')
  dom.editor.commands.setContent(docOf(text))
}
async function settle(ms = 1200, n = 8) {
  await act(async () => { vi.advanceTimersByTime(ms); await settleIdb(n) })
}

/** The three metadata doors, driven through the DOM the member actually uses. */
const doors = {
  folder: () => fireEvent.change(screen.getByDisplayValue('Unfiled'), { target: { value: 'f1' } }),
  ticker: () => fireEvent.blur(screen.getByPlaceholderText('Ticker'), { target: { value: 'NVDA' } }),
  tags: () => fireEvent.blur(screen.getByPlaceholderText('Tags (comma sep)'), { target: { value: 'thesis' } }),
}

/**
 * ⛔⛔ THE ASSERTION IS ON THE BODY, AND THE REASON MATTERS.
 *
 * ⚰️ Draft 2 of this file put the sentence in the TITLE and asserted
 * "authored content", reasoning that `sameAuthoredContent` treats title and
 * body as one unit so the discard decision is field-blind. That reasoning was
 * TRUE and the conclusion was WRONG, and a mutation proved it: reintroducing
 * the round-2 defect left all 17 cases GREEN.
 *
 * ⭐ WHY. The discard decision is field-blind, but WHICH PUT LANDS LAST IS
 * NOT. Every `commitSave` re-sends the whole current title, so a title-borne
 * sentence rides on every subsequent send and losing one entry loses nothing.
 * The door's PUT carries NO body at all — so it cannot clobber a title, and it
 * absolutely decides the body. That is the production shape exactly: the door
 * moved `updatedAt` while the body-carrying entries were discarded, leaving the
 * server holding an OLD body under a NEW revision.
 *
 * ⛔ A rail that cannot see the body cannot see this defect.
 */
const serverBodyHasSentence = () => plainOf(server.note.bodyJson).includes(OFFLINE_SENTENCE)
const forkCount = () => server.created.length
const store = (name) => factory.databases.get(ACCOUNT_DB)?.dump(name) ?? []

/**
 * ⛔⛔ THE NON-VACUITY GATE (rule 14: an empty result is a failed invocation
 * until proven otherwise).
 *
 * ⚰️ The first green run of this file was VACUOUS and looked like a pass. Every
 * ordering went green because no outbox entry ever existed for the door to
 * discard — the rail was asserting that the member's words survived a queue
 * that was empty. An assertion over an empty set satisfies almost anything.
 *
 * ⛔ So: before any door fires, PROVE the queue holds work. If this throws, the
 * scenario never set up the conflict it claims to test, and any result after it
 * is worthless.
 */
function proveThereIsQueuedWork(where) {
  const outbox = store('outbox')
  const notes = store('notes')
  const dirty = notes.filter((n) => n.dirty)
  if (outbox.length === 0 && dirty.length === 0) {
    throw new Error(
      `VACUOUS at "${where}": nothing is queued and no durable record is dirty, so there is `
      + `no work for a door to discard. outbox=${outbox.length} notes=${notes.length} `
      + `dirty=${dirty.length}. The scenario did not reproduce the setup it claims.`,
    )
  }
  return { outbox: outbox.length, dirty: dirty.length }
}

// ────────────────────────────────────────────────────────────────────────────
describe('⛔⛔ the harness is the PRODUCT, not a restatement of it', () => {
  const tabSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'pages', 'journal-2-0', 'tabs', 'NotebookTab.jsx'), 'utf8',
  )

  it('⭐ NON-VACUITY: the source pin actually read NotebookTab', () => {
    expect(tabSrc.length).toBeGreaterThan(2000)
    expect(tabSrc).toContain('NoteEditorPage')
  })

  it('⛔ NotebookTab mounts the drain with the OPEN note excluded — as this harness does', () => {
    expect(tabSrc).toMatch(/useOutboxDrain\(\{[^}]*excludeNoteId:\s*noteId/)
  })

  it('⛔ NotebookTab renders the real NoteEditorPage for the open note', () => {
    expect(tabSrc).toMatch(/<NoteEditorPage[\s\S]{0,120}noteId=\{noteId\}/)
  })
})

describe('⛔⛔ THE INVARIANT — the offline sentence reaches the server body, and nothing forks', () => {
  /**
   * The round-3 ordering, verbatim from the streak log:
   *   one CAS PUT online · offline, the entry captures that baseline ·
   *   the `folder` door PUTs 200 and moves the baseline · N queued sends were
   *   already in flight when it landed.
   */
  async function offlineSentenceThenDoor(door, inFlight) {
    await mountRealSavePath()

    // 1 — one CAS PUT while online. The queued entry will capture this baseline.
    typeTitle('online words')
    await settle()
    expect(server.puts.length).toBeGreaterThan(0)

    // 2 — offline. The member types the sentence that must survive.
    server.online = false
    typeBody(OFFLINE_SENTENCE)
    await settle()
    proveThereIsQueuedWork('after the offline edit, before the door')

    // 3 — back online, but hold N sends on the wire when the door fires.
    let release
    server.gate = { promise: new Promise((r) => { release = r }) }
    server.online = true
    for (let i = 0; i < inFlight; i += 1) {
      typeBody(`${OFFLINE_SENTENCE} ${i}`)
      await act(async () => { vi.advanceTimersByTime(850); await settleIdb(2) })
    }

    // 4 — the door lands while those are in flight.
    await act(async () => { doors[door]() })
    release()
    server.gate = null
    await settle(3000, 12)
    await settle(3000, 12)
  }

  for (const n of [1, 2, 3, 4, 5]) {
    it(`⛔ door \`folder\` with ${n} queued send(s) in flight ⇒ the sentence is on the server`, async () => {
      await offlineSentenceThenDoor('folder', n)
      expect(serverBodyHasSentence()).toBe(true)
      expect(forkCount()).toBe(0)
    })
  }

  it('⛔ door `ticker`, N=3 — the same door class, the same invariant', async () => {
    await offlineSentenceThenDoor('ticker', 3)
    expect(serverBodyHasSentence()).toBe(true)
    expect(forkCount()).toBe(0)
  })

  it('⛔ door `tags`, N=3 — the same door class, the same invariant', async () => {
    await offlineSentenceThenDoor('tags', 3)
    expect(serverBodyHasSentence()).toBe(true)
    expect(forkCount()).toBe(0)
  })
})

describe('⛔⛔ THE ORDERING PRODUCTION ACTUALLY HAD — the note LEAVES excludeNoteId', () => {
  /**
   * ⭐ This is the ordering every previous rail was structurally unable to hold.
   *
   * `NotebookTab` drains with `excludeNoteId: noteId`, so while a note is OPEN
   * the sweep will not touch it. The moment the member navigates away it
   * becomes the sweep's — and round 2's own analysis named exactly that
   * transition: *"the save resolves after navigate-away, exactly when the note
   * leaves `excludeNoteId`"*.
   *
   * So the door fires, sends are still on the wire, AND THEN the note stops
   * being excluded. The drain now claims an entry whose baseline the door has
   * already moved, while the editor that would have settled it is gone.
   */
  it('⛔ door fires, sends in flight, THEN the member navigates away', async () => {
    const view = render(<MemoryRouter><RealSavePath noteId="n1" /></MemoryRouter>)
    await screen.findByPlaceholderText('Title')
    await act(async () => { await settleIdb(6) })

    typeTitle('online words')
    await settle()

    server.online = false
    typeBody(OFFLINE_SENTENCE)
    await settle()
    proveThereIsQueuedWork('after the offline edit, before the door')

    let release
    server.gate = { promise: new Promise((r) => { release = r }) }
    server.online = true
    for (let i = 0; i < 3; i += 1) {
      typeBody(`${OFFLINE_SENTENCE} ${i}`)
      await act(async () => { vi.advanceTimersByTime(850); await settleIdb(2) })
    }

    await act(async () => { doors.folder() })

    // ⛔ THE TRANSITION: the note stops being excluded while work is in flight.
    await act(async () => {
      view.rerender(<MemoryRouter><RealSavePath noteId={null} /></MemoryRouter>)
    })
    release()
    server.gate = null
    await settle(3000, 12)
    await settle(3000, 12)

    expect(serverBodyHasSentence()).toBe(true)
    expect(forkCount()).toBe(0)
  })

  it('⛔ the same, with the door firing AFTER the note is already unexcluded', async () => {
    const view = render(<MemoryRouter><RealSavePath noteId="n1" /></MemoryRouter>)
    await screen.findByPlaceholderText('Title')
    await act(async () => { await settleIdb(6) })

    typeTitle('online words')
    await settle()

    server.online = false
    typeBody(OFFLINE_SENTENCE)
    await settle()
    proveThereIsQueuedWork('after the offline edit, before the door')

    let release
    server.gate = { promise: new Promise((r) => { release = r }) }
    server.online = true
    for (let i = 0; i < 3; i += 1) {
      typeBody(`${OFFLINE_SENTENCE} ${i}`)
      await act(async () => { vi.advanceTimersByTime(850); await settleIdb(2) })
    }

    await act(async () => { doors.folder() })
    await settle(500, 4)
    await act(async () => {
      view.rerender(<MemoryRouter><RealSavePath noteId={null} /></MemoryRouter>)
    })
    await settle(500, 4)
    release()
    server.gate = null
    await settle(3000, 12)
    await settle(3000, 12)

    expect(serverBodyHasSentence()).toBe(true)
    expect(forkCount()).toBe(0)
  })
})

describe('⛔ reload mid-flight, through the real path', () => {
  it('⛔ the sentence survives an unmount while a save is on the wire', async () => {
    const view = render(<MemoryRouter><RealSavePath noteId="n1" /></MemoryRouter>)
    await screen.findByPlaceholderText('Title')
    await act(async () => { await settleIdb(6) })

    typeTitle('online words')
    await settle()

    server.online = false
    typeBody(OFFLINE_SENTENCE)
    await settle()

    let release
    server.gate = { promise: new Promise((r) => { release = r }) }
    server.online = true
    typeBody(`${OFFLINE_SENTENCE} !`)
    await act(async () => { vi.advanceTimersByTime(850); await settleIdb(2) })

    // the reload: the component goes away while the PUT is still on the wire
    view.unmount()
    release()
    server.gate = null

    // a fresh mount picks the work up, exactly as a reloaded tab would
    await mountRealSavePath()
    await settle(3000, 12)
    await settle(3000, 12)

    expect(serverBodyHasSentence()).toBe(true)
    expect(forkCount()).toBe(0)
  })
})

describe('⛔ slow PUT, through the real path', () => {
  it('⛔ a door landing during a slow save does not discard the queued words', async () => {
    await mountRealSavePath()
    typeTitle('online words')
    await settle()

    server.online = false
    typeBody(OFFLINE_SENTENCE)
    await settle()

    let release
    server.gate = { promise: new Promise((r) => { release = r }) }
    server.online = true
    typeBody(`${OFFLINE_SENTENCE} slow`)
    await act(async () => { vi.advanceTimersByTime(850); await settleIdb(2) })

    await act(async () => { doors.folder() })
    await settle(2000, 8)          // the door settles while the body PUT is STILL parked
    release()
    server.gate = null
    await settle(3000, 12)
    await settle(3000, 12)

    expect(serverBodyHasSentence()).toBe(true)
    expect(forkCount()).toBe(0)
  })
})

describe('⭐ CONTROLS — the rail can distinguish, and can fail', () => {
  it('⭐ with no door and no offline window, the ordinary save lands (the rail is not always-red)', async () => {
    await mountRealSavePath()
    typeBody(OFFLINE_SENTENCE)
    await settle()
    expect(serverBodyHasSentence()).toBe(true)
    expect(forkCount()).toBe(0)
  })

  it('⛔ the assertion is REAL: a server that never took the body reads as FAILED', async () => {
    await mountRealSavePath()
    typeBody('something else entirely')
    await settle()
    expect(serverBodyHasSentence()).toBe(false)
  })

  it('⭐ the door really does move the revision without carrying a body', async () => {
    await mountRealSavePath()
    const before = server.note.updatedAt
    await act(async () => { doors.folder() })
    await settle()
    expect(server.note.updatedAt).not.toBe(before)
    const doorPut = server.puts[server.puts.length - 1]
    expect(doorPut.carriedBody).toBe(false)
    expect(doorPut.patch.baseUpdatedAt).toBeUndefined()
  })
})

// ────────────────────────────────────────────────────────────────────────────
/**
 * ⛔⛔ THE MEASURED CHAIN — replayed from the rig, not invented.
 *
 * Every ordering above was a GUESS at what production does. This one is a
 * TRANSCRIPT. It replays `docs/notebook/wave-q1-repro/2026-09-11T03-13-49Z-canary.json`
 * step for step, with the response each request actually got:
 *
 *   #0 body, no sentence   base T0  -> 200   server = T1
 *   #1 body, SENTENCE      base T1  -> never completed (offline)
 *   #2 body, SENTENCE      base T1  -> never completed (offline)
 *   #3 body, SENTENCE      base T1  -> never completed (offline)
 *   #4 NO BODY (the door)  base T1  -> 200   server = T2
 *   #5 body, SENTENCE      base T1  -> 409   "note changed — refresh and retry"
 *   settled: server = T2, the DOOR's revision. The sentence is GONE.
 *
 * ⭐ The two steps the fix must close (owner ruling R-17):
 *   (a) #5 is born stale — the door's 200 carried `updatedAt: T2` and nothing
 *       moved the queued entry onto it before the resend.
 *   (b) the 409 at #5 FORKED instead of rebasing, even though T2 is a revision
 *       THIS browser landed.
 */
describe('⛔⛔ THE MEASURED CHAIN — the rig transcript, replayed', () => {
  it('⛔ (a) after a door 200, no queued entry still holds a pre-door baseline', async () => {
    await mountRealSavePath()
    typeBody('online words')
    await settle()
    const beforeDoor = server.note.updatedAt

    server.online = false
    typeBody(OFFLINE_SENTENCE)
    await settle()
    proveThereIsQueuedWork('offline, before the door')

    server.online = true
    await act(async () => { doors.folder() })
    await settle(2000, 8)

    const doorRev = server.note.updatedAt
    expect(doorRev, 'the door must have moved the revision').not.toBe(beforeDoor)

    // ⛔ R-17(a): the door's own response carried this revision. Any entry still
    // sitting on the pre-door baseline is BORN STALE and will 409 on arrival —
    // which is exactly what #5 did on the rig.
    const stale = store('outbox').filter((e) => e.baseUpdatedAt && e.baseUpdatedAt < doorRev)
    expect(
      stale.map((e) => ({ id: e.mutationId, base: e.baseUpdatedAt })),
      `entries left on a pre-door baseline after the door landed at ${doorRev}`,
    ).toEqual([])
  })

  it('⛔ (b) the full chain ends with the sentence on the server and no fork', async () => {
    await mountRealSavePath()
    typeBody('online words')
    await settle()

    server.online = false
    typeBody(OFFLINE_SENTENCE)
    await settle()
    proveThereIsQueuedWork('offline, before the door')

    server.online = true
    await act(async () => { doors.folder() })
    await settle(3000, 12)
    await settle(3000, 12)

    expect(serverBodyHasSentence(), 'the offline sentence must reach the server body').toBe(true)
    expect(forkCount(), 'a single-writer session must not fork').toBe(0)
  })

  it('⭐ CONTROL — a GENUINELY foreign 409 still forks (the fix must not swallow that)', async () => {
    await mountRealSavePath()
    typeBody('online words')
    await settle()

    server.online = false
    typeBody(OFFLINE_SENTENCE)
    await settle()

    // another device moves the server while we are dark — NOT our revision
    server.applyPut({ title: 'someone else', bodyJson: docOf('a second writer') }, 'other-device')

    server.online = true
    await settle(3000, 12)
    await settle(3000, 12)

    // ⛔ The words must survive SOMEWHERE — that is the fork's whole job.
    const survived = serverBodyHasSentence() || forkCount() > 0
    expect(survived, 'a foreign 409 must preserve both versions, never drop ours').toBe(true)
  })
})
