// Wave 12 (lane 12A) — the community template gallery, end to end in the client:
// the door (gated), browse + filters, preview, Use template (a COPY, then the member's
// own create door), report, publish (Share from Your templates), Your submissions with
// unpublish, and the admin review queue. A fake server keeps state across calls, so a
// test that forgets to send the request cannot pass on rendering alone.
// ⛔ Feedback is asserted by RENDERED TEXT, never by a state transition.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import TemplatePicker from './TemplatePicker'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { GALLERY_CATEGORIES } from '../../lib/templateGallery'

const doc = (...texts) => ({ type: 'doc', content: texts.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) })

let server
let calls
function freshServer({ admin = false } = {}) {
  return {
    admin,
    gallery: [
      { id: 'g-firm', title: 'Pre-Market Plan', description: 'Your day, planned.', category: 'trade_plan', author: 'UCT',
        firm: true, featured: true, usedBy: 4, preview: [{ kind: 'heading', text: 'Overnight' }], mine: false,
        bodyJson: doc('Overnight and premarket') },
      { id: 'g-alice', title: 'Breakout checklist', description: 'Before a breakout.', category: 'trade_plan',
        author: 'Alice Trader', firm: false, featured: false, usedBy: 1, preview: [], mine: false,
        bodyJson: doc('Entry checklist') },
    ],
    mine: [
      { id: 'g-mine-1', title: 'My weekly', status: 'pending', hidden: false, reviewNote: '', mine: true, category: 'review', author: 'Me' },
      { id: 'g-mine-2', title: 'My earnings', status: 'rejected', hidden: false, reviewNote: 'Add your exit rules.', mine: true, category: 'research', author: 'Me' },
    ],
    memberTemplates: [{ id: 't1', name: 'Swing plan', title: 'Swing plan', createdAt: '1' }],
    queue: {
      pending: [{ id: 'g-p', title: 'Pending one', author: 'Bob', category: 'journal', description: '' }],
      reported: [{ id: 'g-r', title: 'Reported one', author: 'Carl', category: 'review', openReports: 1,
        reports: [{ id: 'r1', reason: 'spam', note: 'ads', createdAt: '1' }] }],
      hidden: [{ id: 'g-h', title: 'Hidden one', author: 'Dee', category: 'review' }],
    },
    useFails: false,
  }
}

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  server = freshServer()
  calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url), 'http://x')
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ path: u.pathname, search: u.search, method, body })
    if (u.pathname === '/api/j2/note-templates' && method === 'GET') return json({ templates: server.memberTemplates })
    if (u.pathname === '/api/j2/template-gallery' && method === 'GET') {
      const section = u.searchParams.get('section') || 'all'
      const q = (u.searchParams.get('q') || '').toLowerCase()
      const cat = u.searchParams.get('category')
      let list = section === 'mine' ? server.mine
        : server.gallery.filter((g) => (section === 'picks' ? g.featured : true))
      if (q) list = list.filter((g) => g.title.toLowerCase().includes(q))
      if (cat) list = list.filter((g) => g.category === cat)
      return json({ templates: list.map(({ bodyJson, ...s }) => s), viewer: { admin: server.admin } })
    }
    if (u.pathname === '/api/j2/template-gallery' && method === 'POST') {
      return json({ template: { id: 'g-new', title: body.title, status: 'pending', mine: true } })
    }
    if (u.pathname === '/api/j2/template-gallery/admin/queue') return json(server.queue)
    let m = u.pathname.match(/^\/api\/j2\/template-gallery\/admin\/items\/([\w-]+)$/)
    if (m) return json({ template: { id: m[1], status: body.action === 'approve' ? 'approved' : 'x' } })
    m = u.pathname.match(/^\/api\/j2\/template-gallery\/admin\/reports\/([\w-]+)$/)
    if (m) return json({ ok: true })
    m = u.pathname.match(/^\/api\/j2\/template-gallery\/([\w-]+)\/use$/)
    if (m) {
      if (server.useFails) return json({ detail: 'You can keep up to 200 templates. Delete one to add another.' }, 400)
      const g = server.gallery.find((x) => x.id === m[1])
      return json({ template: { id: 't-copy', name: g.title, title: g.title }, properties: { added: ['Setup'], existing: [], skipped: [] } })
    }
    m = u.pathname.match(/^\/api\/j2\/template-gallery\/([\w-]+)\/report$/)
    if (m) return json({ reported: true, already: false })
    m = u.pathname.match(/^\/api\/j2\/template-gallery\/([\w-]+)$/)
    if (m && method === 'GET') return json({ template: server.gallery.find((x) => x.id === m[1]) })
    if (m && method === 'DELETE') {
      server.mine = server.mine.filter((x) => x.id !== m[1])
      return json({ ok: true })
    }
    return json({ detail: 'Not found' }, 404)
  })
})

afterEach(() => { __resetNotebookFlags() })

function renderPicker(props = {}) {
  const onPickMember = vi.fn()
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <TemplatePicker onPick={vi.fn()} onPickMember={onPickMember} {...props} />
      </SWRConfig>
    </MemoryRouter>,
  )
  return { onPickMember, user }
}

const gateOn = () => latchNotebookFlags({ notebook_template_gallery_enabled: true })
const door = () => screen.getByRole('button', { name: /Browse the community gallery/ })
const sentTo = (path, method) => calls.filter((c) => c.path === path && c.method === method)

async function openGallery(opts) {
  const ctx = renderPicker(opts)
  await ctx.user.click(door())
  await screen.findByRole('heading', { name: 'Community gallery' })
  return ctx
}

describe('the door', () => {
  it('is absent while the gate is off, and nothing else in the picker changes', async () => {
    renderPicker()
    expect(screen.queryByRole('button', { name: /community gallery/i })).not.toBeInTheDocument()
    await screen.findByRole('button', { name: 'Rename Swing plan' })
    expect(screen.queryByRole('button', { name: /Share Swing plan/ })).not.toBeInTheDocument()
    expect(calls.some((c) => c.path.startsWith('/api/j2/template-gallery'))).toBe(false)
  })

  it('opens the gallery with focus on its heading, and Back returns focus to the door', async () => {
    gateOn()
    const { user } = await openGallery()
    expect(screen.getByRole('heading', { name: 'Community gallery' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Back to templates' }))
    await waitFor(() => expect(door()).toHaveFocus())
  })
})

describe('browse', () => {
  it('shows UCT picks above the community, each with its author, and filters by search and category', async () => {
    gateOn()
    const { user } = await openGallery()
    const picks = await screen.findByRole('region', { name: 'UCT picks' })
    expect(within(picks).getByRole('heading', { name: 'Pre-Market Plan' })).toBeInTheDocument()
    const community = screen.getByRole('region', { name: 'Community' })
    expect(within(community).getByText(/by Alice Trader/)).toBeInTheDocument()
    expect(within(community).queryByText('Pre-Market Plan')).not.toBeInTheDocument()   // a pick is not listed twice
    await user.type(screen.getByRole('searchbox', { name: 'Search the community gallery' }), 'breakout')
    await waitFor(() => expect(calls.some((c) => c.search.includes('q=breakout'))).toBe(true))
    const chips = within(screen.getByRole('group', { name: 'Filter by category' }))
    expect(chips.getAllByRole('button').map((b) => b.textContent)).toEqual(['All', ...GALLERY_CATEGORIES.map((c) => c.label)])
    await user.click(chips.getByRole('button', { name: 'Review' }))
    await waitFor(() => expect(calls.some((c) => c.search.includes('category=review'))).toBe(true))
    await user.selectOptions(screen.getByLabelText('Sort'), 'most_used')
    await waitFor(() => expect(calls.some((c) => c.search.includes('sort=most_used'))).toBe(true))
  })

  it('previews read-only, and Use template copies it, says so, then makes a note through the member door', async () => {
    gateOn()
    const { user, onPickMember } = await openGallery()
    await user.click(await screen.findByRole('button', { name: 'Preview Breakout checklist' }))
    const sheet = await screen.findByRole('dialog', { name: 'Breakout checklist' })
    expect(await within(sheet).findByText('Entry checklist')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Use this template' }))
    expect(await screen.findByText(/Added “Breakout checklist” to Your templates\. New properties: Setup\./)).toBeInTheDocument()
    expect(sentTo('/api/j2/template-gallery/g-alice/use', 'POST')).toHaveLength(1)
    expect(onPickMember).not.toHaveBeenCalled()                                   // a copy, not a note
    await user.click(screen.getByRole('button', { name: 'Make a note from it' }))
    expect(onPickMember).toHaveBeenCalledWith(expect.objectContaining({ id: 't-copy', name: 'Breakout checklist' }))
  })

  it('a refused Use is the server’s own sentence on screen', async () => {
    gateOn()
    server.useFails = true
    const { user } = await openGallery()
    await user.click(await screen.findByRole('button', { name: 'Use template Breakout checklist' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You can keep up to 200 templates. Delete one to add another.')
  })

  it('reports with a reason and an optional note, and thanks the member in words', async () => {
    gateOn()
    const { user } = await openGallery()
    await user.click(await screen.findByRole('button', { name: 'Report Breakout checklist' }))
    const form = screen.getByRole('form', { name: 'Report Breakout checklist' })
    expect(within(form).getByRole('button', { name: 'Send report' })).toBeDisabled()       // a reason first
    await user.selectOptions(within(form).getByLabelText('Why are you reporting it?'), 'personal_info')
    await user.type(within(form).getByLabelText(/Anything a moderator should know/), 'has a phone number')
    await user.click(within(form).getByRole('button', { name: 'Send report' }))
    expect(await screen.findByText('Thanks. A moderator will review “Breakout checklist”.')).toBeInTheDocument()
    expect(sentTo('/api/j2/template-gallery/g-alice/report', 'POST')[0].body)
      .toEqual({ reason: 'personal_info', note: 'has a phone number' })
  })
})

describe('publishing and your submissions', () => {
  it('Share on one of Your templates submits it for review and says what is left out', async () => {
    gateOn()
    const { user } = renderPicker()
    await user.click(await screen.findByRole('button', { name: 'Share Swing plan to the community gallery' }))
    const form = screen.getByRole('form', { name: 'Share Swing plan to the community gallery' })
    expect(within(form).getByText(/Left out: links to your other notes, images and attachments/)).toBeInTheDocument()
    expect(within(form).getByLabelText('Title in the gallery')).toHaveValue('Swing plan')
    await user.selectOptions(within(form).getByLabelText('Category'), 'trade_plan')
    await user.click(within(form).getByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByText(/Submitted “Swing plan” for review\./)).toBeInTheDocument()
    expect(sentTo('/api/j2/template-gallery', 'POST')[0].body)
      .toEqual({ templateId: 't1', title: 'Swing plan', description: '', category: 'trade_plan' })
  })

  it('Your submissions shows where each one stands and Unpublish asks once', async () => {
    gateOn()
    const { user } = await openGallery()
    await user.click(screen.getByRole('button', { name: 'Your submissions' }))
    const list = await screen.findByRole('list', { name: 'Your submissions' })
    expect(within(list).getByText('Waiting for review')).toBeInTheDocument()
    expect(within(list).getByText('Not approved')).toBeInTheDocument()
    expect(within(list).getByText('Reviewer: Add your exit rules.')).toBeInTheDocument()
    await user.click(within(list).getByRole('button', { name: 'Unpublish My weekly' }))
    await user.click(within(list).getByRole('button', { name: 'Unpublish' }))
    expect(await screen.findByText(/Unpublished “My weekly”\./)).toBeInTheDocument()
    expect(sentTo('/api/j2/template-gallery/g-mine-1', 'DELETE')).toHaveLength(1)
  })
})

describe('the review queue', () => {
  it('is not offered to a member', async () => {
    gateOn()
    await openGallery()
    await screen.findByRole('region', { name: 'UCT picks' })
    expect(screen.queryByRole('button', { name: 'Review queue' })).not.toBeInTheDocument()
  })

  it('lets an admin approve, reject with a reason, hide a reported one and unhide', async () => {
    gateOn()
    server.admin = true
    const { user } = await openGallery()
    await user.click(await screen.findByRole('button', { name: 'Review queue' }))
    await user.click(await screen.findByRole('button', { name: 'Approve Pending one' }))
    expect(await screen.findByText('Approved “Pending one”. It is listed now.')).toBeInTheDocument()
    expect(sentTo('/api/j2/template-gallery/admin/items/g-p', 'PATCH')[0].body).toEqual({ action: 'approve', note: '' })
    await user.click(screen.getByRole('button', { name: 'Reject Pending one' }))
    const reject = screen.getByRole('form', { name: 'Reject Pending one' })
    expect(within(reject).getByRole('button', { name: 'Reject' })).toBeDisabled()         // a reason first
    await user.type(within(reject).getByLabelText(/The author reads this/), 'Too thin')
    await user.click(within(reject).getByRole('button', { name: 'Reject' }))
    expect(await screen.findByText(/Rejected “Pending one”/)).toBeInTheDocument()
    expect(screen.getByText(/“Spam or advertising” — ads/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide template' }))
    expect(await screen.findByText('Hid “Reported one”.')).toBeInTheDocument()
    expect(sentTo('/api/j2/template-gallery/admin/reports/r1', 'PATCH')[0].body).toEqual({ action: 'hide' })
    await user.click(screen.getByRole('button', { name: 'Unhide Hidden one' }))
    expect(await screen.findByText('“Hidden one” is visible again.')).toBeInTheDocument()
  })
})
