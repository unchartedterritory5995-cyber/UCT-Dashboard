// app/src/pages/journal-2-0/components/notebook/FolderSidebar.folderActions.test.jsx
//
// Wave 8, lane 8A, A2 — a folder row's own actions are SIBLING buttons.
//
// ⛔ Rename / Add subfolder / Delete used to be clickable <span>s nested INSIDE
// the row <button>: invalid HTML, three controls no keyboard could reach (a
// span is not focusable), a Delete with no accessible name at all, and — the
// axe finding — a button's name that swallowed every nested label. They are
// real buttons beside the row now. This file pins: nothing interactive inside
// the row button; each action is a button, reachable by Tab, named for THIS
// folder; Delete asks before it deletes and never selects the folder; the
// double-click rename and the visible Rename door both still work; and the
// `extraFolderActions` extension point (the wave-9 folder-publish door, ruling
// D-B8) renders with the same idiom and hands its action the folder.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { installFetch, latchWave8Flags, Providers, NOTES } from '../../a11y/fixtures'
import { expectNoAxeViolations } from '../../a11y/axeHarness'
import FolderSidebar from './FolderSidebar'

function renderSidebar(props = {}) {
  const onSelectFolder = vi.fn()
  render(
    <Providers>
      <FolderSidebar notes={NOTES} notesTotal={NOTES.length} activeFolderId={null}
        onSelectFolder={onSelectFolder} activeTag={null} onSelectTag={() => {}} {...props} />
    </Providers>,
  )
  return { onSelectFolder }
}

const folderRowButton = async (name) => (await screen.findAllByText(name))[0].closest('button')

beforeEach(() => { installFetch(); latchWave8Flags(true) })

describe('a folder row\'s actions are sibling buttons', () => {
  it('the row button holds NO control of its own (nothing nested inside a button)', async () => {
    renderSidebar()
    const row = await folderRowButton('Theses')
    expect(row.querySelectorAll('button, [role="button"], [tabindex], [title]')).toHaveLength(0)
    expect(row.textContent).toBe('Theses')
  })

  it('each action is a real button, reachable by Tab, named for THIS folder', async () => {
    renderSidebar()
    await folderRowButton('Theses')
    for (const name of ['Rename Theses', 'Add subfolder to Theses', 'Delete Theses']) {
      const btn = screen.getByRole('button', { name })
      expect(btn.tagName).toBe('BUTTON')
      expect(btn.getAttribute('type')).toBe('button')
      expect(btn.tabIndex).toBe(0)
      // a sibling of the row button, inside the same row wrapper
      expect(btn.closest('button')).toBe(btn)
    }
  })

  it('Delete asks first, and pressing it never selects the folder', async () => {
    const { onSelectFolder } = renderSidebar()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Plans' }))
    expect(screen.getByText('Delete folder "Plans"?')).toBeInTheDocument()
    expect(onSelectFolder).not.toHaveBeenCalled()
  })

  it('the visible Rename door and the double-click on the row both open the rename field', async () => {
    renderSidebar()
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Theses' }))
    expect(screen.getByRole('textbox', { name: 'Rename folder Theses' })).toHaveValue('Theses')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Rename folder Theses' }), { key: 'Escape' })
    fireEvent.doubleClick(await folderRowButton('Plans'))
    expect(screen.getByRole('textbox', { name: 'Rename folder Plans' })).toHaveValue('Plans')
  })

  it('Add subfolder opens the named field under that folder', async () => {
    renderSidebar()
    fireEvent.click(await screen.findByRole('button', { name: 'Add subfolder to Theses' }))
    expect(screen.getByRole('textbox', { name: 'New subfolder in Theses' })).toBeInTheDocument()
  })

  it('axe finds no violation in the tree (the nested-control finding is closed)', async () => {
    renderSidebar()
    await folderRowButton('Theses')
    await expectNoAxeViolations(document.body)
  })
})

describe('extraFolderActions — the wave-9 door', () => {
  it('renders nothing extra when no action is passed (wave 8 passes none)', async () => {
    renderSidebar()
    await folderRowButton('Theses')
    expect(screen.queryByRole('button', { name: /Publish/ })).toBeNull()
  })

  it('renders each action as a sibling button named for the folder, and hands it the folder', async () => {
    const onSelect = vi.fn()
    renderSidebar({ extraFolderActions: [{ id: 'publish', label: 'Publish', onSelect }] })
    const btn = await screen.findByRole('button', { name: 'Publish Theses' })
    expect(btn.textContent).toBe('Publish')
    // the same idiom as the built-in actions: beside the row, not inside it
    const row = await folderRowButton('Theses')
    expect(within(row).queryByRole('button', { name: 'Publish Theses' })).toBeNull()
    fireEvent.click(btn)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 'f1', name: 'Theses' })
  })

  it('reaches nested folders too', async () => {
    const onSelect = vi.fn()
    renderSidebar({ extraFolderActions: [{ id: 'publish', label: 'Publish', onSelect }] })
    fireEvent.click(await screen.findByRole('button', { name: 'Expand Plans' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish Archive 2025' }))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'f3' })))
  })
})

describe('the selected row is SAID, not only painted (wave 8, lane 8A)', () => {
  it('the active folder carries aria-current, and no other folder or All notes does', async () => {
    renderSidebar({ activeFolderId: 'f1' })
    const theses = await folderRowButton('Theses')
    expect(theses).toHaveAttribute('aria-current', 'true')
    expect(await folderRowButton('Plans')).not.toHaveAttribute('aria-current')
    const allNotes = (await screen.findByText('All notes')).closest('button')
    expect(allNotes).not.toHaveAttribute('aria-current')
  })

  it('with no folder, tag or home selected, All notes is the current row', async () => {
    renderSidebar({ activeFolderId: null, isHome: false })
    const allNotes = (await screen.findByText('All notes')).closest('button')
    expect(allNotes).toHaveAttribute('aria-current', 'true')
    expect(await folderRowButton('Theses')).not.toHaveAttribute('aria-current')
  })
})
