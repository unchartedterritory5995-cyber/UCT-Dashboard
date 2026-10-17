// P3a Task 10 — the admin review queue for a community STYLE item: its kind, its blocks and its trading style
// (read from the item's payload), the outline through Preview, and, for a held revision of a listed style, the
// revision line and the revision's own title. Approve still sends the version the reviewer looked at.
// ⛔ Asserted by RENDERED TEXT. Every server answer is a recorded fixture (`__fixtures__/contract`); the queue's
// style rows are spreads of the recorded style item (no recorded queue holds a style), never a retyped shape.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { contract, contractBody } from '../../pages/journal-2-0/__fixtures__/contract'
import { blockLabel } from '../../pages/journal-2-0/lib/journalBlocks'
import { BUILTIN_NOTE_KINDS } from '../../pages/journal-2-0/lib/noteKinds'
import { tradingStyleLabel } from '../../pages/journal-2-0/lib/styleLibrary'
import TemplateGalleryReviewPanel, { revisionLine, LISTED_ONLY_LINE } from './TemplateGalleryReviewPanel'

const QUEUE = contractBody('template-gallery.admin.queue')
const SHARED = contractBody('template-gallery.styles.publish').template        // a style as its author submitted it
const ITEM = contractBody('template-gallery.styles.item').template              // a style in full: its `payload`
// A first submission waiting for review, and a held revision of a LISTED style (approved, with pending_at set).
const PENDING_STYLE = { ...SHARED, id: 'style_pending', openReports: 0 }
const REVISION = { ...SHARED, id: ITEM.id, status: 'approved', listedAt: ITEM.listedAt, version: ITEM.version,
  hasRevision: true, revisionTitle: `${SHARED.title}, revised`, openReports: 0 }
const kindName = (id) => BUILTIN_NOTE_KINDS.find((k) => k.id === id).name

let calls
beforeEach(() => {
  calls = []
  globalThis.fetch = vi.fn((input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const path = String(input).split('?')[0]
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    const ok = (payload, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(payload) })
    if (path === '/api/j2/template-gallery/admin/queue') return ok({ ...QUEUE, pending: [...QUEUE.pending, PENDING_STYLE, REVISION] })
    const m = path.match(/^\/api\/j2\/template-gallery\/admin\/items\/([\w-]+)$/)
    if (m && method === 'PATCH') return ok(contractBody('template-gallery.admin.approve'))
    if (path === `/api/j2/template-gallery/${PENDING_STYLE.id}` || path === `/api/j2/template-gallery/${ITEM.id}`) {
      return ok({ template: { ...ITEM, id: path.split('/').pop() } })
    }
    const nf = contract('template-gallery.item.not-found')
    return ok(nf.body, nf._contract.status)
  })
})

const renderPanel = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <TemplateGalleryReviewPanel onMessage={vi.fn()} />
  </SWRConfig>,
)
const rowOf = async (id) => {
  await screen.findByRole('heading', { name: QUEUE.pending[0].title })
  return document.querySelector(`[data-gallery-pending="${id}"]`)
}

describe('the recorded answers hold what these rails read (non-vacuity)', () => {
  it('the style item carries blocks, a built-in kind and a trading style; the queue carries no style', () => {
    expect(ITEM.itemType).toBe('style')
    expect(ITEM.payload.blocks.length).toBeGreaterThan(0)
    expect(BUILTIN_NOTE_KINDS.some((k) => k.id === ITEM.payload.kindId)).toBe(true)
    expect(tradingStyleLabel(SHARED.tradingStyle)).toBeTruthy()
    expect(QUEUE.pending.every((p) => p.itemType === 'outline')).toBe(true)
  })
})

describe('the review queue for a style item', () => {
  it('shows a style\'s kind, its blocks by label and its trading style', async () => {
    renderPanel()
    const row = await rowOf(PENDING_STYLE.id)
    expect(await within(row).findByText(`Blocks: ${ITEM.payload.blocks.map((b) => blockLabel(b.block)).join(', ')}`)).toBeInTheDocument()
    expect(within(row).getByText(`Kind of note: ${kindName(ITEM.payload.kindId)}`)).toBeInTheDocument()
    expect(within(row).getByText(`Trading style: ${tradingStyleLabel(SHARED.tradingStyle)}`)).toBeInTheDocument()
    expect(within(row).queryByText(revisionLine(PENDING_STYLE.version))).toBeNull()          // a first submission is not a revision
  })

  it('an outline row shows none of it (control: the details are the style\'s, not every row\'s)', async () => {
    renderPanel()
    const row = await rowOf(QUEUE.pending[0].id)
    await within(await rowOf(PENDING_STYLE.id)).findByText(/^Blocks: /)
    expect(within(row).queryByText(/^Blocks: /)).toBeNull()
    expect(within(row).queryByText(/^Trading style: /)).toBeNull()
  })

  it('a held revision says it is an update to a listed style, with the revision\'s title, and that the details are the listed version', async () => {
    renderPanel()
    const row = await rowOf(REVISION.id)
    expect(within(row).getByText(revisionLine(REVISION.version))).toBeInTheDocument()
    expect(revisionLine(REVISION.version)).toBe(
      `Update to a listed style (version ${REVISION.version}). Approving lists it; the current version stays until then.`)
    expect(within(row).getByText(`Title in this update: ${REVISION.revisionTitle}`)).toBeInTheDocument()
    expect(within(row).getByText(LISTED_ONLY_LINE)).toBeInTheDocument()
    expect(await within(row).findByText(/^Blocks: /)).toBeInTheDocument()
  })

  it('Preview shows the style\'s outline, and Approve sends the version the reviewer looked at', async () => {
    renderPanel()
    const row = await rowOf(PENDING_STYLE.id)
    fireEvent.click(within(row).getByRole('button', { name: `Preview ${PENDING_STYLE.title}` }))
    const outline = ITEM.bodyJson.content[0].content[0].text
    const preview = await screen.findByRole('dialog', { name: PENDING_STYLE.title })
    expect(await within(preview).findByText(outline)).toBeInTheDocument()
    expect(within(preview).getByText(/the style’s outline/)).toBeInTheDocument()
    fireEvent.click(within(preview).getAllByRole('button', { name: 'Close' })[0])
    fireEvent.click(within(row).getByRole('button', { name: `Approve ${PENDING_STYLE.title}` }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1))
    expect(calls.find((c) => c.method === 'PATCH').body).toEqual({ action: 'approve', note: '', reviewedUpdatedAt: ITEM.updatedAt })
  })
})
