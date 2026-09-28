// app/src/pages/journal-2-0/a11y/deleteFocusFallback.test.jsx
//
// ⛔⛔ Wave 10 follow-up F7, Part C (F4's review, Important 1). A Delete confirmation never
// drops focus to <body>. ConfirmModal gives focus back to the control that opened it, but a
// folder delete and a saved-view delete take that control's own row with them, so focus fell
// to <body> -- a keyboard member was sent back to the top of the page (WCAG 2.4.3). Each caller
// now hands ConfirmModal a `fallbackFocus`: the neighbouring row, else a standing control.
//
// Rendered over the REAL FolderSidebar and the REAL NotebookTab (only the network faked, and
// the fake remembers the delete, so the row is really gone when the dialog closes). The
// position delete has its own file (tabs/OpenPositionsTab.deleteFocus.test.jsx).
//
// Each case asserts where focus LANDS, and first that the invoker is really gone -- a rail
// whose row survived the delete would pass by returning focus to the invoker.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installFetch, latchWave8Flags, Providers, NOTES, FOLDERS } from './fixtures'
import FolderSidebar from '../components/notebook/FolderSidebar'
import NotebookTab from '../tabs/NotebookTab'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

/** A faked network that REMEMBERS a delete: the DELETE itself (not the reading of its answer --
 *  a saved-view delete never reads it) removes the folder or view from later GETs. */
function installStatefulFetch({ views }) {
  const goneFolders = new Set()
  const goneViews = new Set()
  const inner = installFetch([
    [/^\/api\/j2\/note-folders\/[^/]+$/, { ok: true, moved: [] }],
    [/^\/api\/j2\/note-folders$/, () => ({ folders: FOLDERS.filter((f) => !goneFolders.has(f.id)) })],
    [/^\/api\/j2\/saved-views\/[^/]+$/, { ok: true }],
    [/^\/api\/j2\/saved-views$/, () => ({ savedViews: views.filter((v) => !goneViews.has(v.id)) })],
  ])
  global.fetch = vi.fn((input, opts) => {
    const path = String(typeof input === 'string' ? input : input?.url || '').split('?')[0]
    if (opts?.method === 'DELETE') {
      const id = decodeURIComponent(path.split('/').pop())
      if (path.startsWith('/api/j2/note-folders/')) goneFolders.add(id)
      if (path.startsWith('/api/j2/saved-views/')) goneViews.add(id)
    }
    return inner(input, opts)
  })
}

const TWO_VIEWS = [
  { id: 'v1', name: 'Active theses', viewType: 'list', spec: {} },
  { id: 'v2', name: 'Watching', viewType: 'list', spec: {} },
]

beforeEach(() => { latchWave8Flags(true) })

async function confirmDelete(user, openerName, dialogName) {
  const opener = await screen.findByRole('button', { name: openerName })
  await user.click(opener)
  const dialog = await screen.findByRole('dialog', { name: dialogName })
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  // the invoker went with its row -- otherwise this rail proves nothing
  await waitFor(() => expect(screen.queryByRole('button', { name: openerName })).toBeNull())
  await settle()
}

describe('folder delete (FolderSidebar) -- focus goes to the neighbouring folder', () => {
  function renderSidebar() {
    installStatefulFetch({ views: [] })
    render(
      <Providers>
        <FolderSidebar notes={NOTES} notesTotal={NOTES.length} activeFolderId={null}
          onSelectFolder={() => {}} activeTag={null} onSelectTag={() => {}} />
      </Providers>,
    )
  }

  it('deleting the first folder lands on the NEXT folder row, not <body>', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await screen.findAllByText('Theses')
    await confirmDelete(user, 'Delete Theses', 'Delete folder "Theses"?')
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement.getAttribute('data-folder-row')).toBe('f2')   // Plans
  })

  it('deleting the LAST folder lands on the one before it', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await screen.findAllByText('Plans')
    await confirmDelete(user, 'Delete Plans', 'Delete folder "Plans"?')
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement.getAttribute('data-folder-row')).toBe('f1')   // Theses
  })
})

describe('saved-view delete (NotebookTab) -- focus goes to the neighbouring view, else the heading', () => {
  async function renderTab(views) {
    installStatefulFetch({ views })
    render(<Providers route="/journal/notebook?view=all"><NotebookTab /></Providers>)
    await screen.findAllByText('Theses')
    await screen.findByTitle(views[0].name)
    await settle()
  }

  it('deleting a view lands on the NEXT view row, not <body>', async () => {
    const user = userEvent.setup()
    await renderTab(TWO_VIEWS)
    await confirmDelete(user, 'Delete Active theses', 'Delete view "Active theses"?')
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement.getAttribute('data-saved-view-row')).toBe('v2')
  })

  it('deleting the only view lands on the pane heading', async () => {
    const user = userEvent.setup()
    await renderTab([TWO_VIEWS[0]])
    await confirmDelete(user, 'Delete Active theses', 'Delete view "Active theses"?')
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement.tagName).toBe('H2')
    expect(document.getElementById('notebook-pane').contains(document.activeElement)).toBe(true)
  })
})
