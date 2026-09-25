import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Wave 7 lane H (H1) — dictation in the editor, and G5's camera "Scan" door.
//
// TWO REAL mounted editors (split view mounts two), the same shape as the I5
// image-picker rail: the slash menu's "Dictate" item must start the mic of the
// pane it ran in and no other. The mic itself is stubbed at the module seam —
// its recorder is railed in VoiceInputButton.ref.test.jsx — but the stub is
// wired exactly as the real one is: a forwardRef exposing `{ start, available }`
// whose `onTranscript` the page hands in.

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NOTES = {
  n1: { id: 'n1', title: 'Main note', subtitle: '', folderId: null, ticker: null,
    tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false,
    bodyJson: { type: 'doc', content: [P('Main body.')] } },
  n2: { id: 'n2', title: 'Side note', subtitle: '', folderId: null, ticker: null,
    tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false,
    bodyJson: { type: 'doc', content: [P('Side body.')] } },
}

const AUTH = { user: { id: 'u1' }, isPaid: true }
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: (noteId) => ({ note: NOTES[noteId], isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => AUTH }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

// Which pane's mic each start() reached.
const STARTS = []
vi.mock('../VoiceInputButton', async () => {
  const React = await import('react')
  const Stub = React.forwardRef(function StubMic({ onTranscript, disabled, holdOnFailure }, ref) {
    const btn = React.useRef(null)
    React.useImperativeHandle(ref, () => ({
      available: true,
      start: () => {
        STARTS.push(btn.current?.closest('[data-pane]')?.getAttribute('data-pane') || '?')
        return true
      },
    }))
    return (
      <button ref={btn} type="button" aria-label="Start voice input" data-disabled={String(Boolean(disabled))}
              data-hold-on-failure={String(Boolean(holdOnFailure))}
              onClick={() => onTranscript('spoken words')} />
    )
  })
  return { default: Stub }
})

let fetchMock
beforeEach(() => {
  STARTS.length = 0
  AUTH.isPaid = true
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  global.fetch = fetchMock
})
afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

async function mountEditorInPane(pane, noteId) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const div = document.createElement('div')
  div.setAttribute('data-pane', pane)
  document.body.appendChild(div)
  render(
    <MemoryRouter><NoteEditorPage noteId={noteId} onBack={vi.fn()} showBack /></MemoryRouter>,
    { container: div },
  )
  const editorEl = await waitFor(() => {
    const el = div.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  return { editor: editorEl.editor, root: div }
}

const micIn = (root) => within(root).findByLabelText('Start voice input')

describe('NoteEditorPage — dictation (wave 7 H1)', () => {
  it('a paid member gets a mic in the toolbar', async () => {
    const { root } = await mountEditorInPane('main', 'n1')
    const mic = await micIn(root)
    expect(mic.closest('[role="toolbar"]')).toBeTruthy()
  })

  // Fix round 1, review I-4: the editor's mic opts into keeping a recording
  // the server failed to transcribe (VoiceInputButton.holdOnFailure.test.jsx
  // rails the behaviour; this rails that THIS surface asked for it).
  it("the editor's mic keeps a failed recording and says why (holdOnFailure)", async () => {
    await mountEditorInPane('main', 'n1')
    const mic = await screen.findByRole('button', { name: 'Start voice input' })
    expect(mic.getAttribute('data-hold-on-failure')).toBe('true')
  })

  it('an UNPAID member gets no mic and no "Dictate" slash item — nothing dead', async () => {
    AUTH.isPaid = false
    const { root, editor } = await mountEditorInPane('main', 'n1')
    // give a lazily-loaded mic every chance to appear
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(within(root).queryByLabelText('Start voice input')).toBeNull()
    const { blockItemsAvailable } = await import('./SlashMenu')
    expect(blockItemsAvailable(editor).some((i) => i.title === 'Dictate')).toBe(false)
  })

  it('"Dictate" is offered once THIS editor\'s mic is mounted', async () => {
    const { root, editor } = await mountEditorInPane('main', 'n1')
    await micIn(root)
    const { blockItemsAvailable } = await import('./SlashMenu')
    expect(blockItemsAvailable(editor).some((i) => i.title === 'Dictate')).toBe(true)
  })

  it('firing "Dictate" from the SIDE pane starts only the side pane\'s mic', async () => {
    const main = await mountEditorInPane('main', 'n1')
    const side = await mountEditorInPane('side', 'n2')
    await micIn(main.root)
    await micIn(side.root)
    const { ITEMS } = await import('./SlashMenu')
    const dictate = ITEMS.find((i) => i.title === 'Dictate')
    const from = side.editor.state.selection.from
    act(() => { dictate.command({ editor: side.editor, range: { from, to: from } }) })
    expect(STARTS).toEqual(['side'])
  })

  it('CONTROL: firing "Dictate" from the MAIN pane starts only the main pane\'s mic', async () => {
    const main = await mountEditorInPane('main', 'n1')
    const side = await mountEditorInPane('side', 'n2')
    await micIn(main.root)
    await micIn(side.root)
    const { ITEMS } = await import('./SlashMenu')
    const dictate = ITEMS.find((i) => i.title === 'Dictate')
    const from = main.editor.state.selection.from
    act(() => { dictate.command({ editor: main.editor, range: { from, to: from } }) })
    expect(STARTS).toEqual(['main'])
  })

  it('what the mic hears lands in ITS editor, and one Ctrl+Z removes exactly it', async () => {
    const main = await mountEditorInPane('main', 'n1')
    const side = await mountEditorInPane('side', 'n2')
    const mic = await micIn(main.root)
    // caret at the end of the main note's text
    act(() => { main.editor.commands.setTextSelection(main.editor.state.doc.content.size - 1) })
    act(() => { fireEvent.click(mic) })
    expect(main.editor.state.doc.textContent).toBe('Main body. spoken words')
    expect(side.editor.state.doc.textContent).toBe('Side body.')
    act(() => { main.editor.commands.undo() })
    expect(main.editor.state.doc.textContent).toBe('Main body.')
  })
})

describe('NoteEditorPage — the camera "Scan" door (wave 7 G5)', () => {
  it('is a toolbar button that opens a rear-camera image picker', async () => {
    const { root } = await mountEditorInPane('main', 'n1')
    const scan = within(root).getByRole('button', { name: 'Scan a document with the camera' })
    expect(scan.textContent).toContain('Scan')
    const input = within(root).getByLabelText('Scan a document with the camera — photo')
    expect(input.getAttribute('type')).toBe('file')
    expect(input.getAttribute('accept')).toBe('image/*')
    expect(input.getAttribute('capture')).toBe('environment')
    const click = vi.spyOn(input, 'click')
    fireEvent.click(scan)
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('a photo goes through the SAME image upload as Insert image', async () => {
    fetchMock.mockImplementation((url) => (String(url).endsWith('/images')
      ? Promise.resolve({ ok: true, json: () => Promise.resolve({ url: '/api/j2/notes/n1/images/a.jpg' }) })
      : Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
    const { root, editor } = await mountEditorInPane('main', 'n1')
    const input = within(root).getByLabelText('Scan a document with the camera — photo')
    fireEvent.change(input, { target: { files: [new File(['x'], 'page.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, o]) =>
      String(u) === '/api/j2/notes/n1/images' && o?.method === 'POST')).toBe(true))
    await waitFor(() => {
      let img = false
      editor.state.doc.descendants((n) => { if (n.type.name === 'image') img = true })
      expect(img).toBe(true)
    })
  })

  // Review M-4 (fix round 1): a photo that never reached the server says
  // THAT, in a sentence -- never the browser's own words -- and says the note
  // is unchanged exactly once.
  it.each([
    ['Chrome', 'Failed to fetch'],
    ['Safari', 'Load failed'],
    ['Firefox', 'NetworkError when attempting to fetch resource.'],
  ])('a photo upload that never reaches the server (%s) says so, not the browser\'s words', async (_b, words) => {
    fetchMock.mockImplementation((url) => (String(url).endsWith('/images')
      ? Promise.reject(new TypeError(words))
      : Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
    const { root } = await mountEditorInPane('main', 'n1')
    const input = within(root).getByLabelText('Scan a document with the camera — photo')
    fireEvent.change(input, { target: { files: [new File(['x'], 'page.jpg', { type: 'image/jpeg' })] } })
    const toast = await screen.findByText(/Couldn't upload page\.jpg/)
    expect(toast.textContent).toMatch(/Couldn't reach the server/)
    expect(toast.textContent).not.toContain(words)
    expect(toast.textContent.match(/unchanged/g)).toHaveLength(1)
  })

  it('a refused photo (a phone\'s HEIC) says the SERVER\'s sentence in the toast', async () => {
    fetchMock.mockImplementation((url) => (String(url).endsWith('/images')
      ? Promise.resolve({ ok: false, status: 400,
          json: () => Promise.resolve({ detail: 'Only PNG/JPG/GIF/WebP images allowed' }) })
      : Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
    const { root } = await mountEditorInPane('main', 'n1')
    // ⛔ the empty control first: no toast before the pick
    expect(screen.queryByText(/Couldn't upload/)).toBeNull()
    const input = within(root).getByLabelText('Scan a document with the camera — photo')
    fireEvent.change(input, { target: { files: [new File(['x'], 'IMG_0001.HEIC', { type: 'image/heic' })] } })
    const toast = await screen.findByText(/Couldn't upload IMG_0001\.HEIC/)
    expect(toast.textContent).toContain('Only PNG/JPG/GIF/WebP images allowed.')
    expect(toast.textContent).toContain('Your note is unchanged.')
    // Review M-10 (fix round 1): refused BEFORE the upload -- a phone never
    // ships the megabytes only to be told no.
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/images'))).toBe(false)
  })

  it('a photo over the 5 MB limit is refused before the upload, in the server\'s words', async () => {
    const { root } = await mountEditorInPane('main', 'n1')
    const input = within(root).getByLabelText('Scan a document with the camera — photo')
    const big = new File(['x'], 'huge.jpg', { type: 'image/jpeg' })
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 })
    fireEvent.change(input, { target: { files: [big] } })
    const toast = await screen.findByText(/Couldn't upload huge\.jpg/)
    expect(toast.textContent).toContain('Image must be < 5 MB.')
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/images'))).toBe(false)
  })

  it('CONTROL: a photo with NO type is left to the server, which reads the bytes', async () => {
    fetchMock.mockImplementation((url) => (String(url).endsWith('/images')
      ? Promise.resolve({ ok: true, json: () => Promise.resolve({ url: '/api/j2/notes/n1/images/a.jpg' }) })
      : Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
    const { root } = await mountEditorInPane('main', 'n1')
    const input = within(root).getByLabelText('Scan a document with the camera — photo')
    fireEvent.change(input, { target: { files: [new File(['x'], 'page', { type: '' })] } })
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/images'))).toBe(true))
  })
})
