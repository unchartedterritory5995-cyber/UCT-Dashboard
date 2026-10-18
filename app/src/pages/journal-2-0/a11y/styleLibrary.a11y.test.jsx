// app/src/pages/journal-2-0/a11y/styleLibrary.a11y.test.jsx
//
// P3a Task 9: the community STYLE library through 8A's axe harness (the ONE way a Notebook rail asks
// axe-core). The gallery recipes in templateGallery.a11y.test.jsx run with the library switch OFF, so
// they never render these components -- hence recipes of their own rather than a `coveredBy` entry
// that would be untrue. Each recipe proves the state it is about rendered before axe runs:
//   * style-library-card   -- the Styles view: a style card with its Adopt confirm open;
//   * style-library-author -- an author's page with its Follow toggle and their items.
// Task 11 adds the library's member-facing surfaces under components/notebook/styles/ (outside the derived
// population, so they are OUTSIDE_POPULATION_SURFACES in notebookSurfaces.js), each with the switch on:
//   * style-library-share-form   -- "Share to community" for one of the member's styles, filled in;
//   * style-library-update-sheet -- an author's update to an adopted copy: "Adds blocks", the outline box, Update;
//   * style-library-door         -- the door from New note / Styles, open on the library at Styles.
// The fake server answers with the recorded contract fixtures (`__fixtures__/contract`).
import { describe, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Providers, installFetch } from './fixtures'
import { axeSurface } from './surface'
import TemplateGallery from '../components/notebook/TemplateGallery'
import ShareStyleForm, { SHARE_NOTE } from '../components/notebook/styles/ShareStyleForm'
import LibraryUpdateSheet, { TAKE_OUTLINE_LABEL, addsBlocksLine } from '../components/notebook/styles/LibraryUpdateSheet'
import LibraryDoor from '../components/notebook/styles/LibraryDoor'
import { GALLERY_CATEGORIES } from '../lib/templateGallery'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { contractBody } from '../__fixtures__/contract'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
const STYLES = contractBody('template-gallery.list.styles').templates
const STYLE = STYLES[0]
const PAGE = contractBody('template-gallery.authors.page')

function stub() {
  global.fetch = vi.fn((url) => {
    const u = new URL(String(url), 'http://x')
    if (u.pathname === '/api/j2/template-gallery') {
      const picks = u.searchParams.get('section') === 'picks'
      return json({ templates: STYLES.filter((t) => !picks || t.featured), viewer: { admin: false } })
    }
    if (u.pathname === `/api/j2/template-gallery/authors/${PAGE.author.handle}`) return json(PAGE)
    return json({ detail: 'Not found' }, 404)
  })
}

function renderGallery() {
  const user = userEvent.setup()
  render(
    <Providers>
      <TemplateGallery onBack={() => {}} initialType="style" />
    </Providers>,
  )
  return user
}

describe('P3a surfaces (community style library)', () => {
  beforeEach(() => {
    stub()
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_template_gallery_enabled: true, notebook_style_library_enabled: true })
  })
  afterEach(() => { __resetNotebookFlags() })

  axeSurface('style-library-card', async () => {
    const user = renderGallery()
    await screen.findByRole('heading', { name: STYLE.title })
    screen.getByRole('group', { name: 'Filter by trading style' })
    await user.click(screen.getByRole('button', { name: `Adopt ${STYLE.title}` }))
    within(screen.getByRole('group', { name: `Adopt ${STYLE.title}?` }))
      .getByRole('checkbox', { name: 'Notify me when the author updates' })
    await settle()
  })

  axeSurface('style-library-author', async () => {
    const user = renderGallery()
    await screen.findByRole('heading', { name: STYLE.title })
    await user.click(screen.getByRole('button', { name: `See styles by ${STYLE.author}` }))
    await screen.findByRole('heading', { name: PAGE.author.label })
    screen.getByRole('button', { name: `Follow ${PAGE.author.label}` })
    await settle()
  })
})

// ── Task 11: the styles/ surfaces ───────────────────────────────────────────
const LIST = contractBody('journal-styles.list')
const MEMBER = LIST.styles.find((s) => !s.builtin)
const APPLIED = contractBody('template-gallery.updates.apply').style
const PLAN = contractBody('template-gallery.updates.plan').plan
// The adopted copy as the list shows it before the update, and a plan whose outline the author changed (so the
// outline box and its preview region are on screen): spreads of the recorded objects, never a retyped shape.
const COPY = { ...APPLIED, version: PLAN.fromVersion, sourceVersion: PLAN.fromVersion, blocks: [] }
const PLAN_OUTLINE = { ...PLAN, outlineChanged: true, newOutline: APPLIED.outlineBodyJson }

describe('P3a surfaces (the styles/ doors, Task 11)', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_journal_styles_enabled: true, notebook_template_gallery_enabled: true,
      notebook_style_library_enabled: true })
  })
  afterEach(() => { __resetNotebookFlags() })

  axeSurface('style-library-share-form', async () => {
    installFetch([
      [new RegExp(`^/api/j2/journal-styles/${MEMBER.id}$`), { style: { ...MEMBER, outlineBodyJson: null } }],
      [/^\/api\/j2\/note-templates$/, { templates: [] }],
    ])
    const user = userEvent.setup()
    render(<Providers><ShareStyleForm style={MEMBER} onShared={() => {}} onClose={() => {}} /></Providers>)
    const form = await screen.findByRole('form', { name: `Share ${MEMBER.name} to community` })
    await user.selectOptions(within(form).getByLabelText('Category'), GALLERY_CATEGORIES[0].key)
    within(form).getByText(SHARE_NOTE)
    within(form).getByRole('button', { name: 'Submit' })
    await settle()
  })

  axeSurface('style-library-update-sheet', async () => {
    installFetch([
      [/^\/api\/j2\/journal-styles$/, { ...LIST, styles: [...LIST.styles, COPY] }],
      [new RegExp(`^/api/j2/template-gallery/updates/${COPY.id}$`), { plan: PLAN_OUTLINE }],
    ])
    render(<Providers><LibraryUpdateSheet styleId={COPY.id} onClose={() => {}} onApplied={() => {}} /></Providers>)
    await screen.findByText(addsBlocksLine(PLAN.addBlocks))
    screen.getByRole('checkbox', { name: TAKE_OUTLINE_LABEL })
    screen.getByRole('region', { name: "The author's new outline" })
    await screen.findByRole('button', { name: 'Update my copy' })
    await settle()
  })

  axeSurface('style-library-door', async () => {
    stub()
    const user = userEvent.setup()
    render(<Providers><LibraryDoor label="Community styles" /></Providers>)
    await user.click(screen.getByRole('button', { name: 'Community styles' }))
    await screen.findByRole('dialog', { name: 'Community styles' })
    await screen.findByRole('heading', { name: STYLE.title })
    within(screen.getByRole('group', { name: 'Filter by type' })).getByRole('button', { name: 'Styles', pressed: true })
    await settle()
  })
})
