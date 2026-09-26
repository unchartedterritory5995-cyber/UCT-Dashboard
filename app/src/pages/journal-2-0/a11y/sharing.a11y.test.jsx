// app/src/pages/journal-2-0/a11y/sharing.a11y.test.jsx
//
// A1 (OTHER_LANES, lane 8B): the sharing surfaces — the editor's Share popover
// with a live link and a publication, Settings -> Sharing & publishing, a
// published note, a published folder and a share-link page. These files are
// 8B's; 8B had closed when this harness landed, and its report asked for them
// to be added to it (wave8-8B-report.md, "8A" item 4). The rail lives in 8A's
// own directory and edits none of 8B's files: a violation found here goes to
// the controller as a request.
import { describe, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Routes, Route } from 'react-router-dom'
import { latchWave8Flags, Providers, AUTH } from './fixtures'
import { axeSurface } from './surface'
import NoteShareControls from '../components/notebook/NoteShareControls'
import SharingCard from '../components/SharingCard'
import PublishedPage from '../PublishedPage'
import SharedNotePage from '../SharedNotePage'
import { PUBLISHED_ROUTE, PUBLISHED_NOTE_ROUTE, PUBLISH_ENDPOINT } from '../lib/notePublishLink'
import { SHARED_NOTE_ROUTE, SHARE_LINKS_ENDPOINT } from '../lib/noteShareLink'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) })
const T = '2026-09-20T12:00:00Z'
const BODY = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'The plan' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Weekly thesis body.' }] },
] }

const SHARE = { kind: 'share', token: 'tok1', noteId: 'n1', title: 'NVDA thesis', createdAt: T, expiresAt: null, state: 'active' }
const NOTE_PUB = { slug: 'slugN', kind: 'note', targetId: 'n1', name: 'NVDA thesis', path: '/p/slugN', createdAt: T, updatedAt: T, expiresAt: null, state: 'active' }
const FOLDER_PUB = { slug: 'slugF', kind: 'folder', targetId: 'f1', name: 'Weekly plans', path: '/p/slugF', createdAt: T, updatedAt: T, expiresAt: null, state: 'active', memberCount: 3, memberCap: 500 }

function stub() {
  global.fetch = vi.fn((url, opts = {}) => {
    const u = String(url)
    const method = opts.method || 'GET'
    if (u === '/api/j2/notes/n1/share' && method === 'GET') return json(200, { share: { token: 'tok1', createdAt: T, expiresAt: null } })
    if (u === `${PUBLISH_ENDPOINT}?note_id=n1`) {
      return json(200, { publications: [NOTE_PUB], shares: [], note: { noteId: 'n1', exists: true, folderId: 'f1', folderName: 'Weekly plans' } })
    }
    if (u === PUBLISH_ENDPOINT) return json(200, { publications: [NOTE_PUB, FOLDER_PUB], shares: [SHARE] })
    if (u === SHARE_LINKS_ENDPOINT) return json(200, { shares: [SHARE] })
    if (u === '/api/j2/published/slugN') return json(200, { kind: 'note', note: { title: 'NVDA thesis', subtitle: 'the plan', bodyJson: BODY, heroImageUrl: null, updatedAt: T } })
    if (u === '/api/j2/published/slugF') {
      return json(200, { kind: 'folder', title: 'Weekly plans', notes: [
        { pid: 'p1', title: 'Week 38 plan', updatedAt: T }, { pid: 'p2', title: 'Week 39 plan', updatedAt: T }] })
    }
    if (u.startsWith('/api/j2/shared/tok1')) return json(200, { note: { title: 'NVDA thesis', subtitle: null, bodyJson: BODY, heroImageUrl: null, updatedAt: T } })
    return json(200, {})
  })
}

describe('sharing surfaces (lane 8B files)', () => {
  beforeEach(() => {
    stub()
    latchWave8Flags(true)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true })
  })

  axeSurface('share-popover', async () => {
    render(<Providers auth={{ ...AUTH, user: { ...AUTH.user, role: 'member' } }}><NoteShareControls noteId="n1" onMessage={() => {}} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: /share/i }))
    await screen.findByRole('dialog', { name: 'Share this note' })
    await settle(60)
  })

  axeSurface('settings-sharing', async () => {
    render(<Providers><SharingCard /></Providers>)
    await screen.findAllByText('Weekly plans')
    await settle()
  })

  axeSurface('published-note', async () => {
    render(
      <Providers route="/p/slugN" auth={{ ...AUTH, user: null, isPaid: false }}>
        <Routes><Route path={PUBLISHED_ROUTE} element={<PublishedPage />} /><Route path={PUBLISHED_NOTE_ROUTE} element={<PublishedPage />} /></Routes>
      </Providers>,
    )
    await screen.findByText('Weekly thesis body.')
  }, { level: 'page' })

  axeSurface('published-folder', async () => {
    render(
      <Providers route="/p/slugF" auth={{ ...AUTH, user: null, isPaid: false }}>
        <Routes><Route path={PUBLISHED_ROUTE} element={<PublishedPage />} /></Routes>
      </Providers>,
    )
    await screen.findByText('Week 39 plan')
  }, { level: 'page' })

  axeSurface('shared-note', async () => {
    render(
      <Providers route="/share/n/tok1" auth={{ ...AUTH, user: null, isPaid: false }}>
        <Routes><Route path={SHARED_NOTE_ROUTE} element={<SharedNotePage />} /></Routes>
      </Providers>,
    )
    await screen.findByText('Weekly thesis body.')
  }, { level: 'page' })
})
