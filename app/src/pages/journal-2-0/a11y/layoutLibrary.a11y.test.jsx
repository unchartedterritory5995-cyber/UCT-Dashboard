// app/src/pages/journal-2-0/a11y/layoutLibrary.a11y.test.jsx
//
// P4b Task 7: shared PAGE LAYOUTS in the community library through 8A's axe harness (the ONE way a Notebook rail
// asks axe-core). The gallery and style-library recipes never render a layout item (their lists carry none, and
// layout sharing is off without `capabilities.layoutSharing`), so these are recipes of their own. Each proves the
// state it is about rendered before axe runs:
//   * layout-library-card    -- the Page layouts chip on, a layout card with its badge and Helpful toggle;
//   * layout-library-preview -- a Today layout's Preview: the phase tabs and the Shared / Yours now lists;
//   * layout-library-adopt   -- the adopt confirm with its list of what changes.
// P4b Task 9 (P4b-AUD-3) adds what Tasks 7 and 8 left out:
//   * layout-library-preview-phase-{premarket,market,postclose} -- EACH phase tab pressed in the Preview, the
//     last one a phase the layout has no list for (its "doesn't change" note);
//   * layout-library-card-unsupported -- a payload:null layout: Use says LAYOUT_UNSUPPORTED_SENTENCE and opens no
//     confirm, and its Preview says the same;
//   * layout-library-share-drop-line  -- the Customize sheet after a share the server answered with dropped panels.
// LibraryCard.jsx (the dispatcher that renders the card) is covered by the first.
// The fake server answers with the recorded contract fixtures (`__fixtures__/contract`).
import { describe, beforeEach, afterEach, vi, expect } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Providers } from './fixtures'
import { axeSurface } from './surface'
import TemplateGallery from '../components/notebook/TemplateGallery'
import { __resetRevisionStateForTests } from '../../../hooks/usePreferences'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { DEFAULT_LAYOUT, LAYOUT_PREF } from '../lib/pageLayouts'
import { contract, contractBody } from '../__fixtures__/contract'
import { LAYOUT_UNSUPPORTED_SENTENCE } from '../lib/styleLibrary'
import PageLayoutEditor from '../components/layout/PageLayoutEditor'
import { LAYOUT_SENT_SENTENCE } from '../components/layout/ShareLayoutForm'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, headers: { get: () => null }, json: () => Promise.resolve(body) })
const ROW = contractBody('template-gallery.list.layouts').templates[0]
const ITEM = contractBody('template-gallery.layouts.item').template
// A Today layout: the recorded Today share as a listed row, with a payload for one phase.
const TODAY = { ...contractBody('template-gallery.layouts.publish.today').template, mine: false, id: 'today-layout-1' }
const TODAY_PAYLOAD = { page: 'today', lists: { market: [{ id: 'regime', shown: true }] } }
// Task 9: a Today layout with lists for Premarket and Market and none for After close, so every tab is rendered and
// the last one is the "doesn't change" state.
const PHASED = { ...TODAY, id: 'today-layout-phased', title: 'Phased Today layout' }
const PHASED_PAYLOAD = { page: 'today', lists: {
  premarket: [{ id: 'notices', shown: true }, { id: 'regime', shown: false }],
  market: [{ id: 'regime', shown: true }, { id: 'myRules', shown: true }],
} }
// A listed layout whose payload the server could not make usable (P4b-T6b-R1): payload null on the single read.
const UNUSABLE = { ...ROW, id: 'layout-unusable', title: 'Unusable layout' }

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
    if (u.pathname === `/api/j2/template-gallery/${PHASED.id}`) return json({ template: { ...PHASED, payload: PHASED_PAYLOAD } })
    if (u.pathname === `/api/j2/template-gallery/${UNUSABLE.id}`) return json({ template: { ...ITEM, ...UNUSABLE, payload: null } })
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
  // Task 9: each phase tab of a Today layout's Preview, pressed in turn.
  const PHASE_TABS = [['premarket', 'Premarket', true], ['market', 'Market', true], ['postclose', 'After close', false]]
  for (const [id, label, hasList] of PHASE_TABS) {
    axeSurface(`layout-library-preview-phase-${id}`, async () => {
      stub([PHASED])
      const user = renderGallery()
      const card = (await screen.findByRole('heading', { name: PHASED.title })).closest('[data-library-layout]')
      await user.click(within(card).getByRole('button', { name: `Preview ${PHASED.title}` }))
      const dialog = await screen.findByRole('dialog', { name: `Preview: ${PHASED.title}` })
      const tabs = await within(dialog).findByRole('group', { name: 'Phase' })
      await user.click(within(tabs).getByRole('button', { name: label }))
      expect(within(tabs).getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true')
      if (hasList) {
        within(dialog).getByRole('list', { name: `Shared, ${label}` })
        within(dialog).getByRole('list', { name: `Yours now, ${label}` })
      } else {
        within(dialog).getByText(`This layout doesn't change ${label}.`)
        expect(within(dialog).queryByRole('list', { name: `Shared, ${label}` })).toBeNull()
      }
      await settle()
    })
  }

  // Task 9 (P4b-T6b-R1): a payload:null layout card. Use reads the item, says the sentence, and opens no confirm;
  // Preview says the same sentence and reads no lists.
  axeSurface('layout-library-card-unsupported', async () => {
    stub([UNUSABLE])
    const user = renderGallery()
    const card = (await screen.findByRole('heading', { name: UNUSABLE.title })).closest('[data-library-layout]')
    await user.click(within(card).getByRole('button', { name: `Use this layout: ${UNUSABLE.title}` }))
    await screen.findByText(LAYOUT_UNSUPPORTED_SENTENCE)
    expect(screen.queryByRole('dialog', { name: /^Use this layout/ })).toBeNull()
    await user.click(within(card).getByRole('button', { name: `Preview ${UNUSABLE.title}` }))
    const dialog = await screen.findByRole('dialog', { name: `Preview: ${UNUSABLE.title}` })
    await within(dialog).findByText(LAYOUT_UNSUPPORTED_SENTENCE)
    expect(within(dialog).queryByRole('group', { name: 'Phase' })).toBeNull()
    await settle()
  })

  // Task 9: the share form's answer with a drop line, in the Customize sheet.
  axeSurface('layout-library-share-drop-line', async () => {
    const NONE = contractBody('template-gallery.layouts.status.none')
    const PUBLISH = contract('template-gallery.layouts.publish').body
    global.fetch = vi.fn((url, init = {}) => {
      const u = new URL(String(url), 'http://x')
      const method = init.method || 'GET'
      if (u.pathname === '/api/auth/preferences' && method === 'GET') return json({ [LAYOUT_PREF]: JSON.stringify(DEFAULT_LAYOUT) })
      if (u.pathname === '/api/j2/template-gallery/layouts/status') return json(NONE)
      if (u.pathname === '/api/j2/template-gallery/layouts' && method === 'POST') return json({ ...PUBLISH, droppedPanels: 2 })
      if (u.pathname === '/api/j2/telemetry') return json({ ok: true })
      return json({ detail: 'Not found' }, 404)
    })
    __resetNotebookFlags()
    latchNotebookFlags({ journal_page_layouts_enabled: true, notebook_template_gallery_enabled: true, notebook_style_library_enabled: true })
    const user = userEvent.setup()
    render(<Providers><PageLayoutEditor page="trade" onClose={() => {}} onSaved={() => {}} onFindLayouts={() => {}} /></Providers>)
    await screen.findAllByRole('checkbox', { name: /^Show / })
    const dialog = screen.getByRole('dialog', { name: 'Customize trade page' })
    await user.click(await within(dialog).findByRole('button', { name: 'Share this layout' }))
    const form = within(dialog).getByRole('form', { name: 'Share this layout' })
    await user.selectOptions(within(form).getByLabelText('Category'), 'journal')
    await user.click(within(form).getByRole('button', { name: 'Submit' }))
    await within(dialog).findByText(`${LAYOUT_SENT_SENTENCE} 2 panels this version doesn't show were left out.`)
    await settle()
  })
})
