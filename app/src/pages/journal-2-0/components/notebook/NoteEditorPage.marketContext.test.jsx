/**
 * P2a Task 12, R-T12-2 — a failed "Market context" read says so, in the REAL editor page's own toast.
 * ⛔ Asserted by the RENDERED sentence (the copy contract), never by a spy on `notify`: the typed
 * "/market context" is already gone when the read is awaited (R-RC-4), so a silent failure reads as the
 * command having done nothing at all. Driven the way a member drives it: type the command, the menu
 * shows, Enter.
 */
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { contractBody } from '../../__fixtures__/contract'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T1 = '2026-10-01T14:00:00.000000+00:00'
const MC = '/api/j2/trader-blocks/market-context'
// The member's sentence, the /vs wording ("could not be ... just now, so nothing was added. Try ... again.").
const SENTENCE = 'Market context could not be read just now, so nothing was added. Try /market context again.'
let NOTE
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
// Fix round 2 (I-1): the self-archive's two network/raster steps are stood in for, so a rail can watch the
// archive re-freeze after a capture. The real kickSnapshotWarm and everything else stay.
const archive = vi.hoisted(() => ({ capture: vi.fn(), store: vi.fn() }))
vi.mock('../../lib/embedArchive', async (orig) => ({
  ...(await orig()),
  captureElementPng: (...a) => archive.capture(...a),
  storeFallbackImage: (...a) => archive.store(...a),
}))

const note = () => ({
  id: 'n1', title: 'AMD plan', subtitle: '', folderId: null, ticker: 'AMD', tags: [],
  heroImageUrl: null, updatedAt: T1, isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan ' }] }] },
})

/** Every other read answers an empty 200; the market-context read answers `mc`. */
function routeFetch(mc) {
  global.fetch = vi.fn(async (url) => (String(url) === MC ? mc() : { ok: true, status: 200, json: async () => ({}) }))
}

beforeEach(() => {
  archive.capture.mockReset().mockResolvedValue(new Blob(['png']))
  archive.store.mockReset().mockResolvedValue({ url: '/api/j2/notes/n1/images/new-archive.png', width: 10, height: 10 })
  localStorage.clear()
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_journal_styles_enabled: true })
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch }))
  NOTE = note()
})
afterEach(() => {
  vi.clearAllMocks()
  __resetNotebookFlags()
  localStorage.clear()
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter initialEntries={['/journal/notebook?note=n1']}><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  return waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el.editor
  })
}
const mcCalls = () => global.fetch.mock.calls.filter(([u]) => String(u) === MC)
const stamps = (ed) => ed.getJSON().content.filter((n) => n.type === 'widgetEmbed' && n.attrs.widgetId === 'marketcontext')

/** Type "/market context" at the end of the line, wait for the menu, press Enter on its top row. */
async function runMarketContext(ed) {
  ed.commands.focus('end', { scrollIntoView: false })
  await act(async () => { ed.commands.insertContent('/market context') })
  const top = await waitFor(() => {
    const opt = document.querySelector('#uct-slash-menu [role="option"]')
    if (!opt) throw new Error('slash menu not shown')
    return opt.firstElementChild.textContent
  })
  expect(top).toBe('Market context')                     // non-vacuity: Enter runs THIS item
  await act(async () => { ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: 'Enter' }))) })
  await waitFor(() => expect(mcCalls()).toHaveLength(1))
}

describe('Market context: a failed read is said, in the note\'s own toast', () => {
  it('a 503 shows the sentence and inserts nothing', async () => {
    routeFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    const ed = await renderEditor()
    await runMarketContext(ed)
    expect(await screen.findByText(SENTENCE)).toBeTruthy()
    expect(stamps(ed)).toEqual([])
    expect(ed.state.doc.textContent).not.toContain('/market')
  })

  it('a read that throws (offline) shows the sentence and inserts nothing', async () => {
    routeFetch(async () => { throw new TypeError('Failed to fetch') })
    const ed = await renderEditor()
    await runMarketContext(ed)
    expect(await screen.findByText(SENTENCE)).toBeTruthy()
    expect(stamps(ed)).toEqual([])
  })

  it('CONTROL: a good read stamps the note and shows no sentence', async () => {
    routeFetch(async () => ({ ok: true, status: 200, json: async () => ({ readings: {}, wireDate: '2026-10-12', updated: '10:30 AM ET' }) }))
    const ed = await renderEditor()
    await runMarketContext(ed)
    await waitFor(() => expect(stamps(ed)).toHaveLength(1))
    expect(screen.queryByText(SENTENCE)).toBeNull()
  })
})

// R-T12-C fix round, I-1: the WIRE, end to end in the real editor page. A stamp the create could not
// read in time ({uncaptured: true, reason: "budget"}, the backend's shape) offers "Capture now", and the
// click lands the readings IN THE NOTE (the node's params) through the embed's setParams: nothing on
// the path is mocked but the read itself.
const BUDGET = 'The market could not be read in time when this stamp was added.'
const budgetStamp = () => ({ type: 'widgetEmbed', attrs: {
  v: 1, widgetId: 'marketcontext', embedId: 'mc-budget', mode: 'snapshot',
  params: { uncaptured: true, reason: 'budget', fields: 'all' },
  capturedAt: null, annotations: [], caption: null, layout: { width: 'full', height: null }, fallback: null,
} })

describe('Market context: the budget stamp\'s Capture now writes into the note', () => {
  // The setup's IntersectionObserver never reports, so an embed would stay below the fold forever; this
  // one says every observed block is in view, which is what mounts the embed's real renderer.
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb) { this.cb = cb }
      observe(target) { this.cb([{ isIntersecting: true, target }], this) }
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('the click lands the readings in the node, the stamp keeps its preset, and the sentence goes', async () => {
    const READ = { readings: { marketPhase: 'Uptrend', exposureScore: 72.5, powerTrend: null }, wireDate: '2026-10-12', updated: '10:30 AM ET' }
    routeFetch(async () => ({ ok: true, status: 200, json: async () => READ }))
    NOTE = { ...note(), bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan ' }] }, budgetStamp()] } }
    const ed = await renderEditor()
    expect(await screen.findByText(BUDGET)).toBeTruthy()
    expect(mcCalls()).toHaveLength(0)                       // never on mount
    const button = await screen.findByRole('button', { name: 'Capture now' })
    await act(async () => { button.click() })
    await waitFor(() => expect(stamps(ed)[0].attrs.params.readings).toEqual(READ.readings))
    const params = stamps(ed)[0].attrs.params
    expect(params.fields).toBe('all')
    expect(params.wireDate).toBe('2026-10-12')
    expect(params.uncaptured).toBeUndefined()
    expect(params.reason).toBeUndefined()
    expect(mcCalls()).toHaveLength(1)
    await waitFor(() => expect(screen.queryByText(BUDGET)).toBeNull())
    expect(screen.queryByRole('button', { name: 'Capture now' })).toBeNull()
    // fix round 2 (M-2): the button is gone, so focus is on the stamp itself and the capture was said
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('figure')))
    expect(screen.getByText('Market context captured.').getAttribute('role')).toBe('status')
  })

  it('fix round 2 (I-1): Capture now clears a stale archived image in the SAME write, and the archive re-freezes the CAPTURED stamp', async () => {
    const READ = { readings: { marketPhase: 'Uptrend', powerTrend: null }, wireDate: '2026-10-12', updated: '10:30 AM ET' }
    routeFetch(async () => ({ ok: true, status: 200, json: async () => READ }))
    const stale = budgetStamp()
    stale.attrs.fallback = { url: '/api/j2/notes/n1/images/stale.png', w: 10, h: 10 }   // a PNG of the uncaptured frame
    NOTE = { ...note(), bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan ' }] }, stale] } }
    const ed = await renderEditor()
    await act(async () => { (await screen.findByRole('button', { name: 'Capture now' })).click() })
    // one write: the readings, the date and the cleared archive land together
    await waitFor(() => expect(stamps(ed)[0].attrs.params.readings).toEqual(READ.readings))
    expect(stamps(ed)[0].attrs.fallback).toBeNull()
    expect(stamps(ed)[0].attrs.capturedAt).toBeTruthy()
    // re-armed: the self-archive settles, rasterizes the captured stamp (no door, no sentence) and lands it
    await waitFor(() => expect(stamps(ed)[0].attrs.fallback?.url).toBe('/api/j2/notes/n1/images/new-archive.png'), { timeout: 20000 })
    expect(archive.capture).toHaveBeenCalledTimes(1)
    const shot = archive.capture.mock.calls[0][0]
    expect(shot.textContent).toContain('Uptrend')
    expect(shot.textContent).not.toContain('Capture now')
    expect(shot.textContent).not.toContain(BUDGET)
  }, 30000)

  it('fix round 1: the capture is DATED — capturedAt lands in the same node, and the caption says "· captured <day>"', async () => {
    const READ = { readings: { marketPhase: 'Uptrend', powerTrend: null }, wireDate: '2026-10-12', updated: '10:30 AM ET' }
    routeFetch(async () => ({ ok: true, status: 200, json: async () => READ }))
    NOTE = { ...note(), bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan ' }] }, budgetStamp()] } }
    const ed = await renderEditor()
    const before = await screen.findByRole('figure')
    expect(before.getAttribute('aria-label')).toBe('Market Context — not captured')     // no date before
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const t0 = Date.now()
    await act(async () => { (await screen.findByRole('button', { name: 'Capture now' })).click() })
    await waitFor(() => expect(stamps(ed)[0].attrs.params.readings).toEqual(READ.readings))
    const at = stamps(ed)[0].attrs.capturedAt
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{6})?Z$/)              // trader_blocks._iso's form
    expect(Math.abs(new Date(at).getTime() - t0)).toBeLessThan(60_000)
    // the rendered caption (the figure's name, the words its archived image uses for alt)
    await waitFor(() => expect(screen.getByRole('figure').getAttribute('aria-label')).toMatch(new RegExp(`· captured ${today}$`)))
  })

  it('CONTROL (fix round 1): a prep block\'s Capture now lands its snapshot and leaves capturedAt exactly as it was', async () => {
    const WIRE = '/api/j2/trader-blocks/prep/wire'
    const snap = contractBody('trader-blocks.prep.wire.held')
    global.fetch = vi.fn(async (url) => (String(url) === WIRE
      ? { ok: true, status: 200, json: async () => snap } : { ok: true, status: 200, json: async () => ({}) }))
    const block = { type: 'widgetEmbed', attrs: {
      v: 1, widgetId: 'prepWire', embedId: 'pw1', mode: 'snapshot', params: {},
      capturedAt: '2026-10-05T14:00:00Z', annotations: [], caption: null, layout: { width: 'full', height: null },
      // fix round 2: a value a block write must never touch (a block has no archive; this proves it stays)
      fallback: { url: '/api/j2/notes/n1/images/kept.png', w: 1, h: 1 },
    } }
    NOTE = { ...note(), bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prep ' }] }, block] } }
    const ed = await renderEditor()
    const node = () => ed.getJSON().content.find((n) => n.type === 'widgetEmbed' && n.attrs.widgetId === 'prepWire')
    // the block body is its own lazy chunk (BlockNodeView), so its first load can take a moment
    const button = await screen.findByRole('button', { name: 'Capture now' }, { timeout: 8000 })
    await act(async () => { button.click() })
    await waitFor(() => expect(node().attrs.params.snapshot).toEqual(snap))           // non-vacuity: it wrote
    expect(node().attrs.capturedAt).toBe('2026-10-05T14:00:00Z')
    expect(node().attrs.fallback).toEqual({ url: '/api/j2/notes/n1/images/kept.png', w: 1, h: 1 })   // fix round 2
  })

  it('CONTROL: the "Update layout" stamp (no reason) shows its old sentence and no Capture now', async () => {
    routeFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    const stamp = budgetStamp()
    delete stamp.attrs.params.reason
    NOTE = { ...note(), bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan ' }] }, stamp] } }
    await renderEditor()
    expect(await screen.findByText('Market context is captured when a note is created. This note was written before it had one.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Capture now' })).toBeNull()
  })
})
