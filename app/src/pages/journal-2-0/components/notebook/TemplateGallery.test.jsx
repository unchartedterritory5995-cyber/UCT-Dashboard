// Wave 12 (lane 12A) — the community template gallery, end to end in the client:
// the door (gated), browse + filters, preview, Use template (a COPY, then the member's
// own create door), report, publish (Share from Your templates), Your submissions with
// unpublish, and the admin review queue. A fake server keeps state across calls, so a
// test that forgets to send the request cannot pass on rendering alone.
// ⛔ Feedback is asserted by RENDERED TEXT, never by a state transition.
//
// CONTRACT: everything the fake server holds and answers is the REAL server's
// (`__fixtures__/contract`, written by tools/notebook_contract_fixtures.py from the
// /api/j2/template-gallery routes and held current by tests/test_notebook_contract_fixtures.py):
// the browse list (UCT's picks and one member's approved template), the full template for the
// preview, the author's submissions in every status, the review queue with one waiting, one
// reported and one hidden, and each action's answer and refusal. The fake only keeps state
// (which rows are left after an unpublish) and routes; it types no shape of its own.
// `/api/j2/note-templates` is older than this wave and keeps its one-row stand-in.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import TemplatePicker from './TemplatePicker'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { GALLERY_CATEGORIES } from '../../lib/templateGallery'
import { contract, contractBody } from '../../__fixtures__/contract'

const LISTED = contractBody('template-gallery.list').templates
const ITEM = contractBody('template-gallery.item').template            // the full template, with its body
const ALICE = LISTED.find((t) => !t.firm)                               // the member's approved template
const PICK = LISTED.find((t) => t.title === 'Pre-Market Plan')          // one of UCT's own
const MINE = contractBody('template-gallery.list.mine').templates
const QUEUE = contractBody('template-gallery.admin.queue.full')
const mineWith = (status) => MINE.find((t) => t.status === status)
const answer = (name) => { const c = contract(name); return { ok: c._contract.status < 400, status: c._contract.status, json: async () => c.body } }

let server
let calls
function freshServer({ admin = false } = {}) {
  return {
    admin,
    gallery: LISTED.map((t) => ({ ...t })),
    mine: MINE.map((t) => ({ ...t })),
    memberTemplates: [{ id: 't1', name: 'Swing plan', title: 'Swing plan', createdAt: '1' }],
    queue: JSON.parse(JSON.stringify(QUEUE)),
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
      return json({ templates: list, viewer: { admin: server.admin } })
    }
    if (u.pathname === '/api/j2/template-gallery' && method === 'POST') return answer('template-gallery.publish')
    if (u.pathname === '/api/j2/template-gallery/admin/queue') return json(server.queue)
    let m = u.pathname.match(/^\/api\/j2\/template-gallery\/admin\/items\/([\w-]+)$/)
    if (m) {
      return answer({ approve: 'template-gallery.admin.approve', reject: 'template-gallery.admin.reject',
        hide: 'template-gallery.admin.hide', unhide: 'template-gallery.admin.unhide' }[body.action] || 'template-gallery.admin.bad-action')
    }
    m = u.pathname.match(/^\/api\/j2\/template-gallery\/admin\/reports\/([\w-]+)$/)
    if (m) return answer('template-gallery.admin.report.hide')
    m = u.pathname.match(/^\/api\/j2\/template-gallery\/([\w-]+)\/use$/)
    if (m) return answer(server.useFails ? 'template-gallery.use.not-found' : 'template-gallery.use')
    m = u.pathname.match(/^\/api\/j2\/template-gallery\/([\w-]+)\/report$/)
    if (m) return answer(server.reportAnswer || 'template-gallery.report')
    m = u.pathname.match(/^\/api\/j2\/template-gallery\/([\w-]+)$/)
    if (m && method === 'GET') return m[1] === ITEM.id ? answer('template-gallery.item') : answer('template-gallery.item.not-found')
    if (m && method === 'DELETE') {
      server.mine = server.mine.filter((x) => x.id !== m[1])
      return answer('template-gallery.unpublish')
    }
    return answer('template-gallery.item.not-found')
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

describe('the recorded gallery holds what these rails read (non-vacuity)', () => {
  it('UCT picks and one member template; submissions in three statuses; a queue with one of each kind', () => {
    expect(LISTED.filter((t) => t.firm).length).toBeGreaterThan(3)
    expect(ALICE).toMatchObject({ title: 'Breakout checklist', author: 'Alice Trader', firm: false, featured: false })
    expect(ITEM.id).toBe(ALICE.id)
    expect(ITEM.bodyJson.type).toBe('doc')
    expect(new Set(MINE.map((t) => t.status))).toEqual(new Set(['pending', 'approved', 'rejected']))
    expect([QUEUE.pending, QUEUE.reported, QUEUE.hidden].map((l) => l.map((t) => t.title)))
      .toEqual([['Earnings notes'], ['Breakout checklist'], ['Sector notes']])
    expect(QUEUE.reported[0].reports).toHaveLength(1)
  })
})

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
    expect(within(picks).getByRole('heading', { name: PICK.title })).toBeInTheDocument()
    for (const t of LISTED.filter((x) => x.featured)) expect(within(picks).getByRole('heading', { name: t.title })).toBeInTheDocument()
    const community = screen.getByRole('region', { name: 'Community' })
    expect(within(community).getByText(/by Alice Trader/)).toBeInTheDocument()
    expect(within(community).getByText(ALICE.description)).toBeInTheDocument()
    expect(within(community).queryByText(PICK.title)).not.toBeInTheDocument()   // a pick is not listed twice
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
    // the preview is the body the server stored: its heading and its two lines
    expect(await within(sheet).findByText('Before the breakout')).toBeInTheDocument()
    expect(within(sheet).getByText('Is the base at least five weeks long?')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Use this template' }))
    const used = contractBody('template-gallery.use')
    expect(used.properties).toEqual({ added: ['Setup'], existing: ['Thesis Status'], skipped: [] })
    expect(await screen.findByText(/Added “Breakout checklist” to Your templates\. New properties: Setup\./)).toBeInTheDocument()
    expect(sentTo(`/api/j2/template-gallery/${ALICE.id}/use`, 'POST')).toHaveLength(1)
    expect(sentTo(`/api/j2/template-gallery/${ALICE.id}`, 'GET')).toHaveLength(1)   // the preview read the full template
    expect(onPickMember).not.toHaveBeenCalled()                                   // a copy, not a note
    await user.click(screen.getByRole('button', { name: 'Make a note from it' }))
    expect(onPickMember).toHaveBeenCalledWith(expect.objectContaining({ id: used.template.id, name: 'Breakout checklist' }))
  })

  it('a refused Use is the server’s own sentence on screen', async () => {
    gateOn()
    server.useFails = true
    const { user } = await openGallery()
    await user.click(await screen.findByRole('button', { name: 'Use template Breakout checklist' }))
    const sentence = contractBody('template-gallery.use.not-found').detail
    expect(await screen.findByRole('alert')).toHaveTextContent(sentence)
    expect(screen.queryByText(/Added “Breakout checklist”/)).not.toBeInTheDocument()
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
    const sent = sentTo(`/api/j2/template-gallery/${ALICE.id}/report`, 'POST')[0].body
    expect(sent).toEqual({ reason: 'personal_info', note: 'has a phone number' })
    // the same two fields the recorded report carried
    expect(Object.keys(sent).sort()).toEqual(Object.keys(contract('template-gallery.report')._contract.requestBody).sort())
  })

  it('a refused report is the server’s own sentence on screen', async () => {
    gateOn()
    server.reportAnswer = 'template-gallery.report.own'
    const { user } = await openGallery()
    await user.click(await screen.findByRole('button', { name: 'Report Breakout checklist' }))
    const form = screen.getByRole('form', { name: 'Report Breakout checklist' })
    await user.selectOptions(within(form).getByLabelText('Why are you reporting it?'), 'spam')
    await user.click(within(form).getByRole('button', { name: 'Send report' }))
    const sentence = contractBody('template-gallery.report.own').detail
    expect(sentence.length).toBeGreaterThan(15)
    expect(await screen.findByRole('alert')).toHaveTextContent(sentence)
    expect(screen.queryByText(/A moderator will review/)).not.toBeInTheDocument()
  })
})

describe('publishing and your submissions', () => {
  it('Share on one of Your templates submits it for review and says what is left out', async () => {
    gateOn()
    const { user } = renderPicker()
    await user.click(await screen.findByRole('button', { name: 'Share Swing plan to the community gallery' }))
    // the share form loads when Share is pressed (it is out of the Notebook's first open)
    const form = await screen.findByRole('form', { name: 'Share Swing plan to the community gallery' })
    expect(within(form).getByText(/Left out: links to your other notes, images and attachments/)).toBeInTheDocument()
    expect(within(form).getByLabelText('Title in the gallery')).toHaveValue('Swing plan')
    await user.selectOptions(within(form).getByLabelText('Category'), 'trade_plan')
    await user.click(within(form).getByRole('button', { name: 'Submit for review' }))
    // the sentence names the title the SERVER stored for the submission
    const stored = contractBody('template-gallery.publish').template.title
    expect(await screen.findByText(new RegExp(`Submitted “${stored}” for review\\.`))).toBeInTheDocument()
    const sent = sentTo('/api/j2/template-gallery', 'POST')[0].body
    expect(sent).toEqual({ templateId: 't1', title: 'Swing plan', description: '', category: 'trade_plan' })
    expect(Object.keys(sent).sort()).toEqual(Object.keys(contract('template-gallery.publish')._contract.requestBody).sort())
  })

  it('Your submissions shows where each one stands and Unpublish asks once', async () => {
    gateOn()
    const { user } = await openGallery()
    await user.click(screen.getByRole('button', { name: 'Your submissions' }))
    const list = await screen.findByRole('list', { name: 'Your submissions' })
    expect(within(list).getAllByText('Waiting for review')).toHaveLength(MINE.filter((t) => t.status === 'pending').length)
    expect(within(list).getByText('Listed')).toBeInTheDocument()
    expect(within(list).getByText('Not approved')).toBeInTheDocument()
    expect(within(list).getByText(`Reviewer: ${mineWith('rejected').reviewNote}`)).toBeInTheDocument()
    const waiting = mineWith('pending')
    await user.click(within(list).getByRole('button', { name: `Unpublish ${waiting.title}` }))
    await user.click(within(list).getByRole('button', { name: 'Unpublish' }))
    expect(await screen.findByText(new RegExp(`Unpublished “${waiting.title}”\\.`))).toBeInTheDocument()
    expect(sentTo(`/api/j2/template-gallery/${waiting.id}`, 'DELETE')).toHaveLength(1)
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
    const [waiting] = QUEUE.pending
    const [reported] = QUEUE.reported
    const [hidden] = QUEUE.hidden
    await user.click(await screen.findByRole('button', { name: `Approve ${waiting.title}` }))
    expect(await screen.findByText(`Approved “${waiting.title}”. It is listed now.`)).toBeInTheDocument()
    expect(sentTo(`/api/j2/template-gallery/admin/items/${waiting.id}`, 'PATCH')[0].body).toEqual({ action: 'approve', note: '' })
    await user.click(screen.getByRole('button', { name: `Reject ${waiting.title}` }))
    const reject = screen.getByRole('form', { name: `Reject ${waiting.title}` })
    expect(within(reject).getByRole('button', { name: 'Reject' })).toBeDisabled()         // a reason first
    await user.type(within(reject).getByLabelText(/The author reads this/), 'Too thin')
    await user.click(within(reject).getByRole('button', { name: 'Reject' }))
    expect(await screen.findByText(new RegExp(`Rejected “${waiting.title}”`))).toBeInTheDocument()
    // the same two fields the recorded rejection carried
    const rejectBody = sentTo(`/api/j2/template-gallery/admin/items/${waiting.id}`, 'PATCH').at(-1).body
    expect(rejectBody).toEqual({ action: 'reject', note: 'Too thin' })
    expect(Object.keys(rejectBody).sort()).toEqual(Object.keys(contract('template-gallery.admin.reject')._contract.requestBody).sort())
    // the report the member really sent: its reason worded, its note quoted
    const [report] = reported.reports
    expect(report).toMatchObject({ reason: 'broken', note: 'The second line is cut off.' })
    expect(screen.getByText(/“Broken or empty” — The second line is cut off\./)).toBeInTheDocument()
    // the button names the template it hides now (lane FIN-A11Y, review R4 M-16)
    await user.click(screen.getByRole('button', { name: `Hide template ${reported.title}` }))
    expect(await screen.findByText(`Hid “${reported.title}”.`)).toBeInTheDocument()
    expect(sentTo(`/api/j2/template-gallery/admin/reports/${report.id}`, 'PATCH')[0].body).toEqual({ action: 'hide' })
    await user.click(screen.getByRole('button', { name: `Unhide ${hidden.title}` }))
    expect(await screen.findByText(`“${hidden.title}” is visible again.`)).toBeInTheDocument()
  })
})
