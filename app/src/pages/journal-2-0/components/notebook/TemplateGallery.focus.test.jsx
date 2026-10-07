// Lane FIN-A11Y (review R4: M-4 and the gallery items in M-16). In the community gallery
// three actions swapped a control for another one and dropped focus (Unpublish to its
// confirm row, "Keep it" back again, closing the Report form), the admin's Feature button
// did not say which template, and results were written into a status region that mounted
// together with its text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import TemplateGallery from './TemplateGallery'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

let admin
const GALLERY = [
  { id: 'g-firm', title: 'Pre-Market Plan', description: 'Your day, planned.', category: 'trade_plan', author: 'UCT',
    firm: true, featured: true, usedBy: 4, preview: [], mine: false },
  { id: 'g-alice', title: 'Breakout checklist', description: 'Before a breakout.', category: 'trade_plan',
    author: 'Alice Trader', firm: false, featured: false, usedBy: 1, preview: [], mine: false },
]
const MINE = [
  { id: 'g-mine-1', title: 'My weekly', status: 'pending', hidden: false, reviewNote: '', mine: true, category: 'review', author: 'Me' },
  { id: 'g-mine-2', title: 'My earnings', status: 'approved', hidden: false, reviewNote: '', mine: true, category: 'research', author: 'Me' },
]
const QUEUE = {
  pending: [{ id: 'g-p', title: 'Pending one', author: 'Bob', category: 'journal', description: '' }],
  reported: [{ id: 'g-r', title: 'Reported one', author: 'Carl', category: 'review', openReports: 1,
    reports: [{ id: 'r1', reason: 'spam', note: 'ads', createdAt: '1' }] }],
  hidden: [],
}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  admin = false
  latchNotebookFlags({ notebook_template_gallery_enabled: true })
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url), 'http://x')
    const method = init.method || 'GET'
    if (u.pathname === '/api/j2/template-gallery' && method === 'GET') {
      const section = u.searchParams.get('section') || 'all'
      const list = section === 'mine' ? MINE : GALLERY.filter((g) => (section === 'picks' ? g.featured : true))
      return json({ templates: list, viewer: { admin } })
    }
    if (u.pathname === '/api/j2/template-gallery/admin/queue') return json(QUEUE)
    return json({ ok: true, template: { id: 'x', status: 'x' } })
  })
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const renderGallery = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemoryRouter><TemplateGallery onBack={() => {}} onUseNow={() => {}} /></MemoryRouter>
  </SWRConfig>,
)

describe('M-4 -- the Report form gives focus back', () => {
  it('Cancel returns focus to the Report button', async () => {
    const user = userEvent.setup()
    renderGallery()
    const report = await screen.findByRole('button', { name: 'Report Breakout checklist' })
    await user.click(report)
    const form = screen.getByRole('form', { name: 'Report Breakout checklist' })
    await user.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Report Breakout checklist' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Report Breakout checklist' })).toHaveFocus()
  })

  it('sending the report returns focus to the Report button too', async () => {
    const user = userEvent.setup()
    renderGallery()
    await user.click(await screen.findByRole('button', { name: 'Report Breakout checklist' }))
    const form = screen.getByRole('form', { name: 'Report Breakout checklist' })
    await user.selectOptions(within(form).getByRole('combobox'), within(form).getAllByRole('option')[1])
    await user.click(within(form).getByRole('button', { name: 'Send report' }))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Report Breakout checklist' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Report Breakout checklist' })).toHaveFocus()
  })
})

describe('M-4 -- Unpublish and "Keep it" keep focus', () => {
  const openMine = async (user) => {
    renderGallery()
    await user.click(await screen.findByRole('button', { name: 'Your submissions' }))
    return screen.findByRole('list', { name: 'Your submissions' })
  }

  it('Unpublish moves focus to "Keep it" in the confirm row (the safe answer)', async () => {
    const user = userEvent.setup()
    const list = await openMine(user)
    await user.click(within(list).getByRole('button', { name: 'Unpublish My weekly' }))
    const confirm = within(list).getByRole('group', { name: 'Unpublish My weekly?' })
    expect(within(confirm).getByRole('button', { name: 'Keep it' })).toHaveFocus()
  })

  it('"Keep it" returns focus to that template\'s Unpublish button', async () => {
    const user = userEvent.setup()
    const list = await openMine(user)
    await user.click(within(list).getByRole('button', { name: 'Unpublish My earnings' }))
    await user.click(within(list).getByRole('button', { name: 'Keep it' }))
    expect(within(list).getByRole('button', { name: 'Unpublish My earnings' })).toHaveFocus()
  })
})

describe('M-16 -- results go into a status region that was already there', () => {
  it('the region is mounted and empty before anything happens, and is refilled, not replaced', async () => {
    const user = userEvent.setup()
    renderGallery()
    await screen.findByRole('button', { name: 'Report Breakout checklist' })
    const region = document.querySelector('[data-gallery-message]')
    expect(region).not.toBeNull()
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveTextContent('')
    await user.click(screen.getByRole('button', { name: 'Use template Breakout checklist' }))
    await waitFor(() => expect(region.textContent.length).toBeGreaterThan(0))
    expect(document.querySelector('[data-gallery-message]')).toBe(region)
  })
})

describe('M-4 and M-16 -- admin controls say which template', () => {
  it('Feature and Unfeature carry the template name', async () => {
    admin = true
    renderGallery()
    expect(await screen.findByRole('button', { name: 'Feature Breakout checklist' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unfeature Pre-Market Plan' })).toBeInTheDocument()
  })

  it('the review queue names the template on Hide and Dismiss, and its items are headings', async () => {
    admin = true
    const user = userEvent.setup()
    renderGallery()
    await user.click(await screen.findByRole('button', { name: 'Review queue' }))
    expect(await screen.findByRole('button', { name: 'Hide template Reported one' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss the report on Reported one' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Reported one' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pending one' })).toBeInTheDocument()
  })
})
