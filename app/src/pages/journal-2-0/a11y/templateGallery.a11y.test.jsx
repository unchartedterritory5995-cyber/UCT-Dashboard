// app/src/pages/journal-2-0/a11y/templateGallery.a11y.test.jsx
//
// Wave 12, lane 12A: the community template gallery through 8A's axe harness (the ONE way
// a Notebook rail asks axe-core). The tab and picker recipes run with
// NOTEBOOK_TEMPLATE_GALLERY_ENABLED off, so they never render these components -- hence
// their own recipes here rather than a `coveredBy` entry that would be untrue. Each recipe
// proves the state it is about rendered before axe runs, so an empty screen can never pass
// as a clean one:
//   * community-gallery-browse  -- picks + community cards with an open report form;
//   * community-gallery-mine    -- Your submissions in every state;
//   * community-gallery-review  -- the admin review queue (TemplateGalleryReviewPanel);
//   * community-gallery-preview -- a gallery template's read-only preview sheet;
//   * gallery-publish-form      -- Share from Your templates, the form open.
import { describe, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Providers } from './fixtures'
import { axeSurface } from './surface'
import TemplatePicker from '../components/notebook/TemplatePicker'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
const BODY = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Entry checklist' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Trigger, stop, size.' }] },
] }
const ITEMS = [
  { id: 'g1', title: 'Pre-Market Plan', description: 'Your day, planned.', category: 'trade_plan', author: 'UCT',
    firm: true, featured: true, usedBy: 3, preview: [{ kind: 'heading', text: 'Overnight' }, { kind: 'bullet', text: 'Levels' }], mine: false },
  { id: 'g2', title: 'Breakout checklist', description: 'Before a breakout.', category: 'trade_plan', author: 'Alice Trader',
    firm: false, featured: false, usedBy: 1, preview: [{ kind: 'text', text: 'Trigger, stop, size.' }], mine: false },
]
const MINE = [
  { id: 'm1', title: 'My weekly', status: 'pending', hidden: false, reviewNote: '', mine: true, category: 'review', author: 'Me' },
  { id: 'm2', title: 'My earnings', status: 'rejected', hidden: false, reviewNote: 'Add exit rules.', mine: true, category: 'research', author: 'Me' },
  { id: 'm3', title: 'My journal', status: 'approved', hidden: true, reviewNote: '', mine: true, category: 'journal', author: 'Me' },
]
const QUEUE = {
  pending: [{ id: 'p1', title: 'Pending one', author: 'Bob', category: 'journal', description: 'A journal page.' }],
  reported: [{ id: 'r1', title: 'Reported one', author: 'Carl', category: 'review', openReports: 1,
    reports: [{ id: 'rep1', reason: 'spam', note: 'ads', createdAt: '1' }] }],
  hidden: [{ id: 'h1', title: 'Hidden one', author: 'Dee', category: 'review' }],
}

let admin = false
function stub() {
  global.fetch = vi.fn((url) => {
    const u = new URL(String(url), 'http://x')
    if (u.pathname === '/api/j2/note-templates') {
      return json({ templates: [{ id: 't1', name: 'Swing plan', title: 'Swing plan', createdAt: '1' }] })
    }
    if (u.pathname === '/api/j2/template-gallery') {
      const section = u.searchParams.get('section')
      const list = section === 'mine' ? MINE : section === 'picks' ? ITEMS.filter((i) => i.featured) : ITEMS
      return json({ templates: list, viewer: { admin } })
    }
    if (u.pathname === '/api/j2/template-gallery/admin/queue') return json(QUEUE)
    if (u.pathname === '/api/j2/template-gallery/g2') return json({ template: { ...ITEMS[1], bodyJson: BODY, propertyDefs: [] } })
    return json({})
  })
}

function renderPicker() {
  const user = userEvent.setup()
  render(
    <Providers>
      <TemplatePicker onPick={() => {}} onPickMember={() => {}} />
    </Providers>,
  )
  return user
}

async function openGallery() {
  const user = renderPicker()
  await user.click(await screen.findByRole('button', { name: /Browse the community gallery/ }))
  await screen.findByRole('heading', { name: 'Community gallery' })
  return user
}

describe('lane 12A surfaces (community template gallery)', () => {
  beforeEach(() => {
    admin = false
    stub()
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_template_gallery_enabled: true })
  })
  afterEach(() => { __resetNotebookFlags() })

  axeSurface('community-gallery-browse', async () => {
    const user = await openGallery()
    const picks = await screen.findByRole('region', { name: 'UCT picks' })
    within(picks).getByRole('heading', { name: 'Pre-Market Plan' })
    await user.click(screen.getByRole('button', { name: 'Report Breakout checklist' }))
    screen.getByRole('form', { name: 'Report Breakout checklist' })
    await settle()
  })

  axeSurface('community-gallery-mine', async () => {
    const user = await openGallery()
    await user.click(screen.getByRole('button', { name: 'Your submissions' }))
    const list = await screen.findByRole('list', { name: 'Your submissions' })
    within(list).getByText('Hidden by a moderator')
    within(list).getByText('Reviewer: Add exit rules.')
  })

  axeSurface('community-gallery-review', async () => {
    admin = true
    const user = await openGallery()
    await user.click(await screen.findByRole('button', { name: 'Review queue' }))
    await screen.findByRole('button', { name: 'Approve Pending one' })
    await user.click(screen.getByRole('button', { name: 'Reject Pending one' }))
    screen.getByRole('form', { name: 'Reject Pending one' })
    screen.getByRole('button', { name: 'Unhide Hidden one' })
  })

  axeSurface('community-gallery-preview', async () => {
    const user = await openGallery()
    await user.click(await screen.findByRole('button', { name: 'Preview Breakout checklist' }))
    const sheet = await screen.findByRole('dialog', { name: 'Breakout checklist' })
    await within(sheet).findByText('Trigger, stop, size.')
  })

  axeSurface('gallery-publish-form', async () => {
    const user = renderPicker()
    await user.click(await screen.findByRole('button', { name: 'Share Swing plan to the community gallery' }))
    screen.getByRole('form', { name: 'Share Swing plan to the community gallery' })
  })
})
