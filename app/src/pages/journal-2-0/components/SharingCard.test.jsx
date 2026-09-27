import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SharingCard from './SharingCard'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { SHARE_LINKS_ENDPOINT } from '../lib/noteShareLink'
import { PUBLISH_ENDPOINT } from '../lib/notePublishLink'

// Settings → Sharing & publishing (wave 8: seam S8-5's stub, filled by lane 8B).
//
// ⛔ DARK MEANS ABSENT. Both gates (J2_SHARE_LINKS_ENABLED, NOTEBOOK_PUBLISH_ENABLED) stay
// off until the owner's legal sign-off (ruling D-B9), so for every member today this card
// renders NOTHING — and a tab that has not heard from the server yet (nothing latched) is
// treated as off, never as on.
// ⛔ COPY CONTRACT: every row's text and every confirmation is asserted as RENDERED TEXT.

const SHARE = { kind: 'share', token: 'tok1', noteId: 'n1', title: 'March AMD post-mortem',
  createdAt: '2026-09-01T12:00:00Z', expiresAt: '2026-10-01T12:00:00Z', state: 'active' }
const EXPIRED_SHARE = { kind: 'share', token: 'tok2', noteId: 'n2', title: 'Old idea',
  createdAt: '2026-08-01T12:00:00Z', expiresAt: '2026-08-08T12:00:00Z', state: 'expired' }
const NOTE_PUB = { slug: 'slugN', kind: 'note', targetId: 'n3', name: 'Weekly thesis', path: '/p/slugN',
  createdAt: '2026-09-10T12:00:00Z', updatedAt: '2026-09-10T12:00:00Z', expiresAt: null, state: 'active' }
const FOLDER_PUB = { slug: 'slugF', kind: 'folder', targetId: 'f1', name: 'Weekly plans', path: '/p/slugF',
  createdAt: '2026-09-11T12:00:00Z', updatedAt: '2026-09-11T12:00:00Z', expiresAt: null, state: 'active',
  memberCount: 3, memberCap: 500 }

const S = { calls: [], shares: [], pubs: [] }
const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) })

beforeEach(() => {
  S.calls = []
  S.shares = [SHARE, EXPIRED_SHARE]
  S.pubs = [NOTE_PUB, FOLDER_PUB]
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET'
    const u = String(url)
    S.calls.push(`${method} ${u}`)
    if (u === PUBLISH_ENDPOINT && method === 'GET') return json(200, { publications: S.pubs, shares: S.shares })
    if (u === SHARE_LINKS_ENDPOINT && method === 'GET') return json(200, { shares: S.shares })
    if (u === '/api/j2/publish/slugF/refresh' && method === 'POST') {
      return json(200, { publication: { ...FOLDER_PUB, memberCount: 4 } })
    }
    if (method === 'DELETE') return json(200, { revoked: true })
    return json(404, { detail: 'Not found' })
  }))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals(); __resetNotebookFlags() })

describe('SharingCard — who sees it', () => {
  it('renders NOTHING while no flag has latched (the payload has not arrived)', () => {
    const { container } = render(<SharingCard />)
    expect(container).toBeEmptyDOMElement()
    expect(S.calls).toEqual([])
  })

  it('renders NOTHING while both sharing gates are off', () => {
    latchNotebookFlags({ j2_share_links_enabled: false, notebook_publish_enabled: false })
    const { container } = render(<SharingCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    ['share links on', { j2_share_links_enabled: true, notebook_publish_enabled: false }],
    ['publish on', { j2_share_links_enabled: false, notebook_publish_enabled: true }],
    ['both on', { j2_share_links_enabled: true, notebook_publish_enabled: true }],
  ])('renders the card when %s', async (_label, flags) => {
    latchNotebookFlags(flags)
    render(<SharingCard />)
    expect(screen.getByRole('region', { name: 'Sharing & publishing' })).toBeInTheDocument()
    await screen.findByText('Anyone with one of these addresses can read the note or folder without signing in, until you revoke it.')
  })

  it('an unrelated flag being on does not open it', () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_writing_help_enabled: true })
    const { container } = render(<SharingCard />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('SharingCard — the list', () => {
  const open = async (flags = { j2_share_links_enabled: true, notebook_publish_enabled: true }) => {
    latchNotebookFlags(flags)
    render(<SharingCard />)
    return screen.findByRole('list', { name: 'Your share links and published pages' })
  }

  it('every row names its note or folder, its dates and its state; Revoke on every row, Update on folders only', async () => {
    const list = await open()
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('March AMD post-mortem')
    expect(rows[0]).toHaveTextContent('Share link · created Sep 1, 2026 · expires Oct 1, 2026 · Live')
    expect(rows[1]).toHaveTextContent('Share link · created Aug 1, 2026 · expires Aug 8, 2026 · Expired')
    expect(rows[2]).toHaveTextContent('Published note · created Sep 10, 2026 · never expires · Live')
    expect(rows[3]).toHaveTextContent('Published folder · created Sep 11, 2026 · never expires · Live')
    expect(rows[3]).toHaveTextContent('3 of up to 500 notes. A note added to the folder appears when you update.')
    for (const row of rows) expect(within(row).getByRole('button', { name: /^Revoke/ })).toBeInTheDocument()
    expect(within(list).getAllByRole('button', { name: /^Update/ })).toHaveLength(1)
    expect(within(rows[3]).getByRole('button', { name: 'Update the published folder "Weekly plans"' })).toBeInTheDocument()
  })

  it('the empty state says there is nothing to revoke', async () => {
    S.shares = []
    S.pubs = []
    latchNotebookFlags({ j2_share_links_enabled: true, notebook_publish_enabled: true })
    render(<SharingCard />)
    expect(await screen.findByText('You have no share links or published pages.')).toBeInTheDocument()
  })

  it('Revoke on a share link revokes it and says so', async () => {
    const list = await open()
    fireEvent.click(within(list).getByRole('button', { name: 'Revoke the share link to "March AMD post-mortem"' }))
    expect(await screen.findByText('Link to "March AMD post-mortem" revoked. It no longer works.')).toBeInTheDocument()
    expect(S.calls).toContain('DELETE /api/j2/notes/n1/share')
    expect(screen.queryByText('March AMD post-mortem')).toBeNull()
  })

  it('Revoke on a published page unpublishes it and says so', async () => {
    const list = await open()
    fireEvent.click(within(list).getByRole('button', { name: 'Revoke the published note "Weekly thesis"' }))
    expect(await screen.findByText('"Weekly thesis" unpublished. The page no longer works.')).toBeInTheDocument()
    expect(S.calls).toContain('DELETE /api/j2/publish/slugN')
  })

  it('Update re-snapshots a folder and says how many notes it now shows', async () => {
    const list = await open()
    fireEvent.click(within(list).getByRole('button', { name: 'Update the published folder "Weekly plans"' }))
    expect(await screen.findByText('"Weekly plans" updated. The page now shows 4 notes.')).toBeInTheDocument()
    expect(S.calls).toContain('POST /api/j2/publish/slugF/refresh')
    expect(screen.getByText('4 of up to 500 notes. A note added to the folder appears when you update.')).toBeInTheDocument()
  })

  // ⛔ Final review M-1: Revoke removes its own row, and the button that held focus with it.
  // Focus goes to the list (named, so a screen reader says what it is and what is left), or to
  // the empty-state sentence when that was the last row -- never to <body>.
  it('M-1: after a Revoke, focus is on the list, not dropped with the row', async () => {
    const list = await open()
    const revoke = within(list).getByRole('button', { name: 'Revoke the share link to "March AMD post-mortem"' })
    revoke.focus()
    fireEvent.click(revoke)
    await screen.findByText('Link to "March AMD post-mortem" revoked. It no longer works.')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('list', { name: 'Your share links and published pages' })))
    expect(document.activeElement.tabIndex).toBe(-1)
  })

  it('M-1: revoking the LAST row puts focus on the sentence that says there are none', async () => {
    S.shares = []
    S.pubs = [NOTE_PUB]
    const list = await open()
    const revoke = within(list).getByRole('button', { name: 'Revoke the published note "Weekly thesis"' })
    revoke.focus()
    fireEvent.click(revoke)
    await screen.findByText('"Weekly thesis" unpublished. The page no longer works.')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('You have no share links or published pages.')))
  })

  it('with only share links on it reads the share list and shows no publications', async () => {
    await open({ j2_share_links_enabled: true, notebook_publish_enabled: false })
    expect(S.calls).toEqual([`GET ${SHARE_LINKS_ENDPOINT}`])
    expect(screen.queryByText('Weekly thesis')).toBeNull()
    expect(screen.getByText('March AMD post-mortem')).toBeInTheDocument()
  })

  it('with only publishing on it shows no share links', async () => {
    await open({ j2_share_links_enabled: false, notebook_publish_enabled: true })
    expect(S.calls).toEqual([`GET ${PUBLISH_ENDPOINT}`])
    expect(screen.queryByText('March AMD post-mortem')).toBeNull()
    expect(screen.getByText('Weekly thesis')).toBeInTheDocument()
  })
})

describe('SharingCard — the 44px touch floor', () => {
  it('every button reaches var(--tap-min) on the touch tier (<=1024px)', () => {
    const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/SharingCard.module.css'), 'utf8')
    expect(css).toMatch(/@media \(max-width: 1024px\) \{\s*\.action \{ min-height: var\(--tap-min\); \}/)
  })
})
