// Wave 8 lane 8B, B3/B4 — the editor's Share door (NoteShareControls.jsx).
//
// ⛔ WHO SEES IT: a paid member while a gate is on — never an admin by role (finding
// F-ADMIN-GATE), never a free member, never a tab whose flags have not latched.
// ⛔ COPY CONTRACT: every sentence a member reads — the popover's own lines and every
// confirmation — is asserted as RENDERED TEXT after the action settles (CLAUDE.md, "Assert
// user-facing feedback by RENDERED TEXT"), and the same sentence reaches the editor's
// message line through `onMessage`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NoteShareControls from './NoteShareControls'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { sharedNoteUrl } from '../../lib/noteShareLink'
import { publishedUrl } from '../../lib/notePublishLink'

const AUTH = vi.hoisted(() => ({ value: { isPaid: true, user: { id: 'u1', role: 'member' } } }))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => AUTH.value }))

const NOTE = 'n1'
const S = { share: null, pubs: [], calls: [], shareStatus: 200 }
const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) })

beforeEach(() => {
  AUTH.value = { isPaid: true, user: { id: 'u1', role: 'member' } }
  S.share = null
  S.pubs = []
  S.calls = []
  S.shareStatus = 200
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true,
  })
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    S.calls.push({ method, url: String(url), body })
    const u = String(url)
    if (u === `/api/j2/notes/${NOTE}/share`) {
      if (method === 'GET') return json(200, { share: S.share })
      if (method === 'POST') {
        if (S.shareStatus !== 200) return json(S.shareStatus, { detail: 'Share links require a paid plan' })
        S.share = { token: 'tokABC', createdAt: '2026-09-25T00:00:00Z',
          expiresAt: body?.expiresInDays ? '2026-10-25T12:00:00Z' : null }
        return json(200, { share: S.share })
      }
      if (method === 'DELETE') { S.share = null; return json(200, { revoked: true }) }
    }
    if (u === `/api/j2/publish?note_id=${NOTE}`) {
      return json(200, { publications: S.pubs, shares: [],
        note: { noteId: NOTE, exists: true, folderId: 'f1', folderName: 'Weekly plans' } })
    }
    if (u === `/api/j2/publish/notes/${NOTE}` && method === 'POST') {
      return json(200, { publication: { slug: 'slugN', kind: 'note', targetId: NOTE, path: '/p/slugN' } })
    }
    if (u === '/api/j2/publish/folders/f1' && method === 'POST') {
      return json(200, { publication: { slug: 'slugF', kind: 'folder', targetId: 'f1', path: '/p/slugF',
        memberCount: 3, memberCap: 500 } })
    }
    if (u.startsWith('/api/j2/publish/') && method === 'DELETE') return json(200, { revoked: true })
    return json(404, { detail: 'Not found' })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  __resetNotebookFlags()
})

function mount(flags, onMessage = vi.fn()) {
  if (flags) latchNotebookFlags(flags)
  const r = render(<NoteShareControls noteId={NOTE} onMessage={onMessage} />)
  return { ...r, onMessage }
}

async function openDoor() {
  fireEvent.click(screen.getByRole('button', { name: /share/i }))
  const dialog = await screen.findByRole('dialog', { name: 'Share this note' })
  await waitFor(() => expect(within(dialog).queryByText('Loading…')).toBeNull())
  return dialog
}

const statusText = (dialog) => within(dialog).getAllByRole('status').map((n) => n.textContent).join(' ')

describe('who sees the door', () => {
  it('nobody, while no flag has latched (the payload has not arrived)', () => {
    const { container } = mount(null)
    expect(container).toBeEmptyDOMElement()
  })

  it('not a free member, even with both gates on', () => {
    AUTH.value = { isPaid: false, user: { id: 'u1', role: 'member' } }
    const { container } = mount({ j2_share_links_enabled: true, notebook_publish_enabled: true })
    expect(container).toBeEmptyDOMElement()
  })

  it('not an admin while both gates are off (the admin special case is gone)', () => {
    AUTH.value = { isPaid: true, user: { id: 'u1', role: 'admin' } }
    const { container } = mount({ j2_share_links_enabled: false, notebook_publish_enabled: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('a paid member with a gate on sees Share, and nothing is fetched until it opens', () => {
    mount({ j2_share_links_enabled: true })
    expect(screen.getByRole('button', { name: /share/i })).toHaveAttribute('aria-haspopup', 'dialog')
    expect(S.calls).toEqual([])
  })
})

describe('share links', () => {
  it('the closed state says what a link does and offers the four expiries', async () => {
    mount({ j2_share_links_enabled: true, notebook_publish_enabled: false })
    const dialog = await openDoor()
    expect(within(dialog).getByRole('heading', { name: 'Share link' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent(
      'Anyone with the link can read this note without signing in. Market data such as charts is not shown.')
    const select = within(dialog).getByLabelText('Link stops working')
    expect([...select.options].map((o) => o.textContent)).toEqual(
      ['Never', 'After 7 days', 'After 30 days', 'After 90 days'])
    expect(within(dialog).queryByRole('heading', { name: 'Publish to the web' })).toBeNull()
  })

  it('Create link sends the chosen expiry, copies the address and says so', async () => {
    const { onMessage } = mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    fireEvent.change(within(dialog).getByLabelText('Link stops working'), { target: { value: '30' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }))
    await within(dialog).findByText('Share link created and copied.')
    expect(S.calls.find((c) => c.method === 'POST').body).toEqual({ expiresInDays: 30 })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(sharedNoteUrl('tokABC'))
    expect(onMessage).toHaveBeenCalledWith('Share link created and copied.')
    expect(within(dialog).getByLabelText('Share link address')).toHaveValue(sharedNoteUrl('tokABC'))
    expect(dialog).toHaveTextContent('It stops working on Oct 25, 2026.')
    const revoke = within(dialog).getByRole('button', { name: 'Revoke link' })
    expect(revoke).toHaveAccessibleDescription('It stops working immediately.')
  })

  it('a link with no expiry says it never expires; Copy link copies it again', async () => {
    S.share = { token: 'tokOLD', createdAt: '2026-09-01T00:00:00Z', expiresAt: null }
    const { onMessage } = mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    expect(dialog).toHaveTextContent('It never expires.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }))
    await within(dialog).findByText('Share link copied.')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(sharedNoteUrl('tokOLD'))
    expect(onMessage).toHaveBeenCalledWith('Share link copied.')
  })

  it('Revoke link revokes and says the link no longer works', async () => {
    S.share = { token: 'tokOLD', createdAt: '2026-09-01T00:00:00Z', expiresAt: null }
    const { onMessage } = mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke link' }))
    await within(dialog).findByText('Link revoked. It no longer works.')
    expect(S.calls.some((c) => c.method === 'DELETE' && c.url === `/api/j2/notes/${NOTE}/share`)).toBe(true)
    expect(onMessage).toHaveBeenCalledWith('Link revoked. It no longer works.')
    expect(within(dialog).getByRole('button', { name: 'Create link' })).toBeInTheDocument()
  })

  it("a refusal shows the server's own sentence", async () => {
    S.shareStatus = 402
    mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }))
    await waitFor(() => expect(statusText(dialog)).toContain('Share links require a paid plan'))
  })
})

describe('publish to the web', () => {
  it('offers this note and its folder by name, and states the folder cap', async () => {
    mount({ j2_share_links_enabled: false, notebook_publish_enabled: true })
    const dialog = await openDoor()
    expect(within(dialog).getByRole('heading', { name: 'Publish to the web' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent(
      'A published page can be read by anyone with its address, without signing in. Search engines are asked not to index it.')
    expect(within(dialog).getByRole('button', { name: 'Publish this note' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Publish folder "Weekly plans"' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent(
      'Publishes up to 500 notes in this folder and the folders inside it. A note added later appears when you update the page in Settings.')
    expect(within(dialog).queryByRole('heading', { name: 'Share link' })).toBeNull()
  })

  it('Publish this note publishes, copies the page link and says so; Unpublish takes it down', async () => {
    const { onMessage } = mount({ notebook_publish_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish this note' }))
    await within(dialog).findByText('Published. Page link copied.')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(publishedUrl('slugN'))
    expect(onMessage).toHaveBeenCalledWith('Published. Page link copied.')
    expect(within(dialog).getByLabelText('Published page address')).toHaveValue(publishedUrl('slugN'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unpublish' }))
    await within(dialog).findByText('Unpublished. The page no longer works.')
    expect(S.calls.some((c) => c.method === 'DELETE' && c.url === '/api/j2/publish/slugN')).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Publish this note' })).toBeInTheDocument()
  })

  it('Publish folder publishes the folder and says which', async () => {
    mount({ notebook_publish_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish folder "Weekly plans"' }))
    await within(dialog).findByText('Published "Weekly plans". Page link copied.')
    expect(S.calls.some((c) => c.method === 'POST' && c.url === '/api/j2/publish/folders/f1')).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Copy folder link' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Unpublish folder' })).toBeInTheDocument()
  })

  it('an existing live publication opens as published', async () => {
    S.pubs = [{ slug: 'slugN', kind: 'note', targetId: NOTE, state: 'active' },
      { slug: 'slugOld', kind: 'folder', targetId: 'f1', state: 'expired' }]
    mount({ notebook_publish_enabled: true })
    const dialog = await openDoor()
    expect(within(dialog).getByRole('button', { name: 'Copy page link' })).toBeInTheDocument()
    // an EXPIRED folder page is not live: the door offers to publish it again
    expect(within(dialog).getByRole('button', { name: 'Publish folder "Weekly plans"' })).toBeInTheDocument()
  })
})

describe('the 44px touch floor', () => {
  const css = readFileSync(join(process.cwd(),
    'src/pages/journal-2-0/components/notebook/NoteShareControls.module.css'), 'utf8')
  it('every control in the popover reaches var(--tap-min) on the touch tier (<=1024px)', () => {
    const touch = /@media \(max-width: 1024px\) \{([\s\S]*?)\n\}/.exec(css)
    expect(touch, 'no touch-tier block').not.toBeNull()
    for (const cls of ['.action', '.select', '.field']) {
      expect(touch[1]).toMatch(new RegExp(`\\${cls} \\{ min-height: var\\(--tap-min\\); \\}`))
    }
  })
})
