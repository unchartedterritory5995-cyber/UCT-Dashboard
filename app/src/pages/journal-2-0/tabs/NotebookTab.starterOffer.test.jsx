import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Notebook P5 final fix, ruling P5-T10-R2: an EMPTY notebook holds "How do you trade?" on more than one surface
 * (its inline kind picker, the New note sheet's, the Styles manager), and the page must show ONE card. Through
 * the real NotebookTab, the real KindSection / StylesManager / StarterPackOffer, the real preferences hook; only
 * the network and the notes list are faked. The walk of record (tools/notebook_p5_walk.py) asserts the same
 * thing in a browser (`offers_on_page == 1`).
 */
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: [], isLoading: false, error: null, refresh: vi.fn(), mutate: vi.fn(),
    total: 0, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({ default: () => <div data-testid="folder-sidebar" /> }))
vi.mock('../components/notebook/NoteEditorPage', () => ({ default: () => <div data-testid="note-editor" /> }))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))
// Wave 7 Task 7.4: an import spy on the template catalog. The factory runs the first time anything imports the
// module, so its count says whether the catalog rode in with the page or arrived with the picker.
const { catalogSpy } = vi.hoisted(() => ({ catalogSpy: { loads: 0 } }))
vi.mock('../lib/notebookTemplates', async (importOriginal) => {
  catalogSpy.loads += 1
  return importOriginal()
})

import NotebookTab from './NotebookTab'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { setCurrentAccountId } from '../lib/offline/currentAccount'
import { contractBody } from '../__fixtures__/contract'
import { OFFER_TITLE } from '../components/notebook/styles/StarterPackOffer'

const EMPTY = contractBody('journal-styles.list.empty')           // built-ins only: the member has no styles
beforeAll(async () => { await import('../components/notebook/styles/StyleSurfaces') })
const T = { timeout: 20000 }
vi.setConfig({ testTimeout: 40000 })   // role queries over the whole Notebook are slow in jsdom; a wait, not a budget

beforeEach(() => {
  vi.clearAllMocks()
  setCurrentAccountId('acct-A')
  Element.prototype.scrollIntoView = vi.fn()
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (u === '/api/j2/journal-styles') return ok(EMPTY)
    if (u.startsWith('/api/j2/note-folders')) return ok({ folders: [] })
    if (u === '/api/j2/note-templates') return ok({ templates: [] })
    if (u.includes('mapping-offer')) return ok({ offer: null })
    return ok({})                                                   // preferences: nothing answered yet
  })
  latchNotebookFlags({ notebook_journal_styles_enabled: true, notebook_starter_packs_enabled: true })
})
afterEach(() => { setCurrentAccountId(null); __resetNotebookFlags() })

const offers = () => screen.queryAllByRole('region', { name: OFFER_TITLE })
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 100)) })

// Wave 7 Task 7.4: the empty notebook's inline picker is its own chunk, and the catalog it lists comes with it.
// ORDER-DEPENDENT BY DESIGN: this must be the file's first mount, before any test has resolved the picker.
describe('Task 7.4: the template catalog leaves the first open', () => {
  it('notebookTemplates_not_imported_on_empty_notebook_mount', async () => {
    expect(catalogSpy.loads, 'the catalog was imported with the page, before anything was mounted').toBe(0)
    render(<MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>)
    // the picker has not resolved yet: its skeleton holds the box (and the tour anchor), and no catalog
    expect(document.querySelector('[data-template-picker-skeleton] [data-tour="template-gallery-door"]')).not.toBeNull()
    expect(catalogSpy.loads).toBe(0)
    // ...and once it has, the catalog came with it (non-vacuity: the spy can count)
    await screen.findByText('Blank note', {}, T)
    expect(catalogSpy.loads).toBe(1)
  })
})

describe('the empty notebook shows ONE How do you trade? (P5-T10-R2)', () => {
  it('the page alone: the inline picker holds the one card (non-vacuity: the offer does show here)', async () => {
    render(<MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>)
    await screen.findByRole('region', { name: OFFER_TITLE }, T)
    await settle()
    expect(offers()).toHaveLength(1)
  })

  it('with the New note sheet open: one card, in the sheet, and one kind picker on the page', async () => {
    render(<MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>)
    await screen.findByRole('region', { name: OFFER_TITLE }, T)
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    const dialog = await screen.findByRole('dialog', {}, T)
    await waitFor(() => expect(offers().length).toBeGreaterThan(0), T)
    await settle()
    expect(offers()).toHaveLength(1)
    expect(dialog.contains(offers()[0])).toBe(true)
    expect(screen.getAllByRole('group', { name: 'Start from a kind of note' })).toHaveLength(1)
  })

  // Item 9: the Community library tour's step 1 waits for this door, and moves on when it is a NEW element
  // (b4Styles.emptyNotebook.test.jsx). So with the sheet open the page must hold ONE door, the sheet's.
  it('with the New note sheet open the page holds ONE gallery door, in the sheet, not the inline one', async () => {
    __resetNotebookFlags()                                                  // the latch is first-wins
    latchNotebookFlags({ notebook_journal_styles_enabled: true, notebook_starter_packs_enabled: true,
      notebook_template_gallery_enabled: true })
    render(<MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>)
    await screen.findByRole('region', { name: OFFER_TITLE }, T)
    const doors = () => [...document.querySelectorAll('[data-tour="template-gallery-door"]')]
    await waitFor(() => expect(doors()).toHaveLength(1), T)                 // non-vacuity: the inline door
    const inline = doors()[0]
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    const dialog = await screen.findByRole('dialog', {}, T)
    await waitFor(() => expect(doors().some((d) => dialog.contains(d))).toBe(true), T)
    expect(doors()).toHaveLength(1)
    expect(doors()[0]).not.toBe(inline)
  })

  it('with the Styles manager open over it: one card, in the manager', async () => {
    render(<MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>)
    await screen.findByRole('region', { name: OFFER_TITLE }, T)
    fireEvent.click(document.querySelector('[data-tour="styles-button"]'))
    const manager = await screen.findByRole('dialog', { name: 'Journal styles' }, T)
    await waitFor(() => expect(offers().some((o) => manager.contains(o))).toBe(true), T)
    await settle()
    expect(offers()).toHaveLength(1)
  })
})
