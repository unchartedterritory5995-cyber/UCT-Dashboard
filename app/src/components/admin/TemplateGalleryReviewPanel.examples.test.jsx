// P3b Task 6 — the admin review of an EXAMPLE NOTE: the stored reduced body (its listed `payload.bodyJson`, ruling
// P3b-R13, never the gallery-mode `bodyJson` that drops every image) and its images exactly as a member would see
// them, plus the title of the style it shows. For a HELD revision of a listed example, the revision's own body, with
// its images asked for on `?rev=pending` (the held copies, which approval moves into place).
// ⛔ Asserted by RENDERED TEXT and the rendered `src`.
//
// CONTRACT: the reviewer's read of an example with a held revision is the server's recorded answer
// (`template-gallery.examples.item.revision.admin`). A first submission's read is that answer without its
// `pendingRevision` (a spread, never a retyped shape); the queue rows are spreads of the recorded example as its
// author published it (`template-gallery.examples.publish`), as the style rows' are in the sibling file.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { contract, contractBody } from '../../pages/journal-2-0/__fixtures__/contract'
import { EXAMPLE_NOTE_TYPE, EXAMPLE_REV_PENDING, exampleImagePrefix } from '../../pages/journal-2-0/lib/styleLibrary'
import TemplateGalleryReviewPanel, { exampleLinkLine, exampleRevisionLine } from './TemplateGalleryReviewPanel'

const QUEUE = contractBody('template-gallery.admin.queue')
const PUBLISHED = contractBody('template-gallery.examples.publish').template   // an example as its author submitted it
const REV = contractBody('template-gallery.examples.item.revision.admin').template
const { pendingRevision: _held, ...LISTED_READ } = REV                          // the same read with nothing held
const textOf = (doc) => (doc?.content || []).filter((n) => n.type === 'paragraph')
  .map((n) => (n.content || []).map((t) => t.text || '').join('')).find(Boolean)
const imagesOf = (doc) => (doc?.content || []).filter((n) => n.type === 'image').map((n) => n.attrs.src)
const QUEUE_STAMP = '2026-10-04T08:00:00+00:00'

// A first submission (status pending, nothing held) and a held revision of a listed example, as the queue lists them.
const FIRST = { ...PUBLISHED, id: 'example_first', status: 'pending', hasRevision: false, openReports: 0, updatedAt: QUEUE_STAMP }
const HELD = { ...PUBLISHED, id: REV.id, status: 'approved', hasRevision: true, version: REV.version,
  revisionTitle: REV.pendingRevision.title, openReports: 0, updatedAt: QUEUE_STAMP }

let calls
beforeEach(() => {
  calls = []
  globalThis.fetch = vi.fn((input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const path = String(input).split('?')[0]
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    const ok = (payload, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(payload) })
    if (path === '/api/j2/template-gallery/admin/queue') return ok({ ...QUEUE, pending: [...QUEUE.pending, FIRST, HELD] })
    if (path.startsWith('/api/j2/template-gallery/admin/items/') && method === 'PATCH') return ok(contractBody('template-gallery.admin.approve'))
    if (path === `/api/j2/template-gallery/${FIRST.id}`) return ok({ template: { ...LISTED_READ, id: FIRST.id, status: 'pending', hasRevision: false } })
    if (path === `/api/j2/template-gallery/${HELD.id}`) return ok({ template: REV })
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
async function preview(item) {
  fireEvent.click(within(await rowOf(item.id)).getByRole('button', { name: `Preview ${item.title}` }))
  const sheet = await screen.findByRole('dialog')
  await waitFor(() => expect(within(sheet).queryByText('Loading preview…')).toBeNull())
  return sheet
}

describe('the recorded answers hold what these rails read (non-vacuity)', () => {
  it('an example with an image, a held revision that differs from the listed body, and a linked style', () => {
    expect(REV.itemType).toBe(EXAMPLE_NOTE_TYPE)
    expect(PUBLISHED.itemType).toBe(EXAMPLE_NOTE_TYPE)
    expect(imagesOf(REV.payload.bodyJson)).toEqual([`${exampleImagePrefix(REV.id)}0`])
    expect(imagesOf(REV.bodyJson)).toEqual([])                     // the gallery-mode body has NO image: R13 is decided by it
    expect(textOf(REV.pendingRevision.payload.bodyJson)).not.toBe(textOf(REV.payload.bodyJson))
    expect(REV.pendingRevision.version).toBe(REV.version + 1)
    expect(typeof REV.linkedStyle?.title).toBe('string')
    expect(QUEUE.pending.every((p) => p.itemType === 'outline')).toBe(true)
  })
})

describe('the review of an example note', () => {
  it('the preview renders the reduced body, with its image exactly as a member would load it', async () => {
    renderPanel()
    const sheet = await preview(FIRST)
    expect(within(sheet).getByText(textOf(REV.payload.bodyJson))).toBeInTheDocument()
    const img = within(sheet).getByRole('img')
    expect(img.getAttribute('src')).toBe(imagesOf(REV.payload.bodyJson)[0])   // the listed copy, on the gallery route
    expect(img.getAttribute('src')).not.toMatch(/rev=/)
    expect(within(sheet).getByText(new RegExp(REV.linkedStyle.title))).toBeInTheDocument()
  })

  it('a held revision previews the REVISION\'s body, its images on `?rev=pending`', async () => {
    renderPanel()
    const sheet = await preview(HELD)
    expect(within(sheet).getByText(textOf(REV.pendingRevision.payload.bodyJson))).toBeInTheDocument()
    expect(within(sheet).queryByText(textOf(REV.payload.bodyJson))).toBeNull()          // never the listed one as the update
    const img = within(sheet).getByRole('img')
    expect(img.getAttribute('src')).toBe(`${imagesOf(REV.pendingRevision.payload.bodyJson)[0]}?rev=${EXAMPLE_REV_PENDING}`)
    expect(within(sheet).getByText(new RegExp(`version ${REV.pendingRevision.version}`))).toBeInTheDocument()
  })

  it('the row names the style the example shows, and a held revision says so with its own title', async () => {
    renderPanel()
    const first = await rowOf(FIRST.id)
    expect(await within(first).findByText(exampleLinkLine(REV.linkedStyle.title))).toBeInTheDocument()
    expect(within(first).queryByText(exampleRevisionLine(REV.pendingRevision.version))).toBeNull()
    const held = await rowOf(HELD.id)
    expect(await within(held).findByText(exampleRevisionLine(REV.pendingRevision.version))).toBeInTheDocument()
    expect(within(held).getByText(`Title in this update: ${REV.pendingRevision.title}`)).toBeInTheDocument()
  })

  it('Approve sends the version of the read the row rendered', async () => {
    renderPanel()
    const row = await rowOf(FIRST.id)
    await within(row).findByText(exampleLinkLine(REV.linkedStyle.title))
    fireEvent.click(within(row).getByRole('button', { name: `Approve ${FIRST.title}` }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1))
    const [patch] = calls.filter((c) => c.method === 'PATCH')
    expect(patch.path).toBe(`/api/j2/template-gallery/admin/items/${FIRST.id}`)
    expect(patch.body.reviewedUpdatedAt).toBe(REV.updatedAt)
    expect(patch.body.reviewedUpdatedAt).not.toBe(QUEUE_STAMP)
  })
})
