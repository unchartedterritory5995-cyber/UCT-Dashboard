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
import TemplateGalleryReviewPanel, { revisionLine, layoutRevisionLine, REVISION_UNREADABLE_LINE, CARD_REFRESHED_LINE } from './TemplateGalleryReviewPanel'
import { LAYOUT_UNSUPPORTED_SENTENCE } from '../../pages/journal-2-0/lib/styleLibrary'

const QUEUE = contractBody('template-gallery.admin.queue')
const SHARED = contractBody('template-gallery.styles.publish').template        // a style as its author submitted it
const ITEM = contractBody('template-gallery.styles.item').template              // a style in full: its `payload`
const REV_ITEM = contractBody('template-gallery.styles.item.revision.admin').template   // an admin's read of a held revision
const QUEUE_STAMP = '2026-10-04T08:00:00+00:00'
const textOf = (doc) => doc.content[0].content[0].text
// The recorded revision, made to differ from the listed version where the panel could confuse the two.
const REVISED_OUTLINE = { ...REV_ITEM.payload.outlineBodyJson, content: [{ ...REV_ITEM.payload.outlineBodyJson.content[0],
  content: [{ ...REV_ITEM.payload.outlineBodyJson.content[0].content[0], text: `Revised: ${textOf(REV_ITEM.payload.outlineBodyJson)}` }] }] }
// Final review M-10: the read's `pendingRevision.version` is moved OFF "listed + 1", so a panel that restated the
// server's arithmetic from the queue row (`item.version + 1`) would print a different number than one that reads it.
const REVISION_READ = { ...REV_ITEM, pendingRevision: { ...REV_ITEM.pendingRevision, tradingStyle: 'day',
  description: 'Now with a rules block.', category: 'review', version: REV_ITEM.pendingRevision.version + 1,
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

// P4b Task 8: PAGE LAYOUT rows. The queue rows spread the recorded layout share (no recorded queue holds a layout);
// the reads are the recorded layout item and the recorded admin read of a held layout revision. The revision's
// trading style is moved off the listed one so a card that showed the listed version cannot pass.
const LAYOUT_SHARED = contractBody('template-gallery.layouts.publish').template
const LAYOUT_ITEM = contractBody('template-gallery.layouts.item').template
const LAYOUT_REV = contractBody('template-gallery.layouts.item.revision.admin').template
const LAYOUT_REV_READ = { ...LAYOUT_REV, pendingRevision: { ...LAYOUT_REV.pendingRevision, tradingStyle: 'day' } }
const PENDING_LAYOUT = { ...LAYOUT_SHARED, id: 'layout_pending', openReports: 0, updatedAt: QUEUE_STAMP }
const LAYOUT_REVISION = { ...LAYOUT_SHARED, id: LAYOUT_REV.id, status: 'approved', listedAt: LAYOUT_REV.listedAt,
  version: LAYOUT_REV.version, hasRevision: true, revisionTitle: LAYOUT_REV.pendingRevision.title, openReports: 0, updatedAt: QUEUE_STAMP }
const NULL_LAYOUT = { ...PENDING_LAYOUT, id: 'layout_null', title: 'Every panel unknown' }
const NULL_REVISION = { ...LAYOUT_REVISION, id: 'layout_null_rev', title: 'An update with every panel unknown' }
const TODAY_LAYOUT = { ...PENDING_LAYOUT, id: 'layout_today', title: 'Calm open', layoutPage: 'today' }
const TODAY_PAYLOAD = { page: 'today', lists: { premarket: [{ id: 'notices', shown: true }],
  market: [{ id: 'regime', shown: true }, { id: 'quickActions', shown: false }] } }
let extraPending = []

let calls
let pendingRead
beforeEach(() => {
  calls = []
  pendingRead = { ...ITEM, id: PENDING_STYLE.id }
  extraPending = []
  globalThis.fetch = vi.fn((input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const path = String(input).split('?')[0]
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    const ok = (payload, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(payload) })
    if (path === '/api/j2/template-gallery/admin/queue') {
      return ok({ ...QUEUE, pending: [...QUEUE.pending, PENDING_STYLE, REVISION, UNREADABLE, ...extraPending] })
    }
    if (path === `/api/j2/template-gallery/${PENDING_LAYOUT.id}`) return ok({ template: { ...LAYOUT_ITEM, id: PENDING_LAYOUT.id } })
    if (path === `/api/j2/template-gallery/${LAYOUT_REVISION.id}`) return ok({ template: LAYOUT_REV_READ })
    if (path === `/api/j2/template-gallery/${NULL_LAYOUT.id}`) return ok({ template: { ...LAYOUT_ITEM, id: NULL_LAYOUT.id, payload: null } })
    if (path === `/api/j2/template-gallery/${NULL_REVISION.id}`) {
      return ok({ template: { ...LAYOUT_REV_READ, id: NULL_REVISION.id, pendingRevision: { ...LAYOUT_REV_READ.pendingRevision, payload: null } } })
    }
    if (path === `/api/j2/template-gallery/${TODAY_LAYOUT.id}`) {
      return ok({ template: { ...LAYOUT_ITEM, id: TODAY_LAYOUT.id, layoutPage: 'today', payload: TODAY_PAYLOAD } })
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
    // The server's version for the update (M-10), never the listed one and never the queue row's + 1
    expect(await within(row).findByText(revisionLine(rev.version))).toBeInTheDocument()
    expect(revisionLine(rev.version)).toBe(
      `Update to version ${rev.version} of a listed style. Approving lists it; the current version stays until then.`)
    expect(new Set([rev.version, REVISION.version, REVISION.version + 1]).size).toBe(3)        // non-vacuity
    expect(within(row).queryByText(revisionLine(REVISION.version))).toBeNull()
    expect(within(row).queryByText(revisionLine(REVISION.version + 1))).toBeNull()
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
    // ONE number for one revision: the subtitle names the same version as the card line (M-10)
    const v = REVISION_READ.pendingRevision.version
    expect(await within(preview).findByText(new RegExp(`the update’s outline \\(version ${v}\\)`))).toBeInTheDocument()
    expect(within(row).getByText(revisionLine(v))).toBeInTheDocument()
    expect(within(preview).queryByText(new RegExp(`\\(version ${REVISION.version + 1}\\)`))).toBeNull()
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

  // Task 11 (review N-4): the refreshed line used to stay for as long as the row stayed pending.
  const refreshCard = async () => {
    const row = await rowOf(PENDING_STYLE.id)
    await within(row).findByText(/^Blocks: /)
    pendingRead = RESUBMITTED
    fireEvent.click(within(row).getByRole('button', { name: `Preview ${PENDING_STYLE.title}` }))
    const preview = await screen.findByRole('dialog', { name: PENDING_STYLE.title })
    expect(await within(row).findByText(CARD_REFRESHED_LINE)).toBeInTheDocument()
    fireEvent.click(within(preview).getAllByRole('button', { name: 'Close' })[0])
    await within(row).findByText('Blocks: none')
    return row
  }

  it('N-4: the refreshed line clears when the reviewer acts on the row (Approve)', async () => {
    renderPanel()
    const row = await refreshCard()
    fireEvent.click(within(row).getByRole('button', { name: `Approve ${PENDING_STYLE.title}` }))
    await waitFor(() => expect(patches()).toHaveLength(1))
    await waitFor(() => expect(within(row).queryByText(CARD_REFRESHED_LINE)).toBeNull())
    expect(within(row).getByText('Blocks: none')).toBeInTheDocument()            // the card itself is untouched
  })

  it('N-4: the refreshed line clears when the reviewer acts on the row (Reject sent), not when Reject… opens', async () => {
    renderPanel()
    const row = await refreshCard()
    fireEvent.click(within(row).getByRole('button', { name: `Reject ${PENDING_STYLE.title}` }))
    const form = await screen.findByRole('form', { name: `Reject ${PENDING_STYLE.title}` })
    expect(within(row).getByText(CARD_REFRESHED_LINE)).toBeInTheDocument()       // M-1: opening is an intent
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(within(row).getByText(CARD_REFRESHED_LINE)).toBeInTheDocument()       // and Cancel did nothing
    fireEvent.click(within(row).getByRole('button', { name: `Reject ${PENDING_STYLE.title}` }))
    const again = await screen.findByRole('form', { name: `Reject ${PENDING_STYLE.title}` })
    fireEvent.change(within(again).getByRole('textbox'), { target: { value: 'Too thin yet.' } })
    fireEvent.click(within(again).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(patches()).toHaveLength(1))
    await waitFor(() => expect(within(row).queryByText(CARD_REFRESHED_LINE)).toBeNull())
  })

  it('M-1: an Approve the server refuses (409) leaves the refreshed line where it was', async () => {
    renderPanel()
    const row = await refreshCard()
    const real = globalThis.fetch
    globalThis.fetch = vi.fn((input, init = {}) => {
      if ((init.method || '').toUpperCase() !== 'PATCH') return real(input, init)
      calls.push({ method: 'PATCH', path: String(input), body: JSON.parse(init.body) })
      return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ detail: 'This changed since you looked.' }) })
    })
    fireEvent.click(within(row).getByRole('button', { name: `Approve ${PENDING_STYLE.title}` }))
    await waitFor(() => expect(patches()).toHaveLength(1))
    await waitFor(() => expect(within(row).getByRole('button', { name: `Approve ${PENDING_STYLE.title}` })).not.toBeDisabled())
    expect(within(row).getByText(CARD_REFRESHED_LINE)).toBeInTheDocument()
  })

  it('N-4: the refreshed line clears when the reviewer reopens a card that is now current', async () => {
    renderPanel()
    const row = await refreshCard()
    fireEvent.click(within(row).getByRole('button', { name: `Preview ${PENDING_STYLE.title}` }))
    const again = await screen.findByRole('dialog', { name: PENDING_STYLE.title })
    await within(again).findByText(textOf(RESUBMITTED.bodyJson))
    await waitFor(() => expect(within(row).queryByText(CARD_REFRESHED_LINE)).toBeNull())
    // CONTROL: a reopened card is cleared, not a card the reviewer never refreshed
    expect(within(row).getByText('Blocks: none')).toBeInTheDocument()
  })

  it('an outline row still approves with its queue token (unchanged)', async () => {
    renderPanel()
    const row = await rowOf(QUEUE.pending[0].id)
    fireEvent.click(within(row).getByRole('button', { name: `Approve ${QUEUE.pending[0].title}` }))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body.reviewedUpdatedAt).toBe(QUEUE.pending[0].updatedAt)
  })
})

describe('the review queue for a page layout item (P4b Task 8)', () => {
  beforeEach(() => { extraPending = [PENDING_LAYOUT, LAYOUT_REVISION, NULL_LAYOUT, NULL_REVISION, TODAY_LAYOUT] })
  const listItems = (row, name) => within(within(row).getByRole('list', { name })).getAllByRole('listitem').map((li) => li.textContent)

  it('non-vacuity: the recorded layout item and revision carry trade lists that differ in order', () => {
    expect(LAYOUT_ITEM.payload.lists.trade.map((e) => e.id)).toEqual(['story', 'chart', 'outcome'])
    expect(LAYOUT_REV.pendingRevision.payload.lists.trade.map((e) => e.id)).toEqual(['outcome', 'chart', 'story'])
    expect(LAYOUT_REV.pendingRevision.version).toBe(2)
  })

  it('shows Page: Trade page, the trading style, and the panels in order with Shown / Hidden', async () => {
    renderPanel()
    const row = await rowOf(PENDING_LAYOUT.id)
    await within(row).findByRole('list', { name: 'Trade page panels' })
    expect(within(row).getByText('Page: Trade page')).toBeInTheDocument()
    expect(within(row).getByText(`Trading style: ${tradingStyleLabel(LAYOUT_ITEM.tradingStyle)}`)).toBeInTheDocument()
    expect(listItems(row, 'Trade page panels')).toEqual(['The story: Shown', 'Chart: Hidden', 'Outcome: Shown'])
    expect(within(row).queryByRole('button', { name: `Preview ${PENDING_LAYOUT.title}` })).not.toBeInTheDocument()
  })

  it('a Today layout says Page: Today and lists each phase it carries, by its label', async () => {
    renderPanel()
    const row = await rowOf(TODAY_LAYOUT.id)
    await within(row).findByRole('list', { name: 'Market panels' })
    expect(within(row).getByText('Page: Today')).toBeInTheDocument()
    expect(listItems(row, 'Premarket panels')).toEqual(['Notices: Shown'])
    expect(listItems(row, 'Market panels')).toEqual(['Market regime: Shown', 'Quick actions: Hidden'])
    expect(within(row).queryByRole('list', { name: 'After close panels' })).not.toBeInTheDocument()
  })

  it('a held revision shows the update line and the REVISION\'s own lists and trading style', async () => {
    renderPanel()
    const row = await rowOf(LAYOUT_REVISION.id)
    await within(row).findByRole('list', { name: 'Trade page panels' })
    expect(within(row).getByText(layoutRevisionLine(LAYOUT_REV.pendingRevision.version))).toBeInTheDocument()
    expect(layoutRevisionLine(2)).toBe('Update to a listed layout (version 2). Approving lists it; the current version stays until then.')
    expect(listItems(row, 'Trade page panels')).toEqual(['Outcome: Shown', 'Chart: Hidden', 'The story: Shown'])
    expect(within(row).getByText(`Trading style: ${tradingStyleLabel('day')}`)).toBeInTheDocument()
    expect(within(row).queryByText(`Trading style: ${tradingStyleLabel('swing')}`)).not.toBeInTheDocument()
  })

  it('T6b-R1: a payload of null says the layout cannot be used yet and shows no lists (the item and a revision alike)', async () => {
    renderPanel()
    for (const item of [NULL_LAYOUT, NULL_REVISION]) {
      const row = await rowOf(item.id)
      expect(await within(row).findByText(LAYOUT_UNSUPPORTED_SENTENCE)).toBeInTheDocument()
      expect(within(row).queryByRole('list')).not.toBeInTheDocument()
    }
  })

  it('Approve sends the version of the read that rendered the details (reviewedUpdatedAt)', async () => {
    renderPanel()
    const row = await rowOf(PENDING_LAYOUT.id)
    await within(row).findByRole('list', { name: 'Trade page panels' })
    fireEvent.click(within(row).getByRole('button', { name: `Approve ${PENDING_LAYOUT.title}` }))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].path).toBe(`/api/j2/template-gallery/admin/items/${PENDING_LAYOUT.id}`)
    expect(patches()[0].body).toEqual({ action: 'approve', note: '', reviewedUpdatedAt: LAYOUT_ITEM.updatedAt })
    expect(LAYOUT_ITEM.updatedAt).not.toBe(QUEUE_STAMP)
  })

  it('control: a style row still shows its kind and blocks, and no layout details', async () => {
    renderPanel()
    const row = await rowOf(PENDING_STYLE.id)
    await within(row).findByText(`Kind of note: ${kindName(ITEM.payload.kindId)}`)
    expect(within(row).queryByText(/^Page: /)).not.toBeInTheDocument()
  })
})
