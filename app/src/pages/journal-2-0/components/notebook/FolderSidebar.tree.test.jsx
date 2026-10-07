// Finish program, lane KEYS round 4. The folder panel is a tree, and a tree is ONE Tab stop.
//
// Every row, every arrow and every row action used to be its own Tab stop: with 30 folders a
// keyboard member pressed Tab about 120 times to get past the panel (Q2 and Q11 in
// docs/notebook/fin-clicks.md). The keys themselves are tested on the hook
// (lib/useTreeRoving.test.jsx). This file pins the PANEL: what is a row, what its name is,
// that nothing inside a row is a Tab stop, that a row's actions are reachable from the
// keyboard through one key, and that the pointer still does everything it did.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { installFetch, latchWave8Flags, Providers, NOTES } from '../../a11y/fixtures'
import { expectNoAxeViolations } from '../../a11y/axeHarness'
import FolderSidebar from './FolderSidebar'

vi.mock('../../../../hooks/useBreakpoint', async (orig) => ({ ...(await orig()), useIsTouch: () => false }))

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
const tree = () => screen.findByRole('tree', { name: 'Folders' })
const row = (name) => screen.getByRole('treeitem', { name })
const key = (k, opts = {}) => fireEvent.keyDown(document.activeElement, { key: k, ...opts })

beforeEach(() => { installFetch(); latchWave8Flags(true) })

describe('the folder panel is a tree', () => {
  it('the standing rows and every folder are rows of ONE tree, with their level', async () => {
    renderSidebar()
    const t = await tree()
    await waitFor(() => expect(within(t).getByRole('treeitem', { name: 'Theses' })).toBeTruthy())
    const names = within(t).getAllByRole('treeitem').map((el) => el.getAttribute('aria-label'))
    expect(names.slice(0, 4).map((n) => n.split(',')[0])).toEqual(['All notes', 'Unfiled', 'Archived', 'Trash'])
    expect(names).toContain('Theses')
    expect(names).toContain('Plans')
    expect(row('Theses').getAttribute('aria-level')).toBe('1')
  })

  it('exactly one row is a Tab stop, and no control inside the tree is', async () => {
    renderSidebar()
    const t = await tree()
    await waitFor(() => row('Theses'))
    const rows = within(t).getAllByRole('treeitem')
    expect(rows.filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1)
    const inner = [...t.querySelectorAll('button, a[href], input, select')]
    expect(inner.length).toBeGreaterThan(8)                 // NON-VACUITY: there are controls to check
    expect(inner.filter((el) => el.tabIndex >= 0)).toEqual([])
  })

  it('a folder that holds something says whether it is open, and Right opens it into a group', async () => {
    renderSidebar()
    await tree()
    await waitFor(() => row('Plans'))
    expect(row('Plans').getAttribute('aria-expanded')).toBe('false')
    row('Plans').focus()
    key('ArrowRight')
    await waitFor(() => expect(row('Plans').getAttribute('aria-expanded')).toBe('true'))
    const child = row('Archive 2025')
    expect(child.getAttribute('aria-level')).toBe('2')
    expect(child.closest('[role="group"]')).toBeTruthy()
    expect(child.closest('[role="group"]').closest('[role="treeitem"]')).toBe(row('Plans'))
    key('ArrowRight')
    expect(document.activeElement).toBe(child)
    key('ArrowLeft')
    expect(document.activeElement).toBe(row('Plans'))
  })

  it('Enter on a folder row selects that folder; the selected row says so', async () => {
    const { onSelectFolder } = renderSidebar()
    await tree()
    await waitFor(() => row('Theses'))
    row('Theses').focus()
    key('Enter')
    expect(onSelectFolder).toHaveBeenCalledWith('f1')
  })

  it('the selected folder is the row marked selected', async () => {
    renderSidebar({ activeFolderId: 'f2' })
    await tree()
    await waitFor(() => row('Plans'))
    expect(row('Plans').getAttribute('aria-selected')).toBe('true')
    expect(row('Theses').getAttribute('aria-selected')).not.toBe('true')
  })

  it('Shift+F10 on a folder opens its actions as a menu: every action the row offers, named', async () => {
    renderSidebar()
    await tree()
    await waitFor(() => row('Theses'))
    row('Theses').focus()
    key('F10', { shiftKey: true })
    const menu = await screen.findByRole('menu', { name: 'Theses' })
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(
      ['Rename', 'Add subfolder', 'Delete'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }))
    expect(screen.getByRole('textbox', { name: 'Rename folder Theses' })).toHaveValue('Theses')
  })

  it('the menu carries the extra actions too (the folder publish door)', async () => {
    const onSelect = vi.fn()
    renderSidebar({ extraFolderActions: [{ id: 'publish', label: 'Publish', icon: 'share', onSelect }] })
    await tree()
    await waitFor(() => row('Plans'))
    row('Plans').focus()
    key('ContextMenu')
    const menu = await screen.findByRole('menu', { name: 'Plans' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Publish' }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'f2', name: 'Plans' }))
  })

  it('a standing row (All notes) has no actions, so the key opens nothing', async () => {
    renderSidebar()
    const t = await tree()
    within(t).getAllByRole('treeitem')[0].focus()
    key('F10', { shiftKey: true })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('the pointer is unchanged: the same buttons, still clickable, still named', async () => {
    const { onSelectFolder } = renderSidebar()
    await tree()
    await waitFor(() => row('Theses'))
    fireEvent.click(screen.getByRole('button', { name: 'Expand Plans' }))
    await waitFor(() => row('Archive 2025'))
    fireEvent.click(screen.getAllByText('Theses')[0].closest('button'))
    expect(onSelectFolder).toHaveBeenCalledWith('f1')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Plans' }))
    expect(screen.getByText('Delete folder "Plans"?')).toBeInTheDocument()
  })

  it('"+ New folder" is outside the tree and is its own Tab stop', async () => {
    renderSidebar()
    const t = await tree()
    const add = screen.getByRole('button', { name: '+ New folder' })
    expect(t.contains(add)).toBe(false)
    expect(add.tabIndex).toBe(0)
  })

  it('the tree passes axe, closed and with a folder open', async () => {
    renderSidebar()
    const t = await tree()
    await waitFor(() => row('Plans'))
    await expectNoAxeViolations(t, { level: 'component' })
    fireEvent.click(screen.getByRole('button', { name: 'Expand Plans' }))
    await waitFor(() => row('Archive 2025'))
    await expectNoAxeViolations(t, { level: 'component' })
  })
})
