// W11-R76 (review I-3, live on master): no `{{block:<id>}}` text reaches a member on ANY door that previews an
// outline. One rule per layer, and only one:
//   * a CARD line is the server's (`template_gallery.preview_lines` / `_summary`, railed by
//     tests/test_gallery_no_block_tokens.py);
//   * an OUTLINE a member previews goes through `outlineWithBlockNames` (lib/templateSlots.js), which mirrors the
//     server's compose rule when the style's block list is known and names every placeholder when it is not.
//
// Two halves:
//   1. A CENSUS of every file that hands a body to `DocBody` or `TemplatePreview`, derived from the source tree each
//      run (never a hand-kept list of files to check). Each such file either routes the body through
//      `outlineWithBlockNames` or is a COMPOSED-body surface named below with its reason. A new surface fails here
//      by name until it says which it is.
//   2. RENDERS of the outline-preview doors from the REAL recorded server answer that holds placeholders
//      (`template-gallery.item.official`: `{{block:prepLevels}}`, `{{block:prepEarnings}}`, `{{block:routine_a}}`):
//      the gallery's outline preview, the review queue's preview and Your templates' preview. The detail sheet and
//      the share preview have their own rails (TemplateDetailSheet.test.jsx R3, SharePreviewSheet.test.jsx R4).
// The authoring surface (StyleEditor's outline text box and its hint) is where a member TYPES the grammar, so it
// is not a preview door; its preview is the server's composed body.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import TemplateGallery from './TemplateGallery'
import TemplatePicker from './TemplatePicker'
import TemplateGalleryReviewPanel from '../../../../components/admin/TemplateGalleryReviewPanel'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { contractBody } from '../../__fixtures__/contract'

vi.mock('./library/openAdoptSheet', () => ({ openAdoptSheet: vi.fn(() => () => {}) }))

const TOKEN = '{{block:'
const OFFICIAL = contractBody('template-gallery.item.official').template
const LISTED = contractBody('template-gallery.list').templates
const OUTLINE_ROW = LISTED.find((t) => !t.firm) || LISTED[0]
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

// ── 1. the census ────────────────────────────────────────────────────────────────────────────────────────────────

const SRC = join(process.cwd(), 'src')
const walkJs = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkJs(p, out)
    else if (p.endsWith('.js') && !/\.test\.js$/.test(p)) out.push(p)
  }
  return out
}
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.jsx') && !/\.test\.jsx$/.test(p)) out.push(p)
  }
  return out
}
/** Surfaces whose body is COMPOSED by the server (placeholders already placed) or that define the renderer. */
const COMPOSED = {
  'pages/journal-2-0/components/notebook/TemplatePreview.jsx': 'defines DocBody / TemplatePreview',
  'pages/journal-2-0/components/notebook/TemplatePicker.jsx': 'renders the previews MemberTemplates and the built-in catalog hand it (MemberTemplates names its blocks; the catalog holds none)',
  'pages/journal-2-0/components/notebook/styles/KindSection.jsx': "the journal-styles preview: the server's composed body, embeds labelled",
  'pages/journal-2-0/components/notebook/styles/StyleEditor.jsx': "the style's preview: the server's composed body",
  'pages/journal-2-0/components/notebook/styles/ExamplePreviewSheet.jsx': 'an example note: a composed, reduced body',
  'pages/journal-2-0/components/notebook/styles/ExamplesInUse.jsx': 'an example note: a composed, reduced body',
  'pages/journal-2-0/components/notebook/styles/StyleItemPreview.jsx': "a library style's Preview: the journal-styles preview door's composed body",
}

describe('every outline-preview door names its blocks (census)', () => {
  const files = walk(SRC).filter((f) => /<DocBody\b|<TemplatePreview\b/.test(readFileSync(f, 'utf8')))
  it('finds the doors (non-vacuity)', () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
  })
  for (const f of files) {
    const rel = relative(SRC, f).split('\\').join('/')
    it(`${rel}: routes its outline through outlineWithBlockNames, or is a named composed surface`, () => {
      const src = readFileSync(f, 'utf8')
      expect(src.includes('outlineWithBlockNames(') || Object.hasOwn(COMPOSED, rel)).toBe(true)
    })
  }
  it('MemberTemplates (which hands TemplatePicker its body) names its blocks', () => {
    const src = readFileSync(join(SRC, 'pages/journal-2-0/components/notebook/MemberTemplates.jsx'), 'utf8')
    expect(src).toContain('outlineWithBlockNames(')
  })
})

// W11-R77 (review n-1): the census covers NOTE-CREATION doors too, not only preview renderers. Every client file that
// reads a member template's body (`getMemberTemplate(`) to preview it OR to make a note from it passes the body
// through `outlineWithBlockNames`, so the note holds exactly what the preview showed and never a raw placeholder.
// (The server's note-creation doors are railed by tests/test_note_creation_doors_no_block_tokens.py.)
describe('every door that makes a note from a member template names its blocks (census)', () => {
  const DEFINER = 'pages/journal-2-0/lib/memberTemplates.js'
  const files = walk(SRC, []).concat(walkJs(SRC)).filter((f) => readFileSync(f, 'utf8').includes('getMemberTemplate('))
    .map((f) => relative(SRC, f).split('\\').join('/')).filter((r) => r !== DEFINER)
  it('finds the preview door and the Use door (non-vacuity)', () => {
    expect(files).toEqual(expect.arrayContaining(['pages/journal-2-0/components/notebook/MemberTemplates.jsx',
      'pages/journal-2-0/tabs/NotebookTab.jsx']))
  })
  for (const rel of files) {
    it(`${rel}: a member template's body goes through outlineWithBlockNames`, () => {
      expect(readFileSync(join(SRC, rel), 'utf8')).toContain('outlineWithBlockNames(')
    })
  }
})

// ── 2. the renders ───────────────────────────────────────────────────────────────────────────────────────────────

let routes
beforeEach(() => {
  latchNotebookFlags({ notebook_template_gallery_enabled: true })
  routes = {}
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url), 'http://x')
    const method = init.method || 'GET'
    const hit = routes[`${method} ${u.pathname}`]
    if (hit) return json(typeof hit === 'function' ? hit(u) : hit)
    if (u.pathname === '/api/j2/template-gallery' && method === 'GET') return json({ templates: LISTED, viewer: { admin: false } })
    if (u.pathname === '/api/j2/note-templates' && method === 'GET') return json({ templates: [] })
    return json({}, 404)
  })
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const swr = (ui) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <MemoryRouter>{ui}</MemoryRouter>
  </SWRConfig>
)
const NAMES = ['Key levels from my plans', 'Earnings for my names']

describe('the outline-preview doors, from the real recorded outline (renders)', () => {
  it('non-vacuity: the recorded outline holds placeholders, the slot among them', () => {
    const raw = JSON.stringify(OFFICIAL.bodyJson)
    for (const id of ['prepLevels', 'prepEarnings', 'routine_a']) expect(raw).toContain(`{{block:${id}}}`)
  })

  it("the community gallery's outline preview", async () => {
    routes[`GET /api/j2/template-gallery/${OUTLINE_ROW.id}`] = { template: { ...OUTLINE_ROW, bodyJson: OFFICIAL.bodyJson } }
    const user = userEvent.setup()
    render(swr(<TemplateGallery onBack={() => {}} onUseNow={() => {}} />))
    await user.click((await screen.findAllByRole('button', { name: `Preview ${OUTLINE_ROW.title}` }))[0])
    const sheet = await screen.findByRole('dialog', { name: OUTLINE_ROW.title })
    for (const n of NAMES) expect(await within(sheet).findByText(n)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(TOKEN)
  })

  it("the review queue's preview of a style (its block list known)", async () => {
    const PENDING = { id: OFFICIAL.id, title: OFFICIAL.title, author: 'UCT', category: OFFICIAL.category,
      description: '', itemType: 'outline' }
    routes['GET /api/j2/template-gallery/admin/queue'] = { pending: [PENDING], reported: [], hidden: [] }
    routes[`GET /api/j2/template-gallery/${OFFICIAL.id}`] = { template: { ...OFFICIAL, itemType: 'outline' } }
    const user = userEvent.setup()
    render(swr(<TemplateGalleryReviewPanel onMessage={vi.fn()} />))
    await user.click(await screen.findByRole('button', { name: `Preview ${OFFICIAL.title}` }))
    const sheet = await screen.findByRole('dialog', { name: OFFICIAL.title })
    for (const n of NAMES) expect(await within(sheet).findByText(n)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(TOKEN)
  })

  it("Your templates' preview (a template used as a style outline)", async () => {
    routes['GET /api/j2/note-templates'] = { templates: [{ id: 't1', name: 'Night prep', title: 'Night prep', createdAt: '1' }] }
    routes['GET /api/j2/note-templates/t1'] = { template: { id: 't1', name: 'Night prep', title: 'Night prep', bodyJson: OFFICIAL.bodyJson } }
    const user = userEvent.setup()
    render(swr(<TemplatePicker onPick={vi.fn()} onPickMember={vi.fn()} />))
    await user.click(await screen.findByRole('button', { name: 'Preview Night prep' }))
    const sheet = await screen.findByRole('dialog', { name: 'Night prep' })
    for (const n of NAMES) expect(await within(sheet).findByText(n)).toBeInTheDocument()
    await waitFor(() => expect(document.body.textContent).not.toContain(TOKEN))
  })
})
