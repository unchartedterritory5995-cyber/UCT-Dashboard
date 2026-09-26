// Wave 9 lane 9D (D2) — the sidebar's Publish-folder confirmation (PublishFolderSheet.jsx).
//
// ⛔ COPY CONTRACT: every sentence a member reads is asserted as RENDERED TEXT after the
// action settles (CLAUDE.md, "Assert user-facing feedback by RENDERED TEXT"), and the
// sentences that say what becomes public are the literal ones the editor's Share door shows.
// ⛔ ONE PUBLISH CALL: the wire is read — exactly one POST, to the folder route, with no
// expiry — never a spy on a helper that could agree with itself.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PublishFolderSheet from './PublishFolderSheet'
import { publishedUrl } from '../../lib/notePublishLink'

const FOLDER = { id: 'f1', name: 'Weekly plans' }
const PUBLIC = 'A published page can be read by anyone with its address, without signing in. Search engines are asked not to index it.'
const SCOPE = 'Publishes up to 500 notes in this folder and the folders inside it. A note added later appears when you update the page in Settings.'
const S = { pubs: [], calls: [], post: null, listStatus: 200 }
const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) })

beforeEach(() => {
  S.pubs = []
  S.calls = []
  S.listStatus = 200
  S.post = () => json(200, { publication: { slug: 'slugF', kind: 'folder', targetId: 'f1', path: '/p/slugF', memberCount: 3, memberCap: 500 } })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true })
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET'
    S.calls.push({ method, url: String(url), body: opts.body ? JSON.parse(opts.body) : null })
    if (String(url) === '/api/j2/publish' && method === 'GET') {
      return S.listStatus === 200 ? json(200, { publications: S.pubs, shares: [] }) : json(S.listStatus, { detail: 'nope' })
    }
    if (String(url) === '/api/j2/publish/folders/f1' && method === 'POST') return S.post()
    return json(404, { detail: 'Not found' })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mount({ onClose = vi.fn(), returnFocusTo = null, open = true } = {}) {
  const r = render(<PublishFolderSheet open={open} folder={FOLDER} onClose={onClose} returnFocusTo={returnFocusTo} />)
  return { ...r, onClose }
}

async function openSheet(opts) {
  const m = mount(opts)
  const dialog = await screen.findByRole('dialog', { name: 'Publish folder "Weekly plans"' })
  await waitFor(() => expect(within(dialog).queryByText('Loading…')).toBeNull())
  return { ...m, dialog }
}

const posts = () => S.calls.filter((c) => c.method === 'POST')
const status = (dialog) => within(dialog).getAllByRole('status').map((n) => n.textContent).join(' ')

describe('the confirmation says what becomes public before anything is sent', () => {
  it('shows the Share door\'s two sentences, Publish and Cancel — and only the list has been read', async () => {
    const { dialog } = await openSheet()
    expect(dialog).toHaveTextContent(PUBLIC)
    expect(dialog).toHaveTextContent(SCOPE)
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toHaveAccessibleDescription(`${PUBLIC} ${SCOPE}`)
    expect(S.calls).toEqual([{ method: 'GET', url: '/api/j2/publish', body: null }])
  })

  it('Cancel closes and publishes nothing', async () => {
    const { dialog, onClose } = await openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(posts()).toEqual([])
  })
})

describe('Publish posts ONCE and shows the page', () => {
  it('one POST to the folder route with no expiry, then the address, Copy link and the result sentence', async () => {
    const { dialog } = await openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(status(dialog)).toBe('Published "Weekly plans". Page link copied.'))
    expect(posts()).toEqual([{ method: 'POST', url: '/api/j2/publish/folders/f1', body: { expiresInDays: null } }])
    expect(within(dialog).getByRole('textbox', { name: 'Published folder address, Weekly plans' }))
      .toHaveValue(publishedUrl('slugF'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(publishedUrl('slugF'))
    // the Publish button is gone: nothing left to press twice
    expect(within(dialog).queryByRole('button', { name: 'Publish' })).toBeNull()
    // M-1: the button that held focus left the DOM; Copy link takes it
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Copy link' })))
  })

  it('a double press before the first answer lands still posts once', async () => {
    let answer
    S.post = () => new Promise((r) => { answer = r })
    const { dialog } = await openSheet()
    const btn = within(dialog).getByRole('button', { name: 'Publish' })
    // Three presses in ONE act: no render lands between them, so the button is still enabled
    // for the second and third — the case a disabled attribute cannot cover (a fast double
    // click, or a click and an Enter, before React commits). Only the in-flight guard can.
    await act(async () => {
      btn.click()
      btn.click()
      btn.click()
    })
    expect(posts()).toHaveLength(1)
    await act(async () => {
      answer(await json(200, { publication: { slug: 'slugF', kind: 'folder', targetId: 'f1' } }))
    })
    await waitFor(() => expect(status(dialog)).toMatch(/^Published "Weekly plans"\./))
    expect(posts()).toHaveLength(1)
  })

  it('when the browser will not copy, it says to copy the address shown', async () => {
    navigator.clipboard.writeText = vi.fn(() => Promise.reject(new Error('denied')))
    const { dialog } = await openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(status(dialog)).toBe('Published "Weekly plans". Copy the address above.'))
  })

  it('Copy link copies again and says so', async () => {
    const { dialog } = await openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(status(dialog)).toMatch(/Page link copied\./))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(status(dialog)).toBe('Page link copied.'))
    expect(posts()).toHaveLength(1)
  })
})

describe('a folder that already has a live page', () => {
  it('shows that page\'s address instead of a second publish — and sends no POST', async () => {
    S.pubs = [
      { slug: 'old', kind: 'folder', targetId: 'f1', state: 'expired' },
      { slug: 'slugLive', kind: 'folder', targetId: 'f1', state: 'active' },
      { slug: 'other', kind: 'folder', targetId: 'f9', state: 'active' },
    ]
    const { dialog } = await openSheet()
    expect(dialog).toHaveTextContent('This folder is already published. Anyone with its address can read it.')
    expect(within(dialog).getByRole('textbox', { name: 'Published folder address, Weekly plans' }))
      .toHaveValue(publishedUrl('slugLive'))
    expect(within(dialog).queryByRole('button', { name: 'Publish' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(status(dialog)).toBe('Page link copied.'))
    expect(posts()).toEqual([])
  })

  it('an EXPIRED page is not a live one: Publish is offered', async () => {
    S.pubs = [{ slug: 'old', kind: 'folder', targetId: 'f1', state: 'expired' }]
    const { dialog } = await openSheet()
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeInTheDocument()
  })

  it('a list that will not load still offers Publish (the server never makes a second page)', async () => {
    S.listStatus = 500
    const { dialog } = await openSheet()
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeInTheDocument()
  })
})

describe('a refusal shows the server\'s sentence', () => {
  it.each([
    [402, 'Publishing to the web requires a paid plan'],
    [429, "You've published a lot in the last hour. Try again later."],
    [404, 'Not found'],
  ])('%s: its own words, and Publish stays for a retry', async (code, sentence) => {
    S.post = () => json(code, { detail: sentence })
    const { dialog } = await openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(status(dialog)).toBe(sentence))
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeEnabled()
    expect(within(dialog).queryByRole('textbox')).toBeNull()
  })

  it('ours only when the server sent none', async () => {
    S.post = () => json(500, {})
    const { dialog } = await openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(status(dialog)).toBe('Could not publish. Try again.'))
  })
})

describe('keyboard and focus', () => {
  it('is operable from the keyboard alone: Tab to Publish, Enter publishes', async () => {
    const user = userEvent.setup()
    const { dialog } = await openSheet()
    const publish = within(dialog).getByRole('button', { name: 'Publish' })
    // the Sheet traps Tab inside the dialog; walk until Publish has focus
    for (let i = 0; i < 6 && document.activeElement !== publish; i += 1) await user.tab()
    expect(document.activeElement).toBe(publish)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(status(dialog)).toMatch(/^Published "Weekly plans"\./))
    expect(posts()).toHaveLength(1)
  })

  it('Escape closes it', async () => {
    const { onClose } = await openSheet()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('focus returns to the folder\'s action once it closes — even when the browser never focused it (Safari)', async () => {
    const action = document.createElement('button')
    action.textContent = 'Publish'
    document.body.appendChild(action)
    try {
      const { rerender } = await openSheet({ returnFocusTo: action })
      // Safari: a clicked button is never focused, so the Sheet's own opener is <body>
      rerender(<PublishFolderSheet open={false} folder={FOLDER} onClose={() => {}} returnFocusTo={action} />)
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(document.activeElement).toBe(action)
    } finally {
      action.remove()
    }
  })
})

describe('one publish helper, one set of sentences (ruling D-9D2)', () => {
  const J2 = join(cwd(), 'src', 'pages', 'journal-2-0')
  const read = (rel) => readFileSync(join(J2, rel), 'utf8')
  const DOORS = ['components/notebook/NoteShareControls.jsx', 'components/notebook/PublishFolderSheet.jsx']

  it('both doors publish through publishTarget and neither builds the route or calls fetch itself', () => {
    for (const f of DOORS) {
      const src = read(f)
      expect(src, f).toMatch(/\bpublishTarget\(/)
      expect(src, f).not.toMatch(/\/folders\//)
      expect(src, f).not.toMatch(/\bfetch\(/)
      expect(src, f).not.toMatch(/expiresInDays:\s*null/)
    }
  })

  it('the sentences live once, in lib/notePublishLink.js — neither door restates them', () => {
    const lib = read('lib/notePublishLink.js')
    for (const sentence of [PUBLIC, SCOPE, 'Could not publish. Try again.', 'Page link copied.']) {
      expect(lib, sentence).toContain(sentence)
      for (const f of DOORS) expect(read(f), `${f} restates: ${sentence}`).not.toContain(sentence)
    }
  })
})
