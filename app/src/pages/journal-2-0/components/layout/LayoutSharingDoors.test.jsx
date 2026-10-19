// P4b Task 8: sharing a page layout from Customize, and the door into the shared layouts library.
// The REAL editor (through PageLayoutEditorSlot's lazy import), the REAL preferences hook, ShareLayoutForm and
// LayoutLibraryDoor, over a fake server that answers with the recorded contract fixtures (`__fixtures__/contract`):
// the layouts status (nothing shared / pending), the publish answer, and the layouts list. Where a case needs a
// value no recording holds (an approved share, droppedPanels > 0, sharing off) it spreads the recorded object and
// names the one field it changes. The pages' own wiring (Find closes Customize, then opens the door; the trade
// page's key guard) is in TodaySurface.layout.test.jsx and TradeDetailPage.layout.test.jsx.
// ⛔ Feedback is asserted by RENDERED TEXT, never by a state transition.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, within, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import PageLayoutEditorSlot from './PageLayoutEditorSlot'
import LayoutLibraryDoor, { LIBRARY_TITLE } from './LayoutLibraryDoor'
import { SAVE_FIRST_HINT } from './PageLayoutEditor'
import { SHARE_LAYOUT_NOTE, LAYOUT_SENT_SENTENCE, LAYOUT_REVISION_SENT_SENTENCE } from './ShareLayoutForm'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { DEFAULT_LAYOUT, LAYOUT_PREF } from '../../lib/pageLayouts'
import { contract, contractBody } from '../../__fixtures__/contract'

const NONE = contractBody('template-gallery.layouts.status.none')
const PENDING = contractBody('template-gallery.layouts.status.pending')
const PUBLISH = contract('template-gallery.layouts.publish')
const LIST = contractBody('template-gallery.list.layouts')
// The trade page's share, listed at version 1 with no update held: the recorded pending share, approved.
const APPROVED = { shared: { ...PENDING.shared, trade: { ...PENDING.shared.trade, status: 'approved',
  listedAt: PENDING.shared.trade.createdAt, version: 1, hasRevision: false } } }

const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body })
const SAVED = JSON.parse(JSON.stringify(DEFAULT_LAYOUT))

let server
let calls
beforeEach(() => {
  server = { status: NONE, statusCode: 200, publish: PUBLISH.body }
  calls = []
  __resetRevisionStateForTests()
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url), 'http://x')
    const method = init.method || 'GET'
    calls.push({ path: u.pathname, search: u.search, method, body: init.body ? JSON.parse(init.body) : null })
    if (u.pathname === '/api/auth/preferences' && method === 'GET') return json({ [LAYOUT_PREF]: JSON.stringify(server.saved || SAVED) })
    if (u.pathname === '/api/auth/preferences' && method === 'POST') {
      server.saved = JSON.parse(JSON.parse(init.body).value)
      return json({ version: 1 })
    }
    if (u.pathname === '/api/j2/template-gallery/layouts/status') {
      return server.statusCode === 200 ? json(server.status) : json({ detail: 'Not Found' }, server.statusCode)
    }
    if (u.pathname === '/api/j2/template-gallery/layouts' && method === 'POST') {
      if (server.publishGate) await server.publishGate
      return json(server.publish, server.publishCode || 200)
    }
    if (u.pathname === '/api/j2/telemetry') return json({ ok: true })
    if (u.pathname === '/api/j2/template-gallery' && method === 'GET') {
      return json({ templates: u.searchParams.get('type') === 'page_layout' ? LIST.templates : [], viewer: { admin: false },
        capabilities: { layoutSharing: true } })
    }
    return json({ detail: 'Not found' }, 404)
  })
  latchNotebookFlags({ notebook_template_gallery_enabled: true, notebook_style_library_enabled: true })
})
afterEach(() => { __resetNotebookFlags() })

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const sharePosts = () => calls.filter((c) => c.path === '/api/j2/template-gallery/layouts' && c.method === 'POST')
const prefPosts = () => calls.filter((c) => c.path === '/api/auth/preferences' && c.method === 'POST')
const writes = () => calls.filter((c) => c.method !== 'GET' && c.path !== '/api/j2/telemetry')
const TITLES = { today: 'Customize Today', trade: 'Customize trade page' }

// A page's Customize button and the editor it opens, as the pages wire them (open, close, Find).
function Host({ page, onFind }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Customize</button>
      {open && <PageLayoutEditorSlot page={page} initialPhase="market" onClose={() => setOpen(false)} onFindLayouts={onFind} />}
    </>
  )
}

function renderEditor(page = 'trade', onFind = vi.fn()) {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Host page={page} onFind={onFind} />
      </SWRConfig>
    </MemoryRouter>,
  )
  return { user, onFind }
}

async function editorDialog(page = 'trade') {
  await screen.findAllByRole('checkbox', { name: /^Show / })
  return screen.getByRole('dialog', { name: TITLES[page] })
}

describe('the recorded answers hold what these rails read (non-vacuity)', () => {
  it('nothing shared is null for both pages; the pending share is the trade page, pending; publish answers a summary', () => {
    expect(NONE.shared).toEqual({ today: null, trade: null })
    expect(PENDING.shared.trade.status).toBe('pending')
    expect(PENDING.shared.today).toBeNull()
    expect(PUBLISH.body.droppedPanels).toBe(0)
    expect(PUBLISH.body.template.hasRevision).toBe(false)
    expect(Object.keys(PUBLISH._contract.requestBody).sort()).toEqual(['category', 'description', 'page', 'title', 'tradingStyle'])
  })
})

describe('1. layout sharing off (the status read is a 404)', () => {
  for (const page of ['today', 'trade']) {
    it(`${page}: Customize offers no Share and no Find, and says nothing about sharing`, async () => {
      server.statusCode = 404
      renderEditor(page)
      const dialog = await editorDialog(page)
      await waitFor(() => expect(calls.some((c) => c.path === '/api/j2/template-gallery/layouts/status')).toBe(true))
      await settle()
      expect(within(dialog).queryByRole('button', { name: 'Share this layout' })).not.toBeInTheDocument()
      expect(within(dialog).queryByRole('button', { name: 'Find shared layouts' })).not.toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument()   // the editor itself is there
    })
  }

  it('a failed status read (500) renders nothing new either', async () => {
    server.statusCode = 500
    renderEditor('trade')
    const dialog = await editorDialog()
    await settle()
    expect(within(dialog).queryByRole('button', { name: 'Share this layout' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('control: with sharing on, both buttons are there', async () => {
    renderEditor('trade')
    const dialog = await editorDialog()
    expect(await within(dialog).findByRole('button', { name: 'Share this layout' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Find shared layouts' })).toBeEnabled()
  })
})

describe('2. sharing a page that is not shared yet', () => {
  it('Share opens the form in the same sheet; Submit posts exactly the page and the fields; the sent sentence renders', async () => {
    server.publish = { ...PUBLISH.body, droppedPanels: 2 }
    const { user } = renderEditor('trade')
    const dialog = await editorDialog()
    expect(within(dialog).queryByText('Shared, waiting for review.')).not.toBeInTheDocument()   // not shared: no line
    await user.click(await within(dialog).findByRole('button', { name: 'Share this layout' }))
    const form = within(dialog).getByRole('form', { name: 'Share this layout' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)                                     // not a second sheet
    expect(within(form).getByText(SHARE_LAYOUT_NOTE)).toBeInTheDocument()
    expect(SHARE_LAYOUT_NOTE).toBe('An admin reviews it before it is listed. Only which panels show, and their order, are shared.')
    const title = within(form).getByLabelText('Title in the library')
    expect(title).toHaveValue('My trade page layout')
    expect(within(form).getByRole('button', { name: 'Submit' })).toBeDisabled()               // a category is required
    await user.clear(title)
    await user.type(title, 'Story first')
    await user.type(within(form).getByLabelText("What it's for (optional)"), 'The story, then the outcome.')
    await user.selectOptions(within(form).getByLabelText('Category'), 'journal')
    await user.selectOptions(within(form).getByLabelText('Trading style (optional)'), 'swing')
    await user.click(within(form).getByRole('button', { name: 'Submit' }))
    expect(await within(dialog).findByText(`${LAYOUT_SENT_SENTENCE} 2 panels this version doesn't show were left out.`)).toBeInTheDocument()
    expect(LAYOUT_SENT_SENTENCE).toBe('Sent for review. It is listed once an admin approves it.')
    expect(sharePosts()).toHaveLength(1)
    expect(JSON.stringify(sharePosts()[0].body)).toBe(JSON.stringify({
      page: 'trade', title: 'Story first', description: 'The story, then the outcome.', category: 'journal', tradingStyle: 'swing',
    }))
    expect(writes()).toHaveLength(1)                                                          // no preference, no note
    expect(within(dialog).queryByRole('form')).not.toBeInTheDocument()                        // back to the editor
    // the editor puts focus back on Share in the next frame (requestAnimationFrame): wait for it, never sample it
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Share this layout' })).toHaveFocus())
  })

  it('Today: the title starts as My Today layout, and one dropped panel is said in the singular', async () => {
    server.publish = { ...PUBLISH.body, template: { ...PUBLISH.body.template, layoutPage: 'today' }, droppedPanels: 1 }
    const { user } = renderEditor('today')
    const dialog = await editorDialog('today')
    await user.click(await within(dialog).findByRole('button', { name: 'Share this layout' }))
    const form = within(dialog).getByRole('form', { name: 'Share this layout' })
    expect(within(form).getByLabelText('Title in the library')).toHaveValue('My Today layout')
    await user.selectOptions(within(form).getByLabelText('Category'), 'review')
    await user.click(within(form).getByRole('button', { name: 'Submit' }))
    expect(await within(dialog).findByText(`${LAYOUT_SENT_SENTENCE} 1 panel this version doesn't show was left out.`)).toBeInTheDocument()
    expect(sharePosts()[0].body).toEqual({ page: 'today', title: 'My Today layout', description: '', category: 'review', tradingStyle: '' })
  })

  it('a refusal says the server’s sentence and nothing was sent; Cancel goes back to the editor', async () => {
    const refused = contract('template-gallery.layouts.publish.nothing-to-share')
    server.publish = refused.body
    server.publishCode = refused._contract.status
    const { user } = renderEditor('trade')
    const dialog = await editorDialog()
    await user.click(await within(dialog).findByRole('button', { name: 'Share this layout' }))
    const form = within(dialog).getByRole('form', { name: 'Share this layout' })
    await user.selectOptions(within(form).getByLabelText('Category'), 'journal')
    await user.click(within(form).getByRole('button', { name: 'Submit' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent(refused.body.detail)
    await user.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(within(dialog).queryByRole('form')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })
})

// P4b-T8 m3: Cancel is disabled while a share is in flight, so Escape and the sheet's close are refused too.
describe('2b. a share in flight cannot be escaped', () => {
  it('Escape and the close button do nothing until the answer lands; then the sent sentence renders', async () => {
    let release
    server.publishGate = new Promise((r) => { release = r })
    const { user } = renderEditor('trade')
    const dialog = await editorDialog()
    await user.click(await within(dialog).findByRole('button', { name: 'Share this layout' }))
    const form = within(dialog).getByRole('form', { name: 'Share this layout' })
    await user.selectOptions(within(form).getByLabelText('Category'), 'journal')
    await user.click(within(form).getByRole('button', { name: 'Submit' }))
    expect(within(form).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await settle()
    expect(within(dialog).getByRole('form', { name: 'Share this layout' })).toBeInTheDocument()   // not escaped
    release()
    expect(await within(dialog).findByText(LAYOUT_SENT_SENTENCE, { exact: false })).toBeInTheDocument()
    expect(within(dialog).queryByRole('form')).not.toBeInTheDocument()
    expect(sharePosts()).toHaveLength(1)
  })

  it('control: with no share in flight, Escape closes the form back to the editor', async () => {
    const { user } = renderEditor('trade')
    const dialog = await editorDialog()
    await user.click(await within(dialog).findByRole('button', { name: 'Share this layout' }))
    expect(within(dialog).getByRole('form', { name: 'Share this layout' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await settle()
    expect(within(dialog).queryByRole('form')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('after a refused share, Escape closes the form again (the guard is released)', async () => {
    const refused = contract('template-gallery.layouts.publish.nothing-to-share')
    server.publish = refused.body
    server.publishCode = refused._contract.status
    const { user } = renderEditor('trade')
    const dialog = await editorDialog()
    await user.click(await within(dialog).findByRole('button', { name: 'Share this layout' }))
    const form = within(dialog).getByRole('form', { name: 'Share this layout' })
    await user.selectOptions(within(form).getByLabelText('Category'), 'journal')
    await user.click(within(form).getByRole('button', { name: 'Submit' }))
    await within(form).findByRole('alert')
    fireEvent.keyDown(document, { key: 'Escape' })
    await settle()
    expect(within(dialog).queryByRole('form')).not.toBeInTheDocument()
  })
})

describe('3. Share waits for the draft to be saved', () => {
  it('an unsaved toggle disables Share with the hint; Save, reopen Customize, and Share is enabled', async () => {
    const { user } = renderEditor('trade')
    let dialog = await editorDialog()
    const share = await within(dialog).findByRole('button', { name: 'Share this layout' })
    expect(share).toBeEnabled()
    expect(within(dialog).queryByText(SAVE_FIRST_HINT)).not.toBeInTheDocument()
    await user.click(within(dialog).getAllByRole('checkbox')[0])                               // an unsaved toggle
    expect(within(dialog).getByRole('button', { name: 'Share this layout' })).toBeDisabled()
    const hint = within(dialog).getByText(SAVE_FIRST_HINT)
    expect(SAVE_FIRST_HINT).toBe('Save your changes first, then share.')
    expect(within(dialog).getByRole('button', { name: 'Share this layout' }).getAttribute('aria-describedby')).toBe(hint.id)
    await user.click(within(dialog).getAllByRole('checkbox')[0])                               // undone: not an edit
    expect(within(dialog).getByRole('button', { name: 'Share this layout' })).toBeEnabled()
    await user.click(within(dialog).getAllByRole('checkbox')[0])
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(prefPosts()).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Customize' }))                       // X10: reopen
    dialog = await editorDialog()
    expect(await within(dialog).findByRole('button', { name: 'Share this layout' })).toBeEnabled()
    expect(within(dialog).queryByText(SAVE_FIRST_HINT)).not.toBeInTheDocument()
    expect(sharePosts()).toHaveLength(0)
  })
})

describe('4. a page whose layout is already shared', () => {
  it('approved: the status line reads Listed. Version 1. and a new share says the listed version stays', async () => {
    server.status = APPROVED
    server.publish = { ...PUBLISH.body, template: { ...PUBLISH.body.template, status: 'approved', hasRevision: true } }
    const { user } = renderEditor('trade')
    const dialog = await editorDialog()
    expect(await within(dialog).findByText('Listed. Version 1.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Share this layout' }))
    const form = within(dialog).getByRole('form', { name: 'Share this layout' })
    await user.selectOptions(within(form).getByLabelText('Category'), 'journal')
    await user.click(within(form).getByRole('button', { name: 'Submit' }))
    expect(await within(dialog).findByText(LAYOUT_REVISION_SENT_SENTENCE)).toBeInTheDocument()
    expect(LAYOUT_REVISION_SENT_SENTENCE).toBe('Sent for review. The version listed now stays listed until an admin approves this update.')
  })

  it('pending: the status line reads Shared, waiting for review.', async () => {
    server.status = PENDING
    renderEditor('trade')
    const dialog = await editorDialog()
    expect(await within(dialog).findByText('Shared, waiting for review.')).toBeInTheDocument()
  })

  it('an approved share with an update held says so', async () => {
    server.status = { shared: { ...APPROVED.shared, trade: { ...APPROVED.shared.trade, hasRevision: true } } }
    renderEditor('trade')
    const dialog = await editorDialog()
    expect(await within(dialog).findByText('Listed. Your update is waiting for review.')).toBeInTheDocument()
  })

  it('the status line is the page’s own: Today says nothing while only the trade page is shared', async () => {
    server.status = PENDING
    renderEditor('today')
    const dialog = await editorDialog('today')
    await within(dialog).findByRole('button', { name: 'Share this layout' })
    expect(within(dialog).queryByText('Shared, waiting for review.')).not.toBeInTheDocument()
  })
})

describe('5. Find shared layouts, and the door', () => {
  it('Find calls the page’s onFindLayouts and writes nothing', async () => {
    const { user, onFind } = renderEditor('trade')
    const dialog = await editorDialog()
    await user.click(await within(dialog).findByRole('button', { name: 'Find shared layouts' }))
    expect(onFind).toHaveBeenCalledTimes(1)
    expect(writes()).toHaveLength(0)
  })

  it('no onFindLayouts: no Find button (Share still offered)', async () => {
    renderEditor('trade', null)
    const dialog = await editorDialog()
    await within(dialog).findByRole('button', { name: 'Share this layout' })
    expect(within(dialog).queryByRole('button', { name: 'Find shared layouts' })).not.toBeInTheDocument()
  })

  it('the door opens the library at Page layouts in one sheet, and renders nothing while closed', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <MemoryRouter>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <LayoutLibraryDoor open={false} onClose={onClose} />
        </SWRConfig>
      </MemoryRouter>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <LayoutLibraryDoor open onClose={onClose} />
        </SWRConfig>
      </MemoryRouter>,
    )
    const sheet = await screen.findByRole('dialog', { name: LIBRARY_TITLE })
    expect(LIBRARY_TITLE).toBe('Shared page layouts')
    expect((await within(sheet).findAllByRole('heading', { name: LIST.templates[0].title })).length).toBeGreaterThan(0)
    const types = within(sheet).getByRole('group', { name: 'Filter by type' })
    expect(within(types).getByRole('button', { name: 'Page layouts' }).getAttribute('aria-pressed')).toBe('true')
    expect(calls.some((c) => c.path === '/api/j2/template-gallery' && c.search.includes('type=page_layout'))).toBe(true)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})

describe('7. names', () => {
  it('every new control has an accessible name', async () => {
    const { user } = renderEditor('trade')
    const dialog = await editorDialog()
    expect(await within(dialog).findByRole('button', { name: 'Share this layout' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Find shared layouts' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Share this layout' }))
    const form = within(dialog).getByRole('form', { name: 'Share this layout' })
    for (const label of ['Title in the library', "What it's for (optional)", 'Category', 'Trading style (optional)']) {
      expect(within(form).getByLabelText(label)).toBeInTheDocument()
    }
    expect(within(form).getByRole('button', { name: 'Submit' })).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(form).getByLabelText('Title in the library')).toHaveFocus()                // focus moves into the form
  })
})
