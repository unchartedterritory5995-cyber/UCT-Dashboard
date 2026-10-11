import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MQ } from '../../../../styles/breakpoints'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

// P0.6 (notebook discoverability): on a 390 px phone only two of the editor's fifteen controls
// were on screen after "Format", the mic was clipped, and the image / file / camera-scan /
// chart inserts were behind a sideways scroll. The phone row is now Undo, Redo, B, I, Format,
// "+" and the mic; the "+" opens a menu with the four inserts.
//
// WHAT THIS FILE CAN SAY. jsdom lays nothing out, so "the + is shown on a phone and hidden
// above it" is a CSS fact railed in NoteEditorPage.phoneToolbarCss.test.js. What a rendered
// test can hold, through a REAL NoteEditorPage, and does here: the menu lists exactly the four
// inserts, each one opens ITS door (the same ref/handler the desktop button uses), and the
// menu closes when the member leaves the phone tier.
//
// The matchMedia stub matches MQ.phone only, so the shared ContextPopover renders its ANCHORED
// branch (role="menu", items role="menuitem"), the same as the Block actions menu's tests. On
// a real phone it renders a bottom sheet whose rows are plain buttons, which no test here can
// reach without a second stub; the item labels and handlers are the same in both branches.

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
let NOTE
const baseNote = () => ({
  id: 'n1', title: 'Swing plan', subtitle: '', folderId: null, ticker: null, tags: [],
  heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [P('First body line.')] },
})
const AUTH = { user: { id: 'u1' }, isPaid: true }
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => AUTH }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../VoiceInputButton', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => null) }
})

let phone = false
const mqListeners = new Set()
let realMatchMedia
function installMatchMedia() {
  realMatchMedia = window.matchMedia
  window.matchMedia = vi.fn((query) => ({
    get matches() { return phone && query === MQ.phone },
    media: query,
    onchange: null,
    addEventListener: (_t, fn) => { if (query === MQ.phone) mqListeners.add(fn) },
    removeEventListener: (_t, fn) => { mqListeners.delete(fn) },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}
const setPhone = (v) => { phone = v }

beforeEach(() => {
  NOTE = baseNote()
  phone = false
  mqListeners.clear()
  installMatchMedia()
  __resetNotebookFlags()
  latchNotebookFlags({})
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => {
  window.matchMedia = realMatchMedia
  __resetNotebookFlags()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function mountEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  await waitFor(() => {
    if (!document.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted')
  })
}
const toolbar = () => screen.getByRole('toolbar', { name: 'Editor toolbar' })
const insertBtn = () => within(toolbar()).getByRole('button', { name: 'Insert' })

describe('P0.6: the phone "+" insert menu', () => {
  it('the phone "+" lists image, file, camera scan and chart/block, and each opens its door', async () => {
    setPhone(true)
    await mountEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    const names = screen.getAllByRole('menuitem').map((m) => m.textContent.trim())
    expect(names).toEqual(['Image', 'Attach a file', 'Scan with camera', 'Chart or block'])
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scan with camera' }))
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  }, 60000)

  it('each file door clicks ITS OWN input (image -> a gallery input, file -> the attach input, camera -> a capture input)', async () => {
    setPhone(true)
    await mountEditor()
    const clicked = []
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function () {
      clicked.push({ accept: this.accept || '', capture: this.getAttribute('capture') })
    })
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Insert' }))

    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Image' }))
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Attach a file' }))
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scan with camera' }))

    expect(clicked).toHaveLength(3)
    expect(clicked[0].capture, 'the image door is the gallery, not the camera').toBeNull()
    expect(clicked[2].capture, 'the scan door opens the camera').not.toBeNull()
    // three DIFFERENT inputs, not one door three times
    expect(new Set(clicked.map((c) => `${c.accept}|${c.capture}`)).size).toBe(3)
  }, 60000)

  it('Chart or block opens the widget palette', async () => {
    setPhone(true)
    await mountEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chart or block' }))
    expect(await screen.findByRole('dialog', { name: 'Insert widget' })).toBeTruthy()
  }, 60000)

  it('the "+" is a menu button: collapsed it says so, open it says so, and a pick closes the menu', async () => {
    setPhone(true)
    await mountEditor()
    const btn = insertBtn()
    expect(btn).toHaveAttribute('aria-haspopup', 'menu')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toBeTruthy()
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('menuitem', { name: 'Image' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(btn).toHaveAttribute('aria-expanded', 'false')
  }, 60000)

  it('leaving the phone tier closes an open menu (the "+" does not exist above 640 px)', async () => {
    setPhone(true)
    await mountEditor()
    fireEvent.click(insertBtn())
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(mqListeners.size, 'non-vacuity: something listens on the canonical phone query').toBeGreaterThan(0)
    phone = false
    act(() => { for (const fn of [...mqListeners]) fn({ matches: false, media: MQ.phone }) })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(insertBtn()).toHaveAttribute('aria-expanded', 'false')
  }, 60000)

  it('CONTROL: the "+" is a toolbar button carrying the phone-only class', async () => {
    setPhone(true)
    await mountEditor()
    const btn = insertBtn()
    expect(btn.className).toMatch(/insertPhone/)
    expect(btn.className).toMatch(/toolBtn/)
  }, 60000)
})
