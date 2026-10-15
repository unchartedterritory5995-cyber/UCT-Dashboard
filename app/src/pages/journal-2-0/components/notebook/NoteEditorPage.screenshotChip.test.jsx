// Tier 2 part A, item 10 -- the screenshot chip in the REAL editor page. A member pastes a chart image, the page
// waits in the background for the screenshot read (readScreenshot is mocked here; screenshotRead.test.js owns it),
// and a chip OFFERS the tag. Accepting is an editor transaction (the alt) plus, only when the note has no ticker,
// the note's own metadata door (`update` + settleMetadataRevision). Nothing happens by itself.
// Every assertion is on rendered TEXT or on the editor's own JSON; the mount is also railed on the page source,
// because a chip that is built and tested and mounted nowhere is the defect this repo keeps rediscovering.
import { render, screen, act, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T1 = '2026-10-01T14:00:00.000000+00:00'
const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NVDA_DAILY = { symbol: 'NVDA', timeframe: { tf: 'D', label: 'Daily' } }
const IMG_URL = '/api/j2/notes/attachments/u1/n1/inline/abc123.png'

let NOTES
const updateMock = vi.fn()
const readMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: (id) => ({ note: NOTES[id], isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../../lib/screenshotRead', () => ({ readScreenshot: (...a) => readMock(...a) }))
// The REAL image finder, counted: every whole-document scan the chip runs goes through it (I3).
const findImagePosSpy = vi.fn()
vi.mock('../../lib/screenshotLabel', async (orig) => {
  const real = await orig()
  return { ...real, findImagePos: (...a) => { findImagePosSpy(...a); return real.findImagePos(...a) } }
})

const mkNote = (id, extra = {}) => ({
  id, title: `Note ${id}`, subtitle: '', folderId: null, ticker: null, tags: [], heroImageUrl: null,
  updatedAt: T1, isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [P('Intro line.')] },
  ...extra,
})

beforeEach(() => {
  localStorage.clear()
  __resetNotebookFlags()
  NOTES = { n1: mkNote('n1'), n2: mkNote('n2') }
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTES.n1, ...patch, updatedAt: '2026-10-01T14:09:00.000000+00:00' }))
  readMock.mockReset()
  readMock.mockResolvedValue(NVDA_DAILY)
  global.fetch = vi.fn(async (url) => {
    if (String(url).endsWith('/images')) return { ok: true, status: 200, json: async () => ({ url: IMG_URL, width: 800, height: 600 }) }
    return { ok: true, status: 200, json: async () => ({}) }
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  __resetNotebookFlags()
  localStorage.clear()
})

const switchesOn = () => latchNotebookFlags({
  notebook_smart_chips_enabled: true,
  notebook_image_docx_documents_enabled: true,
})

async function renderEditor(noteId = 'n1') {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const ui = (id) => (
    <MemoryRouter initialEntries={[`/journal/notebook?note=${id}`]}>
      <NoteEditorPage noteId={id} onBack={vi.fn()} />
    </MemoryRouter>
  )
  const view = render(ui(noteId))
  await screen.findByPlaceholderText('Title')
  const editor = await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el.editor
  })
  return { editor, rerender: (id) => view.rerender(ui(id)), unmount: view.unmount }
}

/** The member pastes (or picks) a chart image: the page's own upload door, then the image lands in the note. */
async function pasteImage() {
  const input = await screen.findByLabelText('Upload image')
  const file = new File(['png-bytes'], 'chart.png', { type: 'image/png' })
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
  await waitFor(() => expect(readMock.mock.calls.length + (global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/images')).length)).toBeGreaterThan(0))
}
const imageAttrs = (editor) => {
  const out = []
  editor.state.doc.descendants((n) => { if (n.type.name === 'image') out.push(n.attrs) })
  return out
}
const chip = (name) => screen.findByRole('button', { name })
// The ticker field lives in the collapsed details region; open it so the field itself can be read.
const openDetails = () => fireEvent.click(screen.getByRole('button', { name: /^(add )?details$/i }))
const tickerField = () => screen.getByRole('textbox', { name: 'Ticker' })

describe('the mount (source rails)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'NoteEditorPage.jsx'), 'utf8').replace(/\r\n/g, '\n')
  it('the chip loads through lazyChunk, never a static import or a bare React.lazy', () => {
    expect(src).toMatch(/const ScreenshotTagOffer = lazyChunk\(\(\) => import\('\.\/ScreenshotTagOffer'\)\)/)
    expect(src).not.toMatch(/^import .*ScreenshotTagOffer/m)
    expect(src).not.toMatch(/\blazy\(\(\) => import\('\.\/ScreenshotTagOffer'\)/)
    expect(src.match(/import\('\.\/ScreenshotTagOffer'\)/g)).toHaveLength(1)
  })
  it('the poll and its network code load only on a paste with the switch on (a dynamic import, never static)', () => {
    expect(src).not.toMatch(/^import .*screenshotRead/m)
    expect(src.match(/import\('\.\.\/\.\.\/lib\/screenshotRead'\)/g)).toHaveLength(1)
    expect(src).toMatch(/import \{ altFor \} from '\.\.\/\.\.\/lib\/screenshotSmarts'/)
    expect(src).toMatch(/import \{ labelImage \} from '\.\.\/\.\.\/lib\/screenshotLabel'/)
  })
  it('the read starts only behind BOTH switches', () => {
    expect(src).toMatch(
      /smartChipsEnabled\(\) && notebookFlag\('notebook_image_docx_documents_enabled'\) === true/,
    )
  })
  it('the metadata write goes through update + settleMetadataRevision, like onTickerChange', () => {
    expect(src).toMatch(/await settleMetadataRevision\(await update\(\{ ticker: [a-zA-Z.]+ \}\)\)/)
  })
})

describe('⛔ the switch off: no poll', () => {
  it('smart chips OFF: pasting an image never calls readScreenshot (and the image still lands)', async () => {
    latchNotebookFlags({ notebook_smart_chips_enabled: false, notebook_image_docx_documents_enabled: true })
    const { editor } = await renderEditor()
    await pasteImage()
    await waitFor(() => expect(imageAttrs(editor)).toHaveLength(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(readMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('toolbar', { name: 'Screenshot tag' })).toBeNull()
  })
  it('documents OFF (the OCR pipeline is not running): no poll either', async () => {
    latchNotebookFlags({ notebook_smart_chips_enabled: true, notebook_image_docx_documents_enabled: false })
    const { editor } = await renderEditor()
    await pasteImage()
    await waitFor(() => expect(imageAttrs(editor)).toHaveLength(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(readMock).not.toHaveBeenCalled()
  })
  it('CONTROL — both on: the same paste DOES start the read, for this note and this image', async () => {
    switchesOn()
    await renderEditor()
    await pasteImage()
    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(1))
    const args = readMock.mock.calls[0][0]
    expect(args.noteId).toBe('n1')
    expect(args.url).toBe(IMG_URL)
    expect(args.signal.aborted).toBe(false)
  })
})

describe('the offer', () => {
  it('a single ticker found: the chip says what it will do, and NOTHING has been done yet', async () => {
    switchesOn()
    const { editor } = await renderEditor()
    await pasteImage()
    expect(await chip('Tag NVDA · Daily')).toBeTruthy()
    expect(updateMock).not.toHaveBeenCalled()
    expect(imageAttrs(editor)[0].alt).toBe('')
  })
  it('nothing found: no chip at all', async () => {
    switchesOn()
    readMock.mockResolvedValue(null)
    await renderEditor()
    await pasteImage()
    await waitFor(() => expect(readMock).toHaveBeenCalled())
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(screen.queryByRole('toolbar', { name: 'Screenshot tag' })).toBeNull()
  })
  it('Dismiss takes the chip away and writes nothing', async () => {
    switchesOn()
    const { editor } = await renderEditor()
    await pasteImage()
    await chip('Tag NVDA · Daily')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss screenshot tag' }))
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Screenshot tag' })).toBeNull())
    expect(updateMock).not.toHaveBeenCalled()
    expect(imageAttrs(editor)[0].alt).toBe('')
  })
  it('deleting the image removes the chip', async () => {
    switchesOn()
    const { editor } = await renderEditor()
    await pasteImage()
    await chip('Tag NVDA · Daily')
    act(() => {
      const tr = editor.state.tr
      editor.state.doc.descendants((n, pos) => { if (n.type.name === 'image') tr.delete(pos, pos + n.nodeSize) })
      editor.view.dispatch(tr)
    })
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Screenshot tag' })).toBeNull())
  })
  it('⛔ I3: deleting the image ENDS the offer, so typing afterwards runs no whole-document scan', async () => {
    switchesOn()
    const { editor } = await renderEditor()
    await pasteImage()
    await chip('Tag NVDA · Daily')
    const typeAtStart = (t) => act(() => { editor.commands.insertContentAt(1, t) })
    // Control: with the image there, typing maps its position (O(1)) -- no scan, so a count below is meaningful.
    const atStart = findImagePosSpy.mock.calls.length
    typeAtStart('a ')
    expect(findImagePosSpy.mock.calls.length).toBe(atStart)
    act(() => {
      const tr = editor.state.tr
      editor.state.doc.descendants((n, pos) => { if (n.type.name === 'image') tr.delete(pos, pos + n.nodeSize) })
      editor.view.dispatch(tr)
    })
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Screenshot tag' })).toBeNull())
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    const afterDelete = findImagePosSpy.mock.calls.length
    typeAtStart('typing ')
    typeAtStart('after ')
    typeAtStart('the delete ')
    expect(findImagePosSpy.mock.calls.length).toBe(afterDelete)
    expect(screen.queryByRole('button', { name: /^Tag / })).toBeNull()
  })
})

describe('accepting', () => {
  it('a note with NO ticker: the alt is set and the ticker is set ONCE through the metadata door', async () => {
    switchesOn()
    const { editor } = await renderEditor()
    openDetails()
    expect(tickerField().value).toBe('')
    await pasteImage()
    fireEvent.click(await chip('Tag NVDA · Daily'))
    expect(await screen.findByText("Tagged the screenshot NVDA · Daily and set this note's ticker to NVDA.")).toBeTruthy()
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledWith({ ticker: 'NVDA' })
    expect(imageAttrs(editor)[0].alt).toBe('NVDA daily chart')
    expect(screen.queryByRole('toolbar', { name: 'Screenshot tag' })).toBeNull()
    expect(tickerField().value).toBe('NVDA')
  })
  it('a note that already HAS a ticker: the chip says "Tag image", the ticker is untouched, update is not called', async () => {
    switchesOn()
    NOTES.n1 = mkNote('n1', { ticker: 'AMD' })
    const { editor } = await renderEditor()
    await pasteImage()
    fireEvent.click(await chip('Tag image NVDA · Daily'))
    expect(await screen.findByText('Tagged the screenshot NVDA · Daily.')).toBeTruthy()
    expect(updateMock).not.toHaveBeenCalled()
    expect(imageAttrs(editor)[0].alt).toBe('NVDA daily chart')
  })
  it('⛔ I2: a ticker TYPED into the field but not saved yet is the note\'s ticker -- labelled only, never overwritten', async () => {
    switchesOn()
    const { editor } = await renderEditor()
    openDetails()
    await pasteImage()
    await chip('Tag NVDA · Daily') // control: before the member types, the note has no ticker and the chip offers both
    fireEvent.change(tickerField(), { target: { value: 'aapl' } }) // typed, NOT blurred: not saved
    // The chip's words follow the field at once: it will label the image only.
    expect(await chip('Tag image NVDA · Daily')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tag image NVDA · Daily' }))
    expect(await screen.findByText('Tagged the screenshot NVDA · Daily.')).toBeTruthy()
    expect(updateMock).not.toHaveBeenCalled()
    expect(tickerField().value).toBe('aapl')
    expect(imageAttrs(editor)[0].alt).toBe('NVDA daily chart')
  })
  it('the ticker set by a tag goes through the ticker door\'s own validator (normalized, never a second route)', async () => {
    switchesOn()
    readMock.mockResolvedValue({ symbol: 'nvda', timeframe: { tf: 'D', label: 'Daily' } })
    await renderEditor()
    openDetails()
    await pasteImage()
    fireEvent.click(await chip('Tag nvda · Daily'))
    await screen.findByText(/set this note's ticker to NVDA\./)
    expect(updateMock).toHaveBeenCalledWith({ ticker: 'NVDA' })
    expect(tickerField().value).toBe('NVDA')
  })
  it('a symbol the ticker door refuses is not written: the alt stays and the toast says the ticker was not set', async () => {
    switchesOn()
    readMock.mockResolvedValue({ symbol: 'NOT A TICKER', timeframe: null })
    const { editor } = await renderEditor()
    await pasteImage()
    fireEvent.click(await chip('Tag NOT A TICKER'))
    expect(await screen.findByText("Tagged the screenshot NOT A TICKER. Couldn't set the note's ticker; nothing else changed.")).toBeTruthy()
    expect(updateMock).not.toHaveBeenCalled()
    expect(imageAttrs(editor)[0].alt).toBe('NOT A TICKER chart')
  })
  it('no timeframe: the alt and the toast name the symbol alone', async () => {
    switchesOn()
    readMock.mockResolvedValue({ symbol: 'NVDA', timeframe: null })
    NOTES.n1 = mkNote('n1', { ticker: 'NVDA' })
    const { editor } = await renderEditor()
    await pasteImage()
    fireEvent.click(await chip('Tag NVDA'))
    expect(await screen.findByText('Tagged the screenshot NVDA.')).toBeTruthy()
    expect(imageAttrs(editor)[0].alt).toBe('NVDA chart')
  })
  it('the ticker write is refused: the alt STAYS, and the toast says what did and did not happen', async () => {
    switchesOn()
    updateMock.mockRejectedValue(new Error('boom'))
    const { editor } = await renderEditor()
    openDetails()
    await pasteImage()
    fireEvent.click(await chip('Tag NVDA · Daily'))
    expect(await screen.findByText("Tagged the screenshot NVDA · Daily. Couldn't set the note's ticker; nothing else changed.")).toBeTruthy()
    expect(imageAttrs(editor)[0].alt).toBe('NVDA daily chart')
    expect(tickerField().value).toBe('')
  })
  it('a locked note takes no tag: a sentence, no alt, no ticker', async () => {
    switchesOn()
    const { editor } = await renderEditor()
    await pasteImage()
    await chip('Tag NVDA · Daily')
    NOTES.n1 = mkNote('n1', { locked: true })
    act(() => { editor.setEditable(false) }) // the lock arrives while the chip is up
    fireEvent.click(screen.getByRole('button', { name: 'Tag NVDA · Daily' }))
    expect(await screen.findByText(/Couldn't tag the screenshot/)).toBeTruthy()
    expect(updateMock).not.toHaveBeenCalled()
    expect(imageAttrs(editor)[0].alt).toBe('')
  })
})

describe('⛔ the read is abortable (Review Focus 3)', () => {
  it('note changed: the read is aborted and NO offer renders in the other note', async () => {
    switchesOn()
    let finish
    readMock.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const { rerender } = await renderEditor('n1')
    await pasteImage()
    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(1))
    const { signal } = readMock.mock.calls[0][0]
    expect(signal.aborted).toBe(false)
    rerender('n2')
    await waitFor(() => expect(signal.aborted).toBe(true))
    // the read comes back anyway, late: it is ignored
    await act(async () => { finish(NVDA_DAILY); await new Promise((r) => setTimeout(r, 30)) })
    expect(screen.queryByRole('toolbar', { name: 'Screenshot tag' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Tag / })).toBeNull()
  })
  it('a newer paste aborts the older read (one offer at a time, the newest)', async () => {
    switchesOn()
    readMock.mockImplementation(() => new Promise(() => {}))
    await renderEditor()
    await pasteImage()
    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(1))
    global.fetch.mockImplementation(async (url) => (String(url).endsWith('/images')
      ? { ok: true, status: 200, json: async () => ({ url: '/second.png' }) }
      : { ok: true, status: 200, json: async () => ({}) }))
    const input = await screen.findByLabelText('Upload image')
    await act(async () => { fireEvent.change(input, { target: { files: [new File(['b'], 'b.png', { type: 'image/png' })] } }) })
    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(2))
    expect(readMock.mock.calls[0][0].signal.aborted).toBe(true)
    expect(readMock.mock.calls[1][0].signal.aborted).toBe(false)
  })
  it('leaving the page aborts the read', async () => {
    switchesOn()
    readMock.mockImplementation(() => new Promise(() => {}))
    const { unmount } = await renderEditor()
    await pasteImage()
    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(1))
    const { signal } = readMock.mock.calls[0][0]
    unmount()
    expect(signal.aborted).toBe(true)
  })
})
