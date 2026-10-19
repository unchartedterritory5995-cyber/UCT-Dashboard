// app/src/pages/journal-2-0/a11y/layoutLibrary.a11y.test.jsx
//
// P4b Task 7: shared PAGE LAYOUTS in the community library through 8A's axe harness (the ONE way a Notebook rail
// asks axe-core). The gallery and style-library recipes never render a layout item (their lists carry none, and
// layout sharing is off without `capabilities.layoutSharing`), so these are recipes of their own. Each proves the
// state it is about rendered before axe runs:
//   * layout-library-card    -- the Page layouts chip on, a layout card with its badge and Helpful toggle;
//   * layout-library-preview -- a Today layout's Preview: the phase tabs and the Shared / Yours now lists;
//   * layout-library-adopt   -- the adopt confirm with its list of what changes.
// LibraryCard.jsx (the dispatcher that renders the card) is covered by the first.
// The fake server answers with the recorded contract fixtures (`__fixtures__/contract`).
import { describe, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Providers } from './fixtures'
import { axeSurface } from './surface'
import TemplateGallery from '../components/notebook/TemplateGallery'
import { __resetRevisionStateForTests } from '../../../hooks/usePreferences'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { DEFAULT_LAYOUT, LAYOUT_PREF } from '../lib/pageLayouts'
import { contractBody } from '../__fixtures__/contract'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, headers: { get: () => null }, json: () => Promise.resolve(body) })
const ROW = contractBody('template-gallery.list.layouts').templates[0]
const ITEM = contractBody('template-gallery.layouts.item').template
// A Today layout: the recorded Today share as a listed row, with a payload for one phase.
const TODAY = { ...contractBody('template-gallery.layouts.publish.today').template, mine: false, id: 'today-layout-1' }
const TODAY_PAYLOAD = { page: 'today', lists: { market: [{ id: 'regime', shown: true }] } }

function stub(rows) {
  global.fetch = vi.fn((url) => {
    const u = new URL(String(url), 'http://x')
    if (u.pathname === '/api/auth/preferences') return json({ [LAYOUT_PREF]: JSON.stringify(DEFAULT_LAYOUT) })
    if (u.pathname === '/api/j2/template-gallery') {
      const picks = u.searchParams.get('section') === 'picks'
      return json({ templates: rows.filter((t) => !picks || t.featured), viewer: { admin: false },
        capabilities: { layoutSharing: true } })
    }
    if (u.pathname === `/api/j2/template-gallery/${ITEM.id}`) return json({ template: ITEM })
    if (u.pathname === `/api/j2/template-gallery/${TODAY.id}`) return json({ template: { ...TODAY, payload: TODAY_PAYLOAD } })
    return json({ detail: 'Not found' }, 404)
  })
}

function renderGallery() {
  const user = userEvent.setup()
  render(
    <Providers>
      <TemplateGallery onBack={() => {}} initialType="page_layout" />
    </Providers>,
  )
  return user
}

describe('P4b surfaces (shared page layouts)', () => {
  beforeEach(() => {
    __resetRevisionStateForTests()
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_template_gallery_enabled: true, notebook_style_library_enabled: true })
  })
  afterEach(() => { __resetNotebookFlags() })

  axeSurface('layout-library-card', async () => {
    stub([ROW])
    renderGallery()
    const card = (await screen.findByRole('heading', { name: ROW.title })).closest('[data-library-layout]')
    within(card).getByText('Trade page')
    within(card).getByRole('button', { name: `Helpful: ${ROW.title}` })
    within(screen.getByRole('group', { name: 'Filter by type' })).getByRole('button', { name: 'Page layouts' })
    await settle()
  })

  axeSurface('layout-library-preview', async () => {
    stub([TODAY])
    const user = renderGallery()
    const card = (await screen.findByRole('heading', { name: TODAY.title })).closest('[data-library-layout]')
    await user.click(within(card).getByRole('button', { name: `Preview ${TODAY.title}` }))
    const dialog = await screen.findByRole('dialog', { name: `Preview: ${TODAY.title}` })
    await within(dialog).findByRole('group', { name: 'Phase' })
    within(dialog).getByRole('list', { name: 'Shared, Market' })
    within(dialog).getByRole('list', { name: 'Yours now, Market' })
    await settle()
  })

  axeSurface('layout-library-adopt', async () => {
    stub([ROW])
    const user = renderGallery()
    const card = (await screen.findByRole('heading', { name: ROW.title })).closest('[data-library-layout]')
    await user.click(within(card).getByRole('button', { name: `Use this layout: ${ROW.title}` }))
    const dialog = await screen.findByRole('dialog', { name: 'Use this layout for the trade page?' })
    within(dialog).getByRole('list', { name: 'What changes' })
    within(dialog).getByRole('button', { name: 'Use this layout' })
    await settle()
  })
})
