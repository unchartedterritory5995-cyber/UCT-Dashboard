// app/src/pages/journal-2-0/a11y/publishFolder.a11y.test.jsx
//
// Wave 9, lane 9D: the two wave-8 hand-offs through 8A's axe harness (the ONE way a Notebook
// rail asks axe-core; frozen exclusions, ruling D-A5).
//   · D2 — the sidebar's Publish-folder confirmation (PublishFolderSheet.jsx), in each state a
//     member reaches: the confirmation, the page just published, and a folder already live.
//   · D1 — the bulk bar with its Export panel OPEN (the closed bar is `bulk-action-bar`, in
//     dialogs.a11y.test.jsx; the four format buttons exist only once the panel opens).
// Each recipe proves the state it is about rendered before axe runs, so an empty or wrong screen
// can never pass as a clean one. Lives in a11y/ because that is where the coverage rail reads
// registered ids from (surfaceCoverage.test.js).
import { describe, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import PublishFolderSheet from '../components/notebook/PublishFolderSheet'
import BulkActionBar from '../components/notebook/BulkActionBar'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const FOLDER = { id: 'f1', name: 'Theses' }
let livePubs = []

describe('lane 9D surfaces', () => {
  beforeEach(() => {
    livePubs = []
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true })
    installFetch([
      [/^\/api\/j2\/publish$/, () => ({ publications: livePubs, shares: [] })],
      [/^\/api\/j2\/publish\/folders\/f1$/, { publication: { slug: 'slugT', kind: 'folder', targetId: 'f1', path: '/p/slugT' } }],
    ])
  })

  const sheet = () => render(<Providers><PublishFolderSheet open folder={FOLDER} onClose={() => {}} /></Providers>)

  axeSurface('publish-folder-sheet', async () => {
    sheet()
    const dialog = await screen.findByRole('dialog', { name: 'Publish folder "Theses"' })
    await within(dialog).findByRole('button', { name: 'Publish' })
    await settle()
  })

  axeSurface('publish-folder-sheet-published', async () => {
    sheet()
    const dialog = await screen.findByRole('dialog', { name: 'Publish folder "Theses"' })
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Publish' }))
    await within(dialog).findByRole('textbox', { name: 'Published folder address, Theses' })
    await settle()
  })

  axeSurface('publish-folder-sheet-live', async () => {
    livePubs = [{ slug: 'slugLive', kind: 'folder', targetId: 'f1', state: 'active' }]
    sheet()
    const dialog = await screen.findByRole('dialog', { name: 'Publish folder "Theses"' })
    await within(dialog).findByText('This folder is already published. Anyone with its address can read it.')
    await settle()
  })

  axeSurface('bulk-export-formats', async () => {
    render(
      <Providers>
        <BulkActionBar
          count={2} totalInView={3} allSelected={false} onSelectAll={() => {}} onClear={() => {}}
          selectedTags={['semis']} tagNodes={[{ path: 'semis', key: 'semis', own: 1, total: 1 }]}
          onMove={() => {}} onAddTag={() => {}} onRemoveTag={() => {}} onFavorite={() => {}}
          onUnfavorite={() => {}} onExport={vi.fn()} onTrash={() => {}} onRestore={() => {}}
          onArchive={() => {}} onUnarchive={() => {}}
        />
      </Providers>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export selected' }))
    const panel = screen.getByRole('group', { name: 'Export the selected notes as' })
    within(panel).getByRole('button', { name: 'Word (.docx)' })
    await settle()
  })
})
