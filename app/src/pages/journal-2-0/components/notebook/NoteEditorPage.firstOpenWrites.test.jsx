/**
 * ⛔⛔ W11-R79 (the 11.20 walk's D2 ruling): WHAT THE FIRST OPEN OF A TEMPLATE-MADE NOTE MAY WRITE.
 *
 * THE ONE EXEMPTION, named here so the walk's PUTPROBE is read against it: a snapshot widgetEmbed that holds no
 * archive (`fallback: null`) archives ITSELF once its live render settles (WidgetEmbedView's self-archive: rasterise,
 * upload, `updateAttributes({ fallback })`, phase 1's durability pipeline). That is one write per such embed, ONCE:
 * the note then holds its archive and every later open writes nothing. A template-made note's Market context (and
 * any other snapshot the template placed) has no archive yet, so its first open writes exactly that, ~3.5-13.5 s in.
 * NOTHING ELSE may change: the rail compares every body the page sends against the stored body with only `fallback`
 * blanked, and then requires zero further document changes.
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

const templateMade = () => ({ ...contractBody('notes.create.kind').note, locked: false })
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

/** A body as the editor's schema holds it, with every widgetEmbed's `fallback` blanked: the exemption's one key. */
const withoutFallback = (ed, body) => {
  const json = ed.schema.nodeFromJSON(body).toJSON()
  const walk = (n) => ({
    ...n,
    ...(n.type === 'widgetEmbed' ? { attrs: { ...n.attrs, fallback: null } } : {}),
    ...(Array.isArray(n.content) ? { content: n.content.map(walk) } : {}),
  })
  return walk(json)
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
    await waitFor(() => expect(document.querySelector('[data-widget-embed-view="marketcontext"]')?.textContent).toContain('Market phase'),
      { timeout: 15_000 })
    await runClock()
    await runClock()
    const sent = bodiesSent()
    expect(sent.length, 'precondition: the self-archive wrote (the exemption is exercised)').toBeGreaterThan(0)
    expect(archive.store).toHaveBeenCalled()
    const stored = withoutFallback(ed, NOTE.bodyJson)
    for (const body of sent) expect(withoutFallback(ed, body)).toEqual(stored)                   // fallback ONLY
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
