// P3a Task 10 — the admin review queue for a community STYLE item: its kind, its blocks and its trading style
// (read from the item's payload), the outline through Preview, and, for a held revision of a listed style, the
// revision line and the REVISION's own content (ruling P3a-T10-R1: the admin-only `pendingRevision`). Approve
// sends the version of the read the reviewer was shown.
// ⛔ Asserted by RENDERED TEXT. Every server answer is a recorded fixture (`__fixtures__/contract`); the queue's
// style rows are spreads of the recorded style items (no recorded queue holds a style), never a retyped shape.
// ⛔ Fix round 1, M-2: each queue row carries a stamp of its own, distinct from the read's, so an approve that sent
// the queue row's token instead of the rendered read's cannot pass; and the revision differs from the listed
// version in its trading style and outline, so a panel showing the listed one cannot pass either.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { contract, contractBody } from '../../pages/journal-2-0/__fixtures__/contract'
import { blockLabel } from '../../pages/journal-2-0/lib/journalBlocks'
import { BUILTIN_NOTE_KINDS } from '../../pages/journal-2-0/lib/noteKinds'
import { tradingStyleLabel } from '../../pages/journal-2-0/lib/styleLibrary'
import { categoryLabel } from '../../pages/journal-2-0/lib/templateGallery'
import TemplateGalleryReviewPanel, { revisionLine, REVISION_UNREADABLE_LINE, CARD_REFRESHED_LINE } from './TemplateGalleryReviewPanel'

const QUEUE = contractBody('template-gallery.admin.queue')
const SHARED = contractBody('template-gallery.styles.publish').template        // a style as its author submitted it
const ITEM = contractBody('template-gallery.styles.item').template              // a style in full: its `payload`
const REV_ITEM = contractBody('template-gallery.styles.item.revision.admin').template   // an admin's read of a held revision
const QUEUE_STAMP = '2026-10-04T08:00:00+00:00'
const textOf = (doc) => doc.content[0].content[0].text
// The recorded revision, made to differ from the listed version where the panel could confuse the two.
const REVISED_OUTLINE = { ...REV_ITEM.payload.outlineBodyJson, content: [{ ...REV_ITEM.payload.outlineBodyJson.content[0],
  content: [{ ...REV_ITEM.payload.outlineBodyJson.content[0].content[0], text: `Revised: ${textOf(REV_ITEM.payload.outlineBodyJson)}` }] }] }
const REVISION_READ = { ...REV_ITEM, pendingRevision: { ...REV_ITEM.pendingRevision, tradingStyle: 'day',
  description: 'Now with a rules block.', category: 'review',
  payload: { ...REV_ITEM.pendingRevision.payload, outlineBodyJson: REVISED_OUTLINE } } }
// A first submission waiting for review, and a held revision of a LISTED style (approved, with pending_at set).
const PENDING_STYLE = { ...SHARED, id: 'style_pending', openReports: 0, updatedAt: QUEUE_STAMP }
const REVISION = { ...SHARED, id: REV_ITEM.id, status: 'approved', listedAt: REV_ITEM.listedAt, version: REV_ITEM.version,
  hasRevision: true, revisionTitle: REV_ITEM.pendingRevision.title, openReports: 0, updatedAt: QUEUE_STAMP }
const UNREADABLE = { ...REVISION, id: 'style_unreadable' }
const kindName = (id) => BUILTIN_NOTE_KINDS.find((k) => k.id === id).name
// R7: the author resubmits while the reviewer is looking: a newer read of the first submission, with no blocks.
const RESUBMITTED_STAMP = '2026-10-08T16:45:00+00:00'
const RESUBMITTED = { ...ITEM, id: PENDING_STYLE.id, updatedAt: RESUBMITTED_STAMP, payload: { ...ITEM.payload, blocks: [] } }

let calls
let pendingRead
beforeEach(() => {
  calls = []
  pendingRead = { ...ITEM, id: PENDING_STYLE.id }
  globalThis.fetch = vi.fn((input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const path = String(input).split('?')[0]
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    const ok = (payload, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(payload) })
    if (path === '/api/j2/template-gallery/admin/queue') {
      return ok({ ...QUEUE, pending: [...QUEUE.pending, PENDING_STYLE, REVISION, UNREADABLE] })
    }
    const m = path.match(/^\/api\/j2\/template-gallery\/admin\/items\/([\w-]+)$/)
    if (m && method === 'PATCH') return ok(contractBody('template-gallery.admin.approve'))
    if (path === `/api/j2/template-gallery/${PENDING_STYLE.id}`) return ok({ template: pendingRead })
    if (path === `/api/j2/template-gallery/${REVISION.id}`) return ok({ template: REVISION_READ })
    // a revision row whose revision the server could not read: the item answers without `pendingRevision`
    if (path === `/api/j2/template-gallery/${UNREADABLE.id}`) return ok({ template: { ...ITEM, id: UNREADABLE.id } })
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
const patches = () => calls.filter((c) => c.method === 'PATCH')

describe('the recorded answers hold what these rails read (non-vacuity)', () => {
  it('the style items carry blocks and a built-in kind; the revision differs from the listed version; no queue has a style', () => {
    expect(ITEM.itemType).toBe('style')
    expect(ITEM.payload.blocks.length).toBeGreaterThan(0)
    expect(BUILTIN_NOTE_KINDS.some((k) => k.id === ITEM.payload.kindId)).toBe(true)
    expect(REV_ITEM.pendingRevision.version).toBe(REV_ITEM.version + 1)
    expect(REV_ITEM.payload.blocks).toEqual([])                                   // listed: no blocks yet
    expect(REV_ITEM.pendingRevision.payload.blocks.length).toBeGreaterThan(0)    // the update adds one
    expect(REVISION_READ.pendingRevision.tradingStyle).not.toBe(REVISION.tradingStyle)
    expect(new Set([QUEUE_STAMP, ITEM.updatedAt]).size).toBe(2)
    expect(QUEUE.pending.every((p) => p.itemType === 'outline')).toBe(true)
  })
})

describe('the review queue for a style item', () => {
  it('shows a style\'s kind, its blocks by label and its trading style', async () => {
    renderPanel()
    const row = await rowOf(PENDING_STYLE.id)
    expect(await within(row).findByText(`Blocks: ${ITEM.payload.blocks.map((b) => blockLabel(b.block)).join(', ')}`)).toBeInTheDocument()
    expect(within(row).getByText(`Kind of note: ${kindName(ITEM.payload.kindId)}`)).toBeInTheDocument()
    expect(within(row).getByText(`Trading style: ${tradingStyleLabel(ITEM.tradingStyle)}`)).toBeInTheDocument()
    expect(within(row).queryByText(revisionLine(PENDING_STYLE.version))).toBeNull()          // a first submission is not a revision
  })

  it('an outline row shows none of it (control: the details are the style\'s, not every row\'s)', async () => {
    renderPanel()
    const row = await rowOf(QUEUE.pending[0].id)
    await within(await rowOf(PENDING_STYLE.id)).findByText(/^Blocks: /)
    expect(within(row).queryByText(/^Blocks: /)).toBeNull()
    expect(within(row).queryByText(/^Trading style: /)).toBeNull()
  })

  it('a held revision shows the REVISION\'s own title, description, category, kind, blocks and trading style', async () => {
    renderPanel()
    const row = await rowOf(REVISION.id)
    const rev = REVISION_READ.pendingRevision
    expect(within(row).getByText(revisionLine(REVISION.version))).toBeInTheDocument()
    expect(revisionLine(REVISION.version)).toBe(
      `Update to a listed style (version ${REVISION.version}). Approving lists it; the current version stays until then.`)
    expect(await within(row).findByText(`Title in this update: ${rev.title}`)).toBeInTheDocument()
    expect(within(row).getByText(`Description in this update: ${rev.description}`)).toBeInTheDocument()
    expect(within(row).getByText(`Category in this update: ${categoryLabel(rev.category)}`)).toBeInTheDocument()
    expect(within(row).getByText(`Kind of note: ${kindName(rev.payload.kindId)}`)).toBeInTheDocument()
    expect(within(row).getByText(`Blocks: ${rev.payload.blocks.map((b) => blockLabel(b.block)).join(', ')}`)).toBeInTheDocument()
    // from the read, not the queue row (whose trading style is the listed version's)
    expect(within(row).getByText(`Trading style: ${tradingStyleLabel(rev.tradingStyle)}`)).toBeInTheDocument()
    expect(within(row).queryByText(`Trading style: ${tradingStyleLabel(REVISION.tradingStyle)}`)).toBeNull()
    expect(within(row).queryByText('Blocks: none')).toBeNull()                       // not the listed payload
  })

  it('a revision the server could not read says so, and shows nothing from the listed version as the update', async () => {
    renderPanel()
    const row = await rowOf(UNREADABLE.id)
    expect(await within(row).findByText(REVISION_UNREADABLE_LINE)).toBeInTheDocument()
    expect(within(row).queryByText(/^Blocks: /)).toBeNull()
    expect(within(row).queryByText(/^Title in this update/)).toBeNull()
  })

  it('Preview of a revision shows the update\'s outline, not the listed one', async () => {
    renderPanel()
    const row = await rowOf(REVISION.id)
    fireEvent.click(within(row).getByRole('button', { name: `Preview ${REVISION.title}` }))
    const preview = await screen.findByRole('dialog', { name: REVISION.title })
    expect(await within(preview).findByText(textOf(REVISED_OUTLINE))).toBeInTheDocument()
    expect(within(preview).queryByText(textOf(REV_ITEM.bodyJson))).toBeNull()
    expect(within(preview).getByText(new RegExp(`the update’s outline \\(version ${REVISION.version + 1}\\)`))).toBeInTheDocument()
  })

  it('Preview shows a first submission\'s outline', async () => {
    renderPanel()
    const row = await rowOf(PENDING_STYLE.id)
    fireEvent.click(within(row).getByRole('button', { name: `Preview ${PENDING_STYLE.title}` }))
    const preview = await screen.findByRole('dialog', { name: PENDING_STYLE.title })
    expect(await within(preview).findByText(textOf(ITEM.bodyJson))).toBeInTheDocument()
    expect(within(preview).getByText(/the style’s outline/)).toBeInTheDocument()
  })

  it('Approve sends the version of the read that rendered the details, without opening Preview', async () => {
    renderPanel()
    const row = await rowOf(PENDING_STYLE.id)
    await within(row).findByText(/^Blocks: /)
    fireEvent.click(within(row).getByRole('button', { name: `Approve ${PENDING_STYLE.title}` }))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body).toEqual({ action: 'approve', note: '', reviewedUpdatedAt: ITEM.updatedAt })
    expect(patches()[0].body.reviewedUpdatedAt).not.toBe(QUEUE_STAMP)
  })

  it('R7: a Preview of the SAME version as the card leaves the token and the card alone', async () => {
    renderPanel()
    const row = await rowOf(PENDING_STYLE.id)
    await within(row).findByText(/^Blocks: /)
    fireEvent.click(within(row).getByRole('button', { name: `Preview ${PENDING_STYLE.title}` }))
    const preview = await screen.findByRole('dialog', { name: PENDING_STYLE.title })
    await within(preview).findByText(textOf(ITEM.bodyJson))
    expect(screen.queryByText(CARD_REFRESHED_LINE)).toBeNull()
    fireEvent.click(within(preview).getAllByRole('button', { name: 'Close' })[0])
    fireEvent.click(within(row).getByRole('button', { name: `Approve ${PENDING_STYLE.title}` }))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body.reviewedUpdatedAt).toBe(ITEM.updatedAt)
  })

  it('R7: a resubmission between the card read and Preview refreshes the card, and Approve sends the version the card shows', async () => {
    renderPanel()
    const row = await rowOf(PENDING_STYLE.id)
    const before = `Blocks: ${ITEM.payload.blocks.map((b) => blockLabel(b.block)).join(', ')}`
    expect(await within(row).findByText(before)).toBeInTheDocument()            // the card shows version A
    pendingRead = RESUBMITTED                                                     // the author shares again
    fireEvent.click(within(row).getByRole('button', { name: `Preview ${PENDING_STYLE.title}` }))
    const preview = await screen.findByRole('dialog', { name: PENDING_STYLE.title })
    expect(await screen.findByText(CARD_REFRESHED_LINE)).toBeInTheDocument()
    fireEvent.click(within(preview).getAllByRole('button', { name: 'Close' })[0])
    expect(await within(row).findByText('Blocks: none')).toBeInTheDocument()     // the card now shows version B
    expect(within(row).queryByText(before)).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: `Approve ${PENDING_STYLE.title}` }))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body.reviewedUpdatedAt).toBe(RESUBMITTED_STAMP)          // the version the card renders
  })

  it('an outline row still approves with its queue token (unchanged)', async () => {
    renderPanel()
    const row = await rowOf(QUEUE.pending[0].id)
    fireEvent.click(within(row).getByRole('button', { name: `Approve ${QUEUE.pending[0].title}` }))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body.reviewedUpdatedAt).toBe(QUEUE.pending[0].updatedAt)
  })
})
