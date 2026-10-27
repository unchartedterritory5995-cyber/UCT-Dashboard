/**
 * ⛔⛔ W11-R79 (the 11.20 walk's D2 ruling): WHAT THE FIRST OPEN OF A TEMPLATE-MADE NOTE MAY WRITE.
 *
 * THE ONE EXEMPTION, named here so the walk's PUTPROBE is read against it: a snapshot widgetEmbed that holds no
 * archive (`fallback: null`) archives ITSELF once its live render settles (WidgetEmbedView's self-archive: rasterise,
 * upload, `updateAttributes({ fallback })`, phase 1's durability pipeline). That is one write per such embed, ONCE:
 * the note then holds its archive and every later open writes nothing. A template-made note's Market context (and
 * any other snapshot the template placed) has no archive yet, so its first open writes exactly that, ~3.5-13.5 s in.
 * NOTHING ELSE may change (W11-R79 m-2, the exemption exactly): every body the page sends must equal the stored body
 * byte for byte (RAW, no schema round trip) once `fallback` is put back to null on the embeds STORED with
 * `fallback: null` -- and on those alone; an embed that already held an archive (the chart, below) is never re-archived.
 * At most one write per such embed, each one adding an archive (never an identical re-send); then zero further
 * document changes.
 *
 * CONTROL: a note with no snapshot embed opens with zero writes and zero document changes.
 *
 * The note is the server's REAL styled create (`notes.create.kind`, a Trade plan: Market context, chart, checklist,
 * sizing, every one `mode: 'snapshot'` with `fallback: null`), so it carries the trailing paragraph the server now
 * stores (journal_styles.with_trailing_paragraph). The archive's raster and upload are stood in (jsdom cannot paint);
 * the editor, the node views and the self-archive's own decisions are real.
 */
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { contractBody } from '../../__fixtures__/contract'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

let NOTE
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
const archive = vi.hoisted(() => ({ capture: vi.fn(), store: vi.fn() }))
vi.mock('../../lib/embedArchive', async (orig) => ({
  ...(await orig()),
  captureElementPng: (...a) => archive.capture(...a),
  storeFallbackImage: (...a) => archive.store(...a),
}))

// Every embed is on screen (the member scrolls the note): the setup's IntersectionObserver stand-in never reports one,
// and an embed out of view never archives (it holds only its loading skeleton).
class InView {
  constructor(cb) { this.cb = cb }
  observe(el) { this.cb([{ isIntersecting: true, target: el }]) }
  unobserve() {}
  disconnect() {}
}
let realIO
const ARCHIVE_BUDGET_MS = 14_000          // the self-archive's 3.5 s settle and five 2 s retries, then the autosave
const runClock = () => act(async () => { await vi.advanceTimersByTimeAsync(ARCHIVE_BUDGET_MS) })

// The server's styled create, plus a SECOND Market context that already holds its archive (stored with a `fallback`):
// an open must never re-archive it (review m-2's first widened case), so the exemption below covers only the embeds
// stored with `fallback: null`. A Market context, because it is the snapshot jsdom can draw live (a chart cannot).
let ARCHIVED_AT = -1
const OLD_ARCHIVE = { url: '/api/j2/notes/n1/images/old.png', w: 10, h: 10 }
const templateMade = () => {
  const note = { ...contractBody('notes.create.kind').note, locked: false }
  const mc = note.bodyJson.content.findIndex((n) => n.type === 'widgetEmbed' && n.attrs.widgetId === 'marketcontext')
  // W11-R82 m-3: BOTH Market contexts carry `embedId: null` (an embed stored before embed ids). Keyed by id, the fresh
  // one's null also blanks the archived one's fallback (the R80 rail, keyed by embedId, goes red on this fixture with
  // no mutant at all); keyed by POSITION the two cannot collide.
  note.bodyJson.content[mc] = { ...note.bodyJson.content[mc], attrs: { ...note.bodyJson.content[mc].attrs, embedId: null } }
  const archived = { ...note.bodyJson.content[mc], attrs: { ...note.bodyJson.content[mc].attrs, embedId: null, fallback: OLD_ARCHIVE } }
  note.bodyJson.content.splice(mc + 1, 0, archived)
  ARCHIVED_AT = mc + 1
  return note
}

const plain = () => ({
  id: 'n2', title: 'Plain', subtitle: '', folderId: null, ticker: null, tags: [], heroImageUrl: null,
  updatedAt: '2026-10-01T14:00:00.000000+00:00', isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Size it small.' }] }] },
})

beforeEach(() => {
  realIO = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = InView
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // The first open happens the day the note was made: the fixture's capture day (a snapshot first opened on a LATER
  // day with no archive renders its placeholder and archives nothing, widgetEmbedCore.resolveEmbedRender).
  vi.setSystemTime(new Date('2026-10-05T15:00:00Z'))
  archive.capture.mockReset().mockResolvedValue(new Blob(['png']))
  archive.store.mockReset().mockResolvedValue({ url: '/api/j2/notes/n1/images/archive.png', width: 10, height: 10 })
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  localStorage.clear()
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_journal_styles_enabled: true })
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch, updatedAt: '2026-10-01T14:00:05.000000+00:00' }))
})
afterEach(() => {
  globalThis.IntersectionObserver = realIO
  vi.useRealTimers()
  vi.clearAllMocks()
  __resetNotebookFlags()
  localStorage.clear()
})

async function openEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter initialEntries={[`/journal/notebook?note=${NOTE.id}`]}><NoteEditorPage noteId={NOTE.id} onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  return waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el.editor
  })
}

/** Every widgetEmbed in `body`, at any depth, with its POSITION (the child-index path, e.g. "3" or "4.0.1"). W11-R82
 *  m-3: embeds are keyed by position, never by embedId, which can be null (an embed stored before ids) and collide. */
const embedsOf = (body) => {
  const out = []
  const walk = (n, path) => {
    if (n?.type === 'widgetEmbed') out.push({ node: n, path })
    ;(n?.content || []).forEach((c, i) => walk(c, path ? `${path}.${i}` : String(i)))
  }
  walk(body, '')
  return out
}
/** W11-R79 m-2: the exemption, exactly. `body` (RAW, no schema round trip) with `fallback` put back to null ONLY on the
 *  embeds at the positions STORED with `fallback: null` (`paths`); every other byte must already be the stored one. */
const withoutNewArchives = (body, paths) => {
  const walk = (n, path) => ({
    ...n,
    ...(n.type === 'widgetEmbed' && paths.has(path) ? { attrs: { ...n.attrs, fallback: null } } : {}),
    ...(Array.isArray(n.content) ? { content: n.content.map((c, i) => walk(c, path ? `${path}.${i}` : String(i))) } : {}),
  })
  return walk(JSON.parse(JSON.stringify(body)), '')
}
const bodiesSent = () => updateMock.mock.calls.map(([patch]) => patch?.bodyJson).filter(Boolean)
const fallbacks = (body) => (body.content || []).filter((n) => n.type === 'widgetEmbed').map((n) => n.attrs.fallback?.url || null)

describe('the first open of a template-made note writes only the self-archive (W11-R79)', () => {
  it('every body sent differs from the stored one by widgetEmbed `fallback` alone, and then nothing changes', async () => {
    NOTE = templateMade()
    expect(NOTE.bodyJson.content.some((n) => n.type === 'widgetEmbed' && n.attrs.widgetId === 'marketcontext'
      && n.attrs.mode === 'snapshot' && n.attrs.fallback == null)).toBe(true)                 // non-vacuity
    const ed = await openEditor()
    // the Market context's live body is a lazy chunk: let it arrive (real time) before the archive's clock runs
    await waitFor(() => expect(document.querySelectorAll('[data-widget-embed-view="marketcontext"]')[0]?.textContent).toContain('Market phase'),
      { timeout: 15_000 })
    await runClock()
    await runClock()
    const sent = bodiesSent()
    const fresh = new Set(embedsOf(NOTE.bodyJson).filter((e) => e.node.attrs.fallback == null).map((e) => e.path))
    expect(fresh.size, 'non-vacuity: embeds stored without an archive').toBeGreaterThan(0)
    expect(sent.length, 'precondition: the self-archive wrote (the exemption is exercised)').toBeGreaterThan(0)
    // At most one write per embed that had no archive: no extra open-write rides the exemption.
    expect(sent.length).toBeLessThanOrEqual(fresh.size)
    let before = NOTE.bodyJson
    for (const body of sent) {
      // RAW bytes: the stored body exactly, once only the newly archived embeds' `fallback` is put back
      expect(withoutNewArchives(body, fresh)).toEqual(NOTE.bodyJson)
      // and each write ADDS an archive (never an identical re-send of what was already there)
      const had = new Set(embedsOf(before).filter((e) => e.node.attrs.fallback?.url).map((e) => e.path))
      expect(embedsOf(body).some((e) => fresh.has(e.path) && e.node.attrs.fallback?.url && !had.has(e.path)),
        'a write that archives nothing new').toBe(true)
      before = body
    }
    expect(sent.at(-1).content[ARCHIVED_AT].attrs.fallback).toEqual(OLD_ARCHIVE)
    expect(fallbacks(sent.at(-1))).toContain('/api/j2/notes/n1/images/archive.png')
    // and after it: zero document changes, zero further writes
    const changes = []
    ed.on('transaction', ({ transaction, appendedTransactions = [] }) => {
      for (const tr of [transaction, ...appendedTransactions]) if (tr.docChanged) changes.push(tr)
    })
    const n = updateMock.mock.calls.length
    await runClock()
    expect(changes).toHaveLength(0)
    expect(updateMock.mock.calls.length).toBe(n)
  }, 30_000)

  it('CONTROL: a note with no snapshot embed opens with zero writes and zero document changes', async () => {
    NOTE = plain()
    const ed = await openEditor()
    const changes = []
    ed.on('transaction', ({ transaction, appendedTransactions = [] }) => {
      for (const tr of [transaction, ...appendedTransactions]) if (tr.docChanged) changes.push(tr)
    })
    await runClock()
    expect(changes).toHaveLength(0)
    expect(updateMock).not.toHaveBeenCalled()
    expect(archive.capture).not.toHaveBeenCalled()
  }, 30_000)
})
