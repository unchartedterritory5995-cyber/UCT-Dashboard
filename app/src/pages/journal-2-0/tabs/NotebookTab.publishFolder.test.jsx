// Wave 9 lane 9D (D2) — the folder Publish door, WIRED: the real NotebookTab, the real
// FolderSidebar (its wave-8 `extraFolderActions` extension point, not edited — ruling D-9D3)
// and the real PublishFolderSheet, with only the network faked (a11y/fixtures.jsx).
//
// ⛔ THE GATE IS RAILED ON THE RENDERED DOM, not on state: "flag off ⇒ absent" means no
// button a member could press is in the document — whatever a prop or a hook says.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH, FOLDERS, installFetch, latchWave8Flags, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { publishedUrl } from '../lib/notePublishLink'
import NotebookTab from './NotebookTab'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const PUBLIC = 'A published page can be read by anyone with its address, without signing in. Search engines are asked not to index it.'
const SCOPE = 'Publishes up to 500 notes in this folder and the folders inside it. A note added later appears when you update the page in Settings.'

let fetchSpy
let livePubs = []
beforeEach(() => {
  livePubs = []
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true })
  fetchSpy = installFetch([
    [/^\/api\/j2\/publish$/, () => ({ publications: livePubs, shares: [] })],
    [/^\/api\/j2\/publish\/folders\/f1$/, { publication: { slug: 'slugT', kind: 'folder', targetId: 'f1', path: '/p/slugT', memberCount: 1, memberCap: 500 } }],
  ])
})
afterEach(() => {
  cleanup()
  __resetNotebookFlags()
})

async function renderTab(auth = AUTH, route = '/journal/notebook') {
  render(<Providers auth={auth} route={route}><NotebookTab /></Providers>)
  // the folder tree is real: it must show the fixture folders before anything is judged absent
  await screen.findAllByText('Theses')
  await screen.findAllByText('Plans')
  await settle()
}

/** Every button in the document whose name starts "Publish " — the door, wherever it is. */
const publishDoors = () => screen.queryAllByRole('button', { name: /^Publish / })
const publishCalls = () => fetchSpy.mock.calls.filter(([u, o]) => String(u).startsWith('/api/j2/publish/') && o?.method === 'POST')

describe('who sees the door (rendered DOM)', () => {
  it('nobody, while no flag has latched (a tab that has not heard from the server reads as off)', async () => {
    __resetNotebookFlags()
    await renderTab()
    expect(publishDoors()).toEqual([])
  })

  it('nobody, while the publish gate is latched OFF — even with every other wave-8 flag on', async () => {
    latchWave8Flags(true, { notebook_publish_enabled: false })
    await renderTab()
    expect(publishDoors()).toEqual([])
    // non-vacuity: the folder row's own actions ARE rendered — the door is absent, not the row
    expect(screen.getByRole('button', { name: 'Rename Theses' })).toBeInTheDocument()
  })

  it('not a free member, even with the gate on (the server would only answer 402)', async () => {
    latchWave8Flags(true)
    await renderTab({ ...AUTH, isPaid: false, plan: 'free' })
    expect(publishDoors()).toEqual([])
  })

  it('a paid member with the gate on: one Publish action per folder row, named for its folder', async () => {
    latchWave8Flags(true)
    await renderTab()
    const theses = screen.getByRole('button', { name: 'Publish Theses' })
    expect(theses.tagName).toBe('BUTTON')
    expect(theses).toHaveAttribute('type', 'button')
    expect(theses).toHaveTextContent('Publish')
    expect(screen.getByRole('button', { name: 'Publish Plans' })).toBeInTheDocument()
    // non-vacuity: every name is a real fixture folder, and nothing is fetched until it is pressed
    for (const b of publishDoors()) expect(FOLDERS.map((f) => `Publish ${f.name}`)).toContain(b.getAttribute('aria-label'))
    expect(fetchSpy.mock.calls.some(([u]) => String(u).startsWith('/api/j2/publish'))).toBe(false)
  })
})

describe('selecting it opens the confirmation, never a publish (ruling D-9D1)', () => {
  it('confirm, publish once, see the address — and focus goes back to the folder\'s action on close', async () => {
    latchWave8Flags(true)
    await renderTab()
    const action = screen.getByRole('button', { name: 'Publish Theses' })
    action.focus()
    fireEvent.click(action)
    const dialog = await screen.findByRole('dialog', { name: 'Publish folder "Theses"' })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeInTheDocument())
    expect(dialog).toHaveTextContent(PUBLIC)
    expect(dialog).toHaveTextContent(SCOPE)
    expect(publishCalls()).toEqual([])                       // opening it sent nothing

    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    expect(await within(dialog).findByText('Published "Theses". Page link copied.')).toBeInTheDocument()
    expect(publishCalls()).toHaveLength(1)
    expect(publishCalls()[0][0]).toBe('/api/j2/publish/folders/f1')
    expect(within(dialog).getByRole('textbox', { name: 'Published folder address, Theses' })).toHaveValue(publishedUrl('slugT'))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Publish Theses' }))
  })

  it('keyboard only: Tab reaches the action, Enter opens it, Escape closes it and returns focus there', async () => {
    const user = userEvent.setup()
    latchWave8Flags(true)
    await renderTab()
    const action = screen.getByRole('button', { name: 'Publish Theses' })
    // the control just before it in the row; one Tab lands on the action itself
    screen.getByRole('button', { name: 'Delete Theses' }).focus()
    await user.tab()
    expect(document.activeElement).toBe(action)
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Publish folder "Theses"' })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeInTheDocument())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(action)
    expect(publishCalls()).toEqual([])
  })

  // ⚰️ The sheet was first mounted inside the list branch of the pane, so on the home page and
  // beside an open note — where the folder tree is just as visible — the action was a DEAD
  // button. Found by this rail's first run; every screen the sidebar shows is covered.
  it.each([
    ['the home page', '/journal/notebook'],
    ['the notes list', '/journal/notebook?view=all'],
    ['an open note', '/journal/notebook?note=n1'],
  ])('it opens from %s', async (_label, route) => {
    latchWave8Flags(true)
    await renderTab(AUTH, route)
    fireEvent.click(screen.getByRole('button', { name: 'Publish Plans' }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish folder "Plans"' })
    expect(await within(dialog).findByRole('button', { name: 'Publish' })).toBeInTheDocument()
  })

  it('a folder with a live page shows its address instead of a second publish', async () => {
    livePubs = [{ slug: 'slugLive', kind: 'folder', targetId: 'f1', state: 'active' }]
    latchWave8Flags(true)
    await renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Publish Theses' }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish folder "Theses"' })
    expect(await within(dialog).findByRole('textbox', { name: 'Published folder address, Theses' }))
      .toHaveValue(publishedUrl('slugLive'))
    expect(within(dialog).queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(publishCalls()).toEqual([])
  })
})
