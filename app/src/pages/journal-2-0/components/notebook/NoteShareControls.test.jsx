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
const S = { share: null, pubs: [], calls: [], shareStatus: 200, publishable: undefined }
const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) })

beforeEach(() => {
  AUTH.value = { isPaid: true, user: { id: 'u1', role: 'member' } }
  S.share = null
  S.pubs = []
  S.calls = []
  S.shareStatus = 200
  S.publishable = undefined
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
        if (S.share) {                                   // the server's I1 rule: an existing link is returned, tightened
          S.share = { ...S.share, hidePnl: S.share.hidePnl === true || body?.hidePnl === true, reused: true }
          return json(200, { share: S.share })
        }
        S.share = { token: 'tokABC', createdAt: '2026-09-25T00:00:00Z',
          expiresAt: body?.expiresInDays ? '2026-10-25T12:00:00Z' : null, hidePnl: body?.hidePnl === true }
        return json(200, { share: S.share })
      }
      if (method === 'DELETE') { S.share = null; return json(200, { revoked: true }) }
    }
    if (u.startsWith(`/api/j2/notes/${NOTE}/share/preview`)) {
      return json(200, { note: { title: 'NVDA plan', bodyJson: { type: 'doc', content: [{ type: 'paragraph' }] } } })
    }
    if (u === `/api/j2/publish?note_id=${NOTE}`) {
      return json(200, { publications: S.pubs, shares: [],
        note: { noteId: NOTE, exists: true, folderId: 'f1', folderName: 'Weekly plans', folderNoteCount: 3,
          ...(S.publishable === undefined ? {} : { publishable: S.publishable }) } })
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
  const r = render(<NoteShareControls noteId={NOTE} noteTitle="NVDA plan" onMessage={onMessage} />)
  return { ...r, onMessage }
}

async function openDoor() {
  fireEvent.click(screen.getByRole('button', { name: /share/i }))
  // S19 (M5): the sheet names the note it shares.
  const dialog = await screen.findByRole('dialog', { name: 'Share "NVDA plan"' })
  await waitFor(() => expect(within(dialog).queryByText('Loading…')).toBeNull())
  return dialog
}

// S1: a publish press opens the confirm step; this presses its Publish button.
async function confirmPublish(name = 'Publish to the web?') {
  const confirmDialog = await screen.findByRole('dialog', { name })
  fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Publish' }))
  return confirmDialog
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
  it("S19 (M5): the closed state says what a link does, 7 days first and chosen, P&L hidden by default", async () => {
    mount({ j2_share_links_enabled: true, notebook_publish_enabled: false })
    const dialog = await openDoor()
    expect(within(dialog).getByRole('region', { name: 'Private link' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent("Anyone with the link can read this note. They don't need an account.")
    const group = within(dialog).getByRole('group', { name: 'Expires in' })
    expect(within(group).getAllByRole('radio').map((r) => r.closest('label').textContent)).toEqual(['7 days', '30 days', 'Never'])
    expect(within(group).getByRole('radio', { name: '7 days' })).toBeChecked()
    expect(within(dialog).getByRole('switch', { name: 'Hide P&L widgets and images' })).toBeChecked()
    // No "Show live charts": the server cannot honour it (charts are the neutral line), so it is never offered.
    expect(within(dialog).queryByText(/live charts/i)).toBeNull()
    expect(within(dialog).getByRole('button', { name: "Preview: see exactly what they'll see →" })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('tab')).toBeNull()                       // one capability, no tabs
    expect(within(dialog).queryByRole('region', { name: 'Publish to the web' })).toBeNull()
  })

  it('S19: with both on, "Private link" is the first tab and the default; "Publish to the web" is the second', async () => {
    mount({ j2_share_links_enabled: true, notebook_publish_enabled: true })
    const dialog = await openDoor()
    const tabs = within(dialog).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Private link', 'Publish to the web'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByRole('tabpanel', { name: 'Private link' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Publish this note' })).toBeNull()
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(within(dialog).getByRole('tab', { name: 'Publish to the web' })).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByRole('button', { name: 'Publish this note' })).toBeInTheDocument()
  })

  it('I2: the private tab says typed text is shared as written', async () => {
    mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    expect(dialog).toHaveTextContent('Text you typed is shared as written.')
  })

  it('I1: with Hide OFF, the success line says the link SHOWS P&L widgets and images', async () => {
    mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Hide P&L widgets and images' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link and copy' }))
    await within(dialog).findByText('Share link created and copied. P&L widgets you switched to share, and your images, are shown on this link.')
    expect(S.calls.find((c) => c.method === 'POST').body).toEqual({ expiresInDays: 7, hidePnl: false })
  })

  it('I1: an existing link that already hides is returned as it is, and the sheet says so (never "shown")', async () => {
    mount({ j2_share_links_enabled: true })
    S.share = null
    const dialog = await openDoor()
    S.share = { token: 'tokOLD', createdAt: '2026-09-01T00:00:00Z', expiresAt: null, hidePnl: true }  // another tab made it
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Hide P&L widgets and images' }))      // asks to SHOW
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link and copy' }))
    await within(dialog).findByText('Share link copied. P&L widgets and images are hidden on this link. This link already hides P&L. Make a new link to change it.')
    expect(within(dialog).getByLabelText('Share link address')).toHaveValue(sharedNoteUrl('tokOLD'))
  })

  it('I1: an existing link that SHOWS, asked to hide, comes back hidden (the server tightened it) and is said so', async () => {
    mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    S.share = { token: 'tokOLD', createdAt: '2026-09-01T00:00:00Z', expiresAt: null, hidePnl: false }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link and copy' }))
    await within(dialog).findByText('Share link copied. P&L widgets and images are hidden on this link.')
  })

  it('minor 11: an existing link that shows P&L says so plainly', async () => {
    S.share = { token: 'tokOLD', createdAt: '2026-09-01T00:00:00Z', expiresAt: null, hidePnl: false }
    mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    expect(dialog).toHaveTextContent('P&L widgets you switched to share, and your images, are shown on this link.')
  })

  it("S19: the preview is the server's read for exactly this switch, and follows it", async () => {
    mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: "Preview: see exactly what they'll see →" }))
    await waitFor(() => expect(S.calls.some((c) => c.url === `/api/j2/notes/${NOTE}/share/preview?hidePnl=true`)).toBe(true))
    expect(within(dialog).getByRole('region', { name: 'Preview of the shared page' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Hide P&L widgets and images' }))
    await waitFor(() => expect(S.calls.some((c) => c.url === `/api/j2/notes/${NOTE}/share/preview?hidePnl=false`)).toBe(true))
    expect(S.calls.filter((c) => c.method !== 'GET')).toEqual([])            // a preview writes nothing
  })

  it('S19: Cancel closes the sheet and makes nothing', async () => {
    mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(S.calls.filter((c) => c.method === 'POST')).toEqual([])
  })

  it('Create link and copy sends the chosen expiry and the P&L switch, copies the address and says so', async () => {
    const { onMessage } = mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('radio', { name: '30 days' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link and copy' }))
    await within(dialog).findByText('Share link created and copied. P&L widgets and images are hidden on this link.')
    expect(S.calls.find((c) => c.method === 'POST').body).toEqual({ expiresInDays: 30, hidePnl: true })
    expect(within(dialog).getByText('P&L widgets and images are hidden on this link.', { selector: 'p:not([role])' })).toBeInTheDocument()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(sharedNoteUrl('tokABC'))
    expect(onMessage).toHaveBeenCalledWith('Share link created and copied. P&L widgets and images are hidden on this link.')
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
    expect(within(dialog).getByRole('button', { name: 'Create link and copy' })).toBeInTheDocument()
  })

  it("a refusal shows the server's own sentence", async () => {
    S.shareStatus = 402
    mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link and copy' }))
    await waitFor(() => expect(statusText(dialog)).toContain('Share links require a paid plan'))
  })
})

describe('publish to the web', () => {
  it('offers this note and its folder by name, and states the folder cap', async () => {
    mount({ j2_share_links_enabled: false, notebook_publish_enabled: true })
    const dialog = await openDoor()
    expect(within(dialog).getByRole('region', { name: 'Publish to the web' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent(
      'A published page can be read by anyone with its address, without signing in. Search engines are asked not to index it.')
    expect(within(dialog).getByRole('button', { name: 'Publish this note' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Publish folder "Weekly plans"' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent(
      'Publishes up to 500 notes in this folder and the folders inside it. A note added later appears when you update the page in Settings.')
    expect(within(dialog).queryByRole('region', { name: 'Private link' })).toBeNull()
  })

  it('Publish this note publishes, copies the page link and says so; Unpublish takes it down', async () => {
    const { onMessage } = mount({ notebook_publish_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish this note' }))
    await confirmPublish()
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
    await confirmPublish('Publish "Weekly plans" and the 3 notes inside it?')
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

  // Wave-8 backend M-3: the server refuses to publish an archived note and says so in
  // `publishable`. The door says why instead of offering a button whose only result is an error.
  it('an archived note says how to publish it instead of offering the button', async () => {
    S.publishable = false
    mount({ notebook_publish_enabled: true })
    const dialog = await openDoor()
    expect(dialog).toHaveTextContent('This note is archived. Unarchive it from the note menu to publish it.')
    expect(within(dialog).queryByRole('button', { name: 'Publish this note' })).toBeNull()
  })

  it('a live note (publishable true) and a server that predates the field both keep the button', async () => {
    S.publishable = true
    mount({ notebook_publish_enabled: true })
    let dialog = await openDoor()
    expect(within(dialog).getByRole('button', { name: 'Publish this note' })).toBeInTheDocument()
    cleanup()
    __resetNotebookFlags()
    S.publishable = undefined
    mount({ notebook_publish_enabled: true })
    dialog = await openDoor()
    expect(within(dialog).getByRole('button', { name: 'Publish this note' })).toBeInTheDocument()
    expect(dialog).not.toHaveTextContent('This note is archived.')
  })
})

// ⛔ Wave 8 final review, M-1: each action swaps the pressed button for another, and the
// pressed one leaves the DOM with focus in it. Focus goes to the control that replaced it,
// once the busy state clears -- never <body>.
describe('focus follows the swap (M-1)', () => {
  const press = (dialog, name) => {
    const b = within(dialog).getByRole('button', { name })
    b.focus()
    fireEvent.click(b)
  }

  it('Create link -> Copy link; Revoke link -> Create link', async () => {
    mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    press(dialog, 'Create link and copy')
    await within(dialog).findByText('Share link created and copied. P&L widgets and images are hidden on this link.')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Copy link' })))
    press(dialog, 'Revoke link')
    await within(dialog).findByText('Link revoked. It no longer works.')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Create link and copy' })))
  })

  it('Publish this note -> Copy page link; Unpublish -> Publish this note', async () => {
    mount({ notebook_publish_enabled: true })
    const dialog = await openDoor()
    press(dialog, 'Publish this note')
    await confirmPublish()
    await within(dialog).findByText('Published. Page link copied.')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Copy page link' })))
    press(dialog, 'Unpublish')
    await within(dialog).findByText('Unpublished. The page no longer works.')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Publish this note' })))
  })

  it('Publish folder -> Copy folder link; Unpublish folder -> Publish folder', async () => {
    mount({ notebook_publish_enabled: true })
    const dialog = await openDoor()
    press(dialog, 'Publish folder "Weekly plans"')
    await confirmPublish('Publish "Weekly plans" and the 3 notes inside it?')
    await within(dialog).findByText('Published "Weekly plans". Page link copied.')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Copy folder link' })))
    press(dialog, 'Unpublish folder')
    await within(dialog).findByText('Unpublished. The page no longer works.')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Publish folder "Weekly plans"' })))
  })

  it('a refusal moves nothing: focus stays on the button that was pressed', async () => {
    S.shareStatus = 402
    mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    press(dialog, 'Create link and copy')
    await waitFor(() => expect(statusText(dialog)).toContain('Share links require a paid plan'))
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Create link and copy' }))
  })
})

// ⛔ Wave 8 final review, M-3: split view mounts two editors, so two of these popovers can
// exist at once. Its ids come from useId, never a fixed string.
describe('ids are per instance (M-3)', () => {
  it('no fixed id is left, and every label and description still points at its element', async () => {
    const src = readFileSync(join(process.cwd(),
      'src/pages/journal-2-0/components/notebook/NoteShareControls.jsx'), 'utf8')
    expect(src).not.toMatch(/\b(?:id|htmlFor|aria-labelledby|aria-describedby)="[^"{]/)
    mount({ j2_share_links_enabled: true, notebook_publish_enabled: true })
    S.share = null
    const dialog = await openDoor()
    // labelled and described through the generated ids
    expect(within(dialog).getByLabelText('Hide P&L widgets and images').getAttribute('role')).toBe('switch')
    expect(within(dialog).getByRole('tabpanel', { name: 'Private link' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Publish to the web' }))
    expect(within(dialog).getByRole('tabpanel', { name: 'Publish to the web' })).toBeInTheDocument()
  })

  it('two popovers open at once share no id', async () => {
    latchNotebookFlags({ j2_share_links_enabled: true, notebook_publish_enabled: true })
    render(<><NoteShareControls noteId={NOTE} onMessage={vi.fn()} /><NoteShareControls noteId={NOTE} onMessage={vi.fn()} /></>)
    const doors = screen.getAllByRole('button', { name: /share/i })
    fireEvent.click(doors[0])
    fireEvent.click(doors[1])
    await waitFor(() => expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2))
    await waitFor(() => expect(screen.queryAllByText('Loading…')).toHaveLength(0))
    const ids = [...document.querySelectorAll('[role="dialog"] [id]')].map((el) => el.id)
    expect(ids.length).toBeGreaterThan(4)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('the 44px touch floor', () => {
  const css = readFileSync(join(process.cwd(),
    'src/pages/journal-2-0/components/notebook/NoteShareControls.module.css'), 'utf8')
  it('every control in the popover reaches var(--tap-min) on the touch tier (<=1024px)', () => {
    const touch = /@media \(max-width: 1024px\) \{([\s\S]*?)\n\}/.exec(css)
    expect(touch, 'no touch-tier block').not.toBeNull()
    // VIS-3 (audit 2026-11-05): the actions are buttons.css `.btn`s now, whose own rule gives every button the
    // floor at <=1024px (styles/buttons.css); the popover's own fields keep theirs here.
    for (const cls of ['.select', '.field']) {
      expect(touch[1]).toMatch(new RegExp(`\\${cls} \\{ min-height: var\\(--tap-min\\); \\}`))
    }
    const buttons = readFileSync(join(process.cwd(), 'src/styles/buttons.css'), 'utf8')
    expect(buttons).toMatch(/@media \(max-width: 1024px\) \{\s*\.btn \{\s*min-height: var\(--tap-min\);/)
  })

  it('VIS-3: Create link is the one solid primary; Publish is an outline; no bespoke .action class', () => {
    // S19: the sheet's content is the lazy NoteSharePanel.jsx.
    const jsx = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/NoteSharePanel.jsx'), 'utf8')
    expect(jsx).toMatch(/className="btn btn-primary btn-sm" onClick=\{createLink\}/)
    expect(jsx).toMatch(/className="btn btn-outline btn-sm" onClick=\{\(\) => askPublish\('note'\)\}/)
    expect(jsx).not.toMatch(/styles\.action/)
    expect(css).not.toMatch(/^\.action \{/m)
  })
})

// ⭐ Wave 10 (10D, R-16): the editor's Share door counts each action that WORKED — a share
// link made, copied or revoked; a page published, copied or unpublished — with action and
// kind words only. Never the token, the note or the folder.
describe('share_used and publish_used — the editor door counts actions, and nothing about the note', () => {
  const telemetry = () => S.calls.filter((c) => c.url === '/api/j2/telemetry').map((c) => c.body)

  it('create, copy and revoke each send ONE share_used with the action word', async () => {
    mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link and copy' }))
    await within(dialog).findByText('Share link created and copied. P&L widgets and images are hidden on this link.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }))
    await within(dialog).findByText('Share link copied.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke link' }))
    await within(dialog).findByText('Link revoked. It no longer works.')
    expect(telemetry()).toEqual([
      { event: 'share_used', props: { action: 'create' } },
      { event: 'share_used', props: { action: 'copy' } },
      { event: 'share_used', props: { action: 'revoke' } },
    ])
    expect(JSON.stringify(telemetry())).not.toMatch(/tokABC|n1|Weekly/)
  })

  it('publish and unpublish a note send publish_used {kind: note, door: editor}', async () => {
    mount({ notebook_publish_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish this note' }))
    await confirmPublish()
    await within(dialog).findByText('Published. Page link copied.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unpublish' }))
    await within(dialog).findByText('Unpublished. The page no longer works.')
    expect(telemetry()).toEqual([
      { event: 'publish_used', props: { action: 'publish', kind: 'note', door: 'editor' } },
      { event: 'publish_used', props: { action: 'unpublish', kind: 'note', door: 'editor' } },
    ])
    expect(JSON.stringify(telemetry())).not.toMatch(/slugN|n1/)
  })

  it('a refused share link sends nothing', async () => {
    S.shareStatus = 402
    mount({ j2_share_links_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link and copy' }))
    await waitFor(() => expect(statusText(dialog)).toContain('Share links require a paid plan'))
    expect(telemetry()).toEqual([])
  })
})

// ⛔ Audit 2026-11-05, spec S1: one press used to publish. Now the press only asks.
describe('S1: publishing asks first', () => {
  const publishCalls = () => S.calls.filter((c) => c.method === 'POST' && c.url.startsWith('/api/j2/publish/'))

  it('one press on Publish this note sends nothing and opens the confirm step; its Publish sends ONE', async () => {
    mount({ notebook_publish_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish this note' }))
    const confirmDialog = await screen.findByRole('dialog', { name: 'Publish to the web?' })
    expect(confirmDialog).toHaveTextContent(
      '"NVDA plan" will be readable by anyone with its address. Search engines are asked not to index it. Price charts are not shown. You can unpublish anytime.')
    expect(publishCalls()).toEqual([])
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Publish' }))
    await within(dialog).findByText('Published. Page link copied.')
    expect(publishCalls()).toHaveLength(1)
    expect(publishCalls()[0].url).toBe(`/api/j2/publish/notes/${NOTE}`)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Publish to the web?' })).toBeNull())
  })

  it('Publish folder asks with the folder name and its note count, and sends nothing until confirmed', async () => {
    mount({ notebook_publish_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish folder "Weekly plans"' }))
    await screen.findByRole('dialog', { name: 'Publish "Weekly plans" and the 3 notes inside it?' })
    expect(publishCalls()).toEqual([])
  })

  it('focus starts on Cancel; Cancel closes the step, sends nothing, and leaves the Share sheet open', async () => {
    mount({ notebook_publish_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish this note' }))
    const confirmDialog = await screen.findByRole('dialog', { name: 'Publish to the web?' })
    await waitFor(() => expect(document.activeElement).toBe(within(confirmDialog).getByRole('button', { name: 'Cancel' })))
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Publish to the web?' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Share "NVDA plan"' })).toBeInTheDocument()
    expect(publishCalls()).toEqual([])
  })

  it('Escape closes the confirm step only; the Share sheet stays open and nothing is sent', async () => {
    mount({ notebook_publish_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish this note' }))
    await screen.findByRole('dialog', { name: 'Publish to the web?' })
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Publish to the web?' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Share "NVDA plan"' })).toBeInTheDocument()
    expect(publishCalls()).toEqual([])
  })

  it('a refusal keeps the step open and says nothing was made public', async () => {
    mount({ notebook_publish_enabled: true })
    const dialog = await openDoor()
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((url, opts = {}) => (String(url).startsWith('/api/j2/publish/notes/') && opts.method === 'POST'
      ? json(500, { detail: 'boom-marker' }) : realFetch(url, opts))))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish this note' }))
    const confirmDialog = await confirmPublish()
    await waitFor(() => expect(within(confirmDialog).getAllByRole('status').map((n) => n.textContent).join(' '))
      .toContain("Couldn't publish. Nothing was made public."))
    expect(screen.getByRole('dialog', { name: 'Publish to the web?' })).toBeInTheDocument()
  })

  it('after a confirmed publish, focus lands on Copy page link', async () => {
    mount({ notebook_publish_enabled: true })
    const dialog = await openDoor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish this note' }))
    await confirmPublish()
    await within(dialog).findByText('Published. Page link copied.')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Copy page link' })))
  })
})
