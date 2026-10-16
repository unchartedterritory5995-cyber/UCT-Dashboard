/**
 * ⭐⭐ I-A FIX ROUND 1 — the queued `(conflicted copy)`: the durable home for
 * unsent words a member's own swap pushed out of the record.
 *
 * The behavioural rails are `restoreUndoKeepsWords.test.jsx` (the real editor).
 * These pin the pieces underneath, each with the real adapter over the fake
 * IndexedDB and the REAL `drainOutbox`:
 *   · the spill predicate's truth table (every clause can fail on its own);
 *   · a copy entry is not the note's entry — a clean settle of the note cannot
 *     delete it, and per-note readers do not see it;
 *   · the sweep forks it with the same `fork`, clears it only after the fork
 *     landed, and keeps it when the fork fails.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { clearOutboxEntry, listOutbox, putNoteWithIntent } from './notebookDb'
// ⭐ Fix round 3: names added this round are reached through the namespace, so on
// an older tree each new cell fails ON ITS OWN instead of the file failing to load.
import * as drain from './outboxDrain'
import { forkConflictedCopy } from './useOutboxDrain'
import { listBlockedNoteIds } from './blockedNotes'
import { swapCaptureSpills, editorLineageStamp } from './recoverLocalState'
import * as nc from './noteCopy'
import * as refusedCopyNs from './refusedCopy'

const { drainOutbox, FORKED, KEPT } = drain
const { copyEntryFor, isNoteCopy, NOTE_COPY } = nc

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const words = (t, title = 'Thesis') => ({ title, subtitle: '', bodyJson: doc(t) })

let db
beforeEach(() => {
  installKeyRange()
  db = createFakeDb()
})

describe('swapCaptureSpills — every clause can refuse on its own', () => {
  const prevOf = (t, lineageId = 'L0', dirty = 1) => {
    const rec = { noteId: 'n1', ...words(t), dirty }
    rec.editorLineage = editorLineageStamp(rec, { id: lineageId, seq: 1 })
    return rec
  }
  const incomingOf = (t, lineageId = 'L1', seq = 5, title) => ({ ...words(t, title), editLineage: { id: lineageId, seq } })

  it('spills: a swap capture over a dirty record of ANOTHER lineage whose words the page does not carry', () => {
    expect(swapCaptureSpills(prevOf('server copy S. K'), incomingOf('W restored'), true)).toBe(true)
  })
  it('refuses: an ordinary capture (no swap) — today\'s answer keeps the record', () => {
    expect(swapCaptureSpills(prevOf('server copy S. K'), incomingOf('W restored'), false)).toBe(false)
  })
  it('refuses: no record, or a clean one — nothing is owed', () => {
    expect(swapCaptureSpills(null, incomingOf('W restored'), true)).toBe(false)
    expect(swapCaptureSpills(prevOf('server copy S. K', 'L0', 0), incomingOf('W restored'), true)).toBe(false)
  })
  it('refuses: the page carries the record\'s words (they move with it)', () => {
    expect(swapCaptureSpills(prevOf('server copy S. K'), incomingOf('server copy S. K and more'), true)).toBe(false)
  })
  it('refuses: the same live view, later (the record is superseded, not pushed out)', () => {
    expect(swapCaptureSpills(prevOf('W restored!', 'L1'), incomingOf('W restored', 'L1', 9), true)).toBe(false)
  })
  it('spills on a TITLE the page does not carry (review C1b)', () => {
    expect(swapCaptureSpills(prevOf('same body'), incomingOf('same body', 'L1', 5, 'Renamed'), true)).toBe(true)
  })
})

describe('a copy entry is not the note\'s entry', () => {
  it('is keyed off the note, names its source, and is keyed by its words (one copy per body while queued)', () => {
    const a = copyEntryFor({ noteId: 'n1', words: words('K'), writtenSchema: 2, sessionId: 's1' })
    const b = copyEntryFor({ noteId: 'n1', words: words('K'), writtenSchema: 2, sessionId: 's2' })
    const c = copyEntryFor({ noteId: 'n1', words: words('W'), writtenSchema: 2, sessionId: 's1' })
    expect(a.noteId).not.toBe('n1')
    expect(a.copyOf).toBe('n1')
    expect(a.kind).toBe(NOTE_COPY)
    expect(isNoteCopy(a)).toBe(true)
    expect(a.mutationId).toBe(b.mutationId)
    expect(a.mutationId).not.toBe(c.mutationId)
    expect(a.writtenSchema).toBe(2)
  })

  it('⛔ a CLEAN settle of the note (null intent) cannot delete it', async () => {
    const copy = copyEntryFor({ noteId: 'n1', words: words('pushed-out K'), sessionId: 's1' })
    await putNoteWithIntent(db, { noteId: 'n1', ...words('W'), dirty: 1, baseUpdatedAt: 'T1' },
      { mutationId: 'note:n1', noteId: 'n1', kind: 'note-update', patch: words('W'), baseUpdatedAt: 'T1' },
      { copies: [copy] })
    await settleIdb()
    expect((await listOutbox(db)).map((e) => e.mutationId).sort()).toEqual([copy.mutationId, 'note:n1'].sort())
    // The note's save landed: the record settles clean and the note's entry goes.
    await putNoteWithIntent(db, { noteId: 'n1', ...words('W'), dirty: 0, baseUpdatedAt: 'T2' }, null)
    await settleIdb()
    const left = await listOutbox(db)
    expect(left.map((e) => e.mutationId)).toEqual([copy.mutationId])
  })
})

describe('the sweep turns a queued copy into a sibling', () => {
  async function queueCopy(text = 'pushed-out K') {
    const copy = copyEntryFor({ noteId: 'n1', words: words(text), sessionId: 's1' })
    await putNoteWithIntent(db, { noteId: 'n1', ...words('W'), dirty: 0, baseUpdatedAt: 'T1' }, null, { copies: [copy] })
    await settleIdb()
    return copy
  }

  it('forks it with the SAME fork, against its source note, then clears it — even while the editor owns the source', async () => {
    const copy = await queueCopy()
    const send = vi.fn(async () => { throw new Error('a copy is never sent as an update') })
    const fork = vi.fn(async () => ({ id: 'n1', title: 'Thesis', bodyJson: doc('W'), updatedAt: 'T1' }))
    const results = await drainOutbox(db, { send, fork, excludeNoteId: 'n1' })
    await settleIdb()
    expect(send).not.toHaveBeenCalled()
    expect(fork).toHaveBeenCalledTimes(1)
    expect(fork.mock.calls[0][0].noteId, 'the fork reads the SOURCE note (its folder)').toBe('n1')
    expect(JSON.stringify(fork.mock.calls[0][0].patch)).toContain('pushed-out K')
    expect(results).toEqual([expect.objectContaining({ mutationId: copy.mutationId, outcome: FORKED, copy: true })])
    expect(await listOutbox(db)).toEqual([])
  })

  it('⛔ a copy an OLDER bundle blocked (it read it as a baseline-less update) is still forked here', async () => {
    const copy = copyEntryFor({ noteId: 'n1', words: words('blocked by an old tab'), sessionId: 's1' })
    await putNoteWithIntent(db, { noteId: 'n1', ...words('W'), dirty: 0, baseUpdatedAt: 'T1' }, null,
      { copies: [{ ...copy, permanent: true, lastError: 'queued without a baseline' }] })
    await settleIdb()
    const fork = vi.fn(async () => ({ id: 'n1', title: 'Thesis', bodyJson: doc('W'), updatedAt: 'T1' }))
    const results = await drainOutbox(db, { send: vi.fn(), fork })
    await settleIdb()
    expect(fork).toHaveBeenCalledTimes(1)
    expect(results).toEqual([expect.objectContaining({ mutationId: copy.mutationId, outcome: FORKED })])
    expect(await listOutbox(db)).toEqual([])
  })

  it('⛔ a failed fork (offline) leaves the copy exactly where it was', async () => {
    const copy = await queueCopy()
    const fork = vi.fn(async () => { throw new Error('network down') })
    const results = await drainOutbox(db, { send: vi.fn(), fork })
    await settleIdb()
    expect(results).toEqual([expect.objectContaining({ mutationId: copy.mutationId, outcome: KEPT })])
    expect((await listOutbox(db)).map((e) => e.mutationId)).toEqual([copy.mutationId])
  })
})

describe('fix round 2 — the REAL fork path (`forkConflictedCopy` → `createNoteViaApi` → fetch)', () => {
  const realFetch = globalThis.fetch
  let posts
  function fakeServer({ source = 200, create = 200 } = {}) {
    posts = []
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url)
      if (u === '/api/j2/notes/n1' && (!opts.method || opts.method === 'GET')) {
        if (source === 'down') throw new TypeError('Failed to fetch')
        return { ok: source === 200, status: source, json: async () => ({ note: { id: 'n1', title: 'Thesis', folderId: 'f9', bodyJson: doc('S'), updatedAt: 'T1' } }) }
      }
      if (u === '/api/j2/notes' && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body))
        if (create !== 200) return { ok: false, status: create, json: async () => ({ detail: `refused ${create}` }) }
        return { ok: true, status: 200, json: async () => ({ note: { id: `c${posts.length}` } }) }
      }
      throw new Error(`unexpected fetch ${u}`)
    })
  }
  const restoreFetch = () => { globalThis.fetch = realFetch }
  async function queueCopy(w = { title: 'Thesis', subtitle: 'NVDA: wait for 140 reclaim', bodyJson: doc('pushed-out K') }) {
    const copy = copyEntryFor({ noteId: 'n1', words: w, writtenSchema: 2, sessionId: 's1' })
    await putNoteWithIntent(db, { noteId: 'n1', ...words('W'), dirty: 0, baseUpdatedAt: 'T1' }, null, { copies: [copy] })
    await settleIdb()
    return copy
  }

  it('⛔⛔ C-1: every authored field the copy holds lands in the created note — title, a NON-EMPTY subtitle, body — then the entry clears', async () => {
    fakeServer()
    try {
      await queueCopy()
      const results = await drainOutbox(db, { send: vi.fn(), fork: forkConflictedCopy })
      await settleIdb()
      expect(results.map((r) => r.outcome)).toEqual([FORKED])
      expect(posts).toHaveLength(1)
      expect(posts[0].title).toBe('Thesis (conflicted copy)')
      expect(posts[0].subtitle, 'the subtitle was dropped by the fork').toBe('NVDA: wait for 140 reclaim')
      expect(JSON.stringify(posts[0].bodyJson)).toContain('pushed-out K')
      expect(posts[0].tags).toEqual(['sync-conflict'])
      expect(posts[0].folderId).toBe('f9')
      expect(await listOutbox(db)).toEqual([])
    } finally { restoreFetch() }
  })

  it('I-1: the SOURCE is gone (trashed or deleted: 404) ⇒ the copy is still created, in no folder — it never needed the source', async () => {
    fakeServer({ source: 404 })
    try {
      await queueCopy()
      const results = await drainOutbox(db, { send: vi.fn(), fork: forkConflictedCopy })
      await settleIdb()
      expect(results.map((r) => r.outcome)).toEqual([FORKED])
      expect(posts).toHaveLength(1)
      expect(posts[0].folderId).toBeUndefined()
      expect(posts[0].subtitle).toBe('NVDA: wait for 140 reclaim')
      expect(await listOutbox(db)).toEqual([])
    } finally { restoreFetch() }
  })

  it('offline (the source GET cannot be made) ⇒ KEPT, nothing posted, retried later', async () => {
    fakeServer({ source: 'down' })
    try {
      const copy = await queueCopy()
      const results = await drainOutbox(db, { send: vi.fn(), fork: forkConflictedCopy })
      await settleIdb()
      expect(results).toEqual([expect.objectContaining({ mutationId: copy.mutationId, outcome: KEPT })])
      expect(posts).toHaveLength(0)
      expect((await listOutbox(db)).map((e) => e.mutationId)).toEqual([copy.mutationId])
    } finally { restoreFetch() }
  })

  // ⭐ Fix round 3 (review I-3, I-4): refused for good ONLY on 400 / 413 / 422 from
  // the CREATE itself. Held, never re-posted, and NOT a blocked note.
  for (const status of [400, 413, 422]) {
    it(`⛔ I-3: a create the server REFUSES (${status}) ⇒ HELD with its reason, kept, never re-posted, and the source note is NOT blocked (I-4)`, async () => {
      fakeServer({ create: status })
      try {
        const copy = await queueCopy()
        const first = await drainOutbox(db, { send: vi.fn(), fork: forkConflictedCopy })
        await settleIdb()
        expect(drain.HELD, 'the held outcome exists').toBeTruthy()
        expect(first).toEqual([expect.objectContaining({ mutationId: copy.mutationId, outcome: drain.HELD })])
        const kept = await listOutbox(db)
        expect(kept).toHaveLength(1)
        expect(kept[0].copyRefused?.status).toBe(status)
        expect(JSON.stringify(kept[0].patch), 'the words are kept').toContain('pushed-out K')
        expect(await listBlockedNoteIds(db), 'a refused COPY marked its healthy source note blocked').toEqual([])
        const second = await drainOutbox(db, { send: vi.fn(), fork: forkConflictedCopy })
        await settleIdb()
        expect(second.map((r) => r.outcome)).toEqual([drain.HELD])
        expect(posts, 'a refused copy was posted again').toHaveLength(1)
      } finally { restoreFetch() }
    })
  }

  // ⭐ Fix round 3 (review I-3): 403 / 404 / 405 / 409 describe the REQUEST, not the
  // copy — transient wherever they come from, retried on the next sweep.
  for (const status of [403, 404, 405, 409]) {
    it(`I-3: a create that fails ${status} is transient ⇒ KEPT, not refused, and posted again next sweep`, async () => {
      fakeServer({ create: status })
      try {
        const copy = await queueCopy()
        const first = await drainOutbox(db, { send: vi.fn(), fork: forkConflictedCopy })
        await settleIdb()
        expect(first).toEqual([expect.objectContaining({ mutationId: copy.mutationId, outcome: KEPT })])
        const kept = await listOutbox(db)
        expect(kept[0].copyRefused, `a ${status} marked the copy refused for good`).toBeFalsy()
        expect(kept[0].permanent).toBeFalsy()
        await drainOutbox(db, { send: vi.fn(), fork: forkConflictedCopy })
        await settleIdb()
        expect(posts, 'a transient failure is retried').toHaveLength(2)
      } finally { restoreFetch() }
    })
  }
  for (const status of [400, 403, 405, 409, 413, 422, 500]) {
    it(`I-3: the SOURCE read fails ${status} ⇒ transient: KEPT, nothing posted, never refused (no create was attempted)`, async () => {
      fakeServer({ source: status })
      try {
        const copy = await queueCopy()
        const results = await drainOutbox(db, { send: vi.fn(), fork: forkConflictedCopy })
        await settleIdb()
        expect(results).toEqual([expect.objectContaining({ mutationId: copy.mutationId, outcome: KEPT })])
        expect(posts).toHaveLength(0)
        const kept = await listOutbox(db)
        expect(kept[0].copyRefused, `a ${status} on the source GET marked the copy refused`).toBeFalsy()
        expect(kept[0].permanent).toBeFalsy()
      } finally { restoreFetch() }
    })
  }

  it('⛔ C-3 cause: a LONG title gets the whole " (conflicted copy)" suffix and still fits the 300-character limit', async () => {
    fakeServer()
    try {
      const long = `${'A'.repeat(290)}TAIL`
      await queueCopy({ title: long, subtitle: '', bodyJson: doc('pushed-out K') })
      await drainOutbox(db, { send: vi.fn(), fork: forkConflictedCopy })
      await settleIdb()
      expect(posts).toHaveLength(1)
      const t = posts[0].title
      expect([...t].length, `the copy's title is ${[...t].length} characters, over the server's 300`).toBeLessThanOrEqual(300)
      expect(t.endsWith(' (conflicted copy)'), 'the suffix was truncated').toBe(true)
      expect(t.startsWith('A'.repeat(200)), 'the base title was not kept').toBe(true)
    } finally { restoreFetch() }
  })

  it('the suffix fit counts CHARACTERS the way the server does, and never splits one', () => {
    expect(typeof nc.conflictedCopyTitle).toBe('function')
    // An odd prefix puts the cut inside a surrogate pair for a UTF-16 slice.
    const t = nc.conflictedCopyTitle(`a${'\u{1F600}'.repeat(299)}`)
    expect([...t].length, 'a long title keeps as much of itself as fits — exactly 300 characters').toBe(300)
    expect(t.endsWith(' (conflicted copy)')).toBe(true)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(t), 'a character was split in half').toBe(false)
    expect(nc.conflictedCopyTitle('  Thesis  ')).toBe('Thesis (conflicted copy)')
    expect(nc.conflictedCopyTitle('')).toBe('Untitled note (conflicted copy)')
  })

  it('the client limit IS the server\'s MAX_TITLE_CHARS (parsed from notes.py, never restated)', () => {
    // vitest runs from `app/`; under jsdom `import.meta.url` is not a file URL.
    const src = readFileSync(resolve(globalThis.process.cwd(), '..', 'api', 'services', 'journal_two', 'notes.py'), 'utf8')
    const m = src.match(/^MAX_TITLE_CHARS\s*=\s*(\d+)\s*$/m)
    expect(m, 'MAX_TITLE_CHARS not found in notes.py').toBeTruthy()
    expect(nc.MAX_NOTE_TITLE_CHARS).toBe(Number(m[1]))
  })

  it('⛔ I-4: a copy deleted while its create was in flight is NOT brought back by the refusal', async () => {
    const copy = await queueCopy()
    const fork = vi.fn(async (e) => {
      await clearOutboxEntry(db, e.mutationId)          // the member discarded it meanwhile
      const err = new Error('refused'); err.status = 400; err.phase = 'create'; throw err
    })
    await drainOutbox(db, { send: vi.fn(), fork })
    await settleIdb()
    expect(fork).toHaveBeenCalledTimes(1)
    expect((await listOutbox(db)).map((e) => e.mutationId), 'the refusal resurrected a deleted copy').not.toContain(copy.mutationId)
  })

  for (const status of [401, 429, 503]) {
    it(`a create that fails ${status} is transient ⇒ KEPT, not blocked`, async () => {
      fakeServer({ create: status })
      try {
        const copy = await queueCopy()
        const results = await drainOutbox(db, { send: vi.fn(), fork: forkConflictedCopy })
        await settleIdb()
        expect(results).toEqual([expect.objectContaining({ mutationId: copy.mutationId, outcome: KEPT })])
        expect((await listOutbox(db))[0].permanent).toBeFalsy()
      } finally { restoreFetch() }
    })
  }
})

// ⭐⭐ I-A fix round 4 (review I-6, I-7): the refused copy's words as plain text, the
// plain-text save, and the offer's own sentence by refusal class. Reached through the
// namespace, so on an older tree each cell fails on its own.
describe('fix round 4 — a refused copy shows its words and speaks for itself', () => {
  const rc = refusedCopyNs
  const RICH = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan H2' }] },
      { type: 'paragraph' },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first ' }, { type: 'text', text: 'point', marks: [{ type: 'bold' }] }] }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'line one' }, { type: 'hardBreak' }, { type: 'text', text: 'line two' }] },
      { type: 'image', attrs: { src: 'data:image/png;base64,AAAA' } },
    ],
  }
  const jsonDepth = (x) => (x && typeof x === 'object' ? 1 + Math.max(0, ...Object.values(x).map(jsonDepth)) : 0)
  const isFlat = (d) => d?.type === 'doc' && d.content.every((p) => (
    p.type === 'paragraph' && Object.keys(p).every((k) => k === 'type' || k === 'content')
    && (p.content || []).every((t) => t.type === 'text' && typeof t.text === 'string' && t.text.length > 0 && !t.marks)))

  /** The server's own sentences, READ from notes.py (never restated here). */
  function serverSentences() {
    const src = readFileSync(resolve(globalThis.process.cwd(), '..', 'api', 'services', 'journal_two', 'notes.py'), 'utf8')
    const joined = (block) => [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('')
    const constant = (name) => {
      const m = src.match(new RegExp(`^${name}\\s*=\\s*\\(([\\s\\S]*?)\\)\\s*$`, 'm'))
      expect(m, `${name} not found in notes.py`).toBeTruthy()
      return joined(m[1])
    }
    const size = src.match(/raise NoteValidationError\(\s*("This note is too long[\s\S]*?)\)/)
    expect(size, 'the body size sentence was not found in notes.py').toBeTruthy()
    for (const literal of ['"title too long"', '"subtitle too long"', '"folder not found"', '"body_json must be a TipTap doc"']) {
      expect(src.includes(literal), `${literal} is no longer in notes.py`).toBe(true)
    }
    return {
      tooDeep: constant('TOO_DEEP_BODY_DETAIL'),
      unbuildable: constant('UNBUILDABLE_BODY_DETAIL'),
      tooLarge: joined(size[1]),
    }
  }

  it('each of the server’s create refusals lands in its class (sentences parsed from notes.py)', () => {
    const s = serverSentences()
    expect(s.tooDeep).toMatch(/nested/)
    expect(s.unbuildable).toMatch(/editor can't open/)
    expect(s.tooLarge).toMatch(/too long to save/)
    const cls = (status, detail) => rc.copyRefusalClass({ status, detail })
    expect(cls(400, s.tooLarge)).toBe(rc.COPY_TOO_LARGE)
    expect(cls(400, s.tooDeep)).toBe(rc.COPY_CONTENT)
    expect(cls(400, s.unbuildable)).toBe(rc.COPY_CONTENT)
    expect(cls(400, 'body_json must be a TipTap doc')).toBe(rc.COPY_CONTENT)
    // ⛔ Fix round 5 (review M-18) REVERSES round 4 here: a 400/422 that names no reason
    // (an edge's 400, FastAPI's list-shaped 422) is NOT known to be about the body, so it
    // is never sent down the plain-text path.
    for (const detail of [undefined, null, '', '   ', [{ loc: ['body'], msg: 'x' }]]) {
      expect(cls(422, detail), `a 422 with detail ${JSON.stringify(detail)} names no reason`).toBe(rc.COPY_OTHER)
      expect(cls(400, detail), `a 400 with detail ${JSON.stringify(detail)} names no reason`).toBe(rc.COPY_OTHER)
    }
    expect(cls(413, 'That is too large to send. Shorten it and try again.')).toBe(rc.COPY_TOO_LARGE)
    expect(cls(413, undefined)).toBe(rc.COPY_TOO_LARGE)
    for (const other of ['title too long', 'subtitle too long', 'folder not found']) {
      expect(cls(400, other), `"${other}" is not about the body`).toBe(rc.COPY_OTHER)
    }
    expect(cls(409, s.tooDeep), 'only 400/413/422 can be a content refusal').toBe(rc.COPY_OTHER)
  })

  it('the offer’s sentence never carries the server’s detail, and names what each button does', () => {
    const PHRASE = 'ZQ-SERVER-SENTENCE'
    for (const [status, detail, want, content] of [
      [413, PHRASE, /too large to be saved as its own note/, true],
      [400, `${PHRASE} nested`, /content the server can’t store/, true],
      // ⛔ Fix round 5 (wording ruling): the `other` class never says the save "tries
      // again" for a refusal a retry cannot fix; it says what the member can do instead.
      [400, `${PHRASE} title too long`, /couldn’t be saved as a separate note.*paste them into a new note/, false],
    ]) {
      const entry = { ...copyEntryFor({ noteId: 'n1', words: words('K') }), copyRefused: { status, detail } }
      const reason = rc.refusedCopyReason(entry)
      expect(reason).toMatch(want)
      expect(reason).not.toContain(PHRASE)
      expect(reason).toMatch(/kept on this device/)
      expect(reason).toMatch(/Copy text puts its words on your clipboard/)
      expect(reason).toMatch(/Discard deletes the copy from this device/)
      expect(reason, 'the offer says a create the server refused "tries again"').not.toMatch(/tries again/)
      if (content) expect(reason).toMatch(/Save as plain text/)
    }
  })

  it('the view carries the copy’s words as plain text, and offers plain text only after a content refusal', () => {
    const base = { ...copyEntryFor({ noteId: 'n1', words: { title: 'Thesis', subtitle: 'sub', bodyJson: RICH } }) }
    const content = rc.refusedCopyView({ ...base, copyRefused: { status: 413 } })
    expect(content.bodyText).toBe('Plan H2\n\nfirst point\nline one\nline two')
    expect([content.offerPlain, content.offerSeparate]).toEqual([true, false])
    const other = rc.refusedCopyView({ ...base, copyRefused: { status: 400, detail: 'subtitle too long' } })
    expect([other.offerPlain, other.offerSeparate]).toEqual([false, true])
    const plainRefused = rc.refusedCopyView({ ...base, copyRefused: { status: 413, plain: true } })
    expect([plainRefused.offerPlain, plainRefused.offerSeparate], 'nothing left to send after a refused plain save').toEqual([false, false])
    expect(rc.copyClipboardText(content)).toBe('Thesis\nsub\n\nPlan H2\n\nfirst point\nline one\nline two')
  })

  it('⛔ the plain body is paragraphs of one non-empty text node each (never an empty text node), shallow, every word kept', () => {
    const flat = rc.plainParagraphsDoc(RICH)
    expect(isFlat(flat), JSON.stringify(flat)).toBe(true)
    expect(flat.content.map((p) => p.content?.[0]?.text ?? '')).toEqual(['Plan H2', '', 'first point', 'line one', 'line two'])
    let deep = { type: 'paragraph', content: [{ type: 'text', text: 'deep words' }] }
    for (let i = 0; i < 150; i += 1) deep = { type: 'blockquote', content: [deep] }
    const flatDeep = rc.plainParagraphsDoc({ type: 'doc', content: [deep] })
    expect(jsonDepth(flatDeep), 'the plain body is still too deep for the server').toBeLessThan(10)
    expect(JSON.stringify(flatDeep)).toContain('deep words')
    expect(rc.plainParagraphsDoc({ type: 'doc', content: [] })).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })

  async function heldCopy(status = 413) {
    const copy = copyEntryFor({ noteId: 'n1', words: { title: 'Thesis', subtitle: 'sub', bodyJson: RICH }, sessionId: 's1' })
    await putNoteWithIntent(db, { noteId: 'n1', ...words('W'), dirty: 0, baseUpdatedAt: 'T1' }, null, { copies: [copy] })
    await settleIdb()
    const err = new Error('refused'); err.status = status; err.phase = 'create'
    await rc.holdRefusedCopy(db, copy, err)
    await settleIdb()
    return copy
  }

  // ⛔⛔ Fix round 5 (review C-4) REVERSES round 4 here: a plain save NEVER deletes the copy.
  it('"Save as plain text" sends the flattened body through the same fork, against the source note, and KEEPS the copy', async () => {
    const copy = await heldCopy()
    const fork = vi.fn(async () => ({}))
    const res = await rc.saveRefusedCopy(db, copy.mutationId, { fork, plain: true })
    await settleIdb()
    expect(res.outcome).toBe('plain-saved')
    expect(fork).toHaveBeenCalledTimes(1)
    const sent = fork.mock.calls[0][0]
    expect(sent.noteId, 'the fork was not pointed at the source note').toBe('n1')
    expect(sent.patch.title).toBe('Thesis')
    expect(sent.patch.subtitle).toBe('sub')
    expect(isFlat(sent.patch.bodyJson), JSON.stringify(sent.patch.bodyJson)).toBe(true)
    const [kept] = await listOutbox(db)
    expect(kept?.mutationId, 'the plain save deleted the copy').toBe(copy.mutationId)
    expect(kept.patch.bodyJson, 'the stored copy lost its ORIGINAL body').toEqual(RICH)
    expect(kept.copyRefused.plainSaved, 'the copy is not marked plain-saved').toBeTruthy()
  })

  it('⛔ a refused plain-text save keeps the copy with its ORIGINAL words and marks it so', async () => {
    const copy = await heldCopy()
    const fork = vi.fn(async () => { const e = new Error('refused'); e.status = 413; e.phase = 'create'; e.detail = 'server words'; throw e })
    const res = await rc.saveRefusedCopy(db, copy.mutationId, { fork, plain: true })
    await settleIdb()
    expect(res.outcome).toBe('refused')
    const [kept] = await listOutbox(db)
    expect(kept.patch.bodyJson, 'the stored copy was replaced by its flattened body').toEqual(RICH)
    expect(kept.copyRefused.plain).toBe(true)
    expect(kept.copyRefused.detail, 'the server’s detail is kept for diagnosis').toBe('server words')
    expect(res.copy.offerPlain).toBe(false)
    expect(res.copy.reason).not.toContain('server words')
  })

  it('a transient failure says whether it was the NETWORK (offline) or not', async () => {
    const copy = await heldCopy(400)
    const offline = await rc.saveRefusedCopy(db, copy.mutationId, { fork: async () => { throw new TypeError('Failed to fetch') } })
    expect(offline).toEqual({ outcome: 'failed', offline: true })
    const conflict = await rc.saveRefusedCopy(db, copy.mutationId, {
      fork: async () => { const e = new Error('Could not create note (409)'); e.status = 409; e.phase = 'create'; throw e },
    })
    expect(conflict).toEqual({ outcome: 'failed', offline: false })
    expect((await listOutbox(db)).map((e) => e.mutationId)).toEqual([copy.mutationId])
  })
})

// ⭐⭐ I-A fix round 5 (review C-4, I-8, M-18): the walk carries every word, and a plain
// save never deletes the copy. Reached through the namespace, as above.
describe('fix round 5 — the plain-text walk carries every word, and a plain save keeps the copy', () => {
  const rc = refusedCopyNs
  const p = (c) => ({ type: 'paragraph', content: c })
  const t = (s, marks) => ({ type: 'text', text: s, ...(marks ? { marks } : {}) })
  // ⛔ The reviewer's probe body (`r4probe/probe.mjs`), verbatim.
  const CANVAS = { type: 'tradeCanvas', attrs: { board: { cards: [{ text: 'Stop 121.50' }] }, searchText: 'NVDA long stop 121.50 target 140' } }
  const PROBE = { type: 'doc', content: [
    p([t('Entry on '), { type: 'dateMention', attrs: { date: '2026-10-20' } }, t(' at '), { type: 'inlineMath', attrs: { latex: 'R=2.5' } }]),
    p([t('see filing', [{ type: 'link', attrs: { href: 'https://sec.gov/x' } }])]),
    { type: 'blockMath', attrs: { latex: 'E = p q' } },
    { type: 'linkPreview', attrs: { url: 'https://ex.com', title: 'NVDA earnings preview', description: 'Guide raised' } },
    p([{ type: 'attachmentChip', attrs: { name: 'plan.xlsx', href: '/a/1' } }]),
    { type: 'image', attrs: { src: '/img/1.png', alt: 'NVDA daily chart' } },
    CANVAS,
  ] }
  const PROBE_WORDS = [
    'Entry on', '2026-10-20', 'R=2.5', 'see filing', 'https://sec.gov/x', 'E = p q', 'NVDA earnings preview',
    'Guide raised', 'https://ex.com', 'plan.xlsx', 'NVDA daily chart', 'NVDA long stop 121.50 target 140',
  ]
  const viewOf = (bodyJson, copyRefused = { status: 413 }) => rc.refusedCopyView({
    ...copyEntryFor({ noteId: 'n1', words: { title: 'Thesis', subtitle: '', bodyJson } }), copyRefused,
  })
  const plainText = (d) => (d.content || []).map((q) => q.content?.[0]?.text ?? '').join('\n')

  it('⛔ C-4 / I-8: the reviewer’s probe body yields every word in the preview, Copy text and the plain body', () => {
    const view = viewOf(PROBE)
    const clip = rc.copyClipboardText(view)
    const plain = plainText(rc.plainParagraphsDoc(PROBE))
    for (const w of PROBE_WORDS) {
      expect(view.bodyText, `the preview dropped "${w}"`).toContain(w)
      expect(clip, `Copy text dropped "${w}"`).toContain(w)
      expect(plain, `the plain body dropped "${w}"`).toContain(w)
    }
    expect(view.bodyText, 'a link reads as "text (url)"').toContain('see filing (https://sec.gov/x)')
  })

  it('a link split by a mark (bold inside it) still reads as ONE "text (url)"', () => {
    const href = [{ type: 'link', attrs: { href: 'https://ex.com/a' } }]
    const body = { type: 'doc', content: [p([t('read '), t('the ', href), t('filing', [...href, { type: 'bold' }]), t(' now')])] }
    expect(viewOf(body).bodyText).toBe('read the filing (https://ex.com/a) now')
    const bare = { type: 'doc', content: [p([t('https://ex.com/a', href)])] }
    expect(viewOf(bare).bodyText, 'a bare link repeats its address').toBe('https://ex.com/a')
  })

  it('⛔ I-8: a canvas-only copy shows the plan’s words, never "no text"', () => {
    const view = viewOf({ type: 'doc', content: [CANVAS] })
    expect(view.bodyText).toContain('NVDA long stop 121.50 target 140')
    expect(rc.plainParagraphsDoc({ type: 'doc', content: [CANVAS] }).content[0].content[0].text).toContain('NVDA long stop')
  })

  it('a copy whose items carry no words says so (hiddenItems), and an empty copy does not', () => {
    expect(viewOf({ type: 'doc', content: [{ type: 'image', attrs: { src: '/x.png' } }] }).hiddenItems).toBe(true)
    expect(viewOf({ type: 'doc', content: [p([t('words')])] }).hiddenItems).toBe(false)
    expect(viewOf({ type: 'doc', content: [{ type: 'paragraph' }] }).hiddenItems).toBe(false)
  })

  it('⛔ M-18: a 400 or 422 with no string detail is `other` — "Save as a separate note", never the plain path', () => {
    for (const status of [400, 422]) {
      const view = viewOf(doc('x'), { status, detail: null })
      expect(view.kind).toBe(rc.COPY_OTHER)
      expect([view.offerPlain, view.offerSeparate]).toEqual([false, true])
      expect(view.reason).not.toMatch(/tries again/)
    }
  })

  async function heldCopy(bodyJson = PROBE) {
    const copy = copyEntryFor({ noteId: 'n1', words: { title: 'Thesis', subtitle: 'sub', bodyJson }, sessionId: 's1' })
    await putNoteWithIntent(db, { noteId: 'n1', ...words('W'), dirty: 0, baseUpdatedAt: 'T1' }, null, { copies: [copy] })
    await settleIdb()
    const err = new Error('refused'); err.status = 413; err.phase = 'create'
    await rc.holdRefusedCopy(db, copy, err)
    await settleIdb()
    return copy
  }

  it('⛔⛔ C-4: after a plain save lands the copy stays with its ORIGINAL body, the sweep holds it, and only Discard removes it', async () => {
    const copy = await heldCopy()
    const fork = vi.fn(async () => ({}))
    const res = await rc.saveRefusedCopy(db, copy.mutationId, { fork, plain: true })
    await settleIdb()
    expect(res.outcome).toBe('plain-saved')
    for (const w of PROBE_WORDS) expect(JSON.stringify(fork.mock.calls[0][0].patch.bodyJson), `the plain note dropped "${w}"`).toContain(w)
    let [kept] = await listOutbox(db)
    expect(kept?.patch.bodyJson, 'the plain save deleted or flattened the copy').toEqual(PROBE)
    expect(res.copy?.offerPlain, 'a second plain save is offered (a duplicate note)').toBe(false)
    expect(res.copy.offerSeparate).toBe(false)
    expect(res.copy.reason).toMatch(/plain-text version/i)
    expect(res.copy.reason).toMatch(/still kept on this device until you discard it/i)
    // The sweep never re-posts it.
    const sweepFork = vi.fn(async () => ({}))
    await drainOutbox(db, { send: vi.fn(), fork: sweepFork })
    await settleIdb()
    expect(sweepFork, 'the sweep posted a plain-saved copy again').not.toHaveBeenCalled()
    ;[kept] = await listOutbox(db)
    expect(kept?.mutationId, 'the sweep removed a plain-saved copy').toBe(copy.mutationId)
    // On the next open it is still offered, plain-saved.
    const [again] = rc.refusedCopiesOf(await listOutbox(db), 'n1')
    expect(again?.plainSaved).toBeTruthy()
    expect([again.offerPlain, again.offerSeparate]).toEqual([false, false])
    await rc.discardRefusedCopy(db, copy.mutationId)
    await settleIdb()
    expect(await listOutbox(db)).toEqual([])
  })

  it('a plain save that lands but whose mark cannot be WRITTEN still reports it landed (so no "try again", no duplicate)', async () => {
    const copy = await heldCopy()
    let armed = false
    const flaky = Object.create(db)
    flaky.transaction = (stores, mode) => {
      if (armed && mode === 'readwrite') { armed = false; throw new Error('QuotaExceededError') }
      return db.transaction(stores, mode)
    }
    const fork = vi.fn(async () => { armed = true; return {} })
    const res = await rc.saveRefusedCopy(flaky, copy.mutationId, { fork, plain: true })
    expect(res.outcome).toBe('plain-saved')
    expect(res.copy?.plainSaved).toBeTruthy()
    expect((await listOutbox(db)).map((e) => e.mutationId), 'the copy was lost').toEqual([copy.mutationId])
  })
})
