/**
 * ⛔⛔ Q1 STEP 2 — NAME THE WRITER. This is a REPRODUCTION, not a rail.
 *
 * The five append cells lose a member's offline words: the embed reaches the
 * server, the typed words do not, the durable record is reconciled clean, and
 * nothing marks the note as pending. Q1 fix 4 and fix 5 are both live and
 * neither closed it. The door guard (`noteHasUnsentWork`) is a MITIGATION — it
 * stops a member REACHING the route — so the rig can no longer reproduce the
 * loss on production by design, and the writer must be named here instead.
 *
 * ⛔⛔ R-CITE. Nothing in this file names a writer. It INSTRUMENTS every writer
 * and prints what fired. The name comes out of `spyLog`, as "<function>, spy
 * call N", or it does not get written down. A census of three
 * (`settleLandedSave`, `persist`, `settleSent`) is a census; this is the
 * instrument that turns it into a name.
 *
 * ⛔ Corroborated against `tools/q1_clean_write_sweep.mjs` (acorn) and `grep -n`
 * — see `callerFrom`, which also records the day I blamed this instrument for a
 * corruption I had caused in the file it was reading.
 *
 * ⭐ EVERYTHING UNDER TEST IS REAL. `openNotebookDb`, `putNoteWithIntent`,
 * `drainOutbox`, `settleSent`, `rebaseEntry`, `mergeAppends`, `settleNoteWrite`,
 * `recordLandedRevision`, `sendNoteUpdate`, `serverCopyIsOursDefault`,
 * `forkConflictedCopy` and `CAPTURE_TARGETS.note.run` all execute unmocked
 * against a fake IndexedDB and a fake `fetch`. The ONLY wrapper is a
 * pass-through spy on `putNoteWithIntent` that records and then calls the real
 * one — because a mock of the writer could not lose anything, and a
 * reproduction that cannot reproduce the defect proves nothing (R-05).
 *
 * ⛔ THE GUARD IS BYPASSED IN THE TEST ONLY, AND NEVER BY TOUCHING PRODUCT CODE.
 * `sendCaptureToJournal` is the chokepoint that now defers; this drives
 * `CAPTURE_TARGETS.note.run` — the code path immediately AFTER the guard would
 * have passed — so the product keeps its guard and the test still reaches the
 * route the loss lives on.
 *
 * ⭐ THE SERVER MOCK IS DIFFED AGAINST THE 09-15 WIRE, and its shape is the
 * thing most likely to be wrong, so it is stated rather than assumed:
 *   PUT /notes/:id        compare-and-set on `baseUpdatedAt`; 409 when stale
 *   POST /notes/:id/opened  200, and does NOT move `updatedAt`
 *                           (`notes.py::record_note_opened` writes only
 *                           `j2_note_recents` — verified, not assumed)
 *   POST /notes/:id/embeds  appends a node, MOVES `updatedAt`, returns
 *                           `{note}` (`journal_two.py:1808`)
 *   GET  /notes/:id       the server's current copy
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createFakeIndexedDbFactory, installKeyRange, settleIdb } from './__fixtures__/fakeIndexedDb'

const ACCT = 'acct-repro'
const NOTE = 'note-append-cell'
const SENTENCE = 'the member typed this offline and it must survive'
const SERVER_TEXT = 'server copy only'

const T0 = '2026-09-17T10:00:00.000Z'

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...texts) => ({ type: 'doc', content: texts.map(para) })
const embedNode = (key) => ({ type: 'widgetEmbed', attrs: { widgetId: 'chart', serverKey: key } })

/** Does this document, whatever its shape, carry the member's sentence? */
const holdsSentence = (bodyJson) => JSON.stringify(bodyJson ?? null).includes(SENTENCE)

// ── the server ───────────────────────────────────────────────────────────────

function makeServer() {
  let rev = 0
  const nextRev = () => {
    rev += 1
    return `2026-09-17T10:0${rev}:00.000Z`
  }
  const state = {
    note: { id: NOTE, title: 'T', subtitle: null, bodyJson: doc(SERVER_TEXT), updatedAt: T0 },
    wire: [],
    created: [],
  }
  const json = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })

  state.fetch = vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    const line = { method, url, baseUpdatedAt: body?.baseUpdatedAt ?? null }

    if (method === 'POST' && url.endsWith('/opened')) {
      // ⛔ 200, and the revision does NOT move. Verified in notes.py.
      state.wire.push({ ...line, status: 200, note: 'recents only, no revision move' })
      return json(200, { ok: true })
    }

    if (method === 'POST' && url.endsWith('/embeds')) {
      // The door's server-side append. It moves the revision and the returned
      // copy does NOT contain the member's offline sentence — that is the whole
      // shape of the append cell.
      state.note = {
        ...state.note,
        bodyJson: { ...state.note.bodyJson, content: [...state.note.bodyJson.content, embedNode('e1')] },
        updatedAt: nextRev(),
      }
      state.wire.push({ ...line, status: 200, movedTo: state.note.updatedAt })
      return json(200, { note: state.note })
    }

    if (method === 'PUT' && url.includes(`/notes/${NOTE}`)) {
      if (body?.baseUpdatedAt && body.baseUpdatedAt !== state.note.updatedAt) {
        state.wire.push({ ...line, status: 409, serverAt: state.note.updatedAt })
        return json(409, { detail: 'baseUpdatedAt is stale' })
      }
      state.note = {
        ...state.note,
        title: body?.title ?? state.note.title,
        subtitle: body?.subtitle ?? state.note.subtitle,
        ...(body?.bodyJson ? { bodyJson: body.bodyJson } : {}),
        updatedAt: nextRev(),
      }
      state.wire.push({ ...line, status: 200, movedTo: state.note.updatedAt, sentSentence: holdsSentence(body?.bodyJson) })
      return json(200, { note: state.note })
    }

    if (method === 'POST' && url.includes('/notes') && !url.includes(NOTE)) {
      state.created.push(body)
      state.wire.push({ ...line, status: 200, note: 'fork created a conflicted copy' })
      return json(200, { note: { id: 'forked-1', ...body } })
    }

    if (method === 'GET' && url.includes(`/notes/${NOTE}`)) {
      state.wire.push({ ...line, status: 200, serverAt: state.note.updatedAt })
      return json(200, { note: state.note })
    }

    state.wire.push({ ...line, status: 404 })
    return json(404, {})
  })

  return state
}

// ── the spy ──────────────────────────────────────────────────────────────────

/**
 * ⛔ The CALLER is read from the stack, never typed. A function name or a line
 * number typed into a test is the drift this programme has paid for repeatedly;
 * the stack is evidence. Frame 0 is the Error, frame 1 is this wrapper — the
 * first frame after that which is not this file is the writer.
 *
 * ⭐ CORROBORATED, because one instrument agreeing with itself proves nothing.
 * `node tools/q1_clean_write_sweep.mjs` parses the same files with acorn and
 * reports true `loc.start.line` values; it and this spy agree on every call site
 * (`persist` :480, `settleSent` :75, `rebaseEntry` :205), and `grep -n` agrees
 * with both. Cite the writer as "<function> at <file:line>, spy call N".
 *
 * ⚰️⚰️ AND A CORRECTION WORTH MORE THAN THE FINDING, 2026-09-17. This spy
 * briefly reported `useDurableNote.js:957` for a call site in a 563-line file,
 * and the AST sweep independently reported `:952`. I diagnosed that as the spy
 * reading vitest's TRANSFORMED module and labelled its output "not a source
 * line" — a defect in the instrument that did not exist.
 *
 * ⛔ THE FILE WAS CORRUPT, AND I HAD CORRUPTED IT. A patch script read the
 * file preserving its CRLF endings, then wrote it back through a writer set
 * to translate newlines to CRLF, so every ending was translated a SECOND
 * time and 556 of them became CR-CR-LF. A bare CR is a line terminator in
 * ECMAScript, so acorn and vitest both counted ~1.7x the lines, correctly.
 * Two independent instruments agreed, and I read their agreement as
 * corroboration of a shared flaw rather than as evidence about their shared
 * INPUT.
 *
 * ⭐ THE TELL was available and I walked past it: `wc -l` said 563 while both
 * instruments said ~950. When a derived number disagrees with the file
 * itself, suspect the FILE before the readers, and when two independent
 * tools agree on something surprising, that is the strongest possible signal
 * that the thing they SHARE is what moved. `check_repo_hygiene.py` cannot
 * catch this one: it reports a path only when line endings are the ONLY
 * difference, and this file had content changes too.
 *
 * ⛔ AND THIS COMMENT CARRIED THE SAME BUG ONE LAYER UP: written through a
 * shell heredoc, its escaped CR/LF sequences collapsed into REAL control
 * characters and put a literal CR inside this file. That is why the endings
 * are now spelled out in words. Never describe a line ending with an escape
 * sequence you are piping through a shell.
 */
function callerFrom(stack) {
  const frames = String(stack || '').split('\n').slice(1)
  for (const f of frames) {
    if (f.includes('q1AppendWriterCensus')) continue
    const m = f.match(/([\w.-]+\.jsx?):(\d+):\d+/)
    if (!m) continue
    if (m[1] === 'notebookDb.js') continue     // the spy's own layer
    const fn = (f.match(/at\s+(?:async\s+)?([\w$.]+)\s*\(/) || [])[1] || '(top level)'
    return { fn, at: `${m[1]}:${m[2]}` }
  }
  return { fn: '(unresolved)', at: '(unresolved)' }
}

describe('⛔⛔ Q1 STEP 2 — which writer reconciles the record clean on the append route', () => {
  let server
  let spyLog
  let mods

  beforeEach(async () => {
    vi.resetModules()
    installKeyRange()
    spyLog = []
    server = makeServer()

    localStorage.clear()
    localStorage.setItem('uct.notebook.offline', '1')
    localStorage.setItem('uct.j2.offline.enabled', '1')
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: NOTE, title: 'T', ts: Date.now() }))

    vi.stubGlobal('indexedDB', createFakeIndexedDbFactory())
    vi.stubGlobal('fetch', server.fetch)

    // ⛔ A PASS-THROUGH SPY, NEVER A STAND-IN. The real transaction still runs,
    // so whatever the product does to the store is what the store ends up
    // holding; this only reads the world either side of it.
    vi.doMock('./notebookDb', async (importOriginal) => {
      const orig = await importOriginal()
      return {
        ...orig,
        putNoteWithIntent: async (db, record, intent) => {
          const before = db.dump('notes').find((r) => r.noteId === record.noteId) || null
          const queuedBefore = db.dump('outbox').filter((e) => e.noteId === record.noteId)
          const where = callerFrom(new Error().stack)
          const out = await orig.putNoteWithIntent(db, record, intent)
          const after = db.dump('notes').find((r) => r.noteId === record.noteId) || null
          const queuedAfter = db.dump('outbox').filter((e) => e.noteId === record.noteId)
          spyLog.push({
            n: spyLog.length + 1,
            writer: `${where.fn} at ${where.at}`,
            intent: intent ? `entry ${intent.mutationId}` : 'NULL',
            dirtyBefore: before ? before.dirty : '(no record)',
            dirtyAfter: after ? after.dirty : '(no record)',
            sentenceInRecordBefore: before ? holdsSentence(before.bodyJson) : '(no record)',
            sentenceInRecordAfter: after ? holdsSentence(after.bodyJson) : '(no record)',
            sentenceInIntent: intent ? holdsSentence(intent.patch?.bodyJson) : 'NULL',
            queuedBefore: queuedBefore.length,
            queuedAfter: queuedAfter.length,
            baselineAfter: after ? after.baseUpdatedAt : '(no record)',
          })
          return out
        },
      }
    })

    const notebookDb = await import('./notebookDb')
    const useDurableNote = await import('./useDurableNote')
    const useOutboxDrain = await import('./useOutboxDrain')
    const outboxDrain = await import('./outboxDrain')
    const captureTargets = await import('../captureTargets')
    const currentAccount = await import('./currentAccount')
    currentAccount.setCurrentAccountId(ACCT)
    useDurableNote.__resetNotebookConnections()
    mods = { notebookDb, useDurableNote, useOutboxDrain, outboxDrain, captureTargets }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('./notebookDb')
    localStorage.clear()
  })

  /**
   * ⛔ The state the door leaves BEHIND the guard: a note whose durable record
   * holds the member's sentence and is DIRTY, with one queued entry carrying
   * the same words at the same stale baseline. This is seeded, not typed — the
   * editor is not mounted here and mounting it would test React, not the store.
   */
  async function seedPostGuardOfflineState(db) {
    await mods.notebookDb.putNoteWithIntent(
      db,
      {
        noteId: NOTE,
        title: 'T',
        subtitle: '',
        bodyJson: doc(SERVER_TEXT, SENTENCE),
        baseUpdatedAt: T0,
        generation: 3,
        sessionId: 'session-offline',
        localSavedAt: Date.now(),
        dirty: 1,
        serverBase: null,
      },
      {
        mutationId: `note:${NOTE}`,
        noteId: NOTE,
        kind: 'patch',
        baseUpdatedAt: T0,
        queuedAt: Date.now(),
        attempts: 0,
        patch: { title: 'T', subtitle: '', bodyJson: doc(SERVER_TEXT, SENTENCE) },
      },
    )
    spyLog.length = 0        // the seed is not a measurement
  }

  it('⛔ the append sequence, instrumented: the spy log names the writer', async () => {
    const db = await mods.useDurableNote.connectNotebookDb(ACCT)
    await seedPostGuardOfflineState(db)

    // 1. the member opens the note (the wire's POST /<id>/opened)
    await fetch(`/api/j2/notes/${NOTE}/opened`, { method: 'POST', credentials: 'include' })

    // 2. THE DOOR. Post-guard, through the real capture target: POST /embeds,
    //    then the real `settleNoteWrite` records the landed revision.
    const toast = await mods.captureTargets.CAPTURE_TARGETS.note.run(
      { params: { sym: 'NVDA' }, capturedAt: Date.now() },
      { widgetId: 'chart', label: 'Chart' },
    )
    await settleIdb()

    // 3. THE DRAIN, wired exactly as production wires it.
    const results = await mods.outboxDrain.drainOutbox(db, {
      send: mods.useOutboxDrain.sendNoteUpdate,
      fork: mods.useOutboxDrain.forkConflictedCopy,
      excludeNoteId: null,
      holders: [],
      serverCopyIsOurs: mods.useOutboxDrain.serverCopyIsOursDefault,
    })
    await settleIdb()

    const record = db.dump('notes').find((r) => r.noteId === NOTE) || null
    const queued = db.dump('outbox').filter((e) => e.noteId === NOTE)

    // ── the artifact ─────────────────────────────────────────────────────────
    /* eslint-disable no-console */
    console.log('\n===== Q1 STEP 2 SPY LOG (putNoteWithIntent) =====')
    console.log(JSON.stringify(spyLog, null, 1))
    console.log('===== WIRE =====')
    console.log(JSON.stringify(server.wire, null, 1))
    console.log('===== DRAIN RESULTS =====')
    console.log(JSON.stringify(results, null, 1))
    console.log('===== FINAL STATE =====')
    console.log(JSON.stringify({
      toast,
      recordDirty: record ? record.dirty : '(no record)',
      sentenceInRecord: record ? holdsSentence(record.bodyJson) : '(no record)',
      queuedEntries: queued.length,
      sentenceInQueuedEntry: queued.some((e) => holdsSentence(e.patch?.bodyJson)),
      sentenceInServerBody: holdsSentence(server.note.bodyJson),
      forkedCopies: server.created.length,
    }, null, 1))
    /* eslint-enable no-console */

    // ⛔ THE LOSS, stated as the member experiences it: the words are gone from
    // the durable record AND from the queue AND the server never got them.
    const lost = !holdsSentence(record?.bodyJson)
      && !queued.some((e) => holdsSentence(e.patch?.bodyJson))
      && !holdsSentence(server.note.bodyJson)
      && server.created.length === 0
    expect(lost, 'the member\'s sentence must survive somewhere reachable').toBe(false)
  })

  /**
   * ⭐⭐ ITERATION 2 — THE DIFFERENCE THE WIRE NAMES.
   *
   * Iteration 1 drove the SWEEP. The real append cell has the note OPEN: the
   * member is in the editor and clicks Send to Journal. Two things follow, and
   * both are structural:
   *   · the drain SKIPS the note (`excludeNoteId` — the open editor owns it),
   *     so nothing in `outboxDrain.js` can be the writer; and
   *   · the EDITOR settles its own save through `markSynced`.
   *
   * ⛔ `markSynced` does NOT go through `settleLandedSave`. It calls
   * `writer.schedule({...current, synced: caughtUp})` — so Q1 fix 4's
   * dirty-record guard, which lives in `settleLandedSave`, is not on this path
   * at all. That is the gap this case exists to measure, and it is measured,
   * not asserted: the spy names whoever actually writes.
   */
  it('⛔⛔ with the EDITOR owning the note, the spy names the writer', async () => {
    const db = await mods.useDurableNote.connectNotebookDb(ACCT)
    await seedPostGuardOfflineState(db)

    const hook = renderHook(() => mods.useDurableNote.useDurableNote({
      accountId: ACCT, noteId: NOTE, debounceMs: 0, connect: async () => db,
    }))
    await settleIdb()
    expect(hook.result.current.supported, 'the durable layer must be live or this measures nothing').toBe(true)

    // 1. the member opens the note
    await fetch(`/api/j2/notes/${NOTE}/opened`, { method: 'POST', credentials: 'include' })

    // 2. THE DOOR, post-guard — the embed lands and moves the revision.
    await mods.captureTargets.CAPTURE_TARGETS.note.run(
      { params: { sym: 'NVDA' }, capturedAt: Date.now() },
      { widgetId: 'chart', label: 'Chart' },
    )
    await settleIdb()

    // 3. THE DRAIN SKIPS IT — the open editor owns this note.
    const drainResults = await mods.outboxDrain.drainOutbox(db, {
      send: mods.useOutboxDrain.sendNoteUpdate,
      fork: mods.useOutboxDrain.forkConflictedCopy,
      excludeNoteId: NOTE,
      holders: [],
      serverCopyIsOurs: mods.useOutboxDrain.serverCopyIsOursDefault,
    })
    await settleIdb()

    // 4. THE EDITOR SETTLES ITS OWN SAVE. `acked` and `current` are the
    //    server's post-embed copy: the document the editor is holding after the
    //    append, which does NOT carry the sentence the member typed offline.
    const editorState = {
      title: server.note.title,
      subtitle: '',
      bodyJson: server.note.bodyJson,
      baseUpdatedAt: server.note.updatedAt,
    }
    await act(async () => {
      hook.result.current.markSynced({
        acked: editorState, current: editorState, updatedAt: server.note.updatedAt,
      })
    })
    await settleIdb()

    const record = db.dump('notes').find((r) => r.noteId === NOTE) || null
    const queued = db.dump('outbox').filter((e) => e.noteId === NOTE)

    /* eslint-disable no-console */
    console.log('\n===== ITERATION 2 SPY LOG (putNoteWithIntent) =====')
    console.log(JSON.stringify(spyLog, null, 1))
    console.log('===== DRAIN (expected: skipped) =====')
    console.log(JSON.stringify(drainResults, null, 1))
    console.log('===== FINAL STATE =====')
    console.log(JSON.stringify({
      recordDirty: record ? record.dirty : '(no record)',
      recordBase: record ? String(record.baseUpdatedAt) : '(no record)',
      sentenceInRecord: record ? holdsSentence(record.bodyJson) : '(no record)',
      queuedEntries: queued.length,
      sentenceInQueuedEntry: queued.some((e) => holdsSentence(e.patch?.bodyJson)),
      sentenceInServerBody: holdsSentence(server.note.bodyJson),
      forkedCopies: server.created.length,
      trailShape: `(queued, dirty, base, sentence-in-record) = (${queued.length}, ${Boolean(record?.dirty)}, ${String(record?.baseUpdatedAt)}, ${holdsSentence(record?.bodyJson)})`,
    }, null, 1))
    /* eslint-enable no-console */

    hook.unmount()

    // ⛔ THE PRECONDITIONS, so the invariant below cannot pass for the wrong
    // reason: the words are not on the server and were not forked to a sibling,
    // so the QUEUE is the only place they can still be.
    expect(holdsSentence(server.note.bodyJson), 'the server never received the sentence').toBe(false)
    expect(server.created.length, 'nothing forked it to a conflicted copy').toBe(0)

    // ⛔⛔ THE INVARIANT, and it is RED: words the server has never seen must
    // still be somewhere a retry can reach. They are not — the record was
    // reconciled clean and the queue emptied in one transaction.
    expect(
      queued.some((e) => holdsSentence(e.patch?.bodyJson)),
      'a queued entry must still carry words the server has never seen',
    ).toBe(true)
  })
})
