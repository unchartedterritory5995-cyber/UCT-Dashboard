// P3b Task 6 — a style's examples, shown in full in the surface P3a already uses to show one style (its Preview,
// ruling P3b-R7): a section "In use" with one card per example, each example's stored body rendered read-only by
// the library's own renderer (TemplatePreview's DocBody), its images on the gallery image route. No section when the
// style has no examples, or when the server sends no `examples` at all (the switch off, an older pod).
// ⛔ Asserted by RENDERED TEXT and the rendered `src`, through the real client (lib/styleLibrary.js) and the real
//    gallery, with only the network faked.
//
// CONTRACT: the style item WITH its examples is the server's recorded answer (`template-gallery.examples.style-item`,
// tools/notebook_contract_fixtures.py), re-pointed at the listed style's id (the list was recorded in another
// builder); the style item with none is `template-gallery.styles.item`. No example is typed here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../lib/offline/notebookFlags'
import { contract, contractBody } from '../../../__fixtures__/contract'
import {
  EXAMPLE_REV_PENDING, exampleImagePrefix, styleExamples, withHeldImages,
} from '../../../lib/styleLibrary'
import TemplateGallery from '../TemplateGallery'
import ExamplesInUse, { IN_USE_HEADING } from './ExamplesInUse'

const STYLE = contractBody('template-gallery.list.styles').templates[0]
const WITH_EXAMPLES = contractBody('template-gallery.examples.style-item').template
const WITHOUT = contractBody('template-gallery.styles.item').template
const EXAMPLES = WITH_EXAMPLES.examples
const textOf = (doc) => (doc?.content || []).filter((n) => n.type === 'paragraph')
  .map((n) => (n.content || []).map((t) => t.text || '').join('')).find(Boolean)
const imagesOf = (doc) => (doc?.content || []).filter((n) => n.type === 'image').map((n) => n.attrs.src)
const readRepo = (rel) => readFileSync(resolve(process.cwd(), '..', rel), 'utf8')

let itemAnswer
beforeEach(() => {
  itemAnswer = { ...WITH_EXAMPLES, id: STYLE.id }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url), 'http://x')
    const method = (init.method || 'GET').toUpperCase()
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
    if (u.pathname === '/api/j2/template-gallery' && method === 'GET') {
      const list = contractBody('template-gallery.list.styles')
      const picks = u.searchParams.get('section') === 'picks'
      return json({ ...list, templates: list.templates.filter((t) => !picks || t.featured), viewer: { admin: false } })
    }
    if (u.pathname === '/api/j2/journal-styles/preview' && method === 'POST') {
      return json(contractBody('template-gallery.styles.preview'))
    }
    if (u.pathname === `/api/j2/template-gallery/${STYLE.id}` && method === 'GET') return json({ template: itemAnswer })
    const nf = contract('template-gallery.item.not-found')
    return json(nf.body, nf._contract.status)
  })
})

afterEach(() => { __resetNotebookFlags() })

function renderGallery() {
  latchNotebookFlags({ notebook_template_gallery_enabled: true, notebook_style_library_enabled: true })
  render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <TemplateGallery onBack={vi.fn()} initialType="style" />
      </SWRConfig>
    </MemoryRouter>,
  )
}

async function openPreview() {
  const user = userEvent.setup()
  renderGallery()
  await user.click(await screen.findByRole('button', { name: `Preview ${STYLE.title}` }))
  const sheet = await screen.findByRole('dialog', { name: STYLE.title })
  // the style's own composed body has rendered, so the read of the item has answered
  expect(await within(sheet).findByText(textOf(contractBody('template-gallery.styles.preview').bodyJson))).toBeInTheDocument()
  return sheet
}

describe('the recorded answers hold what these rails read (non-vacuity)', () => {
  it('the recorded style has an approved example with an image on the gallery route; the other style has none', () => {
    expect(EXAMPLES.length).toBeGreaterThan(0)
    for (const e of EXAMPLES) expect(Object.keys(e).sort()).toEqual(['bodyJson', 'id', 'title', 'updatedAt'])
    expect(imagesOf(EXAMPLES[0].bodyJson)[0].startsWith(exampleImagePrefix(EXAMPLES[0].id))).toBe(true)
    expect(textOf(EXAMPLES[0].bodyJson)).toBeTruthy()
    expect(WITHOUT.examples).toEqual([])
    expect(styleExamples({ ...WITH_EXAMPLES })).toHaveLength(EXAMPLES.length)
  })

  it('the image route and the held revision\'s `rev` equal template_gallery.py\'s', () => {
    const src = readRepo('api/services/journal_two/template_gallery.py')
    expect(/^EXAMPLE_IMAGE_PATH = "(.*)"$/m.exec(src)?.[1]).toBe(exampleImagePrefix('{item_id}'))
    expect(/^REV_PENDING = "(.*)"$/m.exec(src)?.[1]).toBe(EXAMPLE_REV_PENDING)
  })
})

describe('In use, in the style\'s Preview', () => {
  it('the section renders: one card per example, its title and its stored body, read-only', async () => {
    const sheet = await openPreview()
    const section = within(sheet).getByRole('region', { name: IN_USE_HEADING })
    expect(within(section).getByRole('heading', { name: IN_USE_HEADING })).toBeInTheDocument()
    const cards = within(section).getAllByRole('listitem')
    expect(cards).toHaveLength(EXAMPLES.length)
    EXAMPLES.forEach((e, i) => {
      expect(within(cards[i]).getByRole('heading', { name: e.title })).toBeInTheDocument()
      expect(within(cards[i]).getByText(textOf(e.bodyJson))).toBeInTheDocument()
    })
    // read-only: no editor, nothing to type into, no action on an example
    expect(section.querySelector('[contenteditable]')).toBeNull()
    expect(within(section).queryAllByRole('textbox')).toHaveLength(0)
    expect(within(section).queryAllByRole('button')).toHaveLength(0)
  })

  it('an image src points at the gallery route (the approved copy, never `?rev=pending`)', async () => {
    const sheet = await openPreview()
    const section = within(sheet).getByRole('region', { name: IN_USE_HEADING })
    const img = within(section).getByRole('img')
    const expected = imagesOf(EXAMPLES[0].bodyJson)[0]
    expect(img.getAttribute('src')).toBe(expected)
    expect(img.getAttribute('src').startsWith(exampleImagePrefix(EXAMPLES[0].id))).toBe(true)
    expect(img.getAttribute('src')).not.toMatch(/rev=/)
    expect(img.getAttribute('src')).not.toMatch(/\/api\/j2\/notes\/attachments\//)
  })

  it('no section with no examples', async () => {
    itemAnswer = { ...WITHOUT, id: STYLE.id }
    const sheet = await openPreview()
    expect(within(sheet).queryByRole('region', { name: IN_USE_HEADING })).toBeNull()
    expect(within(sheet).queryByText(IN_USE_HEADING)).toBeNull()
  })

  it('no section when the server sends no `examples` at all (the switch off, an older pod)', async () => {
    const { examples: _drop, ...noKey } = WITH_EXAMPLES
    itemAnswer = { ...noKey, id: STYLE.id }
    const sheet = await openPreview()
    expect(within(sheet).queryByText(IN_USE_HEADING)).toBeNull()
  })
})

describe('ExamplesInUse on its own', () => {
  it('renders nothing for an empty or missing list', () => {
    const { container, rerender } = render(<ExamplesInUse examples={[]} />)
    expect(container.innerHTML).toBe('')
    rerender(<ExamplesInUse />)
    expect(container.innerHTML).toBe('')
  })
})

describe('withHeldImages (the reviewer\'s view of a held revision)', () => {
  it('asks for every image on THIS item\'s gallery route on `?rev=pending`, and touches nothing else', () => {
    const rev = contractBody('template-gallery.examples.item.revision.admin').template
    const body = rev.pendingRevision.payload.bodyJson
    const held = withHeldImages(body, rev.id)
    expect(imagesOf(held)).toEqual(imagesOf(body).map((s) => `${s}?rev=${EXAMPLE_REV_PENDING}`))
    expect(imagesOf(body).length).toBeGreaterThan(0)                                     // non-vacuity
    expect(textOf(held)).toBe(textOf(body))
    expect(imagesOf(withHeldImages(body, 'another-item'))).toEqual(imagesOf(body))     // another item's route: untouched
  })
})
