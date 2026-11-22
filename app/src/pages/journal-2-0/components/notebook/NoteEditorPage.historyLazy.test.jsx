// Tier 1a bytes (perf-budgets.md): version history (with the AI change-set history and lib/aiActions it pulls in) is
// fetched on its FIRST open from More, never when a note opens. Its own file: the module registry is per FILE, so the
// factory counter below starts at 0 here.
const historyLoads = vi.hoisted(() => ({ factoryRuns: 0 }))
vi.mock('./NoteHistoryPanel', () => {
  historyLoads.factoryRuns += 1
  return { default: ({ open }) => (open ? <div role="dialog" aria-label="Version history panel" /> : null) }
})
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const H = (t) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] })
let NOTE
const baseNote = () => ({
  id: 'n1', title: 'Swing plan', subtitle: '', folderId: null, ticker: null, tags: [],
  heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [H('Setup'), P('First body line.')] },
})
const AUTH = { user: { id: 'u1' }, isPaid: true }
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => AUTH }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({
  default: () => ({ folders: [{ id: 'f1', name: 'Semis' }] }),
}))
vi.mock('../VoiceInputButton', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => null) }
})
// The outbox: the real hook, with `unsynced` / `persisted` forced when a test says so.
const { DURABLE } = vi.hoisted(() => ({ DURABLE: { override: null } }))
vi.mock('../../lib/offline/useDurableNote', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, useDurableNote: (...args) => ({ ...real.useDurableNote(...args), ...(DURABLE.override || {}) }) }
})

let onLine
beforeEach(() => {
  NOTE = baseNote()
  DURABLE.override = null
  onLine = true
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => onLine })
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_writing_help_enabled: true, j2_share_links_enabled: true })
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch, updatedAt: '2026-01-03T00:00:00Z' }))
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => {
  __resetNotebookFlags()
  vi.clearAllMocks()
  onLine = true
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  await waitFor(() => {
    if (!document.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted')
  })
}

describe('version history loads on its first open', () => {
  it('opening a note fetches nothing; History fetches it once and stays mounted', async () => {
    await renderEditor()
    await new Promise((r) => setTimeout(r, 20))
    expect(historyLoads.factoryRuns).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'More note actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Version history' }))
    expect(await screen.findByRole('dialog', { name: 'Version history panel' })).toBeTruthy()
    expect(historyLoads.factoryRuns).toBe(1)
  })
})
