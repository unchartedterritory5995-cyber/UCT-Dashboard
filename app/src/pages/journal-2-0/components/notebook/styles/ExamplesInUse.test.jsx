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
import ExamplesInUse, { IN_USE_HEADING, REPORT_EXAMPLE_LABEL } from './ExamplesInUse'

// P5 Task 3: the list fixtures now also carry UCT's fifteen firm styles (the starter packs' rows),
// and one of the swing three shares this member item's title ("Weekend prep"). These tests are
// about a MEMBER's listed style and its In use examples, so they serve exactly the member rows,
// the set the fixture held before P5 (ruling P5-T11-R3). The firm rows are pinned server-side
// (tests/test_firm_style_seed.py).
const memberRows = (list) => ({ ...list, templates: list.templates.filter((t) => !t.firm) })
const STYLE = memberRows(contractBody('template-gallery.list.styles')).templates[0]
const WITH_EXAMPLES = contractBody('template-gallery.examples.style-item').template
const WITHOUT = contractBody('template-gallery.styles.item').template
const EXAMPLES = WITH_EXAMPLES.examples
const textOf = (doc) => (doc?.content || []).filter((n) => n.type === 'paragraph')
  .map((n) => (n.content || []).map((t) => t.text || '').join('')).find(Boolean)
const imagesOf = (doc) => (doc?.content || []).filter((n) => n.type === 'image').map((n) => n.attrs.src)
const readRepo = (rel) => readFileSync(resolve(process.cwd(), '..', rel), 'utf8')

let itemAnswer
let listMine
let reports
beforeEach(() => {
  itemAnswer = { ...WITH_EXAMPLES, id: STYLE.id }
  listMine = false
  reports = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url), 'http://x')
    const method = (init.method || 'GET').toUpperCase()
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
    if (u.pathname === '/api/j2/template-gallery' && method === 'GET') {
      const list = memberRows(contractBody('template-gallery.list.styles'))
      const picks = u.searchParams.get('section') === 'picks'
      return json({ ...list, templates: list.templates.filter((t) => !picks || t.featured).map((t) => ({ ...t, mine: listMine })),
        viewer: { admin: false } })
    }
    const reported = u.pathname.match(/^\/api\/j2\/template-gallery\/([\w-]+)\/report$/)
    if (reported && method === 'POST') {
      reports.push({ id: reported[1], body: JSON.parse(init.body) })
      return json(contractBody('template-gallery.report'))
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
    // read-only: no editor, nothing to type into, and the one action on an example is its Report (P3b-F-R8)
    expect(section.querySelector('[contenteditable]')).toBeNull()
    expect(within(section).queryAllByRole('textbox')).toHaveLength(0)
    expect(within(section).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
      .toEqual(EXAMPLES.map((e) => `Report ${e.title}`))
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
    // the author's alt text, as the reduction stored it (P3b-T2-R4): never decorative to a screen reader
    const alt = EXAMPLES[0].bodyJson.content.find((n) => n.type === 'image').attrs.alt
    expect(alt).toBeTruthy()
    expect(img).toHaveAttribute('alt', alt)
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

describe('P3b-F-R8: Report on an In use card', () => {
  it('reports THAT example through the gallery\'s own report flow, and says so on its card', async () => {
    const user = userEvent.setup()
    const sheet = await openPreview()
    const section = within(sheet).getByRole('region', { name: IN_USE_HEADING })
    const [card] = within(section).getAllByRole('listitem')
    const [e] = EXAMPLES
    const button = within(card).getByRole('button', { name: `Report ${e.title}` })
    expect(button).toHaveTextContent(REPORT_EXAMPLE_LABEL)
    expect(button.querySelector('svg')).not.toBeNull()                                 // a UIcon, never an emoji
    expect(button.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const form = within(card).getByRole('form', { name: `Report ${e.title}` })      // the gallery's ReportForm
    await user.selectOptions(within(form).getByLabelText('Why are you reporting it?'), 'broken')
    await user.type(within(form).getByLabelText(/Anything a moderator should know/), 'An account number shows.')
    await user.click(within(form).getByRole('button', { name: 'Send report' }))
    expect(await within(card).findByText(`Thanks. A moderator will review “${e.title}”.`)).toHaveAttribute('role', 'status')
    expect(reports).toEqual([{ id: e.id, body: { reason: 'broken', note: 'An account number shows.' } }])
    expect(e.id).not.toBe(STYLE.id)                                                     // the example's, not the style's
    expect(within(card).queryByRole('form')).toBeNull()
    expect(button).toHaveFocus()                                                         // focus back on Report
  })

  it('the style\'s own author gets no Report on its examples (they are theirs)', async () => {
    listMine = true
    const sheet = await openPreview()
    const section = within(sheet).getByRole('region', { name: IN_USE_HEADING })
    expect(within(section).getAllByRole('listitem')).toHaveLength(EXAMPLES.length)    // non-vacuity: the cards are there
    expect(within(section).queryAllByRole('button')).toHaveLength(0)
  })

  it('the control is a full touch target, coloured from tokens', () => {
    const css = readRepo('app/src/pages/journal-2-0/components/notebook/TemplateGallery.module.css')
    const rule = /\.inUseReport \{([^}]*)\}/.exec(css)?.[1] || ''
    expect(rule).toMatch(/min-height: var\(--tap-min, 44px\)/)
    expect(rule).toMatch(/min-width: var\(--tap-min, 44px\)/)
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b|rgb/i)                                   // no colour literal of its own
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
