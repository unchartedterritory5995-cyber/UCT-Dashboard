import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wave 7 Task 7.4 ("bytes first"): the template catalog (lib/notebookTemplates.js) leaves the Notebook's first open.
 * The empty notebook's inline picker is its own chunk and brings the catalog with it, so mounting an empty notebook
 * imports NOTHING of the catalog until the picker resolves; until then the skeleton holds the picker's box and the
 * tour's gallery-door anchor.
 *
 * Its own file on purpose: vitest isolates the module registry per file, so the import spy below starts at zero and
 * nothing has mounted the picker before this test, whatever the order, `-t` filter or shuffle. Same fixture as
 * NotebookTab.starterOffer.test.jsx (the real NotebookTab; only the network and the notes list are faked).
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
// The import spy: the factory runs the first time anything imports the catalog module, so its count says whether
// the catalog rode in with the page or arrived with the picker.
const { catalogSpy } = vi.hoisted(() => ({ catalogSpy: { loads: 0 } }))
vi.mock('../lib/notebookTemplates', async (importOriginal) => {
  catalogSpy.loads += 1
  return importOriginal()
})

import NotebookTab from './NotebookTab'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { setCurrentAccountId } from '../lib/offline/currentAccount'

const T = { timeout: 20000 }
vi.setConfig({ testTimeout: 40000 })

beforeEach(() => {
  setCurrentAccountId('acct-A')
  Element.prototype.scrollIntoView = vi.fn()
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => { setCurrentAccountId(null); __resetNotebookFlags() })

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
